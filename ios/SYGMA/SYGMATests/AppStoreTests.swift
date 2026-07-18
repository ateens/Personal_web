import XCTest
@testable import SYGMA

private final class StubURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

@MainActor
final class AppStoreTests: XCTestCase {
    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    func testCoreMutationPreservesCompleteResources() {
        var state = SeedState.make()
        guard case .object(var root) = state else { return XCTFail("Seed root must be an object") }
        let resource: JSONValue = .object([
            "id": .string("resource-preservation-proof"),
            "title": .string("원본 Resource"),
            "type": .string("note"),
            "importance": .string("normal"),
            "pinned": .bool(false),
            "readLater": .bool(false),
            "createdAt": .string("2026-07-16T00:00:00Z"),
            "updatedAt": .string("2026-07-16T00:00:00Z"),
            "revision": .number(1),
            "timestampSource": .string("test"),
            "url": .string(""),
            "boxId": .string(""),
            "goalId": .string(""),
            "projectId": .string(""),
            "parentId": .string(""),
            "nested": .object([
                "unknownEditorState": .array([.string("keep"), .number(42), .bool(true)]),
            ]),
            "blocks": .array([
                .object([
                    "id": .string("block-1"), "type": .string("toggle"), "text": .string("보존"),
                    "marks": .array([]), "checked": .bool(false), "indent": .number(0),
                    "collapsed": .bool(false),
                ]),
            ]),
        ])
        root["resources"] = .array([resource])
        state = .object(root)

        let store = AppStore(initialState: state, persistenceURL: nil, autoRefresh: false)
        store.createTask(title: "Resource와 무관한 변경", lane: .today)

        XCTAssertEqual(store.state.objectValue?["resources"], .array([resource]))
    }

    func testTaskPlacementMovesUnplannedTaskToToday() {
        let store = AppStore(initialState: SeedState.make(), persistenceURL: nil, autoRefresh: false)
        guard let task = store.snapshot.tasks(in: .unplanned).first else {
            return XCTFail("Seed should include an unplanned task")
        }

        store.placeTask(task.id, in: .today)

        XCTAssertTrue(store.snapshot.tasks(in: .today).contains { $0.id == task.id })
        XCTAssertFalse(store.snapshot.tasks(in: .unplanned).contains { $0.id == task.id })
    }

    func testHabitDayToggleIsReversible() {
        let store = AppStore(initialState: SeedState.make(), persistenceURL: nil, autoRefresh: false)
        guard let habit = store.snapshot.habits.first else { return XCTFail("Seed should include a habit") }
        let date = Date().addingDays(-10)
        let original = store.snapshot.habitDone(habit.id, on: date.dateKey)

        store.toggleHabit(habit.id, on: date)
        XCTAssertNotEqual(store.snapshot.habitDone(habit.id, on: date.dateKey), original)

        store.toggleHabit(habit.id, on: date)
        XCTAssertEqual(store.snapshot.habitDone(habit.id, on: date.dateKey), original)
    }

    func testHabitToggleRejectsFutureDates() throws {
        let store = AppStore(initialState: SeedState.make(), persistenceURL: nil, autoRefresh: false)
        let habit = try XCTUnwrap(store.snapshot.habits.first)
        let future = Date().addingDays(1)
        let originalState = store.state

        store.toggleHabit(habit.id, on: future)

        XCTAssertEqual(store.state, originalState)
        XCTAssertFalse(store.snapshot.habitDone(habit.id, on: future.dateKey))
    }

    func testWeeklyHabitProgressIgnoresFutureInstances() throws {
        guard case .object(var root) = SeedState.make(),
              let habitID = root["habits"]?.arrayValue?.first?["id"]?.stringValue else {
            return XCTFail("Seed should include a habit")
        }
        let future = Date().addingDays(1).startOfDay
        root["habitInstances"] = .array([.object([
            "id": .string("future-instance"), "habitId": .string(habitID),
            "date": .string(future.dateKey), "completed": .bool(true),
            "completedAt": .string(ISO8601DateFormatter().string(from: future)),
        ])])
        let snapshot = AppSnapshot(state: .object(root))

        XCTAssertEqual(snapshot.habitWeeklyCompletionCount(habitID, days: Date().calendarWeekDays), 0)
    }

    func testTaskDeletionClearsCaptureConversionAndLinksAtomically() {
        var state = SeedState.make()
        guard case .object(var root) = state,
              let taskID = root["tasks"]?.arrayValue?.first?["id"]?.stringValue else {
            return XCTFail("Seed should include a task")
        }
        root["captures"] = .array([.object([
            "id": .string("capture-task"),
            "title": .string("Task source"),
            "url": .string(""),
            "status": .string("converted"),
            "convertedTo": .string("task"),
            "convertedId": .string(taskID),
        ])])
        root["links"] = .array([.object([
            "id": .string("task-link"),
            "fromType": .string("task"),
            "fromId": .string(taskID),
            "toType": .string("project"),
            "toId": root["projects"]?.arrayValue?.first?["id"] ?? .string(""),
            "relation": .string("related"),
        ])])
        state = .object(root)
        let store = AppStore(initialState: state, persistenceURL: nil, autoRefresh: false)

        store.deleteTask(taskID)

        let saved = store.state.objectValue
        XCTAssertFalse(saved?["tasks"]?.arrayValue?.contains { $0["id"]?.stringValue == taskID } ?? true)
        XCTAssertEqual(saved?["captures"]?[0]?["convertedTo"]?.stringValue, "")
        XCTAssertEqual(saved?["captures"]?[0]?["convertedId"]?.stringValue, "")
        XCTAssertTrue(saved?["links"]?.arrayValue?.isEmpty == true)
    }

    func testHabitDeletionClearsInstancesAndCaptureConversion() {
        var state = SeedState.make()
        guard case .object(var root) = state,
              let habitID = root["habits"]?.arrayValue?.first?["id"]?.stringValue else {
            return XCTFail("Seed should include a habit")
        }
        root["captures"] = .array([.object([
            "id": .string("capture-habit"),
            "title": .string("Habit source"),
            "url": .string(""),
            "status": .string("converted"),
            "convertedTo": .string("habits"),
            "convertedId": .string(habitID),
        ])])
        state = .object(root)
        let store = AppStore(initialState: state, persistenceURL: nil, autoRefresh: false)

        store.deleteHabit(habitID)

        let saved = store.state.objectValue
        XCTAssertFalse(saved?["habits"]?.arrayValue?.contains { $0["id"]?.stringValue == habitID } ?? true)
        XCTAssertFalse(saved?["habitInstances"]?.arrayValue?.contains { $0["habitId"]?.stringValue == habitID } ?? true)
        XCTAssertEqual(saved?["captures"]?[0]?["convertedTo"]?.stringValue, "")
        XCTAssertEqual(saved?["captures"]?[0]?["convertedId"]?.stringValue, "")
    }

    func testHabitToggleIgnoresUnknownHabitID() {
        let store = AppStore(initialState: SeedState.make(), persistenceURL: nil, autoRefresh: false)
        let original = store.state

        store.toggleHabit("missing-habit", on: Date().addingDays(-10))

        XCTAssertEqual(store.state, original)
    }

