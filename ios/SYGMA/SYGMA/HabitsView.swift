import SwiftUI
import UIKit

struct HabitsView: View {
    @Environment(AppStore.self) private var store
    @State private var showsCreate = false
    @State private var selectedHabit: SygmaHabit?

    var body: some View {
        SYGMAScreen(
            eyebrow: "Habits",
            title: "루틴",
            subtitle: "\(activeHabits.count)개 활성",
            actions: {
                Button("새 루틴") { showsCreate = true }
                    .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.teal))
            }
        ) {
            if store.snapshot.habits.isEmpty {
                SYGMAPanel {
                    Text("루틴이 없습니다.")
                        .foregroundStyle(SYGMATheme.muted)
                        .frame(maxWidth: .infinity, minHeight: SYGMATheme.emptyStateMinimumHeight + 8)
                }
            } else {
                ForEach(sortedHabits) { habit in
                    HabitPanel(habit: habit) { selectedHabit = habit }
                }
            }
        }
        .refreshable { await store.refreshFromRemote() }
        .sheet(isPresented: $showsCreate) { HabitCreateSheet() }
        .sheet(item: $selectedHabit) { HabitEditorSheet(habit: $0) }
    }

    private var activeHabits: [SygmaHabit] { store.snapshot.habits.filter(\.isActive) }
    private var sortedHabits: [SygmaHabit] {
        store.snapshot.habits.sorted {
            if $0.isActive != $1.isActive { return $0.isActive }
            return $0.title.localizedStandardCompare($1.title) == .orderedAscending
        }
    }
}

private struct HabitPanel: View {
    let habit: SygmaHabit
    let onEdit: () -> Void

    @Environment(AppStore.self) private var store
    @State private var expanded = false

    private var weekDays: [Date] { Date().calendarWeekDays }
    private var monthDays: [Date] {
        guard let currentWeekStart = weekDays.first else { return weekDays }
        let start = currentWeekStart.addingDays(-21)
        return (0..<28).map { start.addingDays($0) }
    }
    private var eligibleWeekDays: [Date] { eligibleDays(in: weekDays) }
    private var eligibleMonthDays: [Date] { eligibleDays(in: monthDays) }
    private var weekDone: Int {
        let count = store.snapshot.habitCompletionCount(habit.id, days: eligibleWeekDays)
        return habit.cadence == "weekly" ? min(1, count) : count
    }
    private var weekTotal: Int { habit.cadence == "weekly" ? 1 : eligibleWeekDays.count }
    private var monthDone: Int {
        guard habit.cadence == "weekly" else { return store.snapshot.habitCompletionCount(habit.id, days: eligibleMonthDays) }
        return store.snapshot.habitWeeklyCompletionCount(habit.id, days: monthDays)
    }
    private var monthTotal: Int { habit.cadence == "weekly" ? Int(ceil(Double(monthDays.count) / 7.0)) : eligibleMonthDays.count }

