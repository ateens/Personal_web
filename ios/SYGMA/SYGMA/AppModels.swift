import Foundation

enum AppSection: String, CaseIterable, Identifiable {
    case today
    case inbox
    case tasks
    case projects
    case goals
    case boxes
    case habits
    case journal
    case calendar
    case settings

    var id: Self { self }

    var title: String {
        switch self {
        case .today: "Today"
        case .inbox: "Inbox"
        case .tasks: "할 일 배치"
        case .projects: "Projects"
        case .goals: "Goals"
        case .boxes: "Boxes"
        case .habits: "Habits"
        case .journal: "Journal"
        case .calendar: "Calendar"
        case .settings: "Settings"
        }
    }

    var subtitle: String {
        switch self {
        case .today: "대시보드"
        case .inbox: "빠른 수집"
        case .tasks: "확인과 날짜 배치"
        case .projects: "실행 묶음"
        case .goals: "결과 목표"
        case .boxes: "삶의 영역"
        case .habits: "루틴"
        case .journal: "회고"
        case .calendar: "캘린더"
        case .settings: "동기화와 보안"
        }
    }

    var symbol: String {
        switch self {
        case .today: "sun.max"
        case .inbox: "tray"
        case .tasks: "checkmark.square"
        case .projects: "square.grid.2x2"
        case .goals: "target"
        case .boxes: "shippingbox"
        case .habits: "circle.dotted"
        case .journal: "book.closed"
        case .calendar: "calendar"
        case .settings: "gearshape"
        }
    }
}

enum TaskLane: String, CaseIterable, Identifiable {
    case unplanned
    case today
    case tomorrow
    case scheduled
    case overdue
    case completed

    var id: Self { self }

    var title: String {
        switch self {
        case .unplanned: "미계획"
        case .today: "오늘"
        case .tomorrow: "내일"
        case .scheduled: "예정"
        case .overdue: "지연"
        case .completed: "완료/중단"
        }
    }

    var emptyMessage: String {
        switch self {
        case .unplanned: "날짜를 정할 Task가 없습니다."
        case .today: "오늘 배치된 Task가 없습니다."
        case .tomorrow: "내일 배치된 Task가 없습니다."
        case .scheduled: "이후 일정이 없습니다."
        case .overdue: "지연된 Task가 없습니다."
        case .completed: "완료하거나 중단한 업무가 없습니다."
        }
    }
}

struct SygmaTask: Identifiable, Hashable {
    static let statuses = ["todo", "scheduled", "doing", "waiting", "done", "canceled"]

    let id: String
    var title: String
    var status: String
    var boxID: String
    var goalID: String
    var projectID: String
    var dueDate: String
    var completedAt: String

    init?(json: JSONValue) {
        guard case let .object(value) = json,
              let id = value["id"]?.stringValue,
              !id.isEmpty else { return nil }
        self.id = id
        title = value["title"]?.stringValue ?? "새 할 일"
        let storedStatus = value["status"]?.stringValue ?? "todo"
        status = storedStatus == "someday"
            ? "scheduled"
            : Self.statuses.contains(storedStatus) ? storedStatus : "todo"
        boxID = value["boxId"]?.stringValue ?? ""
        goalID = value["goalId"]?.stringValue ?? ""
        projectID = value["projectId"]?.stringValue ?? ""
        let storedDate = value["dueDate"]?.stringValue ?? ""
        let legacyStart = value["scheduledStart"]?.stringValue ?? ""
        dueDate = storedStatus == "someday"
            ? String(storedDate.prefix(10))
            : storedDate.isEmpty
                ? (Date.from(isoString: legacyStart)?.dateKey ?? String(legacyStart.prefix(10)))
                : String(storedDate.prefix(10))
        completedAt = value["completedAt"]?.stringValue ?? ""
    }

    var isDone: Bool { status == "done" }
    var isCanceled: Bool { status == "canceled" }
    var completedInstant: Date? { Date.from(isoString: completedAt) }
    var completedDateKey: String {
        completedInstant?.dateKey ?? String(completedAt.prefix(10))
    }
    var dateKey: String { String(dueDate.prefix(10)) }
}

struct TaskDraft: Identifiable, Hashable {
    let id: String
    var title: String
    var status: String
    var boxID: String
    var goalID: String
    var projectID: String
    var dueDate: String

