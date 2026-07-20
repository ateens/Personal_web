import SwiftUI
import WidgetKit

private let widgetKind = "SYGMAFourWeekCalendar"
private let stateURL = URL(string: "https://personalweb-production-81a6.up.railway.app/api/state")!

private struct CalendarItem: Codable, Identifiable {
    let id: String
    let title: String
    let startDate: String
    let endDate: String
    let timeLabel: String
    let source: String
}

private struct CalendarTimelineEntry: TimelineEntry {
    let date: Date
    let items: [CalendarItem]
}

private struct CalendarProvider: TimelineProvider {
    func placeholder(in context: Context) -> CalendarTimelineEntry {
        CalendarTimelineEntry(date: Date(), items: Self.samples)
    }

    func getSnapshot(in context: Context, completion: @escaping (CalendarTimelineEntry) -> Void) {
        guard !context.isPreview else {
            completion(CalendarTimelineEntry(date: Date(), items: Self.samples))
            return
        }
        fetchItems { completion(CalendarTimelineEntry(date: Date(), items: $0)) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CalendarTimelineEntry>) -> Void) {
        let now = Date()
        fetchItems { items in
            let refresh = Calendar.current.date(byAdding: .minute, value: 15, to: now) ?? now.addingTimeInterval(900)
            completion(Timeline(
                entries: [CalendarTimelineEntry(date: now, items: items)],
                policy: .after(refresh)
            ))
        }
    }

    private func fetchItems(completion: @escaping ([CalendarItem]) -> Void) {
        var request = URLRequest(url: stateURL)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: request) { data, _, _ in
            completion(data.map(Self.decodeItems) ?? [])
        }.resume()
    }

    private static func decodeItems(_ data: Data) -> [CalendarItem] {
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let envelope = object as? [String: Any],
              let root = envelope["state"] as? [String: Any] else { return [] }
        let settings = root["settings"] as? [String: Any] ?? [:]
        let sourceSettings = settings["calendarSources"] as? [String: Any] ?? [:]
        let googleVisibility = settings["visibleGoogleCalendars"] as? [String: Any] ?? [:]
        func sourceVisible(_ key: String) -> Bool { sourceSettings[key] as? Bool != false }
        var items: [CalendarItem] = []

        if sourceVisible("tasks") {
            for task in root["tasks"] as? [[String: Any]] ?? [] {
                let status = task["status"] as? String ?? ""
                let dueDate = task["dueDate"] as? String ?? ""
                guard !["done", "canceled"].contains(status), !dueDate.isEmpty else { continue }
                items.append(CalendarItem(
                    id: "task-\(task["id"] as? String ?? UUID().uuidString)",
                    title: task["title"] as? String ?? "(제목 없음)",
                    startDate: dueDate,
                    endDate: dueDate,
                    timeLabel: "종일",
                    source: "task"
                ))
            }
        }

        if sourceVisible("projects") {
            for project in root["projects"] as? [[String: Any]] ?? [] {
                guard project["status"] as? String != "canceled" else { continue }
                let rawStart = project["startDate"] as? String ?? ""
                let rawEnd = project["endDate"] as? String ?? ""
                guard !rawStart.isEmpty || !rawEnd.isEmpty else { continue }
                let start = rawStart.isEmpty ? rawEnd : rawStart
                let end = rawEnd.isEmpty ? start : rawEnd
                items.append(CalendarItem(
                    id: "project-\(project["id"] as? String ?? UUID().uuidString)",
                    title: project["name"] as? String ?? "(제목 없음)",
                    startDate: start,
                    endDate: max(start, end),
                    timeLabel: "기간",
                    source: "project"
                ))
            }
        }

        if sourceVisible("google") {
            for event in root["googleEvents"] as? [[String: Any]] ?? [] {
                let status = (event["status"] as? String ?? "").lowercased()
                let calendarID = event["calendarId"] as? String ?? ""
                guard !["cancelled", "canceled"].contains(status),
                      calendarID.isEmpty || googleVisibility[calendarID] as? Bool != false else { continue }
                let startValue = event["start"] as? String ?? ""
                let endValue = event["end"] as? String ?? ""
                let allDay = event["allDay"] as? Bool ?? !startValue.contains("T")
                let start = event["startDate"] as? String ?? dayKey(from: startValue)
                var end = event["endDate"] as? String ?? ""
                if end.isEmpty {
                    end = dayKey(from: endValue)
                    if allDay, let exclusiveEnd = parseDay(end) {
                        end = dateKey(widgetCalendar.date(byAdding: .day, value: -1, to: exclusiveEnd) ?? exclusiveEnd)
                    }
                }
                guard !start.isEmpty else { continue }
                if end.isEmpty || end < start { end = start }
                items.append(CalendarItem(
                    id: "google-\(event["id"] as? String ?? UUID().uuidString)",
                    title: event["title"] as? String ?? "(제목 없음)",
                    startDate: start,
                    endDate: end,
                    timeLabel: allDay ? "종일" : timeLabel(from: startValue),
                    source: "google"
                ))
            }
        }
        return items.sorted {
            if $0.startDate != $1.startDate { return $0.startDate < $1.startDate }
            return $0.title.localizedStandardCompare($1.title) == .orderedAscending
        }
    }

    private static var samples: [CalendarItem] {
        let calendar = widgetCalendar
        let start = calendar.dateInterval(of: .weekOfYear, for: Date())?.start ?? Date()
        func key(_ offset: Int) -> String { dateKey(calendar.date(byAdding: .day, value: offset, to: start) ?? start) }
        return [
            CalendarItem(id: "sample-task", title: "이번 주 우선순위 정리", startDate: key(1), endDate: key(1), timeLabel: "09:00", source: "task"),
            CalendarItem(id: "sample-project", title: "프로젝트 집중 기간", startDate: key(3), endDate: key(10), timeLabel: "기간", source: "project"),
            CalendarItem(id: "sample-google", title: "주간 미팅", startDate: key(9), endDate: key(9), timeLabel: "14:00", source: "google")
        ]
    }
}

