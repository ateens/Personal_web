import SwiftUI

struct CalendarView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var displayedMonth = Date().startOfDay
    @State private var selectedDate = Date().startOfDay
    @State private var selectedTask: SygmaTask?
    @State private var selectedProject: SygmaProject?
    @State private var showsTaskCreate = false

    var body: some View {
        SYGMAScreen(
            eyebrow: "Calendar",
            title: "캘린더",
            subtitle: "\(visibleEntries.count)개 일정 표시",
            actions: {
                Button("오늘") {
                    displayedMonth = Date().startOfDay
                    selectedDate = Date().startOfDay
                }
                .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.violet))
            }
        ) {
            sourceControls
            twoWeekPanel
            agendaPanel
        }
        .refreshable { await store.refreshFromRemote() }
        .sheet(item: $selectedTask) { TaskEditorSheet(task: $0) }
        .sheet(item: $selectedProject) { ProjectEditorSheet(project: $0) }
        .sheet(isPresented: $showsTaskCreate) {
            TaskCreateSheet(defaultLane: .scheduled, initialDate: selectedDate)
        }
    }

    private var sourceControls: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(CalendarSource.allCases) { source in
                    Button {
                        store.setCalendarSource(source, visible: !store.snapshot.calendarSourceVisible(source))
                    } label: {
                        HStack(spacing: 7) {
                            Circle().fill(color(for: source)).frame(width: 7, height: 7)
                            Text(source.title)
                        }
                    }
                    .buttonStyle(SYGMAUnderlineButtonStyle(
                        tint: color(for: source),
                        isActive: store.snapshot.calendarSourceVisible(source)
                    ))
                    .accessibilityLabel("\(source.title) 캘린더")
                    .accessibilityValue(store.snapshot.calendarSourceVisible(source) ? "표시" : "숨김")
                    .accessibilityHint("두 번 탭하여 이 일정 유형의 표시 여부를 변경합니다.")
                    .accessibilityAddTraits(store.snapshot.calendarSourceVisible(source) ? .isSelected : [])
                }
            }
        }
    }

    private var twoWeekPanel: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button { moveWeeks(-2) } label: {
                    Image(systemName: "chevron.left").frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("이전 2주")

                Spacer()
                Text(monthTitle)
                    .font(.headline.weight(.bold))
                    .foregroundStyle(SYGMATheme.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer()

                Button { moveWeeks(2) } label: {
                    Image(systemName: "chevron.right").frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("다음 2주")
            }
            .padding(.horizontal, 8)

            LazyVGrid(columns: columns, spacing: 0) {
                ForEach(Array(weekdayLabels.enumerated()), id: \.offset) { index, label in
                    Text(label)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(index == 5 ? SYGMATheme.blue : index == 6 ? SYGMATheme.rose : SYGMATheme.muted)
                        .frame(maxWidth: .infinity, minHeight: 30)
                }

                ForEach(twoWeekDays, id: \.self) { date in
                    CalendarDayCell(
                        date: date,
                        isSelected: calendar.isDate(date, inSameDayAs: selectedDate),
                        entries: visibleEntries.filter { $0.occurs(on: date.dateKey) },
                        sourceColor: color(for:)
                    ) {
                        selectedDate = date
                    }
                }
            }
            .padding(.top, 8)
        }
        .frame(maxWidth: .infinity)
        .background(Color.white.opacity(0.18))
        .padding(.horizontal, -screenHorizontalPadding)
    }

    private var agendaPanel: some View {
        SYGMAPanel {
            SYGMASectionHeader(
                selectedDate.formatted(.dateTime.locale(Locale(identifier: "ko_KR")).month(.wide).day().weekday(.wide)),
                detail: "\(selectedEntries.count)개"
            )
            HStack {
                Spacer()
                Button {
                    showsTaskCreate = true
                } label: {
                    Label("할 일 추가", systemImage: "plus")
                }
                .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.blue))
                .accessibilityLabel("\(selectedDate.formatted(.dateTime.locale(Locale(identifier: "ko_KR")).month().day()))에 할 일 추가")
            }
            .padding(.bottom, 8)

            LazyVStack(spacing: 0) {
                if selectedEntries.isEmpty {
                    Text("선택한 날의 일정이 없습니다.")
                        .font(.subheadline)
                        .foregroundStyle(SYGMATheme.muted)
                        .frame(maxWidth: .infinity, minHeight: SYGMATheme.emptyStateMinimumHeight)
                } else {
                    ForEach(selectedEntries) { entry in
                        CalendarAgendaRow(entry: entry, tint: color(for: entry.source)) {
                            open(entry)
                        }
                    }
                }
            }
        }
    }

    private var visibleEntries: [CalendarEntry] {
        store.snapshot.calendarEntries.filter {
            store.snapshot.calendarSourceVisible($0.source)
                && ($0.source != .google || store.snapshot.googleCalendarVisible($0.calendarID))
        }
    }
    private var selectedEntries: [CalendarEntry] {
        visibleEntries.filter { $0.occurs(on: selectedDate.dateKey) }
    }
    private var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.locale = Locale(identifier: "ko_KR")
        value.firstWeekday = 2
        return value
    }
    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(minimum: 0), spacing: 0), count: 7)
    }
    private var weekdayLabels: [String] { ["월", "화", "수", "목", "금", "토", "일"] }
    private var monthTitle: String {
        guard let end = twoWeekDays.last else { return "" }
        return "\(twoWeekDays[0].formatted(.dateTime.locale(Locale(identifier: "ko_KR")).month().day())) – \(end.formatted(.dateTime.locale(Locale(identifier: "ko_KR")).month().day()))"
    }
    private var twoWeekDays: [Date] {
        let weekday = calendar.component(.weekday, from: displayedMonth)
        let offset = (weekday - calendar.firstWeekday + 7) % 7
        let start = calendar.date(byAdding: .day, value: -offset, to: displayedMonth) ?? displayedMonth
        return (0..<14).map { calendar.date(byAdding: .day, value: $0, to: start) ?? start }
    }

    private var screenHorizontalPadding: CGFloat {
        horizontalSizeClass == .compact ? SYGMATheme.screenCompactHorizontalPadding : SYGMATheme.screenHorizontalPadding
    }

    private func moveWeeks(_ offset: Int) {
        guard let next = calendar.date(byAdding: .weekOfYear, value: offset, to: displayedMonth) else { return }
        displayedMonth = next
        selectedDate = next
    }

    private func open(_ entry: CalendarEntry) {
        switch entry.source {
        case .task:
            selectedTask = store.snapshot.tasks.first { $0.id == entry.entityID }
        case .project:
            selectedProject = store.snapshot.projects.first { $0.id == entry.entityID }
        case .google:
            break
        }
    }

    private func color(for source: CalendarSource) -> Color {
        switch source {
        case .task: SYGMATheme.blue
        case .project: SYGMATheme.violet
        case .google: SYGMATheme.teal
        }
    }
}