    init(
        id: String = UUID().uuidString.lowercased(),
        title: String = "",
        status: String = "todo",
        boxID: String = "",
        goalID: String = "",
        projectID: String = "",
        dueDate: String = ""
    ) {
        self.id = id
        self.title = title
        self.status = status
        self.boxID = boxID
        self.goalID = goalID
        self.projectID = projectID
        self.dueDate = dueDate
    }

    init(task: SygmaTask) {
        self.init(
            id: task.id,
            title: task.title,
            status: task.status,
            boxID: task.boxID,
            goalID: task.goalID,
            projectID: task.projectID,
            dueDate: task.dueDate
        )
    }
}

struct SygmaHabit: Identifiable, Hashable {
    static let cadences = ["daily", "weekdays", "weekly"]
    static let statuses = ["active", "paused", "archived"]

    let id: String
    var title: String
    var cadence: String
    var target: String
    var status: String
    var boxID: String
    var projectID: String

    init?(json: JSONValue) {
        guard case let .object(value) = json,
              let id = value["id"]?.stringValue,
              !id.isEmpty else { return nil }
        self.id = id
        title = value["title"]?.stringValue ?? "새 루틴"
        cadence = value["cadence"]?.stringValue ?? "daily"
        target = value["target"]?.stringValue ?? ""
        status = value["status"]?.stringValue ?? "active"
        boxID = value["boxId"]?.stringValue ?? ""
        projectID = value["projectId"]?.stringValue ?? ""
    }

    var isActive: Bool { status == "active" }
}

struct HabitDraft: Identifiable, Hashable {
    let id: String
    var title: String
    var cadence: String
    var target: String
    var status: String
    var boxID: String
    var projectID: String

    init(
        id: String = UUID().uuidString.lowercased(),
        title: String = "",
        cadence: String = "daily",
        target: String = "",
        status: String = "active",
        boxID: String = "",
        projectID: String = ""
    ) {
        self.id = id
        self.title = title
        self.cadence = cadence
        self.target = target
        self.status = status
        self.boxID = boxID
        self.projectID = projectID
    }

    init(habit: SygmaHabit) {
        self.init(
            id: habit.id,
            title: habit.title,
            cadence: habit.cadence,
            target: habit.target,
            status: habit.status,
            boxID: habit.boxID,
            projectID: habit.projectID
        )
    }
}

struct HabitInstance: Identifiable, Hashable {
    let id: String
    let habitID: String
    let date: String
    let completed: Bool

    init?(json: JSONValue) {
        guard case let .object(value) = json,
              let id = value["id"]?.stringValue,
              let habitID = value["habitId"]?.stringValue,
              let date = value["date"]?.stringValue else { return nil }
        self.id = id
        self.habitID = habitID
        self.date = date
        completed = value["completed"]?.boolValue ?? false
    }
}

struct SygmaBox: Identifiable, Hashable {
    let id: String
    var name: String
    var visibility: String
    var color: String

    init?(json: JSONValue) {
        guard case let .object(value) = json,
              let id = value["id"]?.stringValue,
              !id.isEmpty else { return nil }
        self.id = id
        name = value["name"]?.stringValue ?? "새 박스"
        visibility = value["visibility"]?.stringValue ?? "normal"
        color = value["color"]?.stringValue ?? "blue"
    }
}

struct BoxDraft: Identifiable, Hashable {
    let id: String
    var name: String
    var visibility: String
    var color: String

    init(
        id: String = UUID().uuidString.lowercased(),
        name: String = "",
        visibility: String = "normal",
        color: String = "blue"
    ) {
        self.id = id
        self.name = name
        self.visibility = visibility
        self.color = color
    }

    init(box: SygmaBox) {
        self.init(id: box.id, name: box.name, visibility: box.visibility, color: box.color)
    }
}

struct SygmaGoal: Identifiable, Hashable {
    static let statuses = ["not_started", "active", "focus", "paused", "completed", "canceled"]

    let id: String
    var name: String
    var status: String
    var boxID: String
    var year: String
    var quarter: String
    var targetDate: String

