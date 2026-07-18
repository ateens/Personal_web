import Foundation
import Observation

enum SyncState: Equatable {
    case loading
    case synced
    case saving
    case localOnly
    case authenticationRequired(String)
    case offline(String)
    case conflict(String)

    var label: String {
        switch self {
        case .loading: "불러오는 중"
        case .synced: "PostgreSQL"
        case .saving: "저장 중"
        case .localOnly: "이 기기에 저장됨"
        case .authenticationRequired: "인증 필요"
        case .offline: "오프라인"
        case .conflict: "동기화 충돌"
        }
    }

    var detail: String? {
        switch self {
        case let .authenticationRequired(message), let .offline(message), let .conflict(message): message
        default: nil
        }
    }
}

private struct PendingConflict: Codable, Equatable {
    let remoteState: JSONValue?
    let remoteRevision: Int
    let remoteUpdatedAt: String
    let message: String
}

private struct ConflictBackup: Codable {
    let side: String
    let state: JSONValue
    let revision: Int
    let createdAt: String
}

private struct LocalStoreSnapshot: Codable {
    static let currentFormatVersion = 2

    let formatVersion: Int
    let state: JSONValue
    let revision: Int
    let needsRemoteSave: Bool
    let pendingConflict: PendingConflict?
}

private struct LoadedLocalState {
    let state: JSONValue
    let revision: Int
    let needsRemoteSave: Bool
    let pendingConflict: PendingConflict?
}

@MainActor
@Observable
final class AppStore {
    var selectedSection: AppSection = .today
    var isNavigationOpen = false
    private(set) var snapshot: AppSnapshot
    private(set) var syncState: SyncState = .loading
    private(set) var revision: Int
    private(set) var hasPendingChanges = false
    private(set) var conflictRemoteRevision: Int?
    private(set) var latestConflictBackupURL: URL?

    @ObservationIgnored private(set) var state: JSONValue
    @ObservationIgnored private let apiClient: APIClient
    @ObservationIgnored private let persistenceURL: URL?
    @ObservationIgnored private var remoteReady = false
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var pendingConflict: PendingConflict?
    @ObservationIgnored private var remoteSaveInFlight = false
    @ObservationIgnored private var saveDebounceTask: Task<Void, Never>?
    @ObservationIgnored private var remoteFlushTask: Task<Void, Never>?
    @ObservationIgnored private var stateEventTask: Task<Void, Never>?
    @ObservationIgnored private var fallbackPollTask: Task<Void, Never>?
    @ObservationIgnored private var remoteRefreshInFlight = false
    @ObservationIgnored private var queuedMinimumRevision = 0
    @ObservationIgnored private var liveSyncEnabled = false

    init(
        initialState: JSONValue? = nil,
        apiClient: APIClient = APIClient(),
        persistenceURL: URL? = AppStore.defaultPersistenceURL,
        autoRefresh: Bool = true
    ) {
        self.apiClient = apiClient
        self.persistenceURL = persistenceURL
        let loaded: LoadedLocalState
        if let initialState {
            loaded = LoadedLocalState(
                state: initialState,
                revision: Self.revision(in: initialState),
                needsRemoteSave: false,
                pendingConflict: nil
            )
        } else if let local = Self.loadLocal(from: persistenceURL) {
            loaded = local
        } else {
            let seed = SeedState.make()
            loaded = LoadedLocalState(
                state: seed, revision: Self.revision(in: seed), needsRemoteSave: false, pendingConflict: nil
            )
        }
        let migration = Self.migratingRemovedTaskStatuses(in: loaded.state)
        state = migration.state
        snapshot = AppSnapshot(state: migration.state)
        revision = loaded.revision
        hasPendingChanges = loaded.needsRemoteSave || migration.didChange
        pendingConflict = loaded.pendingConflict
        conflictRemoteRevision = loaded.pendingConflict?.remoteRevision
        if let conflict = loaded.pendingConflict {
            syncState = .conflict(conflict.message)
        } else {
            syncState = persistenceURL == nil || hasPendingChanges ? .localOnly : .loading
        }
        if autoRefresh { startLiveSync() }
    }

    deinit {
        saveDebounceTask?.cancel()
        remoteFlushTask?.cancel()
        stateEventTask?.cancel()
        fallbackPollTask?.cancel()
    }

    func select(_ section: AppSection) {
        selectedSection = section
        isNavigationOpen = false
    }

    func setCalendarSource(_ source: CalendarSource, visible: Bool) {
        guard case .object(var root) = state else { return }
        var settings = root["settings"]?.objectValue ?? [:]
        var sources = settings["calendarSources"]?.objectValue ?? [:]
        sources[source.settingsKey] = .bool(visible)
        settings["calendarSources"] = .object(sources)
        root["settings"] = .object(settings)
        commit(.object(root))
    }

    func setGoogleCalendar(_ id: String, visible: Bool) {
        guard !id.isEmpty, snapshot.googleCalendars.contains(where: { $0.id == id }), case .object(var root) = state else { return }
        var settings = root["settings"]?.objectValue ?? [:]
        var visibility = settings["visibleGoogleCalendars"]?.objectValue ?? [:]
        visibility[id] = .bool(visible)
        settings["visibleGoogleCalendars"] = .object(visibility)
        root["settings"] = .object(settings)
        commit(.object(root))
    }

    func refreshFromRemote(
        discardingLocalChanges: Bool = false,
        silent: Bool = false,
        minimumRevision: Int = 0
    ) async {
        queuedMinimumRevision = max(queuedMinimumRevision, minimumRevision)
        guard !remoteRefreshInFlight else { return }
        remoteRefreshInFlight = true
        defer { remoteRefreshInFlight = false }

        var discard = discardingLocalChanges
        var quiet = silent
        var pass = 0
        repeat {
            pass += 1
            let targetRevision = queuedMinimumRevision
            queuedMinimumRevision = 0
            await performRemoteRefresh(
                discardingLocalChanges: discard,
                silent: quiet,
                minimumRevision: targetRevision
            )
            discard = false
            quiet = true
        } while queuedMinimumRevision > revision && pass < 3
    }

    private func performRemoteRefresh(
        discardingLocalChanges: Bool,
        silent: Bool,
        minimumRevision: Int
    ) async {
        if discardingLocalChanges, pendingConflict != nil {
            await useRemoteVersion()
            return
        }
        guard !remoteSaveInFlight else {
            queuedMinimumRevision = max(queuedMinimumRevision, minimumRevision)
            syncState = .saving
            return
        }
        let startingGeneration = generation
        if !silent, pendingConflict == nil { syncState = .loading }
        do {
            let envelope = try await apiClient.fetchState()
            guard envelope.revision >= revision else { return }
            if envelope.revision < minimumRevision {
                queuedMinimumRevision = max(queuedMinimumRevision, minimumRevision)
                return
            }
            if let conflict = pendingConflict {
                registerConflict(envelope, message: conflict.message)
                return
            }
            if !discardingLocalChanges && (hasPendingChanges || generation != startingGeneration) {
                if envelope.revision == revision {
                    remoteReady = true
                    syncState = .localOnly
                    persistLocal()
                    scheduleRemoteSave()
                } else {
                    registerConflict(envelope, message: "저장되지 않은 로컬 변경과 원격 revision이 다릅니다.")
                }
                return
            }
            if envelope.revision == revision, remoteReady {
                remoteReady = true
                if persistLocal() { syncState = .synced }
                return
            }
            let persistedLocally = applyRemote(envelope)
            remoteReady = true
            if hasPendingChanges {
                if persistedLocally { syncState = .localOnly }
                scheduleRemoteSave()
            } else if persistedLocally {
                syncState = .synced
            }
        } catch {
            if Self.isCancellationError(error) { return }
            handleSyncError(error)
        }
    }