    func testHabitToggleUsesBoundedUUIDInstanceID() {
        var state = SeedState.make()
        let habitID = String(repeating: "h", count: 256)
        guard case .object(var root) = state,
              var habits = root["habits"]?.arrayValue,
              case .object(var habit) = habits.first else {
            return XCTFail("Seed should include a habit")
        }
        habit["id"] = .string(habitID)
        habits[0] = .object(habit)
        root["habits"] = .array(habits)
        root["habitInstances"] = .array([])
        state = .object(root)
        let store = AppStore(initialState: state, persistenceURL: nil, autoRefresh: false)

        store.toggleHabit(habitID, on: Date().addingDays(-10))

        guard let instance = store.state["habitInstances"]?[0]?.objectValue else {
            return XCTFail("Toggle should create one HabitInstance")
        }
        XCTAssertEqual(instance["habitId"]?.stringValue, habitID)
        XCTAssertEqual(instance["id"]?.stringValue?.count, 36)
    }

    func testDeletionTrimsCaptureConversionType() {
        var state = SeedState.make()
        guard case .object(var root) = state,
              let taskID = root["tasks"]?.arrayValue?.first?["id"]?.stringValue,
              let habitID = root["habits"]?.arrayValue?.first?["id"]?.stringValue else {
            return XCTFail("Seed should include a task and habit")
        }
        root["captures"] = .array([
            .object([
                "id": .string("spaced-task-capture"),
                "convertedTo": .string(" task "),
                "convertedId": .string(taskID),
            ]),
            .object([
                "id": .string("spaced-habit-capture"),
                "convertedTo": .string(" habits "),
                "convertedId": .string(habitID),
            ]),
        ])
        state = .object(root)
        let store = AppStore(initialState: state, persistenceURL: nil, autoRefresh: false)

        store.deleteTask(taskID)
        store.deleteHabit(habitID)

        XCTAssertEqual(store.state["captures"]?[0]?["convertedTo"]?.stringValue, "")
        XCTAssertEqual(store.state["captures"]?[0]?["convertedId"]?.stringValue, "")
        XCTAssertEqual(store.state["captures"]?[1]?["convertedTo"]?.stringValue, "")
        XCTAssertEqual(store.state["captures"]?[1]?["convertedId"]?.stringValue, "")
    }

    func testDeletingLastPrimaryTaskOrHabitIsNoOp() {
        let primaryCollections = ["captures", "boxes", "goals", "projects", "tasks", "resources", "habits", "journals"]

        guard case .object(var taskRoot) = SeedState.make(),
              case .object(var task) = taskRoot["tasks"]?.arrayValue?.first,
              let taskID = task["id"]?.stringValue else {
            return XCTFail("Seed should include a task")
        }
        for field in ["boxId", "goalId", "projectId", "resourceId"] { task[field] = .string("") }
        for collection in primaryCollections { taskRoot[collection] = .array([]) }
        taskRoot["tasks"] = .array([.object(task)])
        taskRoot["habitInstances"] = .array([])
        let taskOnlyState = JSONValue.object(taskRoot)
        let taskStore = AppStore(initialState: taskOnlyState, persistenceURL: nil, autoRefresh: false)

        taskStore.deleteTask(taskID)

        XCTAssertEqual(taskStore.state, taskOnlyState)

        guard case .object(var habitRoot) = SeedState.make(),
              case .object(var habit) = habitRoot["habits"]?.arrayValue?.first,
              let habitID = habit["id"]?.stringValue else {
            return XCTFail("Seed should include a habit")
        }
        for field in ["boxId", "projectId"] { habit[field] = .string("") }
        for collection in primaryCollections { habitRoot[collection] = .array([]) }
        habitRoot["habits"] = .array([.object(habit)])
        habitRoot["habitInstances"] = .array([])
        let habitOnlyState = JSONValue.object(habitRoot)
        let habitStore = AppStore(initialState: habitOnlyState, persistenceURL: nil, autoRefresh: false)

        habitStore.deleteHabit(habitID)

        XCTAssertEqual(habitStore.state, habitOnlyState)
    }

    func testAtomicTaskUpdatePreservesUnknownFieldsAndMigratesLegacyScheduleToDate() {
        var state = SeedState.make()
        let blocks: JSONValue = .array([.object([
            "id": .string("task-block"), "type": .string("toggle"), "text": .string("보존"),
            "marks": .array([]), "checked": .bool(false), "indent": .number(0), "collapsed": .bool(true),
        ])])
        guard case .object(var root) = state,
              var tasks = root["tasks"]?.arrayValue,
              case .object(var rawTask) = tasks.first else { return XCTFail("Seed should include a task") }
        rawTask["status"] = .string("doing")
        rawTask["dueDate"] = .string("")
        rawTask["scheduledStart"] = .string("2026-07-16T01:30:00Z")
        rawTask["scheduledEnd"] = .string("2026-07-16T03:00:00Z")
        rawTask["estimatedMinutes"] = .number(90)
        rawTask["actualMinutes"] = .number(45)
        rawTask["blocks"] = blocks
        rawTask["unknownMobileProof"] = .object(["keep": .bool(true)])
        tasks[0] = .object(rawTask)
        root["tasks"] = .array(tasks)
        state = .object(root)
        let store = AppStore(initialState: state, persistenceURL: nil, autoRefresh: false)
        guard let task = store.snapshot.tasks.first else { return XCTFail("Task should decode") }
        XCTAssertEqual(task.dateKey, "2026-07-16")
        var draft = TaskDraft(task: task)
        draft.title = "제목만 수정"

        store.updateTask(draft)

        guard let saved = store.state["tasks"]?[0] else { return XCTFail("Task should remain") }
        XCTAssertEqual(saved["title"]?.stringValue, "제목만 수정")
        XCTAssertEqual(saved["status"]?.stringValue, "doing")
        XCTAssertEqual(saved["dueDate"]?.stringValue, "2026-07-16")
        XCTAssertNil(saved["scheduledStart"])
        XCTAssertNil(saved["scheduledEnd"])
        XCTAssertNil(saved["estimatedMinutes"])
        XCTAssertNil(saved["actualMinutes"])
        XCTAssertEqual(saved["blocks"], blocks)
        XCTAssertEqual(saved["unknownMobileProof"], .object(["keep": .bool(true)]))
    }