    init?(json: JSONValue) {
        guard case let .object(value) = json,
              let id = value["id"]?.stringValue,
              !id.isEmpty else { return nil }
        self.id = id
        name = value["name"]?.stringValue ?? "새 목표"
        status = value["status"]?.stringValue ?? "not_started"
        boxID = value["boxId"]?.stringValue ?? ""
        year = value["year"]?.stringValue ?? ""
        quarter = value["quarter"]?.stringValue ?? ""
        targetDate = value["targetDate"]?.stringValue ?? ""
    }
}

struct GoalDraft: Identifiable, Hashable {
    let id: String
    var name: String
    var status: String
    var boxID: String
    var year: String
    var quarter: String
    var targetDate: String

    init(
        id: String = UUID().uuidString.lowercased(),
        name: String = "",
        status: String = "not_started",
        boxID: String = "",
        year: String = String(Calendar.current.component(.year, from: Date())),
        quarter: String = "\((Calendar.current.component(.month, from: Date()) - 1) / 3 + 1)Q",
        targetDate: String = ""
    ) {
        self.id = id
        self.name = name
        self.status = status
        self.boxID = boxID
        self.year = year
        self.quarter = quarter
        self.targetDate = targetDate
    }

    init(goal: SygmaGoal) {
        self.init(
            id: goal.id,
            name: goal.name,
            status: goal.status,
            boxID: goal.boxID,
            year: goal.year,
            quarter: goal.quarter,
            targetDate: goal.targetDate
        )
    }
}

struct SygmaProject: Identifiable, Hashable {
    static let statuses = ["unplanned", "planned", "active", "focus", "paused", "completed", "canceled"]

    let id: String
    var name: String
    var status: String
    var boxID: String
    var goalID: String
    var startDate: String
    var endDate: String

    init?(json: JSONValue) {
        guard case let .object(value) = json,
              let id = value["id"]?.stringValue,
              !id.isEmpty else { return nil }
        self.id = id
        name = value["name"]?.stringValue ?? "새 프로젝트"
        status = value["status"]?.stringValue ?? "unplanned"
        boxID = value["boxId"]?.stringValue ?? ""
        goalID = value["goalId"]?.stringValue ?? ""
        startDate = value["startDate"]?.stringValue ?? ""
        endDate = value["endDate"]?.stringValue ?? ""
    }

    var isActive: Bool { ["active", "focus"].contains(status) }
}

struct ProjectDraft: Identifiable, Hashable {
    let id: String
    var name: String
    var status: String
    var boxID: String
    var goalID: String
    var startDate: String
    var endDate: String

    init(
        id: String = UUID().uuidString.lowercased(),
        name: String = "",
        status: String = "unplanned",
        boxID: String = "",
        goalID: String = "",
        startDate: String = "",
        endDate: String = ""
    ) {
        self.id = id
        self.name = name
        self.status = status
        self.boxID = boxID
        self.goalID = goalID
        self.startDate = startDate
        self.endDate = endDate
    }

    init(project: SygmaProject) {
        self.init(
            id: project.id,
            name: project.name,
            status: project.status,
            boxID: project.boxID,
            goalID: project.goalID,
            startDate: project.startDate,
            endDate: project.endDate
        )
    }
}

struct SygmaCapture: Identifiable, Hashable {
    static let statuses = ["inbox", "processed", "archived"]

    let id: String
    var title: String
    var url: String
    var status: String
    var convertedTo: String
    var convertedID: String
    var createdAt: String
    var processedAt: String

    init?(json: JSONValue) {
        guard case let .object(value) = json,
              let id = value["id"]?.stringValue,
              !id.isEmpty else { return nil }
        self.id = id
        title = value["title"]?.stringValue ?? "새 수집"
        url = value["url"]?.stringValue ?? ""
        status = value["status"]?.stringValue ?? "inbox"
        convertedTo = value["convertedTo"]?.stringValue ?? ""
        convertedID = value["convertedId"]?.stringValue ?? ""
        createdAt = value["createdAt"]?.stringValue ?? ""
        processedAt = value["processedAt"]?.stringValue ?? ""
    }
}

struct CaptureDraft: Identifiable, Hashable {
    let id: String
    var title: String
    var url: String
    var status: String

    init(
        id: String = UUID().uuidString.lowercased(),
        title: String = "",
        url: String = "",
        status: String = "inbox"
    ) {
        self.id = id
        self.title = title
        self.url = url
        self.status = status
    }

