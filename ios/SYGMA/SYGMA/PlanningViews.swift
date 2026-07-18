import SwiftUI
import UIKit

struct BoxesView: View {
    @Environment(AppStore.self) private var store
    @State private var selectedBox: SygmaBox?
    @State private var showsCreate = false

    var body: some View {
        SYGMAScreen(
            eyebrow: "Boxes",
            title: "관리 영역",
            subtitle: "\(store.snapshot.boxes.count)개 영역",
            actions: {
                Button("새 Box") { showsCreate = true }
                    .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.blue))
            }
        ) {
            SYGMAPanel {
                SYGMASectionHeader("삶의 영역", detail: "Goal과 Project의 최상위 분류")
                if sortedBoxes.isEmpty {
                    EmptyPlanningState(message: "Box가 없습니다. 가장 큰 관리 영역부터 만들어 보세요.")
                } else {
                    LazyVStack(spacing: 0) {
                        ForEach(sortedBoxes) { box in
                            PlanningRow(
                                title: box.name,
                                subtitle: boxSummary(box),
                                badge: boxVisibilityLabel(box.visibility),
                                tint: color(for: box.color)
                            ) { selectedBox = box }
                        }
                    }
                }
            }
        }
        .refreshable { await store.refreshFromRemote() }
        .sheet(item: $selectedBox) { BoxEditorSheet(box: $0) }
        .sheet(isPresented: $showsCreate) { BoxEditorSheet(box: nil) }
    }

    private var sortedBoxes: [SygmaBox] {
        store.snapshot.boxes.sorted {
            if $0.visibility != $1.visibility { return $0.visibility == "pinned" }
            return $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
    }

    private func boxSummary(_ box: SygmaBox) -> String {
        let goals = store.snapshot.goals.filter { $0.boxID == box.id }.count
        let projects = store.snapshot.projects.filter { $0.boxID == box.id }.count
        let tasks = store.snapshot.tasks.filter { $0.boxID == box.id && !$0.isDone && !$0.isCanceled }.count
        return "Goals \(goals) · Projects \(projects) · Tasks \(tasks)"
    }
}

struct GoalsView: View {
    @Environment(AppStore.self) private var store
    @State private var selectedGoal: SygmaGoal?
    @State private var showsCreate = false