    func startLiveSync() {
        guard !liveSyncEnabled else { return }
        liveSyncEnabled = true
        stateEventTask = Task { [weak self] in
            await self?.refreshFromRemote(silent: true)
            await self?.runStateEventLoop()
        }
        fallbackPollTask = Task { [weak self] in
            await self?.runFallbackPollLoop()
        }
    }

    func stopLiveSync() {
        liveSyncEnabled = false
        stateEventTask?.cancel()
        fallbackPollTask?.cancel()
        stateEventTask = nil
        fallbackPollTask = nil
    }

    func flushPendingChangesNow() async {
        saveDebounceTask?.cancel()
        saveDebounceTask = nil
        guard remoteReady, hasPendingChanges, pendingConflict == nil else { return }
        startRemoteFlushIfNeeded()
        await remoteFlushTask?.value
    }

    private func runStateEventLoop() async {
        var retryDelay: UInt64 = 1_000_000_000
        while liveSyncEnabled, !Task.isCancelled {
            do {
                try await apiClient.listenForStateEvents(after: revision) { [weak self] event in
                    await self?.handleStateRevisionEvent(event)
                }
                retryDelay = 1_000_000_000
            } catch is CancellationError {
                return
            } catch {
                if Task.isCancelled { return }
                await refreshFromRemote(silent: true)
            }
            do {
                try await Task.sleep(nanoseconds: retryDelay)
            } catch {
                return
            }
            retryDelay = min(retryDelay * 2, 30_000_000_000)
        }
    }

    private func runFallbackPollLoop() async {
        while liveSyncEnabled, !Task.isCancelled {
            do {
                try await Task.sleep(nanoseconds: 30_000_000_000)
                let status = try await apiClient.fetchStateStatus()
                if status.revision > revision || !remoteReady {
                    await refreshFromRemote(silent: true, minimumRevision: status.revision)
                }
            } catch is CancellationError {
                return
            } catch {
                if !remoteReady { handleSyncError(error) }
            }
        }
    }

    private func handleStateRevisionEvent(_ event: StateRevisionEvent) async {
        guard event.revision > revision || !remoteReady else { return }
        if remoteSaveInFlight {
            queuedMinimumRevision = max(queuedMinimumRevision, event.revision)
            return
        }
        await refreshFromRemote(silent: true, minimumRevision: event.revision)
    }

    func useRemoteVersion() async {
        guard !remoteSaveInFlight, var conflict = pendingConflict else { return }
        do {
            if conflict.remoteState == nil {
                let envelope = try await apiClient.fetchState()
                registerConflict(envelope, message: conflict.message)
                conflict = pendingConflict ?? conflict
            }
            guard let remoteState = conflict.remoteState else { return }
            try writeConflictBackup(side: "local", state: state, revision: revision)
            clearConflict()
            revision = conflict.remoteRevision
            generation = 0
            let incomingState = remoteState == .null
                ? Self.stamped(SeedState.make(), revision: conflict.remoteRevision)
                : remoteState
            let migration = Self.migratingRemovedTaskStatuses(in: incomingState)
            state = migration.state
            snapshot = AppSnapshot(state: state)
            hasPendingChanges = migration.didChange
            remoteReady = true
            if persistLocal() { syncState = hasPendingChanges ? .localOnly : .synced }
            if hasPendingChanges { scheduleRemoteSave() }
        } catch {
            handleResolutionError(error)
        }
    }

    func overwriteRemoteWithLocalVersion() async {
        guard !remoteSaveInFlight, pendingConflict != nil else { return }
        let localState = state
        let localGeneration = generation
        syncState = .saving
        do {
            let latest = try await apiClient.fetchState()
            registerConflict(latest, message: pendingConflict?.message ?? "동기화 충돌이 발생했습니다.")
            try writeConflictBackup(side: "remote", state: latest.state, revision: latest.revision)
            let rebased = Self.stamped(localState, revision: latest.revision)
            let saved = try await apiClient.saveState(rebased, baseRevision: latest.revision)
            clearConflict()
            revision = saved.revision
            remoteReady = true
            if generation == localGeneration {
                let migration = Self.migratingRemovedTaskStatuses(in: saved.state)
                state = migration.state
                snapshot = AppSnapshot(state: state)
                hasPendingChanges = migration.didChange
            } else {
                state = Self.stamped(state, revision: saved.revision)
                snapshot = AppSnapshot(state: state)
                hasPendingChanges = true
            }
            let persistedLocally = persistLocal()
            if persistedLocally { syncState = hasPendingChanges ? .localOnly : .synced }
            if hasPendingChanges { scheduleRemoteSave() }
        } catch {
            if Self.isConflictError(error) {
                registerRevisionOnlyConflict(error)
                do {
                    let latest = try await apiClient.fetchState()
                    registerConflict(latest, message: "로컬 버전을 저장하는 동안 원격 버전이 다시 변경되었습니다.")
                } catch {
                    handleSyncError(error)
                }
            } else {
                handleResolutionError(error)
            }
        }
    }

    @discardableResult
    func createTask(title: String, lane: TaskLane = .today, date: Date? = nil) -> String? {
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanTitle.isEmpty else { return nil }
        let dateKey: String
        switch lane {
        case .unplanned:
            dateKey = ""
        case .tomorrow:
            dateKey = Date().addingDays(1).dateKey
        case .scheduled:
            dateKey = date?.dateKey ?? ""
        default:
            dateKey = (date ?? Date()).dateKey
        }
        let status: String
        switch lane {
        case .completed: status = "done"
        case .scheduled: status = "scheduled"
        default: status = "todo"
        }
        return createTask(TaskDraft(
            title: cleanTitle,
            status: status,
            boxID: defaultBoxID,
            dueDate: dateKey
        ))
    }

    @discardableResult
    func createTask(_ draft: TaskDraft) -> String? {
        guard case .object(var root) = state,
              Self.idAvailable(draft.id, in: root),
              let item = Self.taskItem(from: draft, root: root) else { return nil }
        var items = root["tasks"]?.arrayValue ?? []
        items.append(.object(item))
        root["tasks"] = .array(items)
        commit(.object(root))
        return draft.id
    }