    init(capture: SygmaCapture) {
        self.init(id: capture.id, title: capture.title, url: capture.url, status: capture.status)
    }
}

enum CaptureTargetType: String, CaseIterable, Identifiable {
    case tasks
    case projects
    case goals
    case boxes

    var id: Self { self }
}

struct SygmaJournal: Identifiable, Hashable {
    let id: String
    var title: String
    var date: String
    var satisfaction: Int
    var reflection: String
    var nextAction: String

    init?(json: JSONValue) {
        guard case let .object(value) = json,
              let id = value["id"]?.stringValue,
              !id.isEmpty else { return nil }
        self.id = id
        title = value["title"]?.stringValue ?? "새 리뷰"
        date = value["date"]?.stringValue ?? ""
        satisfaction = value["satisfaction"]?.intValue ?? 0
        let blocks = value["blocks"]?.arrayValue ?? []
        reflection = JournalBlockContent.text(after: "오늘의 기록", type: "paragraph", in: blocks)
        nextAction = JournalBlockContent.text(after: "다음 행동", type: "todo", in: blocks)
    }
}

struct JournalDraft: Identifiable, Hashable {
    let id: String
    var title: String
    var date: String
    var satisfaction: Int
    var reflection: String
    var nextAction: String

    init(
        id: String = UUID().uuidString.lowercased(),
        title: String = "",
        date: String = Date().dateKey,
        satisfaction: Int = 7,
        reflection: String = "",
        nextAction: String = ""
    ) {
        self.id = id
        self.title = title
        self.date = date
        self.satisfaction = satisfaction
        self.reflection = reflection
        self.nextAction = nextAction
    }

    init(journal: SygmaJournal) {
        self.init(
            id: journal.id, title: journal.title, date: journal.date,
            satisfaction: journal.satisfaction, reflection: journal.reflection, nextAction: journal.nextAction
        )
    }
}

enum JournalBlockContent {
    static func text(after heading: String, type: String, in blocks: [JSONValue]) -> String {
        let index = targetIndex(after: heading, type: type, in: blocks)
            ?? blocks.firstIndex { $0["type"]?.stringValue == type }
        guard let index else { return "" }
        return blocks[index]["text"]?.stringValue ?? ""
    }

    static func updating(
        _ rawBlocks: JSONValue?,
        reflection: String,
        nextAction: String
    ) -> JSONValue {
        var blocks = rawBlocks?.arrayValue ?? []
        setText(reflection, after: "오늘의 기록", type: "paragraph", in: &blocks)
        setText(nextAction, after: "다음 행동", type: "todo", in: &blocks)
        return .array(blocks)
    }

    private static func targetIndex(after heading: String, type: String, in blocks: [JSONValue]) -> Int? {
        guard let headingIndex = headingIndex(for: heading, in: blocks) else { return nil }
        for index in blocks.indices where index > headingIndex {
            let blockType = blocks[index]["type"]?.stringValue ?? ""
            if blockType.hasPrefix("heading") { break }
            if blockType == type { return index }
        }
        return nil
    }

    private static func setText(
        _ text: String,
        after heading: String,
        type: String,
        in blocks: inout [JSONValue]
    ) {
        if let index = targetIndex(after: heading, type: type, in: blocks), case .object(var block) = blocks[index] {
            block["text"] = .string(text)
            blocks[index] = .object(block)
            return
        }
        let content = JSONValue.object([
            "id": .string(UUID().uuidString.lowercased()), "type": .string(type),
            "text": .string(text), "marks": .array([]), "checked": .bool(false),
            "indent": .number(0), "collapsed": .bool(false),
        ])
        if let headingIndex = headingIndex(for: heading, in: blocks) {
            let insertionIndex = blocks.indices.first(where: {
                $0 > headingIndex && (blocks[$0]["type"]?.stringValue ?? "").hasPrefix("heading")
            }) ?? blocks.endIndex
            blocks.insert(content, at: insertionIndex)
            return
        }
        blocks.append(.object([
            "id": .string(UUID().uuidString.lowercased()), "type": .string("heading2"),
            "text": .string(heading), "marks": .array([]), "checked": .bool(false),
            "indent": .number(0), "collapsed": .bool(false),
        ]))
        blocks.append(content)
    }

