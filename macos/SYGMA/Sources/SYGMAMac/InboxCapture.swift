import AppKit
import Carbon.HIToolbox
import SwiftUI
import WidgetKit

private let inboxCapturePanelIdentifier = NSUserInterfaceItemIdentifier("SYGMAInboxCapturePanel")

enum InboxCaptureMode {
    case inbox
    case task
}

enum InboxCaptureSavedKind: Equatable {
    case inbox
    case task
}

enum InboxTaskTiming: String, CaseIterable, Identifiable {
    case today
    case tomorrow
    case scheduled

    var id: Self { self }
    var title: String {
        switch self {
        case .today: "오늘"
        case .tomorrow: "내일"
        case .scheduled: "예정"
        }
    }
}

struct InboxWorkspaceChoice: Identifiable, Equatable {
    let id: String
    let name: String
}

struct InboxWorkspaceProject: Identifiable, Equatable {
    let id: String
    let name: String
    let boxID: String
}

struct InboxWorkspaceOptions {
    let boxes: [InboxWorkspaceChoice]
    let projects: [InboxWorkspaceProject]

    init(state: [String: Any]) {
        boxes = (state["boxes"] as? [[String: Any]] ?? []).compactMap { item in
            guard let id = item["id"] as? String, !id.isEmpty,
                  let name = item["name"] as? String, !name.isEmpty else { return nil }
            return InboxWorkspaceChoice(id: id, name: name)
        }
        projects = (state["projects"] as? [[String: Any]] ?? []).compactMap { item in
            guard let id = item["id"] as? String, !id.isEmpty,
                  let name = item["name"] as? String, !name.isEmpty else { return nil }
            return InboxWorkspaceProject(id: id, name: name, boxID: item["boxId"] as? String ?? "")
        }
    }
}

enum InboxCaptureError: LocalizedError {
    case malformedState
    case conflict
    case server(String, retryable: Bool)

    var errorDescription: String? {
        switch self {
        case .malformedState: "Workspace 데이터를 읽을 수 없습니다."
        case .conflict: "다른 기기에서 변경 중입니다. 잠시 후 다시 시도해 주세요."
        case .server(let message, _): message
        }
    }
}

struct InboxStateMutation {
    let collectionKey: String
    let id: String
    let item: [String: Any]
    let updatedAt: String

    static func capture(title: String, id: UUID = UUID(), date: Date = Date()) -> InboxStateMutation {
        let timestamp = isoTimestamp(date)
        let url = title.range(of: #"https?://\S+"#, options: .regularExpression).map { String(title[$0]) } ?? ""
        return InboxStateMutation(
            collectionKey: "captures",
            id: id.uuidString.lowercased(),
            item: [
                "id": id.uuidString.lowercased(),
                "title": title,
                "url": url,
                "createdAt": timestamp,
            ],
            updatedAt: timestamp
        )
    }

    static func task(
        title: String,
        boxID: String,
        projectID: String,
        dueDate: String,
        id: UUID = UUID(),
        blockID: UUID = UUID(),
        date: Date = Date()
    ) -> InboxStateMutation {
        let taskID = id.uuidString.lowercased()
        return InboxStateMutation(
            collectionKey: "tasks",
            id: taskID,
            item: [
                "id": taskID,
                "title": title,
                "status": "scheduled",
                "boxId": boxID,
                "projectId": projectID,
                "resourceId": "",
                "dueDate": dueDate,
                "completedAt": "",
                "googleEventId": "",
                "blocks": [[
                    "id": blockID.uuidString.lowercased(),
                    "type": "paragraph",
                    "text": "",
                    "checked": false,
                    "indent": 0,
                    "collapsed": false,
                ]],
            ],
            updatedAt: isoTimestamp(date)
        )
    }

    @discardableResult
    func apply(to state: inout [String: Any]) throws -> Bool {
        guard var items = state[collectionKey] as? [[String: Any]] else { throw InboxCaptureError.malformedState }
        if items.contains(where: { $0["id"] as? String == id }) { return false }
        var nextItem = item
        if collectionKey == "tasks",
           let projectID = nextItem["projectId"] as? String,
           !projectID.isEmpty,
           let project = (state["projects"] as? [[String: Any]])?.first(where: { $0["id"] as? String == projectID }) {
            nextItem["boxId"] = project["boxId"] as? String ?? ""
        }
        items.append(nextItem)
        state[collectionKey] = items
        state["updatedAt"] = updatedAt
        return true
    }
}

private func isoTimestamp(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}

@MainActor
final class InboxStateClient {
    private let stateURL = SYGMAWebRuntime.homeURL.appendingPathComponent("api/state")
    private let captureURL = SYGMAWebRuntime.homeURL.appendingPathComponent("api/inbox-capture")