    func testSomedayTasksMigrateToScheduledPreservingOnlyExistingDatesAndCannotBeCreatedAgain() throws {
        var state = SeedState.make()
        guard case .object(var root) = state,
              var tasks = root["tasks"]?.arrayValue,
              case .object(var rawTask) = tasks.first,
              let taskID = rawTask["id"]?.stringValue else { return XCTFail("Seed should include a task") }
        rawTask["status"] = .string("someday")
        rawTask["dueDate"] = .string("2026-07-28")
        rawTask["scheduledStart"] = .string("2026-07-28T09:00:00Z")
        rawTask["scheduledEnd"] = .string("2026-07-28T10:00:00Z")
        rawTask["estimatedMinutes"] = .number(60)
        rawTask["actualMinutes"] = .number(15)
        rawTask["unknownMigrationProof"] = .string("keep")
        tasks[0] = .object(rawTask)
        var blankTask = rawTask
        blankTask["id"] = .string("legacy-someday-without-date")
        blankTask["dueDate"] = .string("")
        blankTask["scheduledStart"] = .string("2026-08-02T09:00:00Z")
        tasks.append(.object(blankTask))
        root["tasks"] = .array(tasks)
        state = .object(root)

        let store = AppStore(initialState: state, persistenceURL: nil, autoRefresh: false)

        let migrated = try XCTUnwrap(store.snapshot.tasks.first(where: { $0.id == taskID }))
        XCTAssertEqual(migrated.status, "scheduled")
        XCTAssertEqual(migrated.dateKey, "2026-07-28")
        let migratedBlank = try XCTUnwrap(store.snapshot.tasks.first(where: { $0.id == "legacy-someday-without-date" }))
        XCTAssertEqual(migratedBlank.status, "scheduled")
        XCTAssertEqual(migratedBlank.dateKey, "")
        let saved = try XCTUnwrap(store.state["tasks"]?.arrayValue?.first(where: { $0["id"]?.stringValue == taskID }))
        XCTAssertEqual(saved["status"]?.stringValue, "scheduled")
        XCTAssertEqual(saved["dueDate"]?.stringValue, "2026-07-28")
        XCTAssertNil(saved["scheduledStart"])
        XCTAssertNil(saved["scheduledEnd"])
        XCTAssertNil(saved["estimatedMinutes"])
        XCTAssertNil(saved["actualMinutes"])
        XCTAssertEqual(saved["unknownMigrationProof"]?.stringValue, "keep")
        let savedBlank = try XCTUnwrap(store.state["tasks"]?.arrayValue?.first(where: {
            $0["id"]?.stringValue == "legacy-someday-without-date"
        }))
        XCTAssertEqual(savedBlank["status"]?.stringValue, "scheduled")
        XCTAssertEqual(savedBlank["dueDate"]?.stringValue, "")
        XCTAssertNil(savedBlank["scheduledStart"])

        store.setCalendarSource(.task, visible: false)
        XCTAssertFalse((store.state["tasks"]?.arrayValue ?? []).contains { $0["status"]?.stringValue == "someday" })

        let createdID = try XCTUnwrap(store.createTask(TaskDraft(
            title: "이전 앱에서 넘어온 나중에",
            status: "someday",
            dueDate: "2026-08-01"
        )))
        let created = try XCTUnwrap(store.snapshot.tasks.first(where: { $0.id == createdID }))
        XCTAssertEqual(created.status, "scheduled")
        XCTAssertEqual(created.dateKey, "2026-08-01")
        let createdBlankID = try XCTUnwrap(store.createTask(TaskDraft(
            title: "날짜 없는 이전 나중에",
            status: "someday",
            dueDate: ""
        )))
        let createdBlank = try XCTUnwrap(store.snapshot.tasks.first(where: { $0.id == createdBlankID }))
        XCTAssertEqual(createdBlank.status, "scheduled")
        XCTAssertEqual(createdBlank.dateKey, "")
        XCTAssertFalse(SygmaTask.statuses.contains("someday"))
        XCTAssertFalse(taskStatusChoices.contains { $0.0 == "someday" || $0.1 == "나중에" })
    }

    func testScheduledCreationAndPlacementUseOptionalDate() throws {
        let creationStore = AppStore(initialState: SeedState.make(), persistenceURL: nil, autoRefresh: false)
        let dateFreeID = try XCTUnwrap(creationStore.createTask(title: "날짜 없는 예정", lane: .scheduled))
        let datedID = try XCTUnwrap(creationStore.createTask(
            title: "날짜 있는 예정",
            lane: .scheduled,
            date: try XCTUnwrap(Date.from(dateKey: "2026-07-20"))
        ))
        let dateFree = try XCTUnwrap(creationStore.snapshot.tasks.first(where: { $0.id == dateFreeID }))
        let dated = try XCTUnwrap(creationStore.snapshot.tasks.first(where: { $0.id == datedID }))
        XCTAssertEqual(dateFree.status, "scheduled")
        XCTAssertEqual(dateFree.dateKey, "")
        XCTAssertEqual(dated.status, "scheduled")
        XCTAssertEqual(dated.dateKey, "2026-07-20")

        var state = SeedState.make()
        guard case .object(var root) = state,
              var tasks = root["tasks"]?.arrayValue,
              case .object(var rawTask) = tasks.first,
              let taskID = rawTask["id"]?.stringValue else { return XCTFail("Seed should include a task") }
        rawTask["status"] = .string("doing")
        rawTask["dueDate"] = .string("")
        rawTask["scheduledStart"] = .string("2026-07-10T14:00:00Z")
        rawTask["scheduledEnd"] = .string("2026-07-10T16:00:00Z")
        rawTask["estimatedMinutes"] = .number(120)
        rawTask["actualMinutes"] = .number(30)
        tasks[0] = .object(rawTask)
        root["tasks"] = .array(tasks)
        state = .object(root)
        let store = AppStore(initialState: state, persistenceURL: nil, autoRefresh: false)

        store.placeTask(taskID, in: .scheduled, date: try XCTUnwrap(Date.from(dateKey: "2026-07-20")))

        let moved = try XCTUnwrap(store.snapshot.tasks.first(where: { $0.id == taskID }))
        XCTAssertEqual(moved.status, "scheduled")
        XCTAssertEqual(moved.dateKey, "2026-07-20")
        let saved = try XCTUnwrap(store.state["tasks"]?.arrayValue?.first(where: { $0["id"]?.stringValue == taskID }))
        XCTAssertNil(saved["scheduledStart"])
        XCTAssertNil(saved["scheduledEnd"])
        XCTAssertNil(saved["estimatedMinutes"])
        XCTAssertNil(saved["actualMinutes"])

        store.placeTask(taskID, in: .unplanned)
        let unplanned = try XCTUnwrap(store.snapshot.tasks.first(where: { $0.id == taskID }))
        XCTAssertEqual(unplanned.status, "todo")
        XCTAssertEqual(unplanned.dateKey, "")
    }

    func testTaskRelationSelectionInheritsProjectGoalAndBox() throws {
        let store = AppStore(initialState: SeedState.make(), persistenceURL: nil, autoRefresh: false)
        XCTAssertNotNil(store.createBox(BoxDraft(id: "box-2", name: "새 영역")))
        XCTAssertNotNil(store.createGoal(GoalDraft(id: "goal-2", name: "새 목표", boxID: "box-2")))
        XCTAssertNotNil(store.createProject(ProjectDraft(id: "project-2", name: "새 프로젝트", goalID: "goal-2")))
        var draft = TaskDraft(task: try XCTUnwrap(store.snapshot.tasks.first))
        draft.projectID = "project-2"

        store.updateTask(draft)

        var saved = try XCTUnwrap(store.snapshot.tasks.first(where: { $0.id == draft.id }))
        XCTAssertEqual(saved.projectID, "project-2")
        XCTAssertEqual(saved.goalID, "goal-2")
        XCTAssertEqual(saved.boxID, "box-2")

        draft = TaskDraft(task: saved)
        draft.goalID = "native-demo-goal"
        store.updateTask(draft)
        saved = try XCTUnwrap(store.snapshot.tasks.first(where: { $0.id == draft.id }))
        XCTAssertEqual(saved.goalID, "native-demo-goal")
        XCTAssertEqual(saved.projectID, "")
        XCTAssertEqual(saved.boxID, "native-demo-box")
    }