    func updateTask(_ draft: TaskDraft) {
        guard case .object(var root) = state,
              var items = root["tasks"]?.arrayValue,
              let index = items.firstIndex(where: { $0["id"]?.stringValue == draft.id }),
              case .object(var task) = items[index],
              let previous = SygmaTask(json: items[index]) else { return }
        let cleanTitle = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanTitle.isEmpty else { return }
        var next = Self.normalizedTaskDraft(draft, previous: previous, root: root)
        next.title = cleanTitle
        task["title"] = .string(next.title)
        task["status"] = .string(next.status)
        task["boxId"] = .string(next.boxID)
        task["goalId"] = .string(next.goalID)
        task["projectId"] = .string(next.projectID)
        task["dueDate"] = .string(next.dueDate)
        for key in ["scheduledStart", "scheduledEnd", "estimatedMinutes", "actualMinutes"] {
            task.removeValue(forKey: key)
        }
        task["completedAt"] = .string(next.status == "done" ? previous.completedAt.isEmpty ? Self.timestamp() : previous.completedAt : "")
        Self.clearIncompatibleResource(from: &task, previous: previous, next: next, root: root)
        items[index] = .object(task)
        root["tasks"] = .array(items)
        commit(.object(root))
    }

    func toggleTask(_ id: String) {
        updateItem(in: "tasks", id: id) { task in
            let done = task["status"]?.stringValue == "done"
            task["status"] = .string(done ? "todo" : "done")
            task["completedAt"] = .string(done ? "" : Self.timestamp())
        }
    }

    func placeTask(_ id: String, in lane: TaskLane, date: Date? = nil) {
        if lane == .completed {
            if snapshot.tasks.first(where: { $0.id == id })?.isDone != true { toggleTask(id) }
            return
        }
        let targetDate: String
        switch lane {
        case .unplanned:
            targetDate = ""
        case .today:
            targetDate = Date().dateKey
        case .tomorrow:
            targetDate = Date().addingDays(1).dateKey
        case .scheduled:
            targetDate = date?.dateKey ?? ""
        case .overdue:
            targetDate = (date ?? Date().addingDays(-1)).dateKey
        case .completed:
            return
        }
        updateItem(in: "tasks", id: id) { task in
            task["dueDate"] = .string(targetDate)
            for key in ["scheduledStart", "scheduledEnd", "estimatedMinutes", "actualMinutes"] {
                task.removeValue(forKey: key)
            }
            if task["status"]?.stringValue == "done" {
                task["status"] = .string("todo")
                task["completedAt"] = .string("")
            }
            if lane == .scheduled {
                task["status"] = .string("scheduled")
            } else if lane == .unplanned, task["status"]?.stringValue == "scheduled" {
                task["status"] = .string("todo")
            }
        }
    }

    func renameTask(_ id: String, title: String) {
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanTitle.isEmpty else { return }
        updateItem(in: "tasks", id: id) { $0["title"] = .string(cleanTitle) }
    }

    func deleteTask(_ id: String) {
        guard case .object(var root) = state else { return }
        root["tasks"] = .array((root["tasks"]?.arrayValue ?? []).filter { $0.objectValue?["id"]?.stringValue != id })
        clearCaptureConversions(in: &root, referencing: id, entityTypes: ["task", "tasks"])
        removeLinks(in: &root, referencing: id)
        guard Self.hasPrimaryItem(in: root) else { return }
        commit(.object(root))
    }

    @discardableResult
    func createHabit(title: String, target: String, cadence: String = "daily") -> String? {
        createHabit(HabitDraft(
            title: title,
            cadence: cadence,
            target: target,
            boxID: defaultBoxID
        ))
    }

    @discardableResult
    func createHabit(_ draft: HabitDraft) -> String? {
        let cleanTitle = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard case .object(var root) = state,
              Self.idAvailable(draft.id, in: root),
              !cleanTitle.isEmpty else { return nil }
        let relation = Self.normalizedHabitRelations(boxID: draft.boxID, projectID: draft.projectID, root: root)
        var items = root["habits"]?.arrayValue ?? []
        items.append(.object([
            "id": .string(draft.id), "title": .string(cleanTitle),
            "cadence": .string(SygmaHabit.cadences.contains(draft.cadence) ? draft.cadence : "daily"),
            "target": .string(draft.target.trimmingCharacters(in: .whitespacesAndNewlines)),
            "status": .string(SygmaHabit.statuses.contains(draft.status) ? draft.status : "active"),
            "boxId": .string(relation.boxID), "projectId": .string(relation.projectID),
            "blocks": .array([Self.emptyBlock()]),
        ]))
        root["habits"] = .array(items)
        commit(.object(root))
        return draft.id
    }

    func updateHabit(_ draft: HabitDraft) {
        guard case .object(let root) = state else { return }
        let cleanTitle = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanTitle.isEmpty else { return }
        let relation = Self.normalizedHabitRelations(boxID: draft.boxID, projectID: draft.projectID, root: root)
        updateItem(in: "habits", id: draft.id) { habit in
            habit["title"] = .string(cleanTitle)
            habit["cadence"] = .string(SygmaHabit.cadences.contains(draft.cadence) ? draft.cadence : "daily")
            habit["target"] = .string(draft.target.trimmingCharacters(in: .whitespacesAndNewlines))
            habit["status"] = .string(SygmaHabit.statuses.contains(draft.status) ? draft.status : "active")
            habit["boxId"] = .string(relation.boxID)
            habit["projectId"] = .string(relation.projectID)
        }
    }

    func toggleHabit(_ habitID: String, on date: Date) {
        guard case .object(var root) = state,
              let habit = root["habits"]?.arrayValue?.first(where: { $0["id"]?.stringValue == habitID }),
              date.startOfDay <= Date().startOfDay else { return }
        if habit["cadence"]?.stringValue == "weekdays" {
            let weekday = Calendar.current.component(.weekday, from: date)
            guard (2...6).contains(weekday) else { return }
        }
        var instances = root["habitInstances"]?.arrayValue ?? []
        let dateKey = date.dateKey
        if let index = instances.firstIndex(where: { raw in
            guard case let .object(item) = raw else { return false }
            return item["habitId"]?.stringValue == habitID && item["date"]?.stringValue == dateKey
        }) {
            guard case .object(var item) = instances[index] else { return }
            let completed = !(item["completed"]?.boolValue ?? false)
            item["completed"] = .bool(completed)
            item["completedAt"] = .string(completed ? Self.timestamp() : "")
            instances[index] = .object(item)
        } else {
            instances.append(.object([
                "id": .string(UUID().uuidString.lowercased()),
                "habitId": .string(habitID), "date": .string(dateKey),
                "completed": .bool(true), "completedAt": .string(Self.timestamp()),
            ]))
        }
        root["habitInstances"] = .array(instances)
        commit(.object(root))
    }

    func setHabitStatus(_ id: String, status: String) {
        guard SygmaHabit.statuses.contains(status) else { return }
        updateItem(in: "habits", id: id) { $0["status"] = .string(status) }
    }

    func deleteHabit(_ id: String) {
        guard case .object(var root) = state else { return }
        root["habits"] = .array((root["habits"]?.arrayValue ?? []).filter { $0.objectValue?["id"]?.stringValue != id })
        root["habitInstances"] = .array((root["habitInstances"]?.arrayValue ?? []).filter { $0.objectValue?["habitId"]?.stringValue != id })
        clearCaptureConversions(in: &root, referencing: id, entityTypes: ["habit", "habits"])
        removeLinks(in: &root, referencing: id)
        guard Self.hasPrimaryItem(in: root) else { return }
        commit(.object(root))
    }