    var body: some View {
        SYGMAScreen(
            eyebrow: "Goals",
            title: "결과 목표",
            subtitle: "\(activeGoals.count)개 진행 중",
            actions: {
                Button("새 Goal") { showsCreate = true }
                    .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.teal))
            }
        ) {
            SYGMAPanel {
                SYGMASectionHeader("목표", detail: "Box 안의 측정 가능한 결과")
                if sortedGoals.isEmpty {
                    EmptyPlanningState(message: "Goal이 없습니다. 달성할 결과를 하나 정해 보세요.")
                } else {
                    LazyVStack(spacing: 0) {
                        ForEach(sortedGoals) { goal in
                            PlanningRow(
                                title: goal.name,
                                subtitle: goalSummary(goal),
                                badge: goalStatusLabel(goal.status),
                                tint: goal.status == "focus" ? SYGMATheme.violet : SYGMATheme.teal
                            ) { selectedGoal = goal }
                        }
                    }
                }
            }
        }
        .refreshable { await store.refreshFromRemote() }
        .sheet(item: $selectedGoal) { GoalEditorSheet(goal: $0) }
        .sheet(isPresented: $showsCreate) { GoalEditorSheet(goal: nil) }
    }

    private var activeGoals: [SygmaGoal] {
        store.snapshot.goals.filter { ["active", "focus"].contains($0.status) }
    }

    private var sortedGoals: [SygmaGoal] {
        store.snapshot.goals.sorted {
            let left = goalStatusRank($0.status)
            let right = goalStatusRank($1.status)
            if left != right { return left < right }
            return ($0.targetDate, $0.name) < ($1.targetDate, $1.name)
        }
    }

    private func goalSummary(_ goal: SygmaGoal) -> String {
        let box = store.snapshot.boxes.first { $0.id == goal.boxID }?.name ?? "Box 없음"
        let period = [goal.year, goal.quarter].filter { !$0.isEmpty }.joined(separator: " ")
        let target = goal.targetDate.isEmpty ? "목표일 없음" : goal.targetDate
        return [box, period, target].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

struct ProjectsView: View {
    @Environment(AppStore.self) private var store
    @State private var selectedProject: SygmaProject?
    @State private var showsCreate = false

    var body: some View {
        SYGMAScreen(
            eyebrow: "Projects",
            title: "실행 묶음",
            subtitle: "\(activeProjects.count)개 진행 중",
            actions: {
                Button("새 Project") { showsCreate = true }
                    .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.violet))
            }
        ) {
            projectSection("집중과 진행", projects: activeProjects)
            projectSection("계획", projects: plannedProjects)
            if !closedProjects.isEmpty { projectSection("완료와 중단", projects: closedProjects) }
        }
        .refreshable { await store.refreshFromRemote() }
        .sheet(item: $selectedProject) { ProjectEditorSheet(project: $0) }
        .sheet(isPresented: $showsCreate) { ProjectEditorSheet(project: nil) }
    }

    private var activeProjects: [SygmaProject] {
        sorted(store.snapshot.projects.filter { ["focus", "active"].contains($0.status) })
    }

    private var plannedProjects: [SygmaProject] {
        sorted(store.snapshot.projects.filter { ["planned", "unplanned", "paused"].contains($0.status) })
    }

    private var closedProjects: [SygmaProject] {
        sorted(store.snapshot.projects.filter { ["completed", "canceled"].contains($0.status) })
    }

    private func sorted(_ projects: [SygmaProject]) -> [SygmaProject] {
        projects.sorted {
            let left = projectStatusRank($0.status)
            let right = projectStatusRank($1.status)
            if left != right { return left < right }
            return ($0.endDate, $0.name) < ($1.endDate, $1.name)
        }
    }

    private func projectSection(_ title: String, projects: [SygmaProject]) -> some View {
        SYGMAPanel {
            SYGMASectionHeader(title, detail: "\(projects.count)개")
            if projects.isEmpty {
                EmptyPlanningState(message: "이 구간의 Project가 없습니다.")
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(projects) { project in
                        PlanningRow(
                            title: project.name,
                            subtitle: projectSummary(project),
                            badge: projectStatusLabel(project.status),
                            tint: project.status == "focus" ? SYGMATheme.violet : SYGMATheme.blue
                        ) { selectedProject = project }
                    }
                }
            }
        }
    }

    private func projectSummary(_ project: SygmaProject) -> String {
        let goal = store.snapshot.goals.first { $0.id == project.goalID }?.name
        let box = store.snapshot.boxes.first { $0.id == project.boxID }?.name
        let relation = goal ?? box ?? "연결 없음"
        let period: String
        if project.startDate.isEmpty && project.endDate.isEmpty {
            period = "기간 없음"
        } else {
            period = "\(project.startDate.isEmpty ? "?" : project.startDate) → \(project.endDate.isEmpty ? "?" : project.endDate)"
        }
        let taskCount = store.snapshot.tasks.filter { $0.projectID == project.id && !$0.isDone && !$0.isCanceled }.count
        return "\(relation) · \(period) · Tasks \(taskCount)"
    }
}

struct BoxEditorSheet: View {
    let box: SygmaBox?

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft: BoxDraft
    @State private var confirmsDelete = false

    init(box: SygmaBox?) {
        self.box = box
        _draft = State(initialValue: box.map(BoxDraft.init) ?? BoxDraft())
    }

    var body: some View {
        EntityEditorScaffold(title: box == nil ? "새 Box" : "Box 편집") {
            SYGMAFormTextField(label: "이름", text: $draft.name)
            SYGMAMenuField(label: "구분", selection: $draft.visibility, choices: [
                ("pinned", "고정"), ("normal", "일반"), ("archived", "아카이브"),
            ])
            SYGMAMenuField(label: "색상", selection: $draft.color, choices: [
                ("blue", "Blue"), ("teal", "Teal"), ("amber", "Amber"),
                ("violet", "Violet"), ("rose", "Rose"),
            ])
            editorActions(canDelete: box != nil, canSave: !draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, confirmsDelete: $confirmsDelete, save: save)
        }
        .confirmationDialog("이 Box를 삭제할까요? 연결된 항목은 삭제되지 않고 Box 연결만 해제됩니다.", isPresented: $confirmsDelete, titleVisibility: .visible) {
            Button("삭제", role: .destructive) {
                store.deleteBox(draft.id)
                dismiss()
            }
        }
    }

    private func save() {
        if box == nil { store.createBox(draft) } else { store.updateBox(draft) }
        finishEditor(dismiss)
    }
}

struct GoalEditorSheet: View {
    let goal: SygmaGoal?

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft: GoalDraft
    @State private var hasTargetDate: Bool
    @State private var targetDate: Date
    @State private var confirmsDelete = false

    init(goal: SygmaGoal?) {
        self.goal = goal
        let value = goal.map(GoalDraft.init) ?? GoalDraft()
        _draft = State(initialValue: value)
        _hasTargetDate = State(initialValue: !value.targetDate.isEmpty)
        _targetDate = State(initialValue: Date.from(dateKey: value.targetDate) ?? Date().addingDays(30))
    }