    func testProjectUpdateCascadesRelationsAndDeletionClearsDependents() throws {
        var state = SeedState.make()
        guard case .object(var root) = state,
              let projectID = root["projects"]?[0]?["id"]?.stringValue,
              let boxID = root["boxes"]?[0]?["id"]?.stringValue,
              let goalID = root["goals"]?[0]?["id"]?.stringValue else { return XCTFail("Seed relations required") }
        root["resources"] = .array([.object([
            "id": .string("linked-resource"), "title": .string("자료"), "projectId": .string(projectID),
            "goalId": .string(goalID), "boxId": .string(boxID), "blocks": .array([]),
            "revision": .number(1), "updatedAt": .string("2026-07-16T00:00:00Z"),
        ])])
        root["captures"] = .array([.object([
            "id": .string("project-capture"), "title": .string("출처"), "status": .string("processed"),
            "convertedTo": .string("projects"), "convertedId": .string(projectID),
        ])])
        state = .object(root)
        let store = AppStore(initialState: state, persistenceURL: nil, autoRefresh: false)
        XCTAssertNotNil(store.createBox(BoxDraft(id: "box-cascade", name: "이동 영역")))
        var projectDraft = ProjectDraft(project: try XCTUnwrap(store.snapshot.projects.first(where: { $0.id == projectID })))
        projectDraft.goalID = ""
        projectDraft.boxID = "box-cascade"

        store.updateProject(projectDraft)

        XCTAssertTrue(store.snapshot.tasks.filter { $0.projectID == projectID }.allSatisfy { $0.boxID == "box-cascade" && $0.goalID.isEmpty })
        XCTAssertTrue(store.snapshot.habits.filter { $0.projectID == projectID }.allSatisfy { $0.boxID == "box-cascade" })
        XCTAssertEqual(store.state["resources"]?[0]?["boxId"]?.stringValue, "box-cascade")
        XCTAssertEqual(store.state["resources"]?[0]?["goalId"]?.stringValue, "")

        store.deleteProject(projectID)

        XCTAssertFalse(store.snapshot.projects.contains { $0.id == projectID })
        XCTAssertFalse(store.snapshot.tasks.contains { $0.projectID == projectID })
        XCTAssertFalse(store.snapshot.habits.contains { $0.projectID == projectID })
        XCTAssertEqual(store.state["resources"]?[0]?["projectId"]?.stringValue, "")
        XCTAssertEqual(store.state["captures"]?[0]?["convertedId"]?.stringValue, "")
    }

    func testGoalAndBoxDeletionClearEveryDependentReference() throws {
        var state = SeedState.make()
        guard case .object(var root) = state,
              let goalID = root["goals"]?[0]?["id"]?.stringValue,
              let boxID = root["boxes"]?[0]?["id"]?.stringValue else { return XCTFail("Seed relations required") }
        root["resources"] = .array([.object([
            "id": .string("cleanup-resource"), "title": .string("자료"),
            "boxId": .string(boxID), "goalId": .string(goalID), "projectId": .string(""),
            "blocks": .array([]), "revision": .number(1), "updatedAt": .string("2026-07-16T00:00:00Z"),
        ])])
        state = .object(root)
        let store = AppStore(initialState: state, persistenceURL: nil, autoRefresh: false)

        store.deleteGoal(goalID)

        XCTAssertTrue(store.snapshot.projects.allSatisfy { $0.goalID != goalID })
        XCTAssertTrue(store.snapshot.tasks.allSatisfy { $0.goalID != goalID })
        XCTAssertEqual(store.state["resources"]?[0]?["goalId"]?.stringValue, "")

        store.deleteBox(boxID)

        XCTAssertTrue(store.snapshot.goals.allSatisfy { $0.boxID != boxID })
        XCTAssertTrue(store.snapshot.projects.allSatisfy { $0.boxID != boxID })
        XCTAssertTrue(store.snapshot.tasks.allSatisfy { $0.boxID != boxID })
        XCTAssertTrue(store.snapshot.habits.allSatisfy { $0.boxID != boxID })
        XCTAssertEqual(store.state["resources"]?[0]?["boxId"]?.stringValue, "")
    }

    func testHabitEditPreservesBlocksAndInheritsProjectBox() throws {
        var state = SeedState.make()
        let preservedBlocks: JSONValue = .array([.object(["id": .string("habit-block"), "type": .string("paragraph"), "text": .string("보존")])])
        guard case .object(var root) = state,
              var habits = root["habits"]?.arrayValue,
              case .object(var habit) = habits.first else { return XCTFail("Seed should include habit") }
        habit["blocks"] = preservedBlocks
        habit["unknown"] = .string("keep")
        habits[0] = .object(habit)
        root["habits"] = .array(habits)
        state = .object(root)
        let store = AppStore(initialState: state, persistenceURL: nil, autoRefresh: false)
        XCTAssertNotNil(store.createBox(BoxDraft(id: "habit-box", name: "루틴 영역")))
        XCTAssertNotNil(store.createProject(ProjectDraft(id: "habit-project", name: "루틴 프로젝트", boxID: "habit-box")))
        var draft = HabitDraft(habit: try XCTUnwrap(store.snapshot.habits.first))
        draft.title = "수정된 루틴"
        draft.cadence = "weekly"
        draft.status = "archived"
        draft.projectID = "habit-project"

        store.updateHabit(draft)

        let saved = try XCTUnwrap(store.state["habits"]?.arrayValue?.first(where: { $0["id"]?.stringValue == draft.id }))
        XCTAssertEqual(saved["title"]?.stringValue, "수정된 루틴")
        XCTAssertEqual(saved["status"]?.stringValue, "archived")
        XCTAssertEqual(saved["boxId"]?.stringValue, "habit-box")
        XCTAssertEqual(saved["blocks"], preservedBlocks)
        XCTAssertEqual(saved["unknown"]?.stringValue, "keep")
    }

    func testCaptureArchivedStatusAndAtomicConversion() throws {
        let store = AppStore(initialState: SeedState.make(), persistenceURL: nil, autoRefresh: false)
        let captureID = try XCTUnwrap(store.createCapture(CaptureDraft(title: "분류할 생각", status: "archived")))
        XCTAssertEqual(store.snapshot.captures.first(where: { $0.id == captureID })?.status, "archived")
        var draft = CaptureDraft(capture: try XCTUnwrap(store.snapshot.captures.first(where: { $0.id == captureID })))
        draft.status = "inbox"
        store.updateCapture(draft)

        let goalID = try XCTUnwrap(store.convertCapture(captureID, to: .goals, boxID: "native-demo-box"))

        XCTAssertTrue(store.snapshot.goals.contains { $0.id == goalID && $0.name == "분류할 생각" })
        let converted = try XCTUnwrap(store.snapshot.captures.first(where: { $0.id == captureID }))
        XCTAssertEqual(converted.status, "processed")
        XCTAssertEqual(converted.convertedTo, "goals")
        XCTAssertEqual(converted.convertedID, goalID)
        store.deleteGoal(goalID)
        XCTAssertEqual(store.snapshot.captures.first(where: { $0.id == captureID })?.convertedID, "")
    }