    func workspaceOptions() async throws -> InboxWorkspaceOptions {
        InboxWorkspaceOptions(state: try await readState())
    }

    func save(_ mutation: InboxStateMutation) async throws {
        var lastError: Error = InboxCaptureError.conflict
        for attempt in 0..<3 {
            do {
                try await append(mutation)
                return
            } catch let error as URLError {
                lastError = error
                if await contains(mutation) { return }
                guard attempt < 2 else { break }
                continue
            } catch InboxCaptureError.server(let message, let retryable) where retryable {
                lastError = InboxCaptureError.server(message, retryable: true)
                if await contains(mutation) { return }
                guard attempt < 2 else { break }
                continue
            }
        }
        if await contains(mutation) { return }
        throw lastError
    }

    private func contains(_ mutation: InboxStateMutation) async -> Bool {
        guard let state = try? await readState() else { return false }
        return (state[mutation.collectionKey] as? [[String: Any]])?.contains {
            $0["id"] as? String == mutation.id
        } == true
    }

    private func readState() async throws -> [String: Any] {
        var request = URLRequest(url: stateURL)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw InboxCaptureError.malformedState }
        guard (200..<300).contains(response.statusCode) else { throw serverError(data: data, status: response.statusCode) }
        guard let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let state = payload["state"] as? [String: Any] else {
            throw InboxCaptureError.malformedState
        }
        return state
    }

    private func append(_ mutation: InboxStateMutation) async throws {
        var request = URLRequest(url: captureURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "kind": mutation.collectionKey == "tasks" ? "task" : "capture",
            "item": mutation.item,
        ])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw InboxCaptureError.malformedState }
        guard (200..<300).contains(response.statusCode) else { throw serverError(data: data, status: response.statusCode) }
    }

    private func serverError(data: Data, status: Int) -> InboxCaptureError {
        let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let message = payload?["error"] as? String ?? "SYGMA에 저장하지 못했습니다."
        return .server(message, retryable: status == 408 || status == 425 || status == 429 || status >= 500)
    }
}

@MainActor
final class InboxCaptureModel: ObservableObject {
    @Published var title = ""
    @Published var mode = InboxCaptureMode.inbox
    @Published var boxes: [InboxWorkspaceChoice] = []
    @Published var projects: [InboxWorkspaceProject] = []
    @Published var selectedBoxID = ""
    @Published var selectedProjectID = ""
    @Published var timing = InboxTaskTiming.today
    @Published var isLoadingOptions = false
    @Published var isSaving = false
    @Published var errorMessage = ""
    @Published private(set) var focusRequest = 0
    var pendingMutation: InboxStateMutation?
    var pendingKind: InboxCaptureSavedKind?

    var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
    var availableProjects: [InboxWorkspaceProject] {
        selectedBoxID.isEmpty ? projects : projects.filter { $0.boxID == selectedBoxID }
    }

    func reset() {
        title = ""
        mode = .inbox
        boxes = []
        projects = []
        selectedBoxID = ""
        selectedProjectID = ""
        timing = .today
        isLoadingOptions = false
        isSaving = false
        errorMessage = ""
        pendingMutation = nil
        pendingKind = nil
    }

    func requestFocus() { focusRequest &+= 1 }

    func setBox(_ id: String) {
        selectedBoxID = id
        if let project = projects.first(where: { $0.id == selectedProjectID }), project.boxID != id {
            selectedProjectID = ""
        }
    }

    func setProject(_ id: String) {
        selectedProjectID = id
        if let project = projects.first(where: { $0.id == id }), !project.boxID.isEmpty {
            selectedBoxID = project.boxID
        }
    }

    func setOptions(_ options: InboxWorkspaceOptions) {
        boxes = options.boxes
        projects = options.projects
    }