private struct CalendarDayCell: View {
    let date: Date
    let isSelected: Bool
    let entries: [CalendarEntry]
    let sourceColor: (CalendarSource) -> Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 4) {
                Text(date.formatted(.dateTime.day()))
                    .font(.caption.weight(date.dateKey == Date().dateKey || isSelected ? .heavy : .medium))
                    .monospacedDigit()
                    .frame(maxWidth: .infinity, alignment: .leading)
                ForEach(entries) { entry in
                    HStack(alignment: .top, spacing: 3) {
                        Rectangle().fill(sourceColor(entry.source)).frame(width: 2)
                        Text(entry.title)
                            .font(.system(size: 9, weight: .semibold))
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(isSelected ? SYGMATheme.ink : SYGMATheme.muted)
            .padding(.horizontal, 3)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, minHeight: SYGMATheme.minimumTapTarget, alignment: .topLeading)
            .background(isSelected ? Color.black.opacity(0.04) : .clear)
            .overlay(alignment: .bottom) {
                if isSelected { Rectangle().fill(SYGMATheme.ink).frame(height: 1) }
                else if date.dateKey == Date().dateKey { Rectangle().fill(SYGMATheme.blue.opacity(0.45)).frame(height: 2) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(date.formatted(.dateTime.locale(Locale(identifier: "ko_KR")).month().day().weekday(.wide)))
        .accessibilityValue(entries.isEmpty ? "일정 없음" : "일정 \(entries.count)개")
        .accessibilityHint("두 번 탭하여 이 날짜를 선택합니다.")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

private struct CalendarAgendaRow: View {
    let entry: CalendarEntry
    let tint: Color
    let onOpen: () -> Void

    var body: some View {
        if entry.source == .google {
            googleRow
        } else {
            localRow
        }
    }

    private var localRow: some View {
        SYGMACard(accent: tint) {
            Button(action: onOpen) {
                HStack(spacing: 10) {
                    agendaDescription
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(SYGMATheme.soft)
                        .frame(minWidth: 44, minHeight: 44)
                        .accessibilityHidden(true)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(entry.source.title), \(entry.title)")
            .accessibilityValue(entry.timeLabel)
            .accessibilityHint("두 번 탭하여 편집합니다.")
        }
    }

    private var googleRow: some View {
        SYGMACard(accent: tint) {
            HStack(spacing: 10) {
                agendaDescription
                Spacer()
                if let url = entry.externalURL {
                    Link(destination: url) {
                        Image(systemName: "arrow.up.right")
                            .frame(width: 44, height: 44)
                            .foregroundStyle(SYGMATheme.muted)
                    }
                    .accessibilityLabel("Google Calendar에서 열기")
                }
            }
        }
    }

    private var agendaDescription: some View {
        HStack(spacing: 10) {
            Rectangle().fill(tint).frame(width: 3, height: 34)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(entry.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(SYGMATheme.ink)
                Text("\(entry.source.title) · \(entry.timeLabel)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(tint)
            }
        }
    }
}