    func testCaptureConvertsToDateFreeScheduledTaskWithRelations() throws {
        let store = AppStore(initialState: SeedState.make(), persistenceURL: nil, autoRefresh: false)
        let captureID = try XCTUnwrap(store.createCapture(CaptureDraft(title: "예정으로 분류")))

        let taskID = try XCTUnwrap(store.convertCapture(
            captureID,
            to: .tasks,
            boxID: "native-demo-box",
            goalID: "native-demo-goal",
            projectID: "native-demo-project-ui",
            taskStatus: "scheduled",
            taskDueDate: ""
        ))

        let task = try XCTUnwrap(store.snapshot.tasks.first(where: { $0.id == taskID }))
        XCTAssertEqual(task.status, "scheduled")
        XCTAssertEqual(task.dateKey, "")
        XCTAssertEqual(task.boxID, "native-demo-box")
        XCTAssertEqual(task.goalID, "native-demo-goal")
        XCTAssertEqual(task.projectID, "native-demo-project-ui")
        XCTAssertTrue(store.snapshot.tasks(in: .scheduled).contains { $0.id == taskID })
        XCTAssertFalse(store.snapshot.tasks(in: .unplanned).contains { $0.id == taskID })
    }

    func testJournalEditPreservesBlocksAndUnknownFields() throws {
        var state = SeedState.make()
        let blocks: JSONValue = .array([
            .object(["id": .string("heading-reflection"), "type": .string("heading2"), "text": .string("오늘의 기록")]),
            .object([
                "id": .string("reflection"), "type": .string("paragraph"), "text": .string("원본 기록"),
                "marks": .array([.object(["type": .string("bold")])]), "unknownBlockField": .string("keep"),
            ]),
            .object(["id": .string("extra"), "type": .string("callout"), "text": .string("그대로")]),
            .object(["id": .string("heading-next"), "type": .string("heading2"), "text": .string("다음 행동")]),
            .object(["id": .string("next"), "type": .string("todo"), "text": .string("원본 행동"), "checked": .bool(true)]),
        ])
        guard case .object(var root) = state else { return XCTFail("Seed root required") }
        root["journals"] = .array([.object([
            "id": .string("journal-1"), "title": .string("원본"), "date": .string("2026-07-16"),
            "satisfaction": .number(7), "blocks": blocks, "unknown": .bool(true),
        ])])
        state = .object(root)
        let store = AppStore(initialState: state, persistenceURL: nil, autoRefresh: false)
        var draft = JournalDraft(journal: try XCTUnwrap(store.snapshot.journals.first))
        draft.title = "수정"
        draft.satisfaction = 9
        draft.reflection = "수정된 기록"
        draft.nextAction = "수정된 행동"

        store.updateJournal(draft)

        XCTAssertEqual(store.state["journals"]?[0]?["title"]?.stringValue, "수정")
        XCTAssertEqual(store.state["journals"]?[0]?["satisfaction"]?.intValue, 9)
        XCTAssertEqual(store.state["journals"]?[0]?["blocks"]?[1]?["text"]?.stringValue, "수정된 기록")
        XCTAssertEqual(store.state["journals"]?[0]?["blocks"]?[1]?["marks"], blocks[1]?["marks"])
        XCTAssertEqual(store.state["journals"]?[0]?["blocks"]?[1]?["unknownBlockField"]?.stringValue, "keep")
        XCTAssertEqual(store.state["journals"]?[0]?["blocks"]?[2], blocks[2])
        XCTAssertEqual(store.state["journals"]?[0]?["blocks"]?[4]?["text"]?.stringValue, "수정된 행동")
        XCTAssertEqual(store.state["journals"]?[0]?["blocks"]?[4]?["checked"]?.boolValue, true)
        XCTAssertEqual(store.state["journals"]?[0]?["unknown"]?.boolValue, true)
    }

    func testJournalEditNeverOverwritesFallbackBlocksOutsideNamedSections() throws {
        var state = SeedState.make()
        let unrelatedParagraph: JSONValue = .object([
            "id": .string("unrelated-paragraph"), "type": .string("paragraph"), "text": .string("다른 섹션 기록"),
        ])
        let unrelatedTodo: JSONValue = .object([
            "id": .string("unrelated-todo"), "type": .string("todo"), "text": .string("다른 섹션 할 일"),
        ])
        guard case .object(var root) = state else { return XCTFail("Seed root required") }
        root["journals"] = .array([.object([
            "id": .string("journal-safe-sections"), "title": .string("커스텀 구조"),
            "date": .string("2026-07-17"), "satisfaction": .number(6),
            "blocks": .array([
                unrelatedParagraph,
                unrelatedTodo,
                .object(["id": .string("heading-reflection"), "type": .string("heading2"), "text": .string("오늘의 기록")]),
                .object(["id": .string("reflection-callout"), "type": .string("callout"), "text": .string("보존")]),
                .object(["id": .string("heading-next"), "type": .string("heading2"), "text": .string("다음 행동")]),
            ]),
        ])])
        let store = AppStore(initialState: .object(root), persistenceURL: nil, autoRefresh: false)
        var draft = JournalDraft(journal: try XCTUnwrap(store.snapshot.journals.first))
        draft.reflection = "새 기록"
        draft.nextAction = "새 행동"

        store.updateJournal(draft)

        let blocks = try XCTUnwrap(store.state["journals"]?[0]?["blocks"]?.arrayValue)
        XCTAssertEqual(blocks.first(where: { $0["id"]?.stringValue == "unrelated-paragraph" }), unrelatedParagraph)
        XCTAssertEqual(blocks.first(where: { $0["id"]?.stringValue == "unrelated-todo" }), unrelatedTodo)
        XCTAssertEqual(JournalBlockContent.text(after: "오늘의 기록", type: "paragraph", in: blocks), "새 기록")
        XCTAssertEqual(JournalBlockContent.text(after: "다음 행동", type: "todo", in: blocks), "새 행동")
    }

    func testTaskLanesUseDatesStatusAndCompletionInstants() throws {
        guard case .object(var root) = SeedState.make() else { return XCTFail("Seed root required") }
        let localEarlyMorning = try XCTUnwrap(
            Calendar.current.date(from: DateComponents(year: 2026, month: 7, day: 17, hour: 1, minute: 30))
        )
        root["tasks"] = .array([
            Self.taskJSON(id: "charlie", title: "Charlie", status: "todo", dueDate: "2026-07-17"),
            Self.taskJSON(id: "alpha", title: "Alpha", status: "scheduled", dueDate: "2026-07-17"),
            Self.taskJSON(id: "bravo", title: "Bravo", status: "todo", dueDate: "2026-07-17"),
            Self.taskJSON(id: "unplanned", title: "Unplanned", status: "todo", dueDate: ""),
            Self.taskJSON(id: "scheduled-no-date", title: "Scheduled", status: "scheduled", dueDate: ""),
            Self.taskJSON(id: "future", title: "Future", status: "scheduled", dueDate: "2026-07-20"),
            Self.taskJSON(
                id: "completed-new", title: "최근 완료", status: "done", dueDate: "2026-07-01",
                completedAt: ISO8601DateFormatter().string(from: localEarlyMorning)
            ),
            Self.taskJSON(
                id: "completed-old", title: "이전 완료", status: "done", dueDate: "2026-07-20",
                completedAt: "2026-07-10T12:00:00Z"
            ),
        ])
        let snapshot = AppSnapshot(state: .object(root))

        XCTAssertEqual(snapshot.tasks(in: .today, today: "2026-07-17").map(\.id), ["alpha", "bravo", "charlie"])
        XCTAssertEqual(snapshot.tasks(in: .unplanned, today: "2026-07-17").map(\.id), ["unplanned"])
        XCTAssertEqual(snapshot.tasks(in: .scheduled, today: "2026-07-17").map(\.id), ["scheduled-no-date", "future"])
        XCTAssertEqual(snapshot.tasks(in: .completed).map(\.id), ["completed-new", "completed-old"])
        XCTAssertEqual(snapshot.tasks.first(where: { $0.id == "completed-new" })?.completedDateKey, localEarlyMorning.dateKey)
    }

