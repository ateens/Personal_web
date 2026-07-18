import SwiftUI
import UIKit

struct InboxView: View {
    @Environment(AppStore.self) private var store
    @State private var selectedCapture: SygmaCapture?
    @State private var convertingCapture: SygmaCapture?
    @State private var selectedTask: SygmaTask?
    @State private var selectedProject: SygmaProject?
    @State private var selectedGoal: SygmaGoal?
    @State private var selectedBox: SygmaBox?
    @State private var showsCreate = false

    var body: some View {
        SYGMAScreen(
            eyebrow: "Inbox",
            title: "빠른 수집",
            subtitle: "\(inbox.count)개 미분류",
            actions: {
                Button("새 Capture") { showsCreate = true }
                    .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.blue))
            }
        ) {
            captureSection("미분류", captures: inbox, canConvert: true)
            if !processed.isEmpty { captureSection("최근 처리", captures: processed, canConvert: false) }
            if !archived.isEmpty { captureSection("보관", captures: archived, canConvert: false) }
        }
        .refreshable { await store.refreshFromRemote() }
        .sheet(item: $selectedCapture) { CaptureEditorSheet(capture: $0) }
        .sheet(item: $convertingCapture) { CaptureConvertSheet(capture: $0) }
        .sheet(isPresented: $showsCreate) { CaptureEditorSheet(capture: nil) }
        .sheet(item: $selectedTask) { TaskEditorSheet(task: $0) }
        .sheet(item: $selectedProject) { ProjectEditorSheet(project: $0) }
        .sheet(item: $selectedGoal) { GoalEditorSheet(goal: $0) }
        .sheet(item: $selectedBox) { BoxEditorSheet(box: $0) }
    }

    private var inbox: [SygmaCapture] { sorted(store.snapshot.captures.filter { $0.status == "inbox" }) }
    private var processed: [SygmaCapture] { Array(sorted(store.snapshot.captures.filter { $0.status == "processed" }).prefix(20)) }
    private var archived: [SygmaCapture] { sorted(store.snapshot.captures.filter { $0.status == "archived" }) }

    private func sorted(_ captures: [SygmaCapture]) -> [SygmaCapture] {
        captures.sorted { ($0.createdAt, $0.title) > ($1.createdAt, $1.title) }
    }

    private func captureSection(_ title: String, captures: [SygmaCapture], canConvert: Bool) -> some View {
        SYGMAPanel {
            SYGMASectionHeader(title, detail: "\(captures.count)개")
            if captures.isEmpty {
                Text(title == "미분류" ? "Inbox가 비어 있습니다." : "항목이 없습니다.")
                    .font(.subheadline)
                    .foregroundStyle(SYGMATheme.muted)
                    .frame(maxWidth: .infinity, minHeight: SYGMATheme.emptyStateMinimumHeight)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(captures) { capture in
                        CaptureRow(
                            capture: capture,
                            canConvert: canConvert,
                            onEdit: { selectedCapture = capture },
                            onConvert: { convertingCapture = capture },
                            onOpenConverted: { openConverted(capture) }
                        )
                    }
                }
            }
        }
    }

    private func openConverted(_ capture: SygmaCapture) {
        switch capture.convertedTo {
        case "task", "tasks": selectedTask = store.snapshot.tasks.first { $0.id == capture.convertedID }
        case "project", "projects": selectedProject = store.snapshot.projects.first { $0.id == capture.convertedID }
        case "goal", "goals": selectedGoal = store.snapshot.goals.first { $0.id == capture.convertedID }
        case "box", "boxes": selectedBox = store.snapshot.boxes.first { $0.id == capture.convertedID }
        default: break
        }
    }
}

private struct CaptureRow: View {
    let capture: SygmaCapture
    let canConvert: Bool
    let onEdit: () -> Void
    let onConvert: () -> Void
    let onOpenConverted: () -> Void

    var body: some View {
        SYGMACard(accent: canConvert ? SYGMATheme.blue : SYGMATheme.teal) {
            VStack(alignment: .leading, spacing: 8) {
                Button(action: onEdit) {
                    HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(capture.title)
                                .font(.body.weight(.semibold))
                                .foregroundStyle(SYGMATheme.ink)
                                .multilineTextAlignment(.leading)
                            if !capture.url.isEmpty {
                                Text(capture.url)
                                    .font(.caption)
                                    .foregroundStyle(SYGMATheme.muted)
                                    .lineLimit(1)
                            }
                            if !capture.convertedTo.isEmpty {
                                Text(conversionLabel)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(SYGMATheme.violet)
                            }
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(SYGMATheme.soft)
                            .frame(minWidth: 30, minHeight: 44)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if canConvert {
                    Button("분류하기", action: onConvert)
                        .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.blue, isActive: true))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                } else if !capture.convertedID.isEmpty, capture.convertedTo != "resources" {
                    Button("변환된 항목 열기", action: onOpenConverted)
                        .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.violet))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
        }
    }

    private var conversionLabel: String {
        if capture.convertedTo == "resources" { return "Resource · 웹에서 확인" }
        let names = ["tasks": "Task", "projects": "Project", "goals": "Goal", "boxes": "Box"]
        return "\(names[capture.convertedTo] ?? capture.convertedTo)로 처리됨"
    }
}