    @discardableResult
    func createBox(_ draft: BoxDraft) -> String? {
        let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard case .object(var root) = state, Self.idAvailable(draft.id, in: root), !name.isEmpty else { return nil }
        var items = root["boxes"]?.arrayValue ?? []
        items.append(.object([
            "id": .string(draft.id), "name": .string(name),
            "visibility": .string(draft.visibility), "color": .string(draft.color),
            "blocks": .array([Self.emptyBlock()]),
        ]))
        root["boxes"] = .array(items)
        commit(.object(root))
        return draft.id
    }

    func updateBox(_ draft: BoxDraft) {
        let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        updateItem(in: "boxes", id: draft.id) { box in
            box["name"] = .string(name)
            box["visibility"] = .string(draft.visibility)
            box["color"] = .string(draft.color)
        }
    }

    func deleteBox(_ id: String) {
        guard case .object(var root) = state else { return }
        root["boxes"] = Self.removing(id, from: root["boxes"])
        for (collection, field) in [("goals", "boxId"), ("projects", "boxId"), ("tasks", "boxId"), ("resources", "boxId"), ("habits", "boxId")] {
            Self.clear(field, equalTo: id, in: collection, root: &root)
        }
        clearCaptureConversions(in: &root, referencing: id, entityTypes: ["box", "boxes"])
        removeLinks(in: &root, referencing: id)
        guard Self.hasPrimaryItem(in: root) else { return }
        commit(.object(root))
    }

    @discardableResult
    func createGoal(_ draft: GoalDraft) -> String? {
        let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard case .object(var root) = state, Self.idAvailable(draft.id, in: root), !name.isEmpty else { return nil }
        let boxID = Self.validReference(draft.boxID, collection: "boxes", root: root)
        var items = root["goals"]?.arrayValue ?? []
        items.append(.object([
            "id": .string(draft.id), "name": .string(name),
            "status": .string(SygmaGoal.statuses.contains(draft.status) ? draft.status : "not_started"),
            "boxId": .string(boxID), "year": .string(draft.year), "quarter": .string(draft.quarter),
            "targetDate": .string(draft.targetDate), "blocks": .array([Self.emptyBlock()]),
        ]))
        root["goals"] = .array(items)
        commit(.object(root))
        return draft.id
    }

    func updateGoal(_ draft: GoalDraft) {
        let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard case .object(var root) = state,
              !name.isEmpty,
              var goals = root["goals"]?.arrayValue,
              let index = goals.firstIndex(where: { $0["id"]?.stringValue == draft.id }),
              case .object(var goal) = goals[index] else { return }
        let boxID = Self.validReference(draft.boxID, collection: "boxes", root: root)
        goal["name"] = .string(name)
        goal["status"] = .string(SygmaGoal.statuses.contains(draft.status) ? draft.status : "not_started")
        goal["boxId"] = .string(boxID)
        goal["year"] = .string(draft.year)
        goal["quarter"] = .string(draft.quarter)
        goal["targetDate"] = .string(draft.targetDate)
        goals[index] = .object(goal)
        root["goals"] = .array(goals)
        Self.cascadeGoal(draft.id, boxID: boxID, root: &root)
        commit(.object(root))
    }

    func deleteGoal(_ id: String) {
        guard case .object(var root) = state else { return }
        root["goals"] = Self.removing(id, from: root["goals"])
        for collection in ["projects", "tasks", "resources"] {
            Self.clear("goalId", equalTo: id, in: collection, root: &root)
        }
        clearCaptureConversions(in: &root, referencing: id, entityTypes: ["goal", "goals"])
        removeLinks(in: &root, referencing: id)
        guard Self.hasPrimaryItem(in: root) else { return }
        commit(.object(root))
    }

    @discardableResult
    func createProject(_ draft: ProjectDraft) -> String? {
        let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard case .object(var root) = state, Self.idAvailable(draft.id, in: root), !name.isEmpty else { return nil }
        let relation = Self.normalizedProjectRelations(boxID: draft.boxID, goalID: draft.goalID, root: root)
        var items = root["projects"]?.arrayValue ?? []
        items.append(.object([
            "id": .string(draft.id), "name": .string(name),
            "status": .string(SygmaProject.statuses.contains(draft.status) ? draft.status : "unplanned"),
            "boxId": .string(relation.boxID), "goalId": .string(relation.goalID),
            "startDate": .string(draft.startDate), "endDate": .string(draft.endDate),
            "blocks": .array([Self.emptyBlock()]),
        ]))
        root["projects"] = .array(items)
        commit(.object(root))
        return draft.id
    }

    func updateProject(_ draft: ProjectDraft) {
        let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard case .object(var root) = state,
              !name.isEmpty,
              var projects = root["projects"]?.arrayValue,
              let index = projects.firstIndex(where: { $0["id"]?.stringValue == draft.id }),
              case .object(var project) = projects[index] else { return }
        let relation = Self.normalizedProjectRelations(boxID: draft.boxID, goalID: draft.goalID, root: root)
        project["name"] = .string(name)
        project["status"] = .string(SygmaProject.statuses.contains(draft.status) ? draft.status : "unplanned")
        project["boxId"] = .string(relation.boxID)
        project["goalId"] = .string(relation.goalID)
        project["startDate"] = .string(draft.startDate)
        project["endDate"] = .string(draft.endDate)
        projects[index] = .object(project)
        root["projects"] = .array(projects)
        Self.cascadeProject(draft.id, boxID: relation.boxID, goalID: relation.goalID, root: &root)
        commit(.object(root))
    }

    func deleteProject(_ id: String) {
        guard case .object(var root) = state else { return }
        root["projects"] = Self.removing(id, from: root["projects"])
        for collection in ["tasks", "resources", "habits"] {
            Self.clear("projectId", equalTo: id, in: collection, root: &root)
        }
        clearCaptureConversions(in: &root, referencing: id, entityTypes: ["project", "projects"])
        removeLinks(in: &root, referencing: id)
        guard Self.hasPrimaryItem(in: root) else { return }
        commit(.object(root))
    }

    @discardableResult
    func createCapture(_ draft: CaptureDraft) -> String? {
        let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard case .object(var root) = state, Self.idAvailable(draft.id, in: root), !title.isEmpty else { return nil }
        var items = root["captures"]?.arrayValue ?? []
        items.append(.object([
            "id": .string(draft.id), "title": .string(title),
            "url": .string(Self.safeStoredURL(draft.url)),
            "status": .string(SygmaCapture.statuses.contains(draft.status) ? draft.status : "inbox"),
            "convertedTo": .string(""), "convertedId": .string(""),
            "createdAt": .string(Self.timestamp()), "processedAt": .string(""),
        ]))
        root["captures"] = .array(items)
        commit(.object(root))
        return draft.id
    }

    func updateCapture(_ draft: CaptureDraft) {
        let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        updateItem(in: "captures", id: draft.id) { capture in
            capture["title"] = .string(title)
            capture["url"] = .string(Self.safeStoredURL(draft.url))
            let status = SygmaCapture.statuses.contains(draft.status) ? draft.status : "inbox"
            capture["status"] = .string(status)
            if status == "inbox" {
                capture["convertedTo"] = .string("")
                capture["convertedId"] = .string("")
                capture["processedAt"] = .string("")
            }
        }
    }

