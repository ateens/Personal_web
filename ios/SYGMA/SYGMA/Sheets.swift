import SwiftUI
import UIKit

private enum QuickCreateKind: String, CaseIterable, Identifiable {
    case task = "할 일"
    case habit = "루틴"
    var id: Self { self }
}

struct QuickCreateSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var kind: QuickCreateKind = .task

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    Picker("생성 유형", selection: $kind) {
                        ForEach(QuickCreateKind.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    if kind == .task {
                        TaskCreationForm(defaultLane: .today) { dismiss() }
                    } else {
                        HabitCreationForm { dismiss() }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 18)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(SYGMATheme.backgroundGradient.ignoresSafeArea())
            .navigationTitle("빠른 생성")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("닫기") { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

struct TaskCreateSheet: View {
    let defaultLane: TaskLane
    var initialDate: Date? = nil
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                TaskCreationForm(defaultLane: defaultLane, initialDate: initialDate) { dismiss() }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 18)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(SYGMATheme.backgroundGradient.ignoresSafeArea())
            .navigationTitle("새 할 일")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() } }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

struct HabitCreateSheet: View {
    var body: some View {
        HabitEditorSheet(habit: nil)
    }
}

struct HabitEditorSheet: View {
    let habit: SygmaHabit?

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft: HabitDraft
    @State private var confirmsDelete = false

    init(habit: SygmaHabit?) {
        self.habit = habit
        _draft = State(initialValue: habit.map(HabitDraft.init) ?? HabitDraft())
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    SYGMAFormTextField(label: "루틴", text: $draft.title)
                    SYGMAFormTextField(label: "성공 기준", text: $draft.target)
                    SYGMAMenuField(label: "상태", selection: $draft.status, choices: [
                        ("active", "활성"), ("paused", "중단"), ("archived", "보관"),
                    ])
                    Picker("반복", selection: $draft.cadence) {
                        Text("매일").tag("daily")
                        Text("평일").tag("weekdays")
                        Text("매주").tag("weekly")
                    }
                    .pickerStyle(.segmented)
                    RelationPicker(label: "Box", selection: $draft.boxID, items: store.snapshot.boxes.map { ($0.id, $0.name) })
                    RelationPicker(
                        label: "Project",
                        selection: $draft.projectID,
                        items: store.snapshot.projects.filter { draft.boxID.isEmpty || $0.boxID == draft.boxID }.map { ($0.id, $0.name) }
                    )

                    HStack {
                        if habit != nil {
                            Button("삭제", role: .destructive) { confirmsDelete = true }
                                .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.rose))
                        }
                        Spacer()
                        Button("저장", action: save)
                            .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.teal, isActive: true))
                            .disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 18)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(SYGMATheme.backgroundGradient.ignoresSafeArea())
            .navigationTitle(habit == nil ? "새 루틴" : "루틴 편집")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } } }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .onAppear {
            if habit == nil, draft.boxID.isEmpty { draft.boxID = store.snapshot.boxes.first?.id ?? "" }
        }
        .onChange(of: draft.boxID) { _, next in
            if let project = store.snapshot.projects.first(where: { $0.id == draft.projectID }), project.boxID != next {
                draft.projectID = ""
            }
        }
        .onChange(of: draft.projectID) { _, next in
            if let project = store.snapshot.projects.first(where: { $0.id == next }), !project.boxID.isEmpty {
                draft.boxID = project.boxID
            }
        }
        .confirmationDialog("이 루틴과 체크 기록을 모두 삭제할까요?", isPresented: $confirmsDelete, titleVisibility: .visible) {
            Button("삭제", role: .destructive) {
                store.deleteHabit(draft.id)
                dismiss()
            }
        }
    }

    private func save() {
        if habit == nil { _ = store.createHabit(draft) } else { store.updateHabit(draft) }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        dismiss()
    }
}

struct TaskEditorSheet: View {
    let task: SygmaTask

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var confirmsDelete = false

