import SwiftUI
import UIKit

struct TodayView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var selectedTask: SygmaTask?
    @State private var selectedJournal: SygmaJournal?
    @State private var showsTaskCreate = false
    @State private var showsJournalCreate = false

    var body: some View {
        SYGMAScreen(
            eyebrow: "Today",
            title: "대시보드",
            subtitle: longDate,
            actions: {
                Button("새 할 일") { showsTaskCreate = true }
                    .buttonStyle(SYGMAUnderlineButtonStyle())
                Button("오늘 리뷰") {
                    if let journal = store.snapshot.journals.first(where: { $0.date == Date().dateKey }) {
                        selectedJournal = journal
                    } else {
                        showsJournalCreate = true
                    }
                }
                .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.amber))
            }
        ) {
            metrics

            TaskDropPanel(
                title: "오늘 할 일", detail: "이름순",
                tasks: todayTasks + completedForToday, lane: .today,
                onOpen: { selectedTask = $0 }
            )

            TodayHabitsPanel()

            TaskDropPanel(
                title: "지연 항목", detail: "Tasks에서 재배치",
                tasks: overdueTasks, lane: .overdue,
                onOpen: { selectedTask = $0 }
            )

            TaskDropPanel(
                title: "내일 할 일", detail: tomorrowLabel,
                tasks: tomorrowTasks, lane: .tomorrow,
                onOpen: { selectedTask = $0 }
            )
        }
        .refreshable { await store.refreshFromRemote() }
        .sheet(item: $selectedTask) { TaskEditorSheet(task: $0) }
        .sheet(item: $selectedJournal) { JournalEditorSheet(journal: $0) }
        .sheet(isPresented: $showsTaskCreate) { TaskCreateSheet(defaultLane: .today) }
        .sheet(isPresented: $showsJournalCreate) { JournalEditorSheet(journal: nil, initialDate: Date()) }
    }

    private var metrics: some View {
        LazyVGrid(columns: metricColumns, spacing: 0) {
            SYGMAMetricCell(label: "오늘 할 일", value: String(todayTasks.count))
            SYGMAMetricCell(
                label: "완료",
                value: String(completedTodayCount),
                showsLeadingDivider: !dynamicTypeSize.isAccessibilitySize
            )
                .overlay(alignment: .top) {
                    if dynamicTypeSize.isAccessibilitySize {
                        SYGMATheme.horizontalDivider().frame(height: 1)
                    }
                }
            SYGMAMetricCell(label: "지연", value: String(overdueTasks.count))
                .overlay(alignment: .top) { SYGMATheme.horizontalDivider().frame(height: 1) }
            SYGMAMetricCell(
                label: "진행 프로젝트",
                value: String(activeProjectCount),
                showsLeadingDivider: !dynamicTypeSize.isAccessibilitySize
            )
                .overlay(alignment: .top) { SYGMATheme.horizontalDivider().frame(height: 1) }
        }
        .background(Color.white.opacity(0.08))
        .accessibilityElement(children: .contain)
    }

    private var metricColumns: [GridItem] {
        let columnCount = dynamicTypeSize.isAccessibilitySize ? 1 : 2
        return Array(repeating: GridItem(.flexible(), spacing: 0), count: columnCount)
    }

    private var todayTasks: [SygmaTask] { store.snapshot.tasks(in: .today) }
    private var tomorrowTasks: [SygmaTask] { store.snapshot.tasks(in: .tomorrow) }
    private var overdueTasks: [SygmaTask] { store.snapshot.tasks(in: .overdue) }
    private var completedForToday: [SygmaTask] {
        let today = Date().dateKey
        return store.snapshot.tasks(in: .completed).filter { $0.isDone && $0.dateKey == today }
    }
    private var completedTodayCount: Int {
        let today = Date().dateKey
        return store.snapshot.tasks.filter { $0.isDone && $0.completedDateKey == today }.count
    }
    private var activeProjectCount: Int { store.snapshot.projects.filter(\.isActive).count }
    private var tomorrowLabel: String {
        Date().addingDays(1).formatted(.dateTime.locale(Locale(identifier: "ko_KR")).month(.abbreviated).day())
    }
    private var longDate: String {
        Date().formatted(.dateTime.locale(Locale(identifier: "ko_KR")).year().month(.wide).day().weekday(.wide))
    }
}