    func deleteCapture(_ id: String) {
        guard case .object(var root) = state else { return }
        root["captures"] = Self.removing(id, from: root["captures"])
        removeLinks(in: &root, referencing: id)
        guard Self.hasPrimaryItem(in: root) else { return }
        commit(.object(root))
    }

    @discardableResult
    func convertCapture(
        _ captureID: String,
        to target: CaptureTargetType,
        boxID: String = "",
        goalID: String = "",
        projectID: String = "",
        taskStatus: String = "todo",
        taskDueDate: String = ""
    ) -> String? {
        guard case .object(var root) = state,
              var captures = root["captures"]?.arrayValue,
              let captureIndex = captures.firstIndex(where: { $0["id"]?.stringValue == captureID }),
              case .object(var capture) = captures[captureIndex] else { return nil }
        let title = capture["title"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !title.isEmpty else { return nil }
        let targetID = UUID().uuidString.lowercased()
        let item: [String: JSONValue]
        switch target {
        case .tasks:
            let draft = TaskDraft(
                id: targetID,
                title: title,
                status: taskStatus,
                boxID: boxID,
                goalID: goalID,
                projectID: projectID,
                dueDate: taskDueDate
            )
            guard let created = Self.taskItem(from: draft, root: root) else { return nil }
            item = created
        case .projects:
            let relation = Self.normalizedProjectRelations(boxID: boxID, goalID: goalID, root: root)
            item = [
                "id": .string(targetID), "name": .string(title), "status": .string("unplanned"),
                "boxId": .string(relation.boxID), "goalId": .string(relation.goalID),
                "startDate": .string(""), "endDate": .string(""), "blocks": .array([Self.emptyBlock()]),
            ]
        case .goals:
            item = [
                "id": .string(targetID), "name": .string(title), "status": .string("not_started"),
                "boxId": .string(Self.validReference(boxID, collection: "boxes", root: root)),
                "year": .string(String(Calendar.current.component(.year, from: Date()))),
                "quarter": .string("\((Calendar.current.component(.month, from: Date()) - 1) / 3 + 1)Q"),
                "targetDate": .string(""), "blocks": .array([Self.emptyBlock()]),
            ]
        case .boxes:
            item = [
                "id": .string(targetID), "name": .string(title), "visibility": .string("normal"),
                "color": .string("blue"), "blocks": .array([Self.emptyBlock()]),
            ]
        }
        var targets = root[target.rawValue]?.arrayValue ?? []
        targets.append(.object(item))
        root[target.rawValue] = .array(targets)
        capture["status"] = .string("processed")
        capture["convertedTo"] = .string(target.rawValue)
        capture["convertedId"] = .string(targetID)
        capture["processedAt"] = .string(Self.timestamp())
        captures[captureIndex] = .object(capture)
        root["captures"] = .array(captures)
        commit(.object(root))
        return targetID
    }

    @discardableResult
    func createJournal(_ draft: JournalDraft) -> String? {
        let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard case .object(var root) = state, Self.idAvailable(draft.id, in: root), !title.isEmpty else { return nil }
        var items = root["journals"]?.arrayValue ?? []
        items.append(.object([
            "id": .string(draft.id), "title": .string(title), "date": .string(draft.date),
            "satisfaction": .number(Double(min(10, max(0, draft.satisfaction)))),
            "blocks": Self.journalBlocks(reflection: draft.reflection, nextAction: draft.nextAction),
        ]))
        root["journals"] = .array(items)
        commit(.object(root))
        return draft.id
    }

    func updateJournal(_ draft: JournalDraft) {
        let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        updateItem(in: "journals", id: draft.id) { journal in
            journal["title"] = .string(title)
            journal["date"] = .string(draft.date)
            journal["satisfaction"] = .number(Double(min(10, max(0, draft.satisfaction))))
            journal["blocks"] = JournalBlockContent.updating(
                journal["blocks"], reflection: draft.reflection, nextAction: draft.nextAction
            )
        }
    }

    func deleteJournal(_ id: String) {
        guard case .object(var root) = state else { return }
        root["journals"] = Self.removing(id, from: root["journals"])
        clearCaptureConversions(in: &root, referencing: id, entityTypes: ["journal", "journals"])
        removeLinks(in: &root, referencing: id)
        guard Self.hasPrimaryItem(in: root) else { return }
        commit(.object(root))
    }

    func tasksForToday() -> [SygmaTask] { snapshot.tasks(in: .today) }
    func tasksForTomorrow() -> [SygmaTask] { snapshot.tasks(in: .tomorrow) }
    func overdueTasks() -> [SygmaTask] { snapshot.tasks(in: .overdue) }

    private var defaultBoxID: String {
        guard case let .object(root) = state else { return "" }
        return root["boxes"]?.arrayValue?.first?.objectValue?["id"]?.stringValue ?? ""
    }

    private static func migratingRemovedTaskStatuses(
        in state: JSONValue
    ) -> (state: JSONValue, didChange: Bool) {
        guard case .object(var root) = state,
              let tasks = root["tasks"]?.arrayValue else { return (state, false) }
        var didChange = false
        root["tasks"] = .array(tasks.map { rawTask in
            guard case .object(var task) = rawTask,
                  task["status"]?.stringValue == "someday" else { return rawTask }
            task["status"] = .string("scheduled")
            task["dueDate"] = .string(String((task["dueDate"]?.stringValue ?? "").prefix(10)))
            for key in ["scheduledStart", "scheduledEnd", "estimatedMinutes", "actualMinutes"] {
                task.removeValue(forKey: key)
            }
            didChange = true
            return .object(task)
        })
        return (.object(root), didChange)
    }

    private static func taskItem(from draft: TaskDraft, root: [String: JSONValue]) -> [String: JSONValue]? {
        let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return nil }
        var next = normalizedTaskDraft(draft, previous: nil, root: root)
        next.title = title
        return [
            "id": .string(next.id), "title": .string(next.title), "status": .string(next.status),
            "boxId": .string(next.boxID), "goalId": .string(next.goalID), "projectId": .string(next.projectID),
            "resourceId": .string(""), "dueDate": .string(next.dueDate),
            "completedAt": .string(next.status == "done" ? timestamp() : ""),
            "googleEventId": .string(""), "blocks": .array([emptyBlock()]),
        ]
    }