    init(task: SygmaTask) {
        self.task = task
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    TaskForm(task: task) { dismiss() }
                    HStack {
                        Button("삭제", role: .destructive) { confirmsDelete = true }
                            .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.rose))
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 18)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(SYGMATheme.backgroundGradient.ignoresSafeArea())
            .navigationTitle("할 일 편집")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } }
            }
            .confirmationDialog("이 할 일을 삭제할까요?", isPresented: $confirmsDelete, titleVisibility: .visible) {
                Button("삭제", role: .destructive) {
                    store.deleteTask(task.id)
                    dismiss()
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

private struct TaskCreationForm: View {
    let defaultLane: TaskLane
    let initialDate: Date?
    let onCreated: () -> Void

    init(defaultLane: TaskLane, initialDate: Date? = nil, onCreated: @escaping () -> Void) {
        self.defaultLane = defaultLane
        self.initialDate = initialDate
        self.onCreated = onCreated
    }

    var body: some View {
        TaskForm(task: nil, defaultLane: defaultLane, initialDate: initialDate, onSaved: onCreated)
    }
}

enum TaskDateChoice: String, CaseIterable, Identifiable {
    case none
    case today
    case tomorrow
    case custom

    var id: Self { self }
    var title: String {
        switch self {
        case .none: "없음"
        case .today: "오늘"
        case .tomorrow: "내일"
        case .custom: "직접 선택"
        }
    }
}

private enum TaskFormProperty: Hashable {
    case status
    case date
    case box
    case goal
    case project
}

private struct TaskForm: View {
    let task: SygmaTask?
    let onSaved: () -> Void

    @Environment(AppStore.self) private var store
    @State private var draft: TaskDraft
    @State private var dateChoice: TaskDateChoice
    @State private var selectedDate: Date
    @State private var expandedProperty: TaskFormProperty?

    init(
        task: SygmaTask?,
        defaultLane: TaskLane = .unplanned,
        initialDate: Date? = nil,
        onSaved: @escaping () -> Void
    ) {
        self.task = task
        self.onSaved = onSaved
        let defaultStatus: String
        switch defaultLane {
        case .completed: defaultStatus = "done"
        case .scheduled: defaultStatus = "scheduled"
        default: defaultStatus = "todo"
        }
        let draft = task.map(TaskDraft.init) ?? TaskDraft(status: defaultStatus)
        let dateKey = task?.dateKey ?? initialDate?.dateKey ?? Self.dateKey(for: defaultLane)
        let choice: TaskDateChoice
        if dateKey.isEmpty { choice = .none }
        else if dateKey == Date().dateKey { choice = .today }
        else if dateKey == Date().addingDays(1).dateKey { choice = .tomorrow }
        else { choice = .custom }
        let day = Date.from(dateKey: dateKey) ?? initialDate ?? Date()
        _draft = State(initialValue: draft)
        _dateChoice = State(initialValue: choice)
        _selectedDate = State(initialValue: day)
        _expandedProperty = State(initialValue: nil)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SYGMAFormTextField(label: "제목", text: $draft.title)
            InlinePropertyPicker(
                label: "상태",
                selection: $draft.status,
                choices: taskStatusChoices,
                selectedTitle: title(for: draft.status, in: taskStatusChoices),
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

            InlinePropertyPicker(
                label: "Box",
                selection: $draft.boxID,
                choices: [("", "없음")] + store.snapshot.boxes.map { ($0.id, $0.name) },
                selectedTitle: store.snapshot.boxes.first(where: { $0.id == draft.boxID })?.name ?? "없음",
                isExpanded: expansionBinding(for: .box),
                tint: SYGMATheme.violet,
                usesFullWidthChoices: true
            )
            InlinePropertyPicker(
                label: "Goal",
                selection: $draft.goalID,
                choices: [("", "없음")] + availableGoals.map { ($0.id, $0.name) },
                selectedTitle: store.snapshot.goals.first(where: { $0.id == draft.goalID })?.name ?? "없음",
                isExpanded: expansionBinding(for: .goal),
                tint: SYGMATheme.violet,
                usesFullWidthChoices: true
            )
            InlinePropertyPicker(
                label: "Project",
                selection: $draft.projectID,
                choices: [("", "없음")] + availableProjects.map { ($0.id, $0.name) },
                selectedTitle: store.snapshot.projects.first(where: { $0.id == draft.projectID })?.name ?? "없음",
                isExpanded: expansionBinding(for: .project),
                tint: SYGMATheme.violet,
                usesFullWidthChoices: true
            )

            Button(task == nil ? "할 일 만들기" : "변경사항 저장", action: save)
                .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.blue, isActive: true))
                .disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .onAppear {
            if task == nil, draft.boxID.isEmpty { draft.boxID = store.snapshot.boxes.first?.id ?? "" }
        }
        .onChange(of: draft.boxID) { _, next in
            if let goal = store.snapshot.goals.first(where: { $0.id == draft.goalID }), goal.boxID != next {
                draft.goalID = ""
            }
            if let project = store.snapshot.projects.first(where: { $0.id == draft.projectID }), project.boxID != next {
                draft.projectID = ""
            }
        }
        .onChange(of: draft.goalID) { _, next in
            if let goal = store.snapshot.goals.first(where: { $0.id == next }), !goal.boxID.isEmpty { draft.boxID = goal.boxID }
            if let project = store.snapshot.projects.first(where: { $0.id == draft.projectID }), !next.isEmpty, project.goalID != next {
                draft.projectID = ""
            }
        }
        .onChange(of: draft.projectID) { _, next in
            if let project = store.snapshot.projects.first(where: { $0.id == next }) {
                if !project.boxID.isEmpty { draft.boxID = project.boxID }
                if !project.goalID.isEmpty { draft.goalID = project.goalID }
            }
        }
    }

    private var availableGoals: [SygmaGoal] {
        store.snapshot.goals.filter { draft.boxID.isEmpty || $0.boxID == draft.boxID }
    }

    private var availableProjects: [SygmaProject] {
        store.snapshot.projects.filter {
            (draft.boxID.isEmpty || $0.boxID == draft.boxID)
                && (draft.goalID.isEmpty || $0.goalID == draft.goalID)
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

    private func expansionBinding(for property: TaskFormProperty) -> Binding<Bool> {
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
        case .today:
            selectedDate = Date()
        case .tomorrow:
            selectedDate = Date().addingDays(1)
        case .none, .custom:
            break
        }
    }

    private func title<Value: Equatable>(for selection: Value, in choices: [(Value, String)]) -> String {
        choices.first(where: { $0.0 == selection })?.1 ?? "없음"
    }

    private func save() {
        applyDate()
        if task == nil { _ = store.createTask(draft) } else { store.updateTask(draft) }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        onSaved()
    }

    private func applyDate() {
        guard dateChoice != .none else {
            draft.dueDate = ""
            return
        }
        let day: Date
        switch dateChoice {
        case .today: day = Date()
        case .tomorrow: day = Date().addingDays(1)
        case .custom: day = selectedDate
        case .none: return
        }
        draft.dueDate = day.dateKey
    }

    private static func dateKey(for lane: TaskLane) -> String {
        switch lane {
        case .unplanned: ""
        case .today, .completed: Date().dateKey
        case .tomorrow: Date().addingDays(1).dateKey
        case .scheduled: ""
        case .overdue: Date().addingDays(-1).dateKey
        }
    }
}

struct InlinePropertyPicker<Value: Hashable, Details: View>: View {
    let label: String
    @Binding var selection: Value
    let choices: [(Value, String)]
    let selectedTitle: String
    @Binding var isExpanded: Bool
    let tint: Color
    let usesFullWidthChoices: Bool
    let autoCollapse: Bool
    let onSelect: (Value) -> Void
    let details: Details

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(
        label: String,
        selection: Binding<Value>,
        choices: [(Value, String)],
        selectedTitle: String,
        isExpanded: Binding<Bool>,
        tint: Color,
        usesFullWidthChoices: Bool = false,
        autoCollapse: Bool = true,
        onSelect: @escaping (Value) -> Void = { _ in },
        @ViewBuilder details: () -> Details
    ) {
        self.label = label
        _selection = selection
        self.choices = choices
        self.selectedTitle = selectedTitle
        _isExpanded = isExpanded
        self.tint = tint
        self.usesFullWidthChoices = usesFullWidthChoices
        self.autoCollapse = autoCollapse
        self.onSelect = onSelect
        self.details = details()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                animate { isExpanded.toggle() }
            } label: {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) {
                        propertyLabel
                            .fixedSize(horizontal: true, vertical: false)
                        Spacer(minLength: 12)
                        selectedValue
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                        disclosureIcon
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        propertyLabel
                        HStack(alignment: .top, spacing: 12) {
                            selectedValue
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 8)
                            disclosureIcon
                                .padding(.top, 3)
                        }
                    }
                    .padding(.vertical, 6)
                }
                .frame(maxWidth: .infinity, minHeight: SYGMATheme.minimumTapTarget)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
            .accessibilityValue(selectedTitle)
            .accessibilityHint(isExpanded ? "두 번 탭하여 후보를 닫습니다." : "두 번 탭하여 후보를 펼칩니다.")

            if isExpanded {
                VStack(alignment: .leading, spacing: 10) {
                    LazyVGrid(
                        columns: usesFullWidthChoices
                            ? [GridItem(.flexible(), spacing: 8)]
                            : [GridItem(.adaptive(minimum: 92, maximum: 180), spacing: 8)],
                        alignment: .leading,
                        spacing: 8
                    ) {
                        ForEach(choices, id: \.0) { value, title in
                            let isSelected = selection == value
                            Button {
                                selection = value
                                onSelect(value)
                                UISelectionFeedbackGenerator().selectionChanged()
                                if autoCollapse { animate { isExpanded = false } }
                            } label: {
                                HStack(spacing: 7) {
                                    if isSelected {
                                        Image(systemName: "checkmark")
                                            .font(.caption.weight(.bold))
                                            .accessibilityHidden(true)
                                    }
                                    Text(title)
                                        .lineLimit(usesFullWidthChoices ? 2 : 1)
                                        .multilineTextAlignment(.leading)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, usesFullWidthChoices ? 4 : 0)
                            }
                            .buttonStyle(InlinePropertyChoiceButtonStyle(tint: tint, isSelected: isSelected))
                            .accessibilityLabel(title)
                            .accessibilityValue(isSelected ? "선택됨" : "")
                            .accessibilityAddTraits(isSelected ? .isSelected : [])
                        }
                    }

                    details
                }
                .padding(.top, 8)
                .padding(.bottom, 12)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .overlay(alignment: .bottom) { SYGMATheme.horizontalDivider(tint).frame(height: 1) }
    }

    private var propertyLabel: some View {
        Text(label)
            .font(.callout.weight(.semibold))
            .foregroundStyle(SYGMATheme.ink)
    }

    private var selectedValue: some View {
        Text(selectedTitle)
            .font(.callout.weight(.medium))
            .foregroundStyle(tint)
            .multilineTextAlignment(.leading)
    }

    private var disclosureIcon: some View {
        Image(systemName: "chevron.down")
            .font(.caption.weight(.bold))
            .foregroundStyle(SYGMATheme.muted)
            .rotationEffect(.degrees(isExpanded ? 180 : 0))
            .accessibilityHidden(true)
    }

    private func animate(_ changes: () -> Void) {
        withAnimation(reduceMotion ? nil : SYGMATheme.standardAnimation, changes)
    }
}

