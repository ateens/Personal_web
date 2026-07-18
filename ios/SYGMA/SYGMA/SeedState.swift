import Foundation

enum SeedState {
    static func make(now: Date = Date()) -> JSONValue {
        let createdAt = ISO8601DateFormatter().string(from: now)
        let boxID = "native-demo-box"
        let goalID = "native-demo-goal"
        let projectIDs = ["native-demo-project-ui", "native-demo-project-calendar", "native-demo-project-health"]

        let projects: [JSONValue] = [
            project(projectIDs[0], "대시보드 UI 실험", "focus", boxID, goalID, now.addingDays(-5), now.addingDays(12)),
            project(projectIDs[1], "캘린더 연동 정리", "active", boxID, goalID, now.addingDays(-2), now.addingDays(20)),
            project(projectIDs[2], "아침 운동 루틴", "active", boxID, goalID, now.addingDays(-16), now.addingDays(44)),
        ]

        let taskSpecs: [(String, Int, String, String)] = [
            ("오늘 화면의 핵심 흐름 점검", 0, "doing", projectIDs[0]),
            ("Task 배치 인터랙션 정리", 0, "todo", projectIDs[0]),
            ("Google 일정 색상 확인", 1, "todo", projectIDs[1]),
            ("이번 주 캘린더 범위 검토", 3, "todo", projectIDs[1]),
            ("20분 걷기", 0, "done", projectIDs[2]),
            ("어제 미완료 항목 재배치", -1, "todo", projectIDs[0]),
        ]
        let tasks = taskSpecs.enumerated().map { index, spec in
            task("native-demo-task-\(index + 1)", spec.0, spec.2, boxID, goalID, spec.3, now.addingDays(spec.1), createdAt)
        } + [
            task("native-demo-task-unplanned", "새 아이디어를 실행 단위로 나누기", "todo", boxID, goalID, projectIDs[0], nil, createdAt),
        ]

        let habits: [JSONValue] = [
            habit("native-demo-habit-walk", "20분 걷기", "daily", "퇴근 전 짧게 움직이기", boxID, projectIDs[2]),
            habit("native-demo-habit-review", "하루 리뷰", "daily", "오늘 실행 흐름 기록", boxID, projectIDs[0]),
            habit("native-demo-habit-plan", "내일 계획", "weekdays", "가장 중요한 일 3개", boxID, projectIDs[0]),
        ]
        let habitInstances = habits.enumerated().flatMap { habitIndex, raw -> [JSONValue] in
            guard case let .object(value) = raw, let habitID = value["id"]?.stringValue else { return [] }
            return (-6...0).compactMap { offset in
                guard (offset + habitIndex + 12) % (habitIndex + 2) != 0 else { return nil }
                let date = now.addingDays(offset).dateKey
                return .object([
                    "id": .string("\(habitID)-\(date)"),
                    "habitId": .string(habitID),
                    "date": .string(date),
                    "completed": .bool(true),
                    "completedAt": .string("\(date)T09:00:00.000Z"),
                ])
            }
        }

        let root: [String: JSONValue] = [
            "version": .number(4),
            "revision": .number(0),
            "createdAt": .string(createdAt),
            "updatedAt": .string(createdAt),
            "settings": .object([
                "navOrder": .array([
                    "today", "inbox", "tasks", "projects", "goals", "boxes", "habits", "journal", "calendar",
                ].map(JSONValue.string)),
                "calendarSources": .object(["tasks": .bool(true), "projects": .bool(true), "google": .bool(true)]),
                "visibleGoogleCalendars": .object([:]),
                "calendarColorAssignments": .object([:]),
                "googleCalendarId": .string("primary"),
                "statsDemoDataSeeded": .bool(true),
            ]),
            "captures": .array([
                .object([
                    "id": .string("native-demo-capture"), "title": .string("다음 주에 검토할 아이디어"),
                    "url": .string(""), "status": .string("inbox"),
                    "convertedTo": .string(""), "convertedId": .string(""),
                    "createdAt": .string(createdAt), "processedAt": .string(""),
                ]),
            ]),
            "boxes": .array([
                .object([
                    "id": .string(boxID), "name": .string("성장 시스템"),
                    "visibility": .string("pinned"), "color": .string("teal"),
                    "blocks": .array([block("학습, 제품 실험, 장기 역량을 묶어 관리합니다.")]),
                ]),
            ]),
            "goals": .array([
                .object([
                    "id": .string(goalID), "boxId": .string(boxID),
                    "name": .string("개인 운영체계 고도화"), "status": .string("focus"),
                    "year": .string(String(Calendar.current.component(.year, from: now))),
                    "quarter": .string("\(((Calendar.current.component(.month, from: now) - 1) / 3) + 1)Q"),
                    "targetDate": .string(now.addingDays(54).dateKey),
                    "blocks": .array([block("분류, 실행, 회고 루프를 안정화합니다.")]),
                ]),
            ]),
            "projects": .array(projects),
            "tasks": .array(tasks),
            "resources": .array([]),
            "habits": .array(habits),
            "habitInstances": .array(habitInstances),
            "journals": .array([
                .object([
                    "id": .string("native-demo-journal"), "title": .string("\(now.dateKey) 리뷰"),
                    "date": .string(now.dateKey), "satisfaction": .number(8),
                    "blocks": .array([
                        block("오늘의 기록", type: "heading2"),
                        block("핵심 화면의 흐름을 정리하고 다음 구현 순서를 명확히 했다."),
                        block("다음 행동", type: "heading2"),
                        block("실제 기기에서 전체 흐름 확인", type: "todo"),
                    ]),
                ]),
            ]),
            "googleCalendars": .array([]),
            "googleEvents": .array([]),
            "links": .array([]),
        ]
        return .object(root)
    }

    private static func block(_ text: String, type: String = "paragraph") -> JSONValue {
        .object([
            "id": .string(UUID().uuidString.lowercased()), "type": .string(type),
            "text": .string(text), "marks": .array([]), "checked": .bool(false),
            "indent": .number(0), "collapsed": .bool(false),
        ])
    }

    private static func project(
        _ id: String, _ name: String, _ status: String, _ boxID: String, _ goalID: String,
        _ start: Date, _ end: Date
    ) -> JSONValue {
        .object([
            "id": .string(id), "name": .string(name), "status": .string(status),
            "boxId": .string(boxID), "goalId": .string(goalID),
            "startDate": .string(start.dateKey), "endDate": .string(end.dateKey),
            "blocks": .array([block("프로젝트의 완료 기준과 다음 행동")]),
        ])
    }

    private static func task(
        _ id: String, _ title: String, _ status: String, _ boxID: String, _ goalID: String,
        _ projectID: String, _ due: Date?, _ createdAt: String
    ) -> JSONValue {
        let completed = status == "done"
        return .object([
            "id": .string(id), "title": .string(title), "status": .string(status),
            "boxId": .string(boxID), "goalId": .string(goalID), "projectId": .string(projectID),
            "resourceId": .string(""), "dueDate": .string(due?.dateKey ?? ""),
            "completedAt": .string(completed ? createdAt : ""), "googleEventId": .string(""),
            "blocks": .array([block("")]),
        ])
    }

    private static func habit(
        _ id: String, _ title: String, _ cadence: String, _ target: String,
        _ boxID: String, _ projectID: String
    ) -> JSONValue {
        .object([
            "id": .string(id), "title": .string(title), "cadence": .string(cadence),
            "target": .string(target), "status": .string("active"),
            "boxId": .string(boxID), "projectId": .string(projectID),
            "blocks": .array([block("루틴의 트리거와 성공 기준")]),
        ])
    }
}