@main
struct SYGMAFourWeekCalendarWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: widgetKind, provider: CalendarProvider()) { entry in
            FourWeekCalendarView(entry: entry)
                .containerBackground(Color(red: 0.97, green: 0.975, blue: 0.985), for: .widget)
        }
        .configurationDisplayName("4주 캘린더")
        .description("현재 주부터 4주간의 일정을 한눈에 봅니다.")
        .supportedFamilies([.systemLarge])
        .contentMarginsDisabled()
    }
}

private struct FourWeekCalendarView: View {
    let entry: CalendarTimelineEntry

    private var start: Date {
        widgetCalendar.dateInterval(of: .weekOfYear, for: entry.date)?.start ?? entry.date
    }
    private var days: [Date] {
        (0..<28).compactMap { widgetCalendar.date(byAdding: .day, value: $0, to: start) }
    }
    private var end: Date { days.last ?? start }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("이번 4주")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Palette.ink)
                    Text(rangeLabel)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(Palette.muted)
                }
                Spacer()
                Text(entry.date.formatted(.dateTime.locale(Locale(identifier: "ko_KR")).month(.wide)))
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Palette.ink)
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 6)

            HStack(spacing: 0) {
                ForEach(Array(["일", "월", "화", "수", "목", "금", "토"].enumerated()), id: \.offset) { index, label in
                    Text(label)
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(index == 0 ? Palette.rose : index == 6 ? Palette.blue : Palette.muted)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 8)
            .frame(height: 18)

            ForEach(0..<4, id: \.self) { index in
                let week = Array(days[(index * 7)..<(index * 7 + 7)])
                WidgetWeekRow(dates: week, items: entry.items, today: entry.date)
                    .frame(maxHeight: .infinity)
            }
        }
    }

    private var rangeLabel: String {
        let format = Date.FormatStyle.dateTime.locale(Locale(identifier: "ko_KR")).month().day()
        return "\(start.formatted(format)) – \(end.formatted(format))"
    }
}

private struct WidgetWeekRow: View {
    let dates: [Date]
    let items: [CalendarItem]
    let today: Date