extension InlinePropertyPicker where Details == EmptyView {
    init(
        label: String,
        selection: Binding<Value>,
        choices: [(Value, String)],
        selectedTitle: String,
        isExpanded: Binding<Bool>,
        tint: Color,
        usesFullWidthChoices: Bool = false,
        autoCollapse: Bool = true,
        onSelect: @escaping (Value) -> Void = { _ in }
    ) {
        self.init(
            label: label,
            selection: selection,
            choices: choices,
            selectedTitle: selectedTitle,
            isExpanded: isExpanded,
            tint: tint,
            usesFullWidthChoices: usesFullWidthChoices,
            autoCollapse: autoCollapse,
            onSelect: onSelect
        ) {
            EmptyView()
        }
    }
}

private struct InlinePropertyChoiceButtonStyle: ButtonStyle {
    let tint: Color
    let isSelected: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.callout.weight(isSelected ? .semibold : .medium))
            .foregroundStyle(isSelected ? tint : SYGMATheme.ink)
            .frame(maxWidth: .infinity, minHeight: SYGMATheme.minimumTapTarget)
            .padding(.horizontal, 11)
            .background(
                isSelected ? tint.opacity(0.11) : Color.white.opacity(configuration.isPressed ? 0.34 : 0.58),
                in: RoundedRectangle(cornerRadius: SYGMATheme.cornerRadius, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: SYGMATheme.cornerRadius, style: .continuous)
                    .stroke(isSelected ? tint.opacity(0.7) : SYGMATheme.line, lineWidth: 1)
            }
            .opacity(configuration.isPressed ? 0.72 : 1)
    }
}