    func dueDateKey(now: Date = Date(), calendar: Calendar = .current) -> String {
        guard timing != .scheduled else { return "" }
        let formatter = DateFormatter()
        var gregorian = Calendar(identifier: .gregorian)
        gregorian.timeZone = calendar.timeZone
        formatter.calendar = gregorian
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        let date = timing == .tomorrow
            ? calendar.date(byAdding: .day, value: 1, to: now) ?? now
            : now
        return formatter.string(from: date)
    }
}

private struct InboxCaptureView: View {
    private let accent = Color(red: 0.16, green: 0.42, blue: 0.93)
    @ObservedObject var model: InboxCaptureModel
    let onSubmitInbox: () -> Void
    let onShowTask: () -> Void
    let onSubmitTask: () -> Void
    let onBack: () -> Void
    let onClose: () -> Void
    @FocusState private var titleFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 16) {
                Image(systemName: model.mode == .inbox ? "tray.and.arrow.down.fill" : "checklist")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.tint)
                    .frame(width: 30)
                    .accessibilityHidden(true)
                TextField("Inbox에 추가할 내용을 입력하세요", text: $model.title)
                    .textFieldStyle(.plain)
                    .font(.system(size: 23, weight: .medium))
                    .foregroundStyle(.primary)
                    .focused($titleFocused)
                    .disabled(model.isSaving)
                    .accessibilityLabel("Inbox에 추가할 내용")
                    .accessibilityHint("Return으로 Inbox에 추가하고 Command Return으로 Task 설정을 엽니다")
                if model.isSaving || model.isLoadingOptions {
                    ProgressView().controlSize(.small)
                }
                Text(model.mode == .inbox ? "INBOX" : "TASK")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(accent)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(accent.opacity(0.1), in: Capsule())
            }
            .padding(.horizontal, 22)
            .frame(height: 72)

            if model.mode == .task {
                divider
                taskOptions
                    .transition(.move(edge: .top).combined(with: .opacity))
            }

            divider
            footer
                .padding(.horizontal, 22)
                .frame(height: 52)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0.975, green: 0.984, blue: 1), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .tint(accent)
        .preferredColorScheme(.light)
        .ignoresSafeArea()
        .onAppear { titleFocused = true }
        .onChange(of: model.focusRequest) { _, _ in titleFocused = true }
        .animation(.spring(response: 0.28, dampingFraction: 0.88), value: model.mode)
    }

    private var divider: some View {
        Color.black.opacity(0.06).frame(height: 1)
    }

    private var taskOptions: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Task 배치")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.primary.opacity(0.72))
            optionRow("날짜", systemImage: "calendar") {
                ForEach(InboxTaskTiming.allCases) { timing in
                    choiceButton(timing.title, context: "날짜", selected: model.timing == timing) {
                        model.timing = timing
                    }
                }
            }
            optionRow("Box", systemImage: "shippingbox") {
                choiceButton("미지정", context: "Box", selected: model.selectedBoxID.isEmpty) { model.setBox("") }
                ForEach(model.boxes) { box in
                    choiceButton(box.name, context: "Box", selected: model.selectedBoxID == box.id) { model.setBox(box.id) }
                }
            }
            optionRow("Project", systemImage: "folder") {
                choiceButton("없음", context: "Project", selected: model.selectedProjectID.isEmpty) { model.setProject("") }
                ForEach(model.availableProjects) { project in
                    choiceButton(project.name, context: "Project", selected: model.selectedProjectID == project.id) { model.setProject(project.id) }
                }
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 18)
    }

    private func optionRow<Content: View>(
        _ title: String,
        systemImage: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Label(title, systemImage: systemImage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: 72, alignment: .leading)
                .padding(.top, 7)
            ScrollView(.horizontal) {
                HStack(spacing: 8) { content() }
            }
            .frame(maxWidth: .infinity, minHeight: 30, alignment: .leading)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(accent.opacity(0.065), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func choiceButton(_ title: String, context: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if selected { Image(systemName: "checkmark") }
                Text(title).lineLimit(1)
            }
            .font(.system(size: 12, weight: selected ? .semibold : .medium))
            .foregroundStyle(selected ? .white : .primary.opacity(0.76))
            .padding(.horizontal, 11)
            .frame(height: 30)
            .background(selected ? accent : Color.white.opacity(0.8), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(context) \(title)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var footer: some View {
        HStack(spacing: 12) {
            if !model.errorMessage.isEmpty {
                Label(model.errorMessage, systemImage: "exclamationmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(2)
                    .accessibilityLabel("오류: \(model.errorMessage)")
            } else {
                Text(model.mode == .inbox ? "↩ Inbox에 추가  ·  ⌘↩ Task 설정" : "↩ Task 생성  ·  Esc 닫기")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            Spacer(minLength: 8)
            if model.mode == .inbox {
                actionButton("Task 설정", action: onShowTask)
                actionButton("Inbox 추가", primary: true, action: onSubmitInbox)
            } else {
                actionButton("뒤로", action: onBack)
                actionButton("Task 생성", primary: true, action: onSubmitTask)
            }
        }
        .disabled(model.isSaving)
    }

    private func actionButton(_ title: String, primary: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(primary ? .white : accent)
                .padding(.horizontal, 12)
                .frame(height: 28)
                .background(primary ? accent : accent.opacity(0.09), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

@MainActor
final class InboxCaptureController: NSObject, NSWindowDelegate {
    private let model = InboxCaptureModel()
    private let client = InboxStateClient()
    private var panel: NSPanel?
    private var localKeyMonitor: Any?
    private var visibleFrame: NSRect?
    private var suppressShortcutUntil = Date.distantPast
    private var suppressedShortcut: QuickNoteShortcut?
    private let panelWidth: CGFloat = 760
    private let inboxHeight: CGFloat = 166
    private let taskHeight: CGFloat = 390

    func start() {
        guard localKeyMonitor == nil else { return }
        localKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            if Date() < self.suppressShortcutUntil, self.suppressedShortcut?.matches(event) == true { return nil }
            guard self.panel?.isKeyWindow == true else { return event }
            if self.handle(event) { return nil }
            return event
        }
    }

    deinit {
        if let localKeyMonitor { NSEvent.removeMonitor(localKeyMonitor) }
    }

    func toggle(triggeredBy shortcut: QuickNoteShortcut? = nil) {
        if panel?.isVisible == true {
            hide()
            return
        }
        suppressedShortcut = shortcut
        suppressShortcutUntil = shortcut == nil ? .distantPast : Date().addingTimeInterval(0.25)
        show()
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        hide()
        return false
    }

    private func panelWindow() -> NSPanel {
        if let panel { return panel }
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: panelWidth, height: inboxHeight),
            styleMask: [.titled, .fullSizeContentView, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.identifier = inboxCapturePanelIdentifier
        panel.title = "Inbox 바로 추가"
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.titlebarSeparatorStyle = .none
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.appearance = NSAppearance(named: .aqua)
        panel.hasShadow = true
        panel.collectionBehavior = [.canJoinAllSpaces, .canJoinAllApplications, .fullScreenAuxiliary]
        panel.standardWindowButton(.closeButton)?.isHidden = true
        panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
        panel.standardWindowButton(.zoomButton)?.isHidden = true
        panel.delegate = self
        panel.contentView = NSHostingView(rootView: InboxCaptureView(
            model: model,
            onSubmitInbox: { [weak self] in self?.submitInbox() },
            onShowTask: { [weak self] in self?.showTaskOptions() },
            onSubmitTask: { [weak self] in self?.submitTask() },
            onBack: { [weak self] in self?.showInboxMode() },
            onClose: { [weak self] in self?.hide() }
        ))
        self.panel = panel
        return panel
    }

    private func show() {
        model.reset()
        let panel = panelWindow()
        visibleFrame = mouseScreen()?.visibleFrame
        setPanelHeight(inboxHeight, animated: false)
        panel.orderFrontRegardless()
        panel.makeKeyAndOrderFront(nil)
        DispatchQueue.main.async { [weak self] in self?.model.requestFocus() }
    }

    private func hide() {
        panel?.orderOut(nil)
        model.reset()
    }

    private func showTaskOptions() {
        guard !model.isSaving else { return }
        if model.mode != .task {
            model.pendingMutation = nil
            model.pendingKind = nil
            model.mode = .task
            model.errorMessage = ""
            setPanelHeight(taskHeight, animated: true)
        }
        guard !model.isLoadingOptions else { return }
        model.isLoadingOptions = true
        Task { [weak self] in
            guard let self else { return }
            do {
                let options = try await client.workspaceOptions()
                guard panel?.isVisible == true, model.mode == .task else { return }
                model.setOptions(options)
                model.errorMessage = ""
            } catch {
                guard panel?.isVisible == true, model.mode == .task else { return }
                model.errorMessage = error.localizedDescription
            }
            model.isLoadingOptions = false
        }
    }

    private func showInboxMode() {
        guard !model.isSaving else { return }
        model.pendingMutation = nil
        model.pendingKind = nil
        model.mode = .inbox
        model.errorMessage = ""
        setPanelHeight(inboxHeight, animated: true)
        model.requestFocus()
    }

    private func submitInbox() {
        let title = model.trimmedTitle
        guard !title.isEmpty else {
            model.errorMessage = "추가할 내용을 입력해 주세요."
            model.requestFocus()
            return
        }
        let pending = model.pendingKind == .inbox
            && model.pendingMutation?.item["title"] as? String == title
            ? model.pendingMutation
            : nil
        save(pending ?? .capture(title: title), kind: .inbox)
    }

    private func submitTask() {
        let title = model.trimmedTitle
        guard !title.isEmpty else {
            model.errorMessage = "Task 내용을 입력해 주세요."
            model.requestFocus()
            return
        }
        let dueDate = model.dueDateKey()
        let pendingItem = model.pendingMutation?.item
        let mutation = model.pendingKind == .task
            && pendingItem?["title"] as? String == title
            && pendingItem?["boxId"] as? String == model.selectedBoxID
            && pendingItem?["projectId"] as? String == model.selectedProjectID
            && pendingItem?["dueDate"] as? String == dueDate
                ? model.pendingMutation
                : nil
        save(mutation ?? .task(
            title: title,
            boxID: model.selectedBoxID,
            projectID: model.selectedProjectID,
            dueDate: dueDate
        ), kind: .task)
    }

    private func save(_ mutation: InboxStateMutation, kind: InboxCaptureSavedKind) {
        guard !model.isSaving else { return }
        model.pendingMutation = mutation
        model.pendingKind = kind
        model.isSaving = true
        model.errorMessage = ""
        Task { [weak self] in
            guard let self else { return }
            do {
                guard await SYGMAWorkspaceBridge.flushPendingChanges() else {
                    throw InboxCaptureError.server("열려 있는 SYGMA 변경 사항을 먼저 저장해 주세요.", retryable: false)
                }
                try await client.save(mutation)
                SYGMAWorkspaceBridge.reloadAfterMutation()
                if kind == .task { WidgetCenter.shared.reloadAllTimelines() }
                hide()
            } catch {
                model.isSaving = false
                model.errorMessage = error.localizedDescription
                model.requestFocus()
            }
        }
    }

    private func handle(_ event: NSEvent) -> Bool {
        let modifiers = event.modifierFlags.intersection([.control, .option, .shift, .command])
        if event.keyCode == UInt16(kVK_Escape), modifiers.isEmpty {
            if event.isARepeat { return true }
            hide()
            return true
        }
        guard [UInt16(kVK_Return), UInt16(kVK_ANSI_KeypadEnter)].contains(event.keyCode) else { return false }
        if (panel?.firstResponder as? NSTextView)?.hasMarkedText() == true { return false }
        if event.isARepeat { return true }
        if modifiers == .command, model.mode == .inbox {
            showTaskOptions()
        } else if modifiers.isEmpty || modifiers == .command {
            model.mode == .inbox ? submitInbox() : submitTask()
        } else {
            return false
        }
        return true
    }

    private func setPanelHeight(_ height: CGFloat, animated: Bool) {
        guard let panel else { return }
        let frame = visibleFrame ?? mouseScreen()?.visibleFrame ?? panel.screen?.visibleFrame ?? panel.frame
        let width = min(panelWidth, max(320, frame.width - 32))
        let targetHeight = min(height, max(140, frame.height - 32))
        let target = NSRect(
            x: frame.midX - width / 2,
            y: frame.midY - targetHeight / 2,
            width: width,
            height: targetHeight
        )
        guard animated, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else {
            panel.setFrame(target, display: true)
            panel.invalidateShadow()
            return
        }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.22
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            panel.animator().setFrame(target, display: true)
        } completionHandler: {
            panel.invalidateShadow()
        }
    }

    private func mouseScreen() -> NSScreen? {
        let point = NSEvent.mouseLocation
        return NSScreen.screens.first { NSMouseInRect(point, $0.frame, false) } ?? NSScreen.main
    }
}