    var body: some View {
        EntityEditorScaffold(title: goal == nil ? "새 Goal" : "Goal 편집") {
            SYGMAFormTextField(label: "이름", text: $draft.name)
            SYGMAMenuField(label: "상태", selection: $draft.status, choices: goalStatusChoices)
            RelationPicker(label: "Box", selection: $draft.boxID, items: store.snapshot.boxes.map { ($0.id, $0.name) })
            HStack(spacing: 14) {
                SYGMAFormTextField(label: "연도", text: $draft.year)
                SYGMAMenuField(label: "분기", selection: $draft.quarter, choices: [
                    ("1Q", "1Q"), ("2Q", "2Q"), ("3Q", "3Q"), ("4Q", "4Q"),
                ])
            }
            Toggle("목표일 설정", isOn: $hasTargetDate)
                .tint(SYGMATheme.teal)
            if hasTargetDate {
                DatePicker("목표일", selection: $targetDate, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .tint(SYGMATheme.teal)
            }
            editorActions(canDelete: goal != nil, canSave: !draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, confirmsDelete: $confirmsDelete, save: save)
        }
        .confirmationDialog("이 Goal을 삭제할까요? Project와 Task의 Goal 연결만 해제됩니다.", isPresented: $confirmsDelete, titleVisibility: .visible) {
            Button("삭제", role: .destructive) {
                store.deleteGoal(draft.id)
                dismiss()
            }
        }
    }

    private func save() {
        draft.targetDate = hasTargetDate ? targetDate.dateKey : ""
        if goal == nil { store.createGoal(draft) } else { store.updateGoal(draft) }
        finishEditor(dismiss)
    }
}

struct ProjectEditorSheet: View {
    let project: SygmaProject?

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft: ProjectDraft
    @State private var hasStartDate: Bool
    @State private var startDate: Date
    @State private var hasEndDate: Bool
    @State private var endDate: Date
    @State private var confirmsDelete = false

    init(project: SygmaProject?) {
        self.project = project
        let value = project.map(ProjectDraft.init) ?? ProjectDraft()
        _draft = State(initialValue: value)
        _hasStartDate = State(initialValue: !value.startDate.isEmpty)
        _startDate = State(initialValue: Date.from(dateKey: value.startDate) ?? Date())
        _hasEndDate = State(initialValue: !value.endDate.isEmpty)
        _endDate = State(initialValue: Date.from(dateKey: value.endDate) ?? Date().addingDays(14))
    }

    var body: some View {
        EntityEditorScaffold(title: project == nil ? "새 Project" : "Project 편집") {
            SYGMAFormTextField(label: "이름", text: $draft.name)
            SYGMAMenuField(label: "상태", selection: $draft.status, choices: projectStatusChoices)
            RelationPicker(label: "Box", selection: $draft.boxID, items: store.snapshot.boxes.map { ($0.id, $0.name) })
                .onChange(of: draft.boxID) { _, next in
                    if let goal = store.snapshot.goals.first(where: { $0.id == draft.goalID }), goal.boxID != next {
                        draft.goalID = ""
                    }
                }
            RelationPicker(
                label: "Goal",
                selection: $draft.goalID,
                items: store.snapshot.goals
                    .filter { draft.boxID.isEmpty || $0.boxID == draft.boxID }
                    .map { ($0.id, $0.name) }
            )
            .onChange(of: draft.goalID) { _, next in
                if let goal = store.snapshot.goals.first(where: { $0.id == next }), !goal.boxID.isEmpty {
                    draft.boxID = goal.boxID
                }
            }
            Toggle("시작일 설정", isOn: $hasStartDate).tint(SYGMATheme.violet)
            if hasStartDate { DatePicker("시작일", selection: $startDate, displayedComponents: .date) }
            Toggle("종료일 설정", isOn: $hasEndDate).tint(SYGMATheme.violet)
            if hasEndDate { DatePicker("종료일", selection: $endDate, in: hasStartDate ? startDate... : Date.distantPast..., displayedComponents: .date) }
            editorActions(canDelete: project != nil, canSave: !draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, confirmsDelete: $confirmsDelete, save: save)
        }
        .confirmationDialog("이 Project를 삭제할까요? Task와 Habit의 Project 연결만 해제됩니다.", isPresented: $confirmsDelete, titleVisibility: .visible) {
            Button("삭제", role: .destructive) {
                store.deleteProject(draft.id)
                dismiss()
            }
        }
    }

    private func save() {
        draft.startDate = hasStartDate ? startDate.dateKey : ""
        draft.endDate = hasEndDate ? (hasStartDate ? max(endDate, startDate) : endDate).dateKey : ""
        if project == nil { store.createProject(draft) } else { store.updateProject(draft) }
        finishEditor(dismiss)
    }
}

struct RelationPicker: View {
    let label: String
    @Binding var selection: String
    let items: [(String, String)]