    var body: some View {
        SYGMAPanel {
            Button {
                withAnimation(SYGMATheme.standardAnimation) { expanded.toggle() }
            } label: {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(habit.title)
                            .font(.headline.weight(.bold))
                            .foregroundStyle(SYGMATheme.ink)
                        Text(habit.target.isEmpty ? cadenceLabel : habit.target)
                            .font(.caption)
                            .foregroundStyle(SYGMATheme.muted)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer()
                    Text("\(weekDone)/\(weekTotal)")
                        .font(.headline.weight(.heavy))
                        .monospacedDigit()
                        .foregroundStyle(SYGMATheme.teal)
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(SYGMATheme.soft)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .frame(minHeight: 48)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            weekStrip
                .padding(.top, 12)

            if expanded {
                monthGrid
                    .padding(.top, 16)
                    .transition(.opacity.combined(with: .move(edge: .top)))

                HStack {
                    Button(habit.isActive ? "일시 중지" : "활성화") {
                        store.setHabitStatus(habit.id, status: habit.isActive ? "paused" : "active")
                    }
                    .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.teal))
                    Spacer()
                    Button("편집", action: onEdit)
                        .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.blue, isActive: true))
                }
                .padding(.top, 12)
            }
        }
        .opacity(habit.status == "archived" ? 0.55 : 1)
    }

    private var weekStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(weekDays, id: \.self) { date in
                    HabitDayButton(habit: habit, date: date, showsWeekday: true)
                        .overlay(alignment: .leading) {
                            if date != weekDays.first {
                                SYGMATheme.verticalDivider().frame(width: 1).padding(.vertical, 8)
                            }
                        }
                }
            }
            .frame(minWidth: SYGMATheme.minimumTapTarget * 7)
            .overlay(alignment: .leading) { SYGMATheme.verticalDivider().frame(width: 1).padding(.vertical, 8) }
            .overlay(alignment: .trailing) { SYGMATheme.verticalDivider().frame(width: 1).padding(.vertical, 8) }
        }
    }

    private var monthGrid: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("최근 4주")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(SYGMATheme.muted)
                Spacer()
                Text("\(monthDone)/\(monthTotal)")
                    .font(.caption.weight(.heavy))
                    .foregroundStyle(SYGMATheme.teal)
                    .monospacedDigit()
            }
            ScrollView(.horizontal, showsIndicators: false) {
                LazyVGrid(
                    columns: Array(
                        repeating: GridItem(.flexible(minimum: SYGMATheme.minimumTapTarget), spacing: 2),
                        count: 7
                    ),
                    spacing: 3
                ) {
                    ForEach(monthDays, id: \.self) { date in
                        HabitDayButton(habit: habit, date: date, showsWeekday: false)
                    }
                }
                .frame(minWidth: SYGMATheme.minimumTapTarget * 7 + 12)
            }
        }
    }

    private var cadenceLabel: String {
        switch habit.cadence {
        case "daily": "매일"
        case "weekdays": "평일"
        case "weekly": "매주"
        default: habit.cadence
        }
    }

    private func eligibleDays(in days: [Date]) -> [Date] {
        let throughToday = days.filter { $0 <= Date().startOfDay }
        guard habit.cadence == "weekdays" else { return throughToday }
        return throughToday.filter {
            let weekday = Calendar.current.component(.weekday, from: $0)
            return (2...6).contains(weekday)
        }
    }
}

private struct HabitDayButton: View {
    let habit: SygmaHabit
    let date: Date
    let showsWeekday: Bool

    @Environment(AppStore.self) private var store

    private var done: Bool { store.snapshot.habitDone(habit.id, on: date.dateKey) }
    private var isToday: Bool { date.dateKey == Date().dateKey }
    private var isFuture: Bool { date > Date().startOfDay }
    private var isEligible: Bool {
        guard !isFuture else { return false }
        guard habit.cadence == "weekdays" else { return true }
        return (2...6).contains(Calendar.current.component(.weekday, from: date))
    }

    var body: some View {
        Button {
            guard isEligible else { return }
            store.toggleHabit(habit.id, on: date)
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        } label: {
            VStack(spacing: 3) {
                if showsWeekday {
                    Text(date.formatted(.dateTime.locale(Locale(identifier: "ko_KR")).weekday(.narrow)))
                        .font(.caption2.weight(.semibold))
                }
                Text(date.formatted(.dateTime.day()))
                    .font(.caption.weight(.bold))
                    .monospacedDigit()
            }
            .foregroundStyle(!isEligible ? SYGMATheme.soft.opacity(0.45) : done ? SYGMATheme.teal : isToday ? SYGMATheme.blue : SYGMATheme.muted)
            .frame(
                minWidth: SYGMATheme.minimumTapTarget,
                maxWidth: .infinity,
                minHeight: showsWeekday ? 48 : SYGMATheme.minimumTapTarget
            )
            .background(done ? Color(red: 0.898, green: 0.941, blue: 0.929) : .clear)
            .overlay(alignment: .bottom) {
                if isToday { Rectangle().fill(SYGMATheme.teal.opacity(0.32)).frame(height: 2) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!isEligible)
        .accessibilityLabel(date.formatted(.dateTime.locale(Locale(identifier: "ko_KR")).month().day().weekday(.wide)))
        .accessibilityValue(
            isFuture ? "미래 날짜" : isEligible ? (done ? "완료" : "미완료") : "평일 루틴 수행일 아님"
        )
    }
}