    func testCalendarUsesEntityIDsAndExclusiveEndDates() throws {
        var state = SeedState.make()
        guard case .object(var root) = state else { return XCTFail("Seed root required") }
        root["googleEvents"] = .array([
            .object([
                "id": .string("all-day"), "title": .string("종일"), "allDay": .bool(true),
                "start": .string("2026-07-10"), "end": .string("2026-07-12"),
            ]),
            .object([
                "id": .string("midnight"), "title": .string("자정 종료"), "allDay": .bool(false),
                "start": .string("2026-07-10T22:00:00+09:00"), "end": .string("2026-07-11T00:00:00+09:00"),
                "startDate": .string("2026-07-10"), "endDate": .string("2026-07-11"),
            ]),
            .object([
                "id": .string("ten"), "title": .string("10시"), "allDay": .bool(false),
                "start": .string("2026-07-10T10:00:00+09:00"), "end": .string("2026-07-10T11:00:00+09:00"),
            ]),
            .object([
                "id": .string("nine"), "title": .string("9시"), "allDay": .bool(false),
                "start": .string("2026-07-10T09:00:00+09:00"), "end": .string("2026-07-10T10:00:00+09:00"),
            ]),
            .object([
                "id": .string("cancelled"), "title": .string("취소됨"), "status": .string("cancelled"),
                "allDay": .bool(false), "start": .string("2026-07-10T08:00:00+09:00"),
                "end": .string("2026-07-10T09:00:00+09:00"),
            ]),
        ])
        state = .object(root)
        let snapshot = AppSnapshot(state: state)
        let allDay = try XCTUnwrap(snapshot.calendarEntries.first(where: { $0.entityID == "all-day" }))
        let midnight = try XCTUnwrap(snapshot.calendarEntries.first(where: { $0.entityID == "midnight" }))

        XCTAssertEqual(allDay.endDate, "2026-07-11")
        XCTAssertFalse(allDay.occurs(on: "2026-07-12"))
        XCTAssertEqual(midnight.endDate, "2026-07-10")
        XCTAssertFalse(midnight.occurs(on: "2026-07-11"))
        XCTAssertFalse(snapshot.calendarEntries.contains { $0.entityID == "cancelled" })
        XCTAssertEqual(
            snapshot.calendarEntries.filter { $0.source == .google }.map(\.entityID),
            ["all-day", "nine", "ten", "midnight"]
        )
    }

    func testCalendarWeekDaysAreOneContiguousCalendarWeek() throws {
        let date = try XCTUnwrap(Date.from(dateKey: "2026-07-17"))
        let days = date.calendarWeekDays
        let interval = try XCTUnwrap(Calendar.current.dateInterval(of: .weekOfYear, for: date))

        XCTAssertEqual(days.count, 7)
        XCTAssertEqual(days.first, interval.start.startOfDay)
        XCTAssertEqual(days.last, interval.start.addingDays(6).startOfDay)
    }

    func testLocalPersistenceFailureIsNotReportedAsSaved() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("SYGMA-PersistenceFailure-\(UUID().uuidString)", isDirectory: true)
        let invalidFileURL = directory.appendingPathComponent("state.json", isDirectory: true)
        try FileManager.default.createDirectory(at: invalidFileURL, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = AppStore(
            initialState: SeedState.make(), persistenceURL: invalidFileURL, autoRefresh: false
        )

        store.createTask(title: "디스크 실패 중 변경", lane: .today)

        guard case let .offline(message) = store.syncState else {
            return XCTFail("A failed atomic local write must stay visible")
        }
        XCTAssertTrue(message.contains("로컬 상태"))
        XCTAssertTrue(store.hasPendingChanges)
    }

    func testCalendarSourceVisibilityPersistsInSharedSettings() {
        let store = AppStore(initialState: SeedState.make(), persistenceURL: nil, autoRefresh: false)

        store.setCalendarSource(.project, visible: false)

        XCTAssertEqual(store.state["settings"]?["calendarSources"]?["projects"]?.boolValue, false)
        XCTAssertFalse(store.snapshot.calendarSourceVisible(.project))
        XCTAssertTrue(store.snapshot.calendarSourceVisible(.task))
        XCTAssertTrue(store.snapshot.calendarSourceVisible(.google))
    }

    func testGoogleCalendarVisibilityPersistsInSharedSettings() throws {
        guard case .object(var root) = SeedState.make() else { return XCTFail("Missing seed root") }
        root["googleCalendars"] = .array([
            .object(["id": .string("primary"), "summary": .string("Primary")]),
        ])
        let store = AppStore(initialState: .object(root), persistenceURL: nil, autoRefresh: false)

        XCTAssertTrue(store.snapshot.googleCalendarVisible("primary"))
        store.setGoogleCalendar("primary", visible: false)

        XCTAssertEqual(store.state["settings"]?["visibleGoogleCalendars"]?["primary"]?.boolValue, false)
        XCTAssertFalse(store.snapshot.googleCalendarVisible("primary"))
    }

    func testConflictSurvivesLaterEditsAndRelaunch() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("SYGMA-ConflictPersistence-\(UUID().uuidString)", isDirectory: true)
        let url = directory.appendingPathComponent("state.json")
        defer { try? FileManager.default.removeItem(at: directory) }
        let remote = Self.namedState("remote-v2", revision: 2)
        StubURLProtocol.handler = { request in
            try Self.stateResponse(for: request, state: remote, revision: 2)
        }
        let store = AppStore(
            initialState: SeedState.make(), apiClient: makeStubClient(), persistenceURL: url, autoRefresh: false
        )
        store.createTask(title: "local-before-conflict", lane: .today)

        await store.refreshFromRemote()

        guard case .conflict = store.syncState else { return XCTFail("Dirty mismatched revisions must conflict") }
        XCTAssertEqual(store.conflictRemoteRevision, 2)
        XCTAssertTrue(store.hasPendingChanges)
        store.createTask(title: "local-after-conflict", lane: .today)
        guard case .conflict = store.syncState else { return XCTFail("A later edit must not hide the conflict") }