struct CaptureEditorSheet: View {
    let capture: SygmaCapture?

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft: CaptureDraft
    @State private var confirmsDelete = false

    init(capture: SygmaCapture?) {
        self.capture = capture
        _draft = State(initialValue: capture.map(CaptureDraft.init) ?? CaptureDraft())
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    SYGMAFormTextField(label: "제목", text: $draft.title)
                    SYGMAFormTextField(label: "URL", text: $draft.url)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SYGMAMenuField(label: "상태", selection: $draft.status, choices: [
                        ("inbox", "Inbox"), ("processed", "처리됨"), ("archived", "보관"),
                    ])
                    if !urlIsValid {
                        Text("URL은 비우거나 http/https 주소를 입력하세요.")
                            .font(.caption)
                            .foregroundStyle(SYGMATheme.rose)
                    }
                    HStack {
                        if capture != nil {
                            Button("삭제", role: .destructive) { confirmsDelete = true }
                                .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.rose))
                        }
                        Spacer()
                        Button("저장", action: save)
                            .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.blue, isActive: true))
                            .disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !urlIsValid)
                    }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(SYGMATheme.backgroundGradient.ignoresSafeArea())
            .navigationTitle(capture == nil ? "새 Capture" : "Capture 편집")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .confirmationDialog("이 Capture를 삭제할까요?", isPresented: $confirmsDelete, titleVisibility: .visible) {
            Button("삭제", role: .destructive) {
                store.deleteCapture(draft.id)
                dismiss()
            }
        }
    }

    private var urlIsValid: Bool {
        let clean = draft.url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return true }
        guard let components = URLComponents(string: clean), let scheme = components.scheme?.lowercased() else { return false }
        return ["http", "https"].contains(scheme) && components.host != nil
    }

    private func save() {
        draft.url = draft.url.trimmingCharacters(in: .whitespacesAndNewlines)
        if capture == nil { store.createCapture(draft) } else { store.updateCapture(draft) }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        dismiss()
    }
}

private enum CapturePlacementProperty: Hashable {
    case status
    case date
    case box
    case goal
    case project
}

struct CaptureConvertSheet: View {
    let capture: SygmaCapture

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var target: CaptureTargetType = .tasks
    @State private var taskStatus = "todo"
    @State private var dateChoice: TaskDateChoice = .none
    @State private var selectedDate = Date()
    @State private var boxID = ""
    @State private var goalID = ""
    @State private var projectID = ""
    @State private var expandedProperty: CapturePlacementProperty?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(capture.title)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(SYGMATheme.ink)
                    Picker("변환 대상", selection: $target) {
                        Text("Task").tag(CaptureTargetType.tasks)
                        Text("Project").tag(CaptureTargetType.projects)
                        Text("Goal").tag(CaptureTargetType.goals)
                        Text("Box").tag(CaptureTargetType.boxes)
                    }
                    .pickerStyle(.segmented)

                    if target == .tasks {
                        InlinePropertyPicker(
                            label: "상태",
                            selection: $taskStatus,
                            choices: taskStatusChoices,
                            selectedTitle: title(for: taskStatus, in: taskStatusChoices),
                            isExpanded: expansionBinding(for: .status),
                            tint: SYGMATheme.blue
                        )
                        InlinePropertyPicker(
                            label: "날짜",
                            selection: $dateChoice,
                            choices: TaskDateChoice.allCases.map { ($0, $0.title) },
                            selectedTitle: dateSummary,
                            isExpanded: expansionBinding(for: .date),
                            tint: SYGMATheme.blue,
                            autoCollapse: false,
                            onSelect: selectDate
                        ) {
                            if dateChoice == .custom {
                                DatePicker("날짜", selection: $selectedDate, displayedComponents: .date)
                                    .datePickerStyle(.graphical)
                                    .tint(SYGMATheme.blue)
                            }
                        }
                    }