    private static func headingIndex(for heading: String, in blocks: [JSONValue]) -> Int? {
        blocks.firstIndex {
            $0["type"]?.stringValue == "heading2"
                && $0["text"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) == heading
        }
    }
}

struct GoogleCalendarEntry: Identifiable, Hashable {
    let id: String
    let summary: String
    let backgroundColor: String

    init?(json: JSONValue) {
        guard case let .object(value) = json,
              let id = value["id"]?.stringValue,
              !id.isEmpty else { return nil }
        self.id = id
        summary = value["summary"]?.stringValue ?? "Google Calendar"
        backgroundColor = value["backgroundColor"]?.stringValue ?? ""
    }
}

enum CalendarSource: String, CaseIterable, Identifiable {
    case task
    case project
    case google

    var id: Self { self }

    var title: String {
        switch self {
        case .task: "Tasks"
        case .project: "Projects"
        case .google: "Google"
        }
    }

    var settingsKey: String {
        switch self {
        case .task: "tasks"
        case .project: "projects"
        case .google: "google"
        }
    }
}

struct CalendarEntry: Identifiable, Hashable {
    let id: String
    let entityID: String
    let title: String
    let startDate: String
    let endDate: String
    let timeLabel: String
    let startTimestamp: TimeInterval
    let source: CalendarSource
    let calendarID: String
    let externalURL: URL?

    func occurs(on dateKey: String) -> Bool {
        startDate <= dateKey && dateKey <= (endDate.isEmpty ? startDate : endDate)
    }
}

struct AppSnapshot: Equatable {
    var captures: [SygmaCapture]
    var boxes: [SygmaBox]
    var goals: [SygmaGoal]
    var tasks: [SygmaTask]
    var habits: [SygmaHabit]
    var habitInstances: [HabitInstance]
    var projects: [SygmaProject]
    var journals: [SygmaJournal]
    var googleCalendars: [GoogleCalendarEntry]
    var calendarEntries: [CalendarEntry]
    var visibleCalendarSources: Set<CalendarSource>
    var googleCalendarVisibility: [String: Bool]

    static let empty = AppSnapshot(
        captures: [], boxes: [], goals: [], tasks: [], habits: [], habitInstances: [], projects: [], journals: [],
        googleCalendars: [], calendarEntries: [], visibleCalendarSources: Set(CalendarSource.allCases),
        googleCalendarVisibility: [:]
    )

    init(state: JSONValue) {
        guard case let .object(root) = state else {
            self = .empty
            return
        }
        captures = root["captures"]?.arrayValue?.compactMap(SygmaCapture.init) ?? []
        boxes = root["boxes"]?.arrayValue?.compactMap(SygmaBox.init) ?? []
        goals = root["goals"]?.arrayValue?.compactMap(SygmaGoal.init) ?? []
        tasks = root["tasks"]?.arrayValue?.compactMap(SygmaTask.init) ?? []
        habits = root["habits"]?.arrayValue?.compactMap(SygmaHabit.init) ?? []
        habitInstances = root["habitInstances"]?.arrayValue?.compactMap(HabitInstance.init) ?? []
        projects = root["projects"]?.arrayValue?.compactMap(SygmaProject.init) ?? []
        journals = root["journals"]?.arrayValue?.compactMap(SygmaJournal.init) ?? []
        googleCalendars = root["googleCalendars"]?.arrayValue?.compactMap(GoogleCalendarEntry.init) ?? []
        calendarEntries = Self.makeCalendarEntries(root: root, tasks: tasks, projects: projects)
        let sourceSettings = root["settings"]?["calendarSources"]?.objectValue ?? [:]
        visibleCalendarSources = Set(CalendarSource.allCases.filter { sourceSettings[$0.settingsKey]?.boolValue != false })
        let googleVisibility = root["settings"]?["visibleGoogleCalendars"]?.objectValue ?? [:]
        googleCalendarVisibility = [:]
        for calendar in googleCalendars {
            googleCalendarVisibility[calendar.id] = googleVisibility[calendar.id]?.boolValue != false
        }
    }