        let relaunched = AppStore(persistenceURL: url, autoRefresh: false)
        guard case .conflict = relaunched.syncState else { return XCTFail("Conflict must survive relaunch") }
        XCTAssertEqual(relaunched.conflictRemoteRevision, 2)
        XCTAssertTrue(relaunched.hasPendingChanges)
        XCTAssertTrue(relaunched.snapshot.tasks.contains { $0.title == "local-after-conflict" })
    }

    func testUseRemoteBacksUpLocalThenClearsConflictAndDirtyState() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("SYGMA-UseRemote-\(UUID().uuidString)", isDirectory: true)
        let url = directory.appendingPathComponent("state.json")
        defer { try? FileManager.default.removeItem(at: directory) }
        let remote = Self.namedState("remote-selected", revision: 2)
        StubURLProtocol.handler = { request in
            try Self.stateResponse(for: request, state: remote, revision: 2)
        }
        let store = AppStore(
            initialState: SeedState.make(), apiClient: makeStubClient(), persistenceURL: url, autoRefresh: false
        )
        store.createTask(title: "local-losing-change", lane: .today)
        await store.refreshFromRemote()

        await store.useRemoteVersion()

        XCTAssertEqual(store.syncState, .synced)
        XCTAssertFalse(store.hasPendingChanges)
        XCTAssertNil(store.conflictRemoteRevision)
        XCTAssertEqual(store.snapshot.tasks.first?.title, "remote-selected")
        XCTAssertFalse(store.snapshot.tasks.contains { $0.title == "local-losing-change" })
        let backupURL = try XCTUnwrap(store.latestConflictBackupURL)
        let backup = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: backupURL))
        XCTAssertEqual(backup["side"]?.stringValue, "local")
        XCTAssertTrue(backup["state"]?["tasks"]?.arrayValue?.contains { $0["title"]?.stringValue == "local-losing-change" } == true)
        XCTAssertEqual(try backupURL.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
    }

    func testOverwriteRemoteBacksUpLatestRemoteAndRebasesOnce() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("SYGMA-KeepLocal-\(UUID().uuidString)", isDirectory: true)
        let url = directory.appendingPathComponent("state.json")
        defer { try? FileManager.default.removeItem(at: directory) }
        let lock = NSLock()
        var getCount = 0
        var putCount = 0
        StubURLProtocol.handler = { request in
            if request.httpMethod == "GET" {
                let count = lock.withLock { getCount += 1; return getCount }
                let revision = count == 1 ? 2 : 3
                return try Self.stateResponse(
                    for: request, state: Self.namedState("remote-v\(revision)", revision: revision), revision: revision
                )
            }
            lock.withLock { putCount += 1 }
            XCTAssertEqual(request.value(forHTTPHeaderField: "If-Match"), "\"state-3\"")
            let payload = try JSONDecoder().decode(JSONValue.self, from: Self.requestBody(from: request))
            return try Self.stateResponse(for: request, state: try XCTUnwrap(payload["state"]), revision: 4)
        }
        let store = AppStore(
            initialState: SeedState.make(), apiClient: makeStubClient(), persistenceURL: url, autoRefresh: false
        )
        store.createTask(title: "local-winner", lane: .today)
        await store.refreshFromRemote()

        await store.overwriteRemoteWithLocalVersion()

        XCTAssertEqual(store.syncState, .synced)
        XCTAssertFalse(store.hasPendingChanges)
        XCTAssertNil(store.conflictRemoteRevision)
        XCTAssertEqual(store.revision, 4)
        XCTAssertTrue(store.snapshot.tasks.contains { $0.title == "local-winner" })
        XCTAssertEqual(lock.withLock { putCount }, 1)
        let backup = try JSONDecoder().decode(
            JSONValue.self, from: Data(contentsOf: try XCTUnwrap(store.latestConflictBackupURL))
        )
        XCTAssertEqual(backup["side"]?.stringValue, "remote")
        XCTAssertEqual(backup["revision"]?.intValue, 3)
        XCTAssertEqual(backup["state"]?["tasks"]?[0]?["title"]?.stringValue, "remote-v3")
    }

    func testOverwriteRemoteSecondRaceRemainsConflictWithoutSecondPut() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("SYGMA-SecondRace-\(UUID().uuidString)", isDirectory: true)
        let url = directory.appendingPathComponent("state.json")
        defer { try? FileManager.default.removeItem(at: directory) }
        let lock = NSLock()
        var getCount = 0
        var putCount = 0
        StubURLProtocol.handler = { request in
            if request.httpMethod == "GET" {
                let count = lock.withLock { getCount += 1; return getCount }
                let revision = min(count + 1, 4)
                return try Self.stateResponse(
                    for: request, state: Self.namedState("remote-v\(revision)", revision: revision), revision: revision
                )
            }
            lock.withLock { putCount += 1 }
            return try Self.conflictResponse(for: request, revision: 4)
        }
        let store = AppStore(
            initialState: SeedState.make(), apiClient: makeStubClient(), persistenceURL: url, autoRefresh: false
        )
        store.createTask(title: "local-still-safe", lane: .today)
        await store.refreshFromRemote()

        await store.overwriteRemoteWithLocalVersion()

        guard case .conflict = store.syncState else { return XCTFail("A second race must remain a conflict") }
        XCTAssertTrue(store.hasPendingChanges)
        XCTAssertEqual(store.conflictRemoteRevision, 4)
        XCTAssertTrue(store.snapshot.tasks.contains { $0.title == "local-still-safe" })
        XCTAssertEqual(lock.withLock { putCount }, 1)
        XCTAssertEqual(lock.withLock { getCount }, 3)
    }

    func testAuthenticationRequiredIsNotReportedAsOffline() async throws {
        StubURLProtocol.handler = { request in
            try Self.authenticationRequiredResponse(for: request)
        }
        let store = AppStore(
            initialState: SeedState.make(), apiClient: makeStubClient(), persistenceURL: nil, autoRefresh: false
        )

        await store.refreshFromRemote()

        guard case .authenticationRequired = store.syncState else {
            return XCTFail("401/AUTH_REQUIRED must have a distinct sync state")
        }
    }

    func testDirtyLocalStateIsNotOverwrittenByRefresh() async throws {
        let remote = SeedState.make()
        StubURLProtocol.handler = { request in
            try Self.stateResponse(for: request, state: remote, revision: 0)
        }
        let store = AppStore(
            initialState: SeedState.make(),
            apiClient: makeStubClient(),
            persistenceURL: nil,
            autoRefresh: false
        )
        store.createTask(title: "unsaved-local-task", lane: .today)

        await store.refreshFromRemote()

        XCTAssertTrue(store.snapshot.tasks.contains { $0.title == "unsaved-local-task" })
    }

    func testDirtyMetadataAndStateSurviveRelaunch() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("SYGMA-AppStoreTests-\(UUID().uuidString)", isDirectory: true)
        let url = directory.appendingPathComponent("state.json")
        defer { try? FileManager.default.removeItem(at: directory) }

        let firstStore = AppStore(
            initialState: SeedState.make(),
            persistenceURL: url,
            autoRefresh: false
        )
        firstStore.createTask(title: "persisted-pending-task", lane: .today)

        let raw = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
        XCTAssertEqual(raw["needsRemoteSave"]?.boolValue, true)
        let relaunched = AppStore(persistenceURL: url, autoRefresh: false)
        XCTAssertTrue(relaunched.snapshot.tasks.contains { $0.title == "persisted-pending-task" })
        XCTAssertEqual(relaunched.syncState, .localOnly)
    }

    func testNullRemoteStateUsesSeedState() async throws {
        StubURLProtocol.handler = { request in
            try Self.stateResponse(for: request, state: .null, revision: 0)
        }
        var empty = SeedState.make()
        empty = empty.replacingValue(.array([]), forKey: "boxes")
        let store = AppStore(
            initialState: empty,
            apiClient: makeStubClient(),
            persistenceURL: nil,
            autoRefresh: false
        )

        await store.refreshFromRemote()

        XCTAssertFalse(store.state.objectValue?["boxes"]?.arrayValue?.isEmpty ?? true)
        XCTAssertEqual(store.syncState, .localOnly)
    }

    func testEditDuringInFlightSaveProducesFollowUpSave() async throws {
        let firstPutStarted = expectation(description: "first PUT started")
        let lock = NSLock()
        var putCount = 0
        StubURLProtocol.handler = { request in
            if request.httpMethod == "GET" {
                return try Self.stateResponse(for: request, state: SeedState.make(), revision: 0)
            }
            let currentPut = lock.withLock {
                putCount += 1
                return putCount
            }
            if currentPut == 1 {
                firstPutStarted.fulfill()
                Thread.sleep(forTimeInterval: 0.3)
            }
            let body = try Self.requestBody(from: request)
            let payload = try JSONDecoder().decode(JSONValue.self, from: body)
            let requestState = try XCTUnwrap(payload["state"])
            return try Self.stateResponse(for: request, state: requestState, revision: currentPut)
        }
        let store = AppStore(
            initialState: SeedState.make(),
            apiClient: makeStubClient(),
            persistenceURL: nil,
            autoRefresh: false
        )
        await store.refreshFromRemote()
        store.createTask(title: "first-save", lane: .today)
        await fulfillment(of: [firstPutStarted], timeout: 2)

        store.createTask(title: "second-save", lane: .today)
        try await Task.sleep(nanoseconds: 1_100_000_000)

        let completedPutCount = lock.withLock { putCount }
        XCTAssertGreaterThanOrEqual(completedPutCount, 2)
        XCTAssertEqual(store.syncState, .synced)
        XCTAssertTrue(store.snapshot.tasks.contains { $0.title == "second-save" })
    }

    func testFailedSaveKeepsDirtySnapshotAndRetriesAfterRefresh() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("SYGMA-AppStoreRetryTests-\(UUID().uuidString)", isDirectory: true)
        let url = directory.appendingPathComponent("state.json")
        defer { try? FileManager.default.removeItem(at: directory) }
        let lock = NSLock()
        var failWrites = true
        var putCount = 0
        StubURLProtocol.handler = { request in
            if request.httpMethod == "GET" {
                return try Self.stateResponse(for: request, state: SeedState.make(), revision: 0)
            }
            let shouldFail = lock.withLock {
                putCount += 1
                return failWrites
            }
            if shouldFail { return try Self.errorResponse(for: request, statusCode: 500) }
            let payload = try JSONDecoder().decode(JSONValue.self, from: Self.requestBody(from: request))
            return try Self.stateResponse(
                for: request,
                state: try XCTUnwrap(payload["state"]),
                revision: 1
            )
        }
        let store = AppStore(
            initialState: SeedState.make(),
            apiClient: makeStubClient(),
            persistenceURL: url,
            autoRefresh: false
        )
        await store.refreshFromRemote()
        store.createTask(title: "retry-after-failure", lane: .today)
        try await Task.sleep(nanoseconds: 700_000_000)

        guard case .offline = store.syncState else { return XCTFail("A failed PUT should remain offline and dirty") }
        var persisted = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
        XCTAssertEqual(persisted["needsRemoteSave"]?.boolValue, true)

        lock.withLock { failWrites = false }
        await store.refreshFromRemote()
        try await Task.sleep(nanoseconds: 700_000_000)

        XCTAssertEqual(store.syncState, .synced)
        XCTAssertTrue(store.snapshot.tasks.contains { $0.title == "retry-after-failure" })
        persisted = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
        XCTAssertEqual(persisted["needsRemoteSave"]?.boolValue, false)
        XCTAssertGreaterThanOrEqual(lock.withLock { putCount }, 2)
    }

    private func makeStubClient() -> APIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return APIClient(
            baseURL: URL(string: "https://sygma.test/")!,
            session: URLSession(configuration: configuration)
        )
    }

    nonisolated private static func taskJSON(
        id: String,
        title: String,
        status: String,
        dueDate: String,
        completedAt: String = ""
    ) -> JSONValue {
        .object([
            "id": .string(id), "title": .string(title), "status": .string(status),
            "boxId": .string(""), "goalId": .string(""), "projectId": .string(""),
            "dueDate": .string(dueDate),
            "completedAt": .string(completedAt),
        ])
    }

    nonisolated private static func stateResponse(
        for request: URLRequest,
        state: JSONValue,
        revision: Int
    ) throws -> (HTTPURLResponse, Data) {
        let response = try XCTUnwrap(HTTPURLResponse(
            url: try XCTUnwrap(request.url),
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["X-State-Revision": String(revision)]
        ))
        let payload: JSONValue = .object([
            "state": state,
            "revision": .number(Double(revision)),
            "updatedAt": .string("2026-07-16T00:00:00Z"),
        ])
        return (response, try JSONEncoder().encode(payload))
    }

    nonisolated private static func namedState(_ title: String, revision: Int) -> JSONValue {
        guard case .object(var root) = SeedState.make(),
              var tasks = root["tasks"]?.arrayValue,
              !tasks.isEmpty,
              case .object(var task) = tasks[0] else { return SeedState.make() }
        task["title"] = .string(title)
        tasks[0] = .object(task)
        root["tasks"] = .array(tasks)
        root["revision"] = .number(Double(revision))
        return .object(root)
    }

    nonisolated private static func conflictResponse(
        for request: URLRequest,
        revision: Int
    ) throws -> (HTTPURLResponse, Data) {
        let response = try XCTUnwrap(HTTPURLResponse(
            url: try XCTUnwrap(request.url),
            statusCode: 409,
            httpVersion: "HTTP/1.1",
            headerFields: ["X-State-Revision": String(revision)]
        ))
        let payload: JSONValue = .object([
            "error": .string("Revision conflict."),
            "code": .string("REVISION_CONFLICT"),
            "details": .object(["revision": .number(Double(revision))]),
        ])
        return (response, try JSONEncoder().encode(payload))
    }

    nonisolated private static func authenticationRequiredResponse(
        for request: URLRequest
    ) throws -> (HTTPURLResponse, Data) {
        let response = try XCTUnwrap(HTTPURLResponse(
            url: try XCTUnwrap(request.url),
            statusCode: 401,
            httpVersion: "HTTP/1.1",
            headerFields: nil
        ))
        let payload: JSONValue = .object([
            "error": .string("Authentication required."),
            "code": .string("AUTH_REQUIRED"),
        ])
        return (response, try JSONEncoder().encode(payload))
    }

    nonisolated private static func errorResponse(
        for request: URLRequest,
        statusCode: Int
    ) throws -> (HTTPURLResponse, Data) {
        let response = try XCTUnwrap(HTTPURLResponse(
            url: try XCTUnwrap(request.url),
            statusCode: statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: nil
        ))
        return (response, try JSONEncoder().encode(JSONValue.object([
            "error": .string("Temporary failure"),
            "code": .string("TEMPORARY_FAILURE"),
        ])))
    }

    nonisolated private static func requestBody(from request: URLRequest) throws -> Data {
        if let body = request.httpBody { return body }
        let stream = try XCTUnwrap(request.httpBodyStream)
        stream.open()
        defer { stream.close() }
        var body = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while true {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count < 0 { throw stream.streamError ?? URLError(.cannotDecodeRawData) }
            if count == 0 { return body }
            body.append(contentsOf: buffer.prefix(count))
        }
    }
}