    private static func normalizedTaskDraft(
        _ draft: TaskDraft,
        previous: SygmaTask?,
        root: [String: JSONValue]
    ) -> TaskDraft {
        var next = draft
        if next.status == "someday" {
            next.status = "scheduled"
            next.dueDate = String(next.dueDate.prefix(10))
        } else {
            if !SygmaTask.statuses.contains(next.status) { next.status = "todo" }
            next.dueDate = String(next.dueDate.prefix(10))
        }
        next.boxID = validReference(next.boxID, collection: "boxes", root: root)
        next.goalID = validReference(next.goalID, collection: "goals", root: root)
        next.projectID = validReference(next.projectID, collection: "projects", root: root)

        let projectChanged = previous?.projectID != next.projectID
        let goalChanged = previous?.goalID != next.goalID
        let boxChanged = previous?.boxID != next.boxID
        let project = object(next.projectID, in: "projects", root: root)
        let goal = object(next.goalID, in: "goals", root: root)

        if projectChanged, let project {
            let projectGoalID = validReference(project["goalId"]?.stringValue ?? "", collection: "goals", root: root)
            if !projectGoalID.isEmpty { next.goalID = projectGoalID }
            let projectBoxID = validReference(project["boxId"]?.stringValue ?? "", collection: "boxes", root: root)
            let inheritedBoxID = object(next.goalID, in: "goals", root: root)?["boxId"]?.stringValue ?? ""
            if !projectBoxID.isEmpty || !inheritedBoxID.isEmpty {
                next.boxID = projectBoxID.isEmpty ? inheritedBoxID : projectBoxID
            }
        } else if goalChanged, let goal {
            let goalBoxID = validReference(goal["boxId"]?.stringValue ?? "", collection: "boxes", root: root)
            if !goalBoxID.isEmpty { next.boxID = goalBoxID }
            if let project {
                let projectGoalID = project["goalId"]?.stringValue ?? ""
                let projectBoxID = project["boxId"]?.stringValue ?? ""
                if (!projectGoalID.isEmpty && projectGoalID != next.goalID)
                    || (!projectBoxID.isEmpty && !next.boxID.isEmpty && projectBoxID != next.boxID) {
                    next.projectID = ""
                }
            }
        } else if boxChanged {
            if let goal, let goalBoxID = goal["boxId"]?.stringValue,
               !goalBoxID.isEmpty, goalBoxID != next.boxID { next.goalID = "" }
            if let project, let projectBoxID = project["boxId"]?.stringValue,
               !projectBoxID.isEmpty, projectBoxID != next.boxID { next.projectID = "" }
        } else if let project {
            let projectGoalID = validReference(project["goalId"]?.stringValue ?? "", collection: "goals", root: root)
            if !projectGoalID.isEmpty { next.goalID = projectGoalID }
            let projectBoxID = validReference(project["boxId"]?.stringValue ?? "", collection: "boxes", root: root)
            let inheritedBoxID = object(next.goalID, in: "goals", root: root)?["boxId"]?.stringValue ?? ""
            if !projectBoxID.isEmpty || !inheritedBoxID.isEmpty {
                next.boxID = projectBoxID.isEmpty ? inheritedBoxID : projectBoxID
            }
        } else if let goal {
            let goalBoxID = validReference(goal["boxId"]?.stringValue ?? "", collection: "boxes", root: root)
            if !goalBoxID.isEmpty { next.boxID = goalBoxID }
        }
        return next
    }

    private static func clearIncompatibleResource(
        from task: inout [String: JSONValue],
        previous: SygmaTask,
        next: TaskDraft,
        root: [String: JSONValue]
    ) {
        guard let resourceID = task["resourceId"]?.stringValue,
              let resource = object(resourceID, in: "resources", root: root) else { return }
        if previous.boxID != next.boxID,
           let resourceBoxID = resource["boxId"]?.stringValue,
           !next.boxID.isEmpty, !resourceBoxID.isEmpty, resourceBoxID != next.boxID {
            task["resourceId"] = .string("")
        } else if previous.goalID != next.goalID,
                  let resourceGoalID = resource["goalId"]?.stringValue,
                  !next.goalID.isEmpty, !resourceGoalID.isEmpty, resourceGoalID != next.goalID {
            task["resourceId"] = .string("")
        } else if previous.projectID != next.projectID,
                  let resourceProjectID = resource["projectId"]?.stringValue,
                  !next.projectID.isEmpty, !resourceProjectID.isEmpty, resourceProjectID != next.projectID {
            task["resourceId"] = .string("")
        }
    }

    private static func normalizedProjectRelations(
        boxID: String,
        goalID: String,
        root: [String: JSONValue]
    ) -> (boxID: String, goalID: String) {
        let validGoalID = validReference(goalID, collection: "goals", root: root)
        var validBoxID = validReference(boxID, collection: "boxes", root: root)
        if let goalBoxID = object(validGoalID, in: "goals", root: root)?["boxId"]?.stringValue,
           !goalBoxID.isEmpty {
            validBoxID = validReference(goalBoxID, collection: "boxes", root: root)
        }
        return (validBoxID, validGoalID)
    }

    private static func normalizedHabitRelations(
        boxID: String,
        projectID: String,
        root: [String: JSONValue]
    ) -> (boxID: String, projectID: String) {
        let validProjectID = validReference(projectID, collection: "projects", root: root)
        var validBoxID = validReference(boxID, collection: "boxes", root: root)
        if let projectBoxID = object(validProjectID, in: "projects", root: root)?["boxId"]?.stringValue,
           !projectBoxID.isEmpty {
            validBoxID = validReference(projectBoxID, collection: "boxes", root: root)
        }
        return (validBoxID, validProjectID)
    }

    private static func cascadeGoal(_ goalID: String, boxID: String, root: inout [String: JSONValue]) {
        var projectIDs = Set<String>()
        root["projects"] = .array((root["projects"]?.arrayValue ?? []).map { raw in
            guard case .object(var item) = raw, item["goalId"]?.stringValue == goalID else { return raw }
            if let id = item["id"]?.stringValue { projectIDs.insert(id) }
            item["boxId"] = .string(boxID)
            return .object(item)
        })
        for collection in ["tasks", "resources"] {
            root[collection] = .array((root[collection]?.arrayValue ?? []).map { raw in
                guard case .object(var item) = raw else { return raw }
                if item["goalId"]?.stringValue == goalID {
                    item["boxId"] = .string(boxID)
                    if collection == "resources" { touchResource(&item) }
                }
                if let projectID = item["projectId"]?.stringValue, projectIDs.contains(projectID) {
                    item["goalId"] = .string(goalID)
                    item["boxId"] = .string(boxID)
                    if collection == "resources" { touchResource(&item) }
                }
                return .object(item)
            })
        }
        root["habits"] = .array((root["habits"]?.arrayValue ?? []).map { raw in
            guard case .object(var item) = raw,
                  let projectID = item["projectId"]?.stringValue,
                  projectIDs.contains(projectID) else { return raw }
            item["boxId"] = .string(boxID)
            return .object(item)
        })
    }

    private static func cascadeProject(
        _ projectID: String,
        boxID: String,
        goalID: String,
        root: inout [String: JSONValue]
    ) {
        for collection in ["tasks", "resources"] {
            root[collection] = .array((root[collection]?.arrayValue ?? []).map { raw in
                guard case .object(var item) = raw, item["projectId"]?.stringValue == projectID else { return raw }
                item["boxId"] = .string(boxID)
                item["goalId"] = .string(goalID)
                if collection == "resources" { touchResource(&item) }
                return .object(item)
            })
        }
        root["habits"] = .array((root["habits"]?.arrayValue ?? []).map { raw in
            guard case .object(var item) = raw, item["projectId"]?.stringValue == projectID else { return raw }
            item["boxId"] = .string(boxID)
            return .object(item)
        })
    }

    private static func clear(
        _ field: String,
        equalTo value: String,
        in collection: String,
        root: inout [String: JSONValue]
    ) {
        root[collection] = .array((root[collection]?.arrayValue ?? []).map { raw in
            guard case .object(var item) = raw, item[field]?.stringValue == value else { return raw }
            item[field] = .string("")
            if collection == "resources" { touchResource(&item) }
            return .object(item)
        })
    }