    private init(
        captures: [SygmaCapture],
        boxes: [SygmaBox],
        goals: [SygmaGoal],
        tasks: [SygmaTask],
        habits: [SygmaHabit],
        habitInstances: [HabitInstance],
        projects: [SygmaProject],
        journals: [SygmaJournal],
        googleCalendars: [GoogleCalendarEntry],
        calendarEntries: [CalendarEntry],
        visibleCalendarSources: Set<CalendarSource>,
        googleCalendarVisibility: [String: Bool]
    ) {
        self.captures = captures
        self.boxes = boxes
        self.goals = goals
        self.tasks = tasks
        self.habits = habits
        self.habitInstances = habitInstances
        self.projects = projects
        self.journals = journals
        self.googleCalendars = googleCalendars
        self.calendarEntries = calendarEntries
        self.visibleCalendarSources = visibleCalendarSources
        self.googleCalendarVisibility = googleCalendarVisibility
    }

    func tasks(in lane: TaskLane, today: String = Date().dateKey) -> [SygmaTask] {
        let tomorrow = Date.from(dateKey: today)?.addingDays(1).dateKey
            ?? Date().addingDays(1).dateKey
        let matching = tasks.filter { task in
            switch lane {
            case .completed:
                task.isDone || task.isCanceled
            case .unplanned:
                !task.isDone && !task.isCanceled && task.dateKey.isEmpty && task.status != "scheduled"
            case .today:
                !task.isDone && !task.isCanceled && task.dateKey == today
            case .tomorrow:
                !task.isDone && !task.isCanceled && task.dateKey == tomorrow
            case .overdue:
                !task.isDone && !task.isCanceled && !task.dateKey.isEmpty && task.dateKey < today
            case .scheduled:
                !task.isDone && !task.isCanceled
                    && ((task.dateKey.isEmpty && task.status == "scheduled") || task.dateKey > tomorrow)
            }
        }
        return matching.sorted { taskComesBefore($0, $1, in: lane) }
    }

    private func taskComesBefore(_ lhs: SygmaTask, _ rhs: SygmaTask, in lane: TaskLane) -> Bool {
        if lane == .completed {
            switch (lhs.completedInstant, rhs.completedInstant) {
            case let (left?, right?) where left != right: return left > right
            case (_?, nil): return true
            case (nil, _?): return false
            default: break
            }
            if lhs.dateKey != rhs.dateKey { return lhs.dateKey > rhs.dateKey }
        } else {
            if lhs.dateKey != rhs.dateKey { return lhs.dateKey < rhs.dateKey }
        }
        let titleOrder = lhs.title.localizedStandardCompare(rhs.title)
        return titleOrder == .orderedSame ? lhs.id < rhs.id : titleOrder == .orderedAscending
    }

    func habitDone(_ habitID: String, on dateKey: String) -> Bool {
        habitInstances.contains { $0.habitID == habitID && $0.date == dateKey && $0.completed }
    }

    func habitCompletionCount(_ habitID: String, days: [Date]) -> Int {
        days.reduce(0) { $0 + (habitDone(habitID, on: $1.dateKey) ? 1 : 0) }
    }

    func habitWeeklyCompletionCount(
        _ habitID: String,
        days: [Date],
        through cutoff: Date = Date()
    ) -> Int {
        let boundedDays = days.filter { $0.startOfDay <= cutoff.startOfDay }
        return stride(from: 0, to: boundedDays.count, by: 7).reduce(0) { total, start in
            let end = min(start + 7, boundedDays.count)
            let week = Array(boundedDays[start..<end])
            return total + (habitCompletionCount(habitID, days: week) > 0 ? 1 : 0)
        }
    }

    func calendarSourceVisible(_ source: CalendarSource) -> Bool {
        visibleCalendarSources.contains(source)
    }

    func googleCalendarVisible(_ id: String) -> Bool {
        id.isEmpty || googleCalendarVisibility[id] != false
    }