struct TasksView: View {
    @Environment(AppStore.self) private var store
    @State private var selectedTask: SygmaTask?
    @State private var showsTaskCreate = false

    var body: some View {
        SYGMAScreen(
            eyebrow: "Tasks",
            title: "할 일 배치",
            subtitle: "\(store.snapshot.tasks(in: .unplanned).count)개 미계획 / \(assignedCount)개 배정",
            actions: {
                Button("새 할 일") { showsTaskCreate = true }
                    .buttonStyle(SYGMAUnderlineButtonStyle())
            }
        ) {
            ForEach(TaskLane.allCases) { lane in
                TaskDropPanel(
                    title: lane.title,
                    detail: laneDetail(lane),
                    tasks: store.snapshot.tasks(in: lane),
                    lane: lane,
                    limit: lane == .completed ? 14 : nil,
                    onOpen: { selectedTask = $0 }
                )
            }
        }
        .refreshable { await store.refreshFromRemote() }
        .sheet(item: $selectedTask) { TaskEditorSheet(task: $0) }
        .sheet(isPresented: $showsTaskCreate) { TaskCreateSheet(defaultLane: .unplanned) }
    }

    private var assignedCount: Int {
        [.today, .tomorrow, .scheduled, .overdue]
            .reduce(0) { $0 + store.snapshot.tasks(in: $1).count }
    }

    private func laneDetail(_ lane: TaskLane) -> String {
        let count = store.snapshot.tasks(in: lane).count
        switch lane {
        case .unplanned: return "날짜를 정할 \(count)개"
        case .today: return "오늘 \(count)개"
        case .tomorrow: return "내일 \(count)개"
        case .scheduled: return "이후 일정 \(count)개"
        case .overdue: return "재배치 \(count)개"
        case .completed: return "최근 \(min(count, 14))개"
        }
    }
}

private struct TodayHabitsPanel: View {
    @Environment(AppStore.self) private var store

    private var activeHabits: [SygmaHabit] {
        store.snapshot.habits.filter { habit in
            guard habit.isActive else { return false }
            if habit.cadence == "weekdays" {
                return (2...6).contains(Calendar.current.component(.weekday, from: Date()))
            }
            if habit.cadence == "weekly" {
                let days = Date().calendarWeekDays.filter { $0 <= Date().startOfDay }
                return store.snapshot.habitCompletionCount(habit.id, days: days) == 0
            }
            return true
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SYGMASectionHeader("오늘 루틴", detail: "\(activeHabits.count)개", compactBottomPadding: 6)
            LazyVStack(spacing: 0) {
                if activeHabits.isEmpty {
                    Text("활성 루틴이 없습니다.")
                        .font(.subheadline)
                        .foregroundStyle(SYGMATheme.muted)
                        .frame(maxWidth: .infinity, minHeight: SYGMATheme.emptyStateMinimumHeight)
                } else {
                    ForEach(activeHabits) { habit in
                        SYGMACard(accent: SYGMATheme.teal) {
                            HStack(spacing: 12) {
                                Button {
                                    store.toggleHabit(habit.id, on: Date())
                                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                } label: {
                                    Image(systemName: store.snapshot.habitDone(habit.id, on: Date().dateKey) ? "checkmark.circle.fill" : "circle")
                                        .font(.title3)
                                        .foregroundStyle(store.snapshot.habitDone(habit.id, on: Date().dateKey) ? SYGMATheme.teal : SYGMATheme.muted)
                                        .frame(width: 44, height: 44)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(habit.title)
                                .accessibilityValue(store.snapshot.habitDone(habit.id, on: Date().dateKey) ? "완료" : "미완료")

                                VStack(alignment: .leading, spacing: 4) {
                                    Text(habit.title).font(.body.weight(.semibold)).foregroundStyle(SYGMATheme.ink)
                                    if !habit.target.isEmpty {
                                        Text(habit.target).font(.caption).foregroundStyle(SYGMATheme.muted).lineLimit(2)
                                    }
                                }
                                Spacer()
                            }
                        }
                    }
                }
            }
        }
    }
}