    var body: some View {
        ZStack(alignment: .topLeading) {
            HStack(spacing: 0) {
                ForEach(dates, id: \.self) { date in
                    VStack(spacing: 0) {
                        if widgetCalendar.component(.day, from: date) == 1 {
                            Text("\(widgetCalendar.component(.month, from: date))월")
                                .font(.system(size: 7, weight: .bold))
                                .foregroundStyle(Palette.ink)
                        }
                        Text(date.formatted(.dateTime.day()))
                            .font(.system(size: 10, weight: isToday(date) ? .bold : .medium))
                            .monospacedDigit()
                            .foregroundStyle(Palette.muted)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .padding(.leading, 4)
                    .padding(.top, 4)
                    .background(isToday(date) ? Palette.ink.opacity(0.075) : .clear)
                }
            }

            GeometryReader { proxy in
                let columnWidth = proxy.size.width / 7
                ForEach(segments) { segment in
                    Text(segment.label)
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                        .padding(.horizontal, 3)
                        .frame(
                            width: columnWidth * CGFloat(segment.span) - 2,
                            height: 13,
                            alignment: .leading
                        )
                        .background(Palette.color(for: segment.item.source).opacity(0.16))
                        .overlay(alignment: .leading) {
                            Rectangle().fill(Palette.color(for: segment.item.source)).frame(width: 1.5)
                        }
                        .offset(
                            x: columnWidth * CGFloat(segment.startIndex) + 1,
                            y: CGFloat(23 + segment.lane * 14)
                        )
                }
            }
        }
        .padding(.horizontal, 8)
        .clipped()
    }

    private func isToday(_ date: Date) -> Bool {
        widgetCalendar.isDate(date, inSameDayAs: today)
    }

    private var segments: [WeekSegment] {
        guard let first = dates.first.map(dateKey), let last = dates.last.map(dateKey) else { return [] }
        var laneEnds: [Int] = []
        var result: [WeekSegment] = []
        let candidates = items
            .filter { $0.startDate <= last && $0.endDate >= first }
            .sorted { $0.startDate == $1.startDate ? $0.endDate > $1.endDate : $0.startDate < $1.startDate }

        for item in candidates {
            let startKey = max(item.startDate, first)
            let endKey = min(item.endDate, last)
            guard let startIndex = dates.firstIndex(where: { dateKey($0) == startKey }),
                  let endIndex = dates.firstIndex(where: { dateKey($0) == endKey }) else { continue }
            let lane = laneEnds.firstIndex(where: { $0 < startIndex }) ?? laneEnds.count
            guard lane < 3 else { continue }
            if lane == laneEnds.count { laneEnds.append(endIndex) } else { laneEnds[lane] = endIndex }
            result.append(WeekSegment(
                item: item,
                weekStart: first,
                startIndex: startIndex,
                span: endIndex - startIndex + 1,
                lane: lane
            ))
        }
        return result
    }
}

private struct WeekSegment: Identifiable {
    let item: CalendarItem
    let weekStart: String
    let startIndex: Int
    let span: Int
    let lane: Int

    var id: String { "\(item.id)-\(weekStart)-\(startIndex)" }
    var label: String {
        ["종일", "기간", ""].contains(item.timeLabel) ? item.title : "\(item.timeLabel) \(item.title)"
    }
}

private enum Palette {
    static let ink = Color(red: 23 / 255, green: 32 / 255, blue: 47 / 255)
    static let muted = Color(red: 105 / 255, green: 115 / 255, blue: 134 / 255)
    static let blue = Color(red: 37 / 255, green: 99 / 255, blue: 235 / 255)
    static let violet = Color(red: 109 / 255, green: 40 / 255, blue: 217 / 255)
    static let teal = Color(red: 15 / 255, green: 118 / 255, blue: 110 / 255)
    static let rose = Color(red: 190 / 255, green: 18 / 255, blue: 60 / 255)

    static func color(for source: String) -> Color {
        switch source {
        case "project": violet
        case "google": teal
        default: blue
        }
    }
}

private var widgetCalendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale(identifier: "ko_KR")
    calendar.firstWeekday = 1
    return calendar
}

private func dateKey(_ date: Date) -> String {
    let components = widgetCalendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
}

private func dayKey(from value: String) -> String {
    if value.count >= 10, value[value.index(value.startIndex, offsetBy: 4)] == "-" {
        return String(value.prefix(10))
    }
    return parseISO(value).map(dateKey) ?? ""
}

private func parseDay(_ value: String) -> Date? {
    let parts = value.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return nil }
    return widgetCalendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
}

private func parseISO(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}

private func timeLabel(from value: String) -> String {
    guard let date = parseISO(value) else { return "" }
    return date.formatted(.dateTime.hour().minute())
}