    private static func makeCalendarEntries(
        root: [String: JSONValue],
        tasks: [SygmaTask],
        projects: [SygmaProject]
    ) -> [CalendarEntry] {
        var entries = tasks.compactMap { task -> CalendarEntry? in
            guard !task.isDone, !task.isCanceled, !task.dateKey.isEmpty else { return nil }
            return CalendarEntry(
                id: "task-\(task.id)", entityID: task.id, title: task.title,
                startDate: task.dateKey,
                endDate: task.dateKey,
                timeLabel: "종일",
                startTimestamp: Date.from(dateKey: task.dateKey)?.timeIntervalSince1970 ?? 0,
                source: .task,
                calendarID: "", externalURL: nil
            )
        }

        entries += projects.compactMap { project -> CalendarEntry? in
            guard project.status != "canceled", !project.startDate.isEmpty || !project.endDate.isEmpty else { return nil }
            let start = project.startDate.isEmpty ? project.endDate : project.startDate
            let end = project.endDate.isEmpty ? start : project.endDate
            return CalendarEntry(
                id: "project-\(project.id)", entityID: project.id, title: project.name,
                startDate: start, endDate: end, timeLabel: "기간",
                startTimestamp: Date.from(dateKey: start)?.timeIntervalSince1970 ?? 0,
                source: .project, calendarID: "", externalURL: nil
            )
        }

        for raw in root["googleEvents"]?.arrayValue ?? [] {
            guard case let .object(value) = raw,
                  let id = value["id"]?.stringValue,
                  !id.isEmpty else { continue }
            let status = value["status"]?.stringValue?.lowercased() ?? ""
            guard status != "cancelled", status != "canceled" else { continue }
            let startTime = value["start"]?.stringValue ?? ""
            let endTime = value["end"]?.stringValue ?? ""
            let allDay = value["allDay"]?.boolValue ?? !startTime.contains("T")
            let start = value["startDate"]?.stringValue ?? dateKey(from: startTime)
            var end = value["endDate"]?.stringValue ?? ""
            if !allDay, let parsedEnd = Date.from(isoString: endTime) {
                end = parsedEnd.addingTimeInterval(-1).dateKey
            } else if end.isEmpty {
                end = dateKey(from: endTime)
                if allDay, let exclusiveEnd = Date.from(dateKey: end) { end = exclusiveEnd.addingDays(-1).dateKey }
            }
            if end.isEmpty { end = start }
            if end < start { end = start }
            entries.append(CalendarEntry(
                id: "google-\(id)", entityID: id,
                title: value["title"]?.stringValue ?? "(제목 없음)",
                startDate: start,
                endDate: end,
                timeLabel: Self.timeLabel(startTime),
                startTimestamp: Date.from(isoString: startTime)?.timeIntervalSince1970
                    ?? Date.from(dateKey: start)?.timeIntervalSince1970 ?? 0,
                source: .google,
                calendarID: value["calendarId"]?.stringValue ?? "",
                externalURL: URL(string: value["htmlLink"]?.stringValue ?? "")
            ))
        }
        return entries.sorted {
            if $0.startDate != $1.startDate { return $0.startDate < $1.startDate }
            if $0.startTimestamp != $1.startTimestamp { return $0.startTimestamp < $1.startTimestamp }
            if $0.source != $1.source { return $0.source.rawValue < $1.source.rawValue }
            return $0.title.localizedStandardCompare($1.title) == .orderedAscending
        }
    }

    private static func timeLabel(_ value: String) -> String {
        guard value.contains("T"), let date = Date.from(isoString: value) else { return "종일" }
        return date.formatted(date: .omitted, time: .shortened)
    }

    private static func dateKey(from value: String) -> String {
        guard !value.isEmpty else { return "" }
        return Date.from(isoString: value)?.dateKey ?? String(value.prefix(10))
    }

}

extension Date {
    var dateKey: String {
        let components = Calendar.current.dateComponents([.year, .month, .day], from: self)
        return String(format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
    }

    var startOfDay: Date { Calendar.current.startOfDay(for: self) }

    var calendarWeekDays: [Date] {
        let start = Calendar.current.dateInterval(of: .weekOfYear, for: self)?.start.startOfDay
            ?? addingDays(-6).startOfDay
        return (0..<7).map { start.addingDays($0) }
    }

    static func from(dateKey: String) -> Date? {
        let parts = dateKey.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    static func from(isoString: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: isoString) ?? ISO8601DateFormatter().date(from: isoString)
    }

    func addingDays(_ value: Int) -> Date {
        Calendar.current.date(byAdding: .day, value: value, to: self) ?? self
    }
}
