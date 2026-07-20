import SwiftUI

struct CalendarView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var displayedMonth = Date().startOfDay
    @State private var selectedDate = Date().startOfDay
    @State private var selectedTask: SygmaTask?
    @State private var selectedProject: SygmaProject?
    @State private var expandedEvent: ExpandedCalendarEvent?
    @State private var showsTaskCreate = false
    @State private var calendarMode = CalendarDisplayMode.month

    var body: some View {
        ZStack {
            SYGMAScreen(
            eyebrow: "Calendar",
            title: "캘린더",
            subtitle: "",
            actions: {
                Button("오늘") {
                    displayedMonth = Date().startOfDay
                    selectedDate = Date().startOfDay
                }
                .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.violet))
            }
            ) {
                sourceControls
                calendarModeControl
                calendarPanel
                agendaPanel
            }

            if let expandedEvent {
                Color.clear
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture { self.expandedEvent = nil }

                GeometryReader { proxy in
                    expandedCalendarEntry(expandedEvent.entry)
                        .frame(width: proxy.size.width - 16, height: 82)
                        .position(x: proxy.size.width / 2, y: min(max(expandedEvent.frame.midY, 100), proxy.size.height - 100))
                        .transition(.scale(scale: 0.18, anchor: UnitPoint(
                            x: min(max(expandedEvent.frame.midX / max(proxy.size.width, 1), 0), 1),
                            y: 0.5
                        )).combined(with: .opacity))
                }
                .zIndex(100)
            }
        }
        .animation(.spring(response: 0.28, dampingFraction: 0.82), value: expandedEvent?.id)
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

    private var calendarModeControl: some View {
        HStack(spacing: 2) {
            ForEach(CalendarDisplayMode.allCases) { mode in
                Button(mode.title) { calendarMode = mode }
                    .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.ink, isActive: calendarMode == mode))
                    .accessibilityAddTraits(calendarMode == mode ? .isSelected : [])
            }
        }
    }

    private var calendarPanel: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button { movePeriod(-1) } label: {
                    Image(systemName: "chevron.left").frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(previousPeriodLabel)

                Spacer()
                Text(calendarTitle)
                    .font(.headline.weight(.bold))
                    .foregroundStyle(SYGMATheme.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer()

                Button { movePeriod(1) } label: {
                    Image(systemName: "chevron.right").frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(nextPeriodLabel)
            }
            .padding(.horizontal, 8)

            LazyVGrid(columns: columns, spacing: 0) {
                ForEach(Array(weekdayLabels.enumerated()), id: \.offset) { index, label in
                    Text(label)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(index == 0 ? SYGMATheme.rose : index == 6 ? SYGMATheme.blue : SYGMATheme.muted)
                        .frame(maxWidth: .infinity, minHeight: 30)
                }

            }
            .padding(.top, 8)

            ForEach(Array(calendarWeeks.enumerated()), id: \.offset) { _, week in
                CalendarWeekRow(
                    dates: week,
                    entries: visibleEntries,
                    selectedDate: selectedDate,
                    isPastWeek: week.last.map { $0 < currentWeekStart } ?? false,
                    sourceColor: color(for:),
                    select: { selectedDate = $0 },
                    expand: { entry, frame in expandedEvent = ExpandedCalendarEvent(entry: entry, frame: frame) }
                )
            }
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
        value.firstWeekday = 1
        return value
    }
    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(minimum: 0), spacing: 0), count: 7)
    }
    private var currentWeekStart: Date {
        calendar.dateInterval(of: .weekOfYear, for: Date())?.start ?? Date().startOfDay
    }
    private var weekdayLabels: [String] { ["일", "월", "화", "수", "목", "금", "토"] }
    private var calendarTitle: String {
        if calendarMode == .month {
            return displayedMonth.formatted(.dateTime.locale(Locale(identifier: "ko_KR")).year().month(.wide))
        }
        guard let first = displayedDays.first, let end = displayedDays.last else { return "" }
        return "\(first.formatted(.dateTime.locale(Locale(identifier: "ko_KR")).month().day())) – \(end.formatted(.dateTime.locale(Locale(identifier: "ko_KR")).month().day()))"
    }
    private var twoWeekDays: [Date] {
        let weekday = calendar.component(.weekday, from: displayedMonth)
        let offset = (weekday - calendar.firstWeekday + 7) % 7
        let start = calendar.date(byAdding: .day, value: -offset, to: displayedMonth) ?? displayedMonth
        return (0..<14).map { calendar.date(byAdding: .day, value: $0, to: start) ?? start }
    }

    private var monthDays: [Date] {
        let weekday = calendar.component(.weekday, from: displayedMonth)
        let offset = (weekday - calendar.firstWeekday + 7) % 7
        let currentWeekStart = calendar.date(byAdding: .day, value: -offset, to: displayedMonth) ?? displayedMonth
        let start = calendar.date(byAdding: .weekOfYear, value: -1, to: currentWeekStart) ?? currentWeekStart
        return (0..<42).map { calendar.date(byAdding: .day, value: $0, to: start) ?? start }
    }

    private var calendarWeeks: [[Date]] {
        let days = displayedDays
        return stride(from: 0, to: days.count, by: 7).map { Array(days[$0..<min($0 + 7, days.count)]) }
    }

    private var displayedDays: [Date] {
        switch calendarMode {
        case .week: Array(twoWeekDays.prefix(7))
        case .twoWeeks: twoWeekDays
        case .month: monthDays
        }
    }

    private var previousPeriodLabel: String {
        switch calendarMode {
        case .week: "이전 주"
        case .twoWeeks: "이전 2주"
        case .month: "이전 달"
        }
    }

    private var nextPeriodLabel: String {
        switch calendarMode {
        case .week: "다음 주"
        case .twoWeeks: "다음 2주"
        case .month: "다음 달"
        }
    }

    private var screenHorizontalPadding: CGFloat {
        horizontalSizeClass == .compact ? SYGMATheme.screenCompactHorizontalPadding : SYGMATheme.screenHorizontalPadding
    }

    private func movePeriod(_ offset: Int) {
        let component: Calendar.Component = calendarMode == .month ? .month : .weekOfYear
        let value = calendarMode == .twoWeeks ? offset * 2 : offset
        guard let next = calendar.date(byAdding: component, value: value, to: displayedMonth) else { return }
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

    private func expandedCalendarEntry(_ entry: CalendarEntry) -> some View {
        HStack(spacing: 12) {
            Rectangle().fill(color(for: entry.source)).frame(width: 4, height: 54)
            VStack(alignment: .leading, spacing: 6) {
                Text(entry.title)
                    .font(.body.weight(.bold))
                    .foregroundStyle(SYGMATheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(entry.timeLabel) · \(entry.startDate == entry.endDate || entry.endDate.isEmpty ? entry.startDate : "\(entry.startDate) – \(entry.endDate)")")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(color(for: entry.source))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Text(entry.source.title)
                .font(.caption2.weight(.bold))
                .foregroundStyle(color(for: entry.source))
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color(for: entry.source).opacity(0.18), in: RoundedRectangle(cornerRadius: 6))
        .overlay { RoundedRectangle(cornerRadius: 6).stroke(color(for: entry.source).opacity(0.34), lineWidth: 1) }
        .shadow(color: color(for: entry.source).opacity(0.2), radius: 12, y: 5)
        .contentShape(Rectangle())
        .onTapGesture { }
    }

    private func color(for source: CalendarSource) -> Color {
        switch source {
        case .task: SYGMATheme.blue
        case .project: SYGMATheme.violet
        case .google: SYGMATheme.teal
        }
    }
}

private struct ExpandedCalendarEvent: Identifiable, Equatable {
    let entry: CalendarEntry
    let frame: CGRect
    var id: String { entry.id }
}

private enum CalendarDisplayMode: String, CaseIterable, Identifiable {
    case week
    case twoWeeks
    case month

    var id: String { rawValue }
    var title: String {
        switch self {
        case .week: "주간"
        case .twoWeeks: "2주"
        case .month: "월간"
        }
    }
}

private struct CalendarWeekRow: View {
    let dates: [Date]
    let entries: [CalendarEntry]
    let selectedDate: Date
    let isPastWeek: Bool
    let sourceColor: (CalendarSource) -> Color
    let select: (Date) -> Void
    let expand: (CalendarEntry, CGRect) -> Void
    @State private var hoveredEntryID: String?

    var body: some View {
        ZStack(alignment: .topLeading) {
            HStack(spacing: 0) {
                ForEach(dates, id: \.self) { date in
                    Button { select(date) } label: {
                        Text(date.formatted(.dateTime.day()))
                            .font(.caption.weight(date.dateKey == Date().dateKey || calendar.isDate(date, inSameDayAs: selectedDate) ? .heavy : .medium))
                            .monospacedDigit()
                            .foregroundStyle(SYGMATheme.muted)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                            .padding(.horizontal, 4)
                            .padding(.top, 6)
                            .background(calendar.isDate(date, inSameDayAs: selectedDate) ? Color.black.opacity(0.04) : .clear)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(date.formatted(.dateTime.locale(Locale(identifier: "ko_KR")).month().day().weekday(.wide)))
                }
            }

            GeometryReader { proxy in
                let columnWidth = proxy.size.width / 7
                ForEach(segments) { segment in
                    GeometryReader { barProxy in
                        Button { expand(segment.entry, barProxy.frame(in: .global)) } label: {
                            Text(segment.entry.title)
                                .font(.system(size: 9, weight: .semibold))
                                .lineLimit(1)
                                .foregroundStyle(SYGMATheme.ink)
                                .padding(.horizontal, 5)
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                                .background(sourceColor(segment.entry.source).opacity(0.16))
                                .overlay(alignment: .leading) { Rectangle().fill(sourceColor(segment.entry.source)).frame(width: 2) }
                        }
                        .buttonStyle(.plain)
                        .help(segment.entry.title)
                        .accessibilityLabel(segment.entry.title)
                    }
                    .frame(width: columnWidth * CGFloat(segment.span) - 4, height: 18)
                    .offset(x: columnWidth * CGFloat(segment.startIndex) + 2, y: CGFloat(34 + segment.lane * 20))
                    .zIndex(hoveredEntryID == segment.entry.id ? 50 : Double(segment.lane + 1))
                    .onHover { hoveredEntryID = $0 ? segment.entry.id : nil }
                }
            }
            .zIndex(10)
        }
        .frame(height: CGFloat(max(54, 40 + laneCount * 20)))
        .opacity(isPastWeek ? 0.56 : 1)
        .overlay(alignment: .bottom) { Rectangle().fill(SYGMATheme.soft.opacity(0.24)).frame(height: 1) }
    }

    private var calendar: Calendar { Calendar.current }

    private var segments: [CalendarWeekSegment] {
        guard let first = dates.first?.dateKey, let last = dates.last?.dateKey else { return [] }
        var lanes: [Int] = []
        var result: [CalendarWeekSegment] = []
        let candidates = entries.filter { $0.startDate <= last && ($0.endDate.isEmpty ? $0.startDate : $0.endDate) >= first }
            .sorted { $0.startDate == $1.startDate ? $0.endDate > $1.endDate : $0.startDate < $1.startDate }
        for entry in candidates {
            let startKey = max(entry.startDate, first)
            let endKey = min(entry.endDate.isEmpty ? entry.startDate : entry.endDate, last)
            guard let startIndex = dates.firstIndex(where: { $0.dateKey == startKey }),
                  let endIndex = dates.firstIndex(where: { $0.dateKey == endKey }) else { continue }
            let lane = lanes.firstIndex(where: { $0 < startIndex }) ?? lanes.count
            if lane == lanes.count { lanes.append(endIndex) } else { lanes[lane] = endIndex }
            result.append(CalendarWeekSegment(entry: entry, startIndex: startIndex, span: endIndex - startIndex + 1, lane: lane))
        }
        return result
    }

    private var laneCount: Int {
        (segments.map(\.lane).max() ?? -1) + 1
    }
}

private struct CalendarWeekSegment: Identifiable {
    let entry: CalendarEntry
    let startIndex: Int
    let span: Int
    let lane: Int
    var id: String { "\(entry.id)-\(startIndex)" }
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