    private static func removing(_ id: String, from collection: JSONValue?) -> JSONValue {
        .array((collection?.arrayValue ?? []).filter { $0["id"]?.stringValue != id })
    }

    private static func object(
        _ id: String,
        in collection: String,
        root: [String: JSONValue]
    ) -> [String: JSONValue]? {
        guard !id.isEmpty else { return nil }
        return root[collection]?.arrayValue?.first(where: { $0["id"]?.stringValue == id })?.objectValue
    }

    private static func validReference(
        _ id: String,
        collection: String,
        root: [String: JSONValue]
    ) -> String {
        object(id, in: collection, root: root) == nil ? "" : id
    }

    private static func idAvailable(_ id: String, in root: [String: JSONValue]) -> Bool {
        let clean = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean.count <= 256,
              clean.unicodeScalars.allSatisfy({ $0.value >= 32 && $0.value != 127 }) else { return false }
        return !["captures", "boxes", "goals", "projects", "tasks", "resources", "habits", "habitInstances", "journals", "googleCalendars", "googleEvents", "links"]
            .contains { collection in root[collection]?.arrayValue?.contains(where: { $0["id"]?.stringValue == id }) == true }
    }

    private static func touchResource(_ resource: inout [String: JSONValue]) {
        resource["updatedAt"] = .string(timestamp())
        resource["revision"] = .number(Double(max(0, resource["revision"]?.intValue ?? 0) + 1))
    }