                    if target != .boxes {
                        InlinePropertyPicker(
                            label: "Box",
                            selection: $boxID,
                            choices: [("", "없음")] + store.snapshot.boxes.map { ($0.id, $0.name) },
                            selectedTitle: store.snapshot.boxes.first(where: { $0.id == boxID })?.name ?? "없음",
                            isExpanded: expansionBinding(for: .box),
                            tint: SYGMATheme.violet,
                            usesFullWidthChoices: true
                        )
                    }
                    if target == .tasks || target == .projects {
                        InlinePropertyPicker(
                            label: "Goal",
                            selection: $goalID,
                            choices: [("", "없음")] + availableGoals.map { ($0.id, $0.name) },
                            selectedTitle: store.snapshot.goals.first(where: { $0.id == goalID })?.name ?? "없음",
                            isExpanded: expansionBinding(for: .goal),
                            tint: SYGMATheme.violet,
                            usesFullWidthChoices: true
                        )
                    }
                    if target == .tasks {
                        InlinePropertyPicker(
                            label: "Project",
                            selection: $projectID,
                            choices: [("", "없음")] + availableProjects.map { ($0.id, $0.name) },
                            selectedTitle: store.snapshot.projects.first(where: { $0.id == projectID })?.name ?? "없음",
                            isExpanded: expansionBinding(for: .project),
                            tint: SYGMATheme.violet,
                            usesFullWidthChoices: true
                        )
                    }
                    Text(target == .tasks ? "선택한 속성으로 Task가 생성됩니다." : "선택한 연결로 \(targetLabel)가 생성됩니다.")
                        .font(.caption)
                        .foregroundStyle(SYGMATheme.muted)
                    Button("\(targetLabel)로 분류", action: convert)
                        .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.blue, isActive: true))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .padding(20)
            }
            .background(SYGMATheme.backgroundGradient.ignoresSafeArea())
            .navigationTitle("Capture 분류")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } } }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .onChange(of: target) { _, _ in expandedProperty = nil }
        .onChange(of: boxID) { _, next in
            if let goal = store.snapshot.goals.first(where: { $0.id == goalID }), goal.boxID != next { goalID = "" }
            if let project = store.snapshot.projects.first(where: { $0.id == projectID }), project.boxID != next { projectID = "" }
        }
        .onChange(of: goalID) { _, next in
            if let goal = store.snapshot.goals.first(where: { $0.id == next }), !goal.boxID.isEmpty { boxID = goal.boxID }
            if let project = store.snapshot.projects.first(where: { $0.id == projectID }), !next.isEmpty, project.goalID != next { projectID = "" }
        }
        .onChange(of: projectID) { _, next in
            if let project = store.snapshot.projects.first(where: { $0.id == next }) {
                if !project.boxID.isEmpty { boxID = project.boxID }
                if !project.goalID.isEmpty { goalID = project.goalID }
            }
        }
    }

    private var targetLabel: String {
        switch target {
        case .tasks: "Task"
        case .projects: "Project"
        case .goals: "Goal"
        case .boxes: "Box"
        }
    }

    private var availableGoals: [SygmaGoal] {
        store.snapshot.goals.filter { boxID.isEmpty || $0.boxID == boxID }
    }

    private var availableProjects: [SygmaProject] {
        store.snapshot.projects.filter {
            (boxID.isEmpty || $0.boxID == boxID)
                && (goalID.isEmpty || $0.goalID == goalID)
        }
    }

    private var dateSummary: String {
        switch dateChoice {
        case .none: "없음"
        case .today: "오늘"
        case .tomorrow: "내일"
        case .custom: selectedDate.formatted(date: .abbreviated, time: .omitted)
        }
    }

    private var taskDueDate: String {
        switch dateChoice {
        case .none: ""
        case .today: Date().dateKey
        case .tomorrow: Date().addingDays(1).dateKey
        case .custom: selectedDate.dateKey
        }
    }

    private func expansionBinding(for property: CapturePlacementProperty) -> Binding<Bool> {
        Binding(
            get: { expandedProperty == property },
            set: { isExpanded in
                if isExpanded {
                    UIApplication.shared.sendAction(
                        #selector(UIResponder.resignFirstResponder),
                        to: nil,
                        from: nil,
                        for: nil
                    )
                }
                expandedProperty = isExpanded ? property : nil
            }
        )
    }

    private func selectDate(_ choice: TaskDateChoice) {
        switch choice {
        case .today: selectedDate = Date()
        case .tomorrow: selectedDate = Date().addingDays(1)
        case .none, .custom: break
        }
    }

    private func title<Value: Equatable>(for selection: Value, in choices: [(Value, String)]) -> String {
        choices.first(where: { $0.0 == selection })?.1 ?? "없음"
    }

    private func convert() {
        _ = store.convertCapture(
            capture.id,
            to: target,
            boxID: boxID,
            goalID: goalID,
            projectID: projectID,
            taskStatus: taskStatus,
            taskDueDate: target == .tasks ? taskDueDate : ""
        )
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        dismiss()
        switch target {
        case .tasks: store.select(.tasks)
        case .projects: store.select(.projects)
        case .goals: store.select(.goals)
        case .boxes: store.select(.boxes)
        }
    }
}