private struct HabitCreationForm: View {
    @Environment(AppStore.self) private var store
    @State private var title = ""
    @State private var target = ""
    @State private var cadence = "daily"
    let onCreated: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            UnderlineField(label: "루틴", text: $title)
            UnderlineField(label: "성공 기준", text: $target)
            Picker("반복", selection: $cadence) {
                Text("매일").tag("daily")
                Text("평일").tag("weekdays")
                Text("매주").tag("weekly")
            }
            .pickerStyle(.segmented)

            Button("루틴 만들기") {
                store.createHabit(title: title, target: target, cadence: cadence)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                onCreated()
            }
            .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.teal, isActive: true))
            .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .frame(maxWidth: .infinity, alignment: .trailing)
            Spacer(minLength: 0)
        }
    }
}

private struct TaskLanePicker: View {
    @Binding var lane: TaskLane

    private let choices: [TaskLane] = [.unplanned, .today, .tomorrow, .scheduled, .completed]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("배치")
                .font(.caption.weight(.bold))
                .foregroundStyle(SYGMATheme.muted)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    ForEach(choices) { choice in
                        Button(choice.title) { lane = choice }
                            .buttonStyle(SYGMAUnderlineButtonStyle(
                                tint: choice == .completed ? SYGMATheme.teal : SYGMATheme.blue,
                                isActive: lane == choice
                            ))
                    }
                }
            }
        }
    }
}

private struct UnderlineField: View {
    let label: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption.weight(.bold))
                .foregroundStyle(SYGMATheme.muted)
            TextField(label, text: $text)
                .frame(minHeight: 44)
                .overlay(alignment: .bottom) { SYGMATheme.horizontalDivider().frame(height: 1) }
        }
    }
}

let taskStatusChoices = [
    ("todo", "할 일"), ("scheduled", "예정"), ("doing", "진행"),
    ("waiting", "대기"), ("done", "완료"), ("canceled", "중단"),
]