    private static func safeStoredURL(_ value: String) -> String {
        let raw = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }),
              !raw.contains(where: { $0.isWhitespace }) else { return "" }
        guard let separator = raw.firstIndex(of: ":") else { return raw }
        let scheme = raw[..<separator].lowercased()
        guard ["http", "https", "mailto", "tel"].contains(scheme) else { return "" }
        if ["http", "https"].contains(scheme) {
            guard let url = URL(string: raw), url.scheme?.lowercased() == scheme, url.host?.isEmpty == false else { return "" }
        }
        return raw
    }

    private static func journalBlocks(reflection: String, nextAction: String) -> JSONValue {
        .array([
            block(type: "heading2", text: "오늘의 기록"), block(type: "paragraph", text: reflection),
            block(type: "heading2", text: "다음 행동"), block(type: "todo", text: nextAction),
        ])
    }

    private func append(_ item: JSONValue, to collection: String) {
        guard case .object(var root) = state else { return }
        var items = root[collection]?.arrayValue ?? []
        items.append(item)
        root[collection] = .array(items)
        commit(.object(root))
    }

    private func updateItem(in collection: String, id: String, mutation: (inout [String: JSONValue]) -> Void) {
        guard case .object(var root) = state else { return }
        var items = root[collection]?.arrayValue ?? []
        guard let index = items.firstIndex(where: { $0.objectValue?["id"]?.stringValue == id }),
              case .object(var item) = items[index] else { return }
        mutation(&item)
        items[index] = .object(item)
        root[collection] = .array(items)
        commit(.object(root))
    }

    private func removeLinks(in root: inout [String: JSONValue], referencing id: String) {
        let links = root["links"]?.arrayValue ?? []
        root["links"] = .array(links.filter { raw in
            guard let item = raw.objectValue else { return true }
            return item["sourceId"]?.stringValue != id
                && item["targetId"]?.stringValue != id
                && item["fromId"]?.stringValue != id
                && item["toId"]?.stringValue != id
        })
    }

    private func clearCaptureConversions(
        in root: inout [String: JSONValue],
        referencing id: String,
        entityTypes: Set<String>
    ) {
        let captures = root["captures"]?.arrayValue ?? []
        root["captures"] = .array(captures.map { raw in
            guard case .object(var capture) = raw,
                  capture["convertedId"]?.stringValue == id,
                  let convertedType = capture["convertedTo"]?.stringValue,
                  entityTypes.contains(convertedType.trimmingCharacters(in: .whitespacesAndNewlines)) else { return raw }
            capture["convertedTo"] = .string("")
            capture["convertedId"] = .string("")
            return .object(capture)
        })
    }

    private static func hasPrimaryItem(in root: [String: JSONValue]) -> Bool {
        ["captures", "boxes", "goals", "projects", "tasks", "resources", "habits", "journals"]
            .contains { root[$0]?.arrayValue?.isEmpty == false }
    }

    private func commit(_ newState: JSONValue) {
        generation += 1
        state = Self.migratingRemovedTaskStatuses(
            in: Self.stamped(newState, revision: revision)
        ).state
        snapshot = AppSnapshot(state: state)
        hasPendingChanges = true
        let persistedLocally = persistLocal()
        if let conflict = pendingConflict {
            remoteReady = false
            syncState = .conflict(conflict.message)
            return
        }
        guard remoteReady else {
            if persistedLocally { syncState = .localOnly }
            return
        }
        scheduleRemoteSave()
    }

    private func scheduleRemoteSave() {
        guard remoteReady, hasPendingChanges, pendingConflict == nil else { return }
        saveDebounceTask?.cancel()
        saveDebounceTask = Task { [weak self] in
            do {
                try await Task.sleep(nanoseconds: 450_000_000)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            self?.startRemoteFlushIfNeeded()
        }
    }

    private func startRemoteFlushIfNeeded() {
        saveDebounceTask = nil
        guard remoteReady, hasPendingChanges, pendingConflict == nil, !remoteSaveInFlight else { return }
        remoteSaveInFlight = true
        remoteFlushTask = Task { [weak self] in
            await self?.flushRemoteSave()
        }
    }

    private func flushRemoteSave() async {
        guard remoteReady, hasPendingChanges, pendingConflict == nil else {
            finishRemoteFlush()
            return
        }
        syncState = .saving
        let outgoingState = state
        let outgoingRevision = revision
        let outgoingGeneration = generation
        do {
            let envelope = try await apiClient.saveState(outgoingState, baseRevision: outgoingRevision)
            revision = envelope.revision
            if generation == outgoingGeneration {
                let migration = Self.migratingRemovedTaskStatuses(in: envelope.state)
                state = migration.state
                snapshot = AppSnapshot(state: state)
                hasPendingChanges = migration.didChange
            } else {
                state = Self.stamped(state, revision: envelope.revision)
                hasPendingChanges = true
            }
            let persistedLocally = persistLocal()
            if persistedLocally { syncState = hasPendingChanges ? .localOnly : .synced }
        } catch {
            hasPendingChanges = true
            persistLocal()
            if Self.isConflictError(error) {
                registerRevisionOnlyConflict(error)
                do {
                    let latest = try await apiClient.fetchState()
                    registerConflict(latest, message: error.localizedDescription)
                } catch {
                    handleSyncError(error)
                }
            } else {
                handleSyncError(error)
            }
        }
        finishRemoteFlush()
    }

    private func finishRemoteFlush() {
        remoteSaveInFlight = false
        remoteFlushTask = nil
        if hasPendingChanges && remoteReady && pendingConflict == nil { scheduleRemoteSave() }
        if queuedMinimumRevision > revision {
            let minimumRevision = queuedMinimumRevision
            Task { [weak self] in
                await self?.refreshFromRemote(silent: true, minimumRevision: minimumRevision)
            }
        }
    }

    @discardableResult
    private func applyRemote(_ envelope: StateEnvelope) -> Bool {
        revision = envelope.revision
        generation = 0
        if case .null = envelope.state {
            state = Self.stamped(SeedState.make(), revision: envelope.revision)
            hasPendingChanges = true
        } else {
            let migration = Self.migratingRemovedTaskStatuses(in: envelope.state)
            state = migration.state
            hasPendingChanges = migration.didChange
        }
        snapshot = AppSnapshot(state: state)
        return persistLocal()
    }

    private func registerConflict(_ envelope: StateEnvelope, message: String) {
        pendingConflict = PendingConflict(
            remoteState: envelope.state,
            remoteRevision: envelope.revision,
            remoteUpdatedAt: envelope.updatedAt,
            message: message
        )
        conflictRemoteRevision = envelope.revision
        hasPendingChanges = true
        remoteReady = false
        syncState = .conflict(message)
        persistLocal()
    }

    private func registerRevisionOnlyConflict(_ error: Error) {
        let remoteRevision: Int
        if case let APIClientError.server(_, _, _, _, revision, _) = error {
            remoteRevision = revision ?? conflictRemoteRevision ?? self.revision
        } else {
            remoteRevision = conflictRemoteRevision ?? revision
        }
        let message = error.localizedDescription
        pendingConflict = PendingConflict(
            remoteState: nil,
            remoteRevision: remoteRevision,
            remoteUpdatedAt: "",
            message: message
        )
        conflictRemoteRevision = remoteRevision
        hasPendingChanges = true
        remoteReady = false
        syncState = .conflict(message)
        persistLocal()
    }

    private func retainConflict(message: String) {
        guard let conflict = pendingConflict else {
            syncState = .offline(message)
            return
        }
        pendingConflict = PendingConflict(
            remoteState: conflict.remoteState,
            remoteRevision: conflict.remoteRevision,
            remoteUpdatedAt: conflict.remoteUpdatedAt,
            message: message
        )
        conflictRemoteRevision = conflict.remoteRevision
        hasPendingChanges = true
        remoteReady = false
        syncState = .conflict(message)
        persistLocal()
    }

    private func clearConflict() {
        pendingConflict = nil
        conflictRemoteRevision = nil
    }

    private func handleSyncError(_ error: Error) {
        remoteReady = false
        if Self.isAuthenticationError(error) {
            syncState = .authenticationRequired(error.localizedDescription)
        } else if pendingConflict != nil {
            retainConflict(message: pendingConflict?.message ?? error.localizedDescription)
        } else {
            syncState = .offline(error.localizedDescription)
        }
    }

    private func handleResolutionError(_ error: Error) {
        if Self.isAuthenticationError(error) {
            remoteReady = false
            syncState = .authenticationRequired(error.localizedDescription)
        } else {
            retainConflict(message: "충돌 해결을 완료하지 못했습니다. \(error.localizedDescription)")
        }
    }

    private static func isConflictError(_ error: Error) -> Bool {
        guard let apiError = error as? APIClientError, let status = apiError.statusCode else { return false }
        return [409, 412, 428].contains(status)
    }

    private static func isAuthenticationError(_ error: Error) -> Bool {
        guard let apiError = error as? APIClientError else { return false }
        return apiError.statusCode == 401 || ["AUTH_REQUIRED", "AUTH_INVALID", "INVALID_TOKEN"].contains(apiError.code ?? "")
    }

    private static func isCancellationError(_ error: Error) -> Bool {
        error is CancellationError || (error as? URLError)?.code == .cancelled
    }

    private func writeConflictBackup(side: String, state: JSONValue, revision: Int) throws {
        guard let persistenceURL else {
            throw CocoaError(.fileNoSuchFile, userInfo: [NSLocalizedDescriptionKey: "충돌 백업 저장 위치가 없습니다."])
        }
        let directory = persistenceURL.deletingLastPathComponent().appendingPathComponent("Conflict Backups", isDirectory: true)
        try Self.prepareProtectedDirectory(directory)
        let backupURL = directory.appendingPathComponent(
            "conflict-\(Int(Date().timeIntervalSince1970))-\(side)-\(UUID().uuidString.lowercased()).json"
        )
        let backup = ConflictBackup(side: side, state: state, revision: revision, createdAt: Self.timestamp())
        try JSONEncoder().encode(backup).write(to: backupURL, options: .atomic)
        try Self.protectAndExcludeFromBackup(backupURL)
        latestConflictBackupURL = backupURL
    }

    private static func prepareProtectedDirectory(_ url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.path
        )
        try excludeFromBackup(url)
    }

    private static func protectAndExcludeFromBackup(_ url: URL) throws {
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.path
        )
        try excludeFromBackup(url)
    }

    private static func excludeFromBackup(_ url: URL) throws {
        var target = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try target.setResourceValues(values)
    }

    @discardableResult
    private func persistLocal() -> Bool {
        guard let persistenceURL else { return true }
        do {
            let directory = persistenceURL.deletingLastPathComponent()
            try Self.prepareProtectedDirectory(directory)
            let local = LocalStoreSnapshot(
                formatVersion: LocalStoreSnapshot.currentFormatVersion,
                state: state,
                revision: revision,
                needsRemoteSave: hasPendingChanges,
                pendingConflict: pendingConflict
            )
            try JSONEncoder().encode(local).write(to: persistenceURL, options: .atomic)
            try Self.protectAndExcludeFromBackup(persistenceURL)
            return true
        } catch {
            if pendingConflict == nil { syncState = .offline("로컬 상태를 저장하지 못했습니다.") }
            return false
        }
    }

    private static func loadLocal(from url: URL?) -> LoadedLocalState? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        if let local = try? JSONDecoder().decode(LocalStoreSnapshot.self, from: data),
           (1...LocalStoreSnapshot.currentFormatVersion).contains(local.formatVersion) {
            return LoadedLocalState(
                state: local.state,
                revision: max(0, local.revision),
                needsRemoteSave: local.needsRemoteSave,
                pendingConflict: local.pendingConflict
            )
        }
        guard let legacyState = try? JSONDecoder().decode(JSONValue.self, from: data) else { return nil }
        return LoadedLocalState(
            state: legacyState,
            revision: revision(in: legacyState),
            needsRemoteSave: false,
            pendingConflict: nil
        )
    }

    nonisolated private static var defaultPersistenceURL: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("SYGMA", isDirectory: true)
            .appendingPathComponent("state.json")
    }

    private static func revision(in state: JSONValue) -> Int {
        state.objectValue?["revision"]?.intValue ?? 0
    }

    private static func stamped(_ state: JSONValue, revision: Int) -> JSONValue {
        guard case .object(var root) = state else { return state }
        root["version"] = .number(4)
        root["revision"] = .number(Double(revision))
        root["updatedAt"] = .string(timestamp())
        return .object(root)
    }

    private static func emptyBlock() -> JSONValue {
        block(type: "paragraph", text: "")
    }

    private static func block(type: String, text: String) -> JSONValue {
        .object([
            "id": .string(UUID().uuidString.lowercased()), "type": .string(type),
            "text": .string(text), "marks": .array([]), "checked": .bool(false),
            "indent": .number(0), "collapsed": .bool(false),
        ])
    }

    private static func timestamp() -> String { ISO8601DateFormatter().string(from: Date()) }
}