    var body: some View {
        LabeledContent(label) {
            Picker(label, selection: $selection) {
                Text("없음").tag("")
                ForEach(items, id: \.0) { id, name in Text(name).tag(id) }
            }
            .pickerStyle(.menu)
            .tint(SYGMATheme.ink)
        }
        .frame(minHeight: SYGMATheme.minimumTapTarget)
        .overlay(alignment: .bottom) { SYGMATheme.horizontalDivider().frame(height: 1) }
    }
}

struct SYGMAFormTextField: View {
    let label: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.caption.weight(.bold)).foregroundStyle(SYGMATheme.muted)
            TextField(label, text: $text)
                .textInputAutocapitalization(.sentences)
                .frame(minHeight: SYGMATheme.minimumTapTarget)
                .overlay(alignment: .bottom) { SYGMATheme.horizontalDivider().frame(height: 1) }
        }
    }
}

struct SYGMAMenuField: View {
    let label: String
    @Binding var selection: String
    let choices: [(String, String)]

    var body: some View {
        LabeledContent(label) {
            Picker(label, selection: $selection) {
                ForEach(choices, id: \.0) { value, title in Text(title).tag(value) }
            }
            .pickerStyle(.menu)
            .tint(SYGMATheme.ink)
        }
        .frame(minHeight: SYGMATheme.minimumTapTarget)
        .overlay(alignment: .bottom) { SYGMATheme.horizontalDivider().frame(height: 1) }
    }
}

private struct EntityEditorScaffold<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content
    @Environment(\.dismiss) private var dismiss

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) { content }
                    .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(SYGMATheme.backgroundGradient.ignoresSafeArea())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

private struct PlanningRow: View {
    let title: String
    let subtitle: String
    let badge: String
    let tint: Color
    let action: () -> Void

    var body: some View {
        SYGMACard(accent: tint) {
            Button(action: action) {
                HStack(alignment: .top, spacing: 12) {
                    Rectangle().fill(tint).frame(width: 3, height: 38)
                    VStack(alignment: .leading, spacing: 7) {
                        Text(title).font(.body.weight(.semibold)).foregroundStyle(SYGMATheme.ink)
                        Text(subtitle).font(.caption).foregroundStyle(SYGMATheme.muted).lineLimit(3)
                    }
                    Spacer(minLength: 8)
                    Text(badge)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(tint)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 4)
                        .background(tint.opacity(0.09))
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(SYGMATheme.soft)
                        .frame(minWidth: 24, minHeight: 44)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }
}

private struct EmptyPlanningState: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.subheadline)
            .foregroundStyle(SYGMATheme.muted)
            .frame(maxWidth: .infinity, minHeight: 80)
            .multilineTextAlignment(.center)
    }
}

@ViewBuilder
private func editorActions(
    canDelete: Bool,
    canSave: Bool,
    confirmsDelete: Binding<Bool>,
    save: @escaping () -> Void
) -> some View {
    HStack {
        if canDelete {
            Button("삭제", role: .destructive) { confirmsDelete.wrappedValue = true }
                .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.rose))
        }
        Spacer()
        Button("저장", action: save)
            .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.blue, isActive: true))
            .disabled(!canSave)
    }
}

private func finishEditor(_ dismiss: DismissAction) {
    UINotificationFeedbackGenerator().notificationOccurred(.success)
    dismiss()
}

private let goalStatusChoices = [
    ("not_started", "시작 전"), ("active", "진행 중"), ("focus", "집중"),
    ("paused", "중단"), ("completed", "완료"), ("canceled", "취소"),
]

private let projectStatusChoices = [
    ("unplanned", "계획 전"), ("planned", "계획"), ("active", "진행 중"),
    ("focus", "집중"), ("paused", "중단"), ("completed", "완료"), ("canceled", "취소"),
]

private func goalStatusLabel(_ status: String) -> String {
    Dictionary(uniqueKeysWithValues: goalStatusChoices)[status] ?? status
}

private func projectStatusLabel(_ status: String) -> String {
    Dictionary(uniqueKeysWithValues: projectStatusChoices)[status] ?? status
}

private func boxVisibilityLabel(_ visibility: String) -> String {
    ["pinned": "고정", "normal": "일반", "archived": "아카이브"][visibility] ?? visibility
}

private func goalStatusRank(_ status: String) -> Int {
    ["focus", "active", "not_started", "paused", "completed", "canceled"].firstIndex(of: status) ?? 99
}

private func projectStatusRank(_ status: String) -> Int {
    ["focus", "active", "planned", "unplanned", "paused", "completed", "canceled"].firstIndex(of: status) ?? 99
}

private func color(for name: String) -> Color {
    switch name {
    case "teal": SYGMATheme.teal
    case "amber": SYGMATheme.amber
    case "violet": SYGMATheme.violet
    case "rose": SYGMATheme.rose
    default: SYGMATheme.blue
    }
}
