import AppKit
import SwiftUI

private let mainWindowIdentifier = NSUserInterfaceItemIdentifier("SYGMAMainWindow")
private let windowDragAreaIdentifier = NSUserInterfaceItemIdentifier("SYGMAWindowDragArea")
private let windowDragAreaHeight: CGFloat = 24

@main
struct SYGMAMacApp: App {
    @NSApplicationDelegateAdaptor(SYGMAMacDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup("SYGMA") {
            SYGMAWebView()
                .frame(minWidth: 980, minHeight: 680)
                .background(WindowChromeAccessor())
                .preferredColorScheme(.light)
        }
        .defaultSize(width: 1440, height: 920)
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandMenu("Notes") {
                Button("Quick Notes 열기/숨기기") { appDelegate.toggleQuickNotes() }
            }
        }
    }
}

@MainActor
private final class SYGMAMacDelegate: NSObject, NSApplicationDelegate {
    private var keyWindowObserver: NSObjectProtocol?
    private let quickNotes = QuickNotesController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        quickNotes.start()
        keyWindowObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.didBecomeKeyNotification,
            object: nil,
            queue: .main
        ) { notification in
            guard let window = notification.object as? NSWindow else { return }
            Task { @MainActor in
                if isMainWindow(window) { configureMainWindow(window) }
            }
        }
        DispatchQueue.main.async {
            NSApp.windows.filter(isMainWindow).forEach(configureMainWindow)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        quickNotes.flush()
    }

    func toggleQuickNotes() {
        quickNotes.toggle()
    }

    deinit {
        if let keyWindowObserver { NotificationCenter.default.removeObserver(keyWindowObserver) }
    }
}

private struct WindowChromeAccessor: NSViewRepresentable {
    func makeNSView(context: Context) -> WindowChromeAccessView { WindowChromeAccessView() }
    func updateNSView(_ view: WindowChromeAccessView, context: Context) { view.configureWindow() }
}

private final class WindowChromeAccessView: NSView {
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        configureWindow()
        DispatchQueue.main.async { [weak self] in self?.configureWindow() }
    }

    func configureWindow() {
        guard let window else { return }
        configureMainWindow(window)
    }
}

@MainActor
private func configureMainWindow(_ window: NSWindow) {
    window.identifier = mainWindowIdentifier
    window.title = "SYGMA"
    window.styleMask.formUnion([.closable, .miniaturizable, .resizable, .fullSizeContentView])
    window.appearance = NSAppearance(named: .aqua)
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    window.titlebarSeparatorStyle = .none
    window.toolbar = nil
    window.isOpaque = true
    window.backgroundColor = .windowBackgroundColor
    [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].forEach {
        guard let button = window.standardWindowButton($0) else { return }
        button.isEnabled = false
        button.isHidden = true
        button.setAccessibilityHidden(true)
    }
    installDragArea(in: window)
}

@MainActor
private func isMainWindow(_ window: NSWindow) -> Bool {
    window.identifier == mainWindowIdentifier || window.title == "SYGMA"
}

@MainActor
private func installDragArea(in window: NSWindow) {
    guard let frameView = window.contentView?.superview else { return }
    if let dragArea = frameView.subviews.first(where: { $0.identifier == windowDragAreaIdentifier }) {
        frameView.addSubview(dragArea, positioned: .above, relativeTo: nil)
        return
    }
    let height = windowDragAreaHeight
    let y = frameView.isFlipped ? 0 : max(0, frameView.bounds.height - height)
    let dragArea = WindowDragAreaView(frame: NSRect(x: 0, y: y, width: frameView.bounds.width, height: height))
    dragArea.identifier = windowDragAreaIdentifier
    dragArea.autoresizingMask = [.width, .minYMargin]
    frameView.addSubview(dragArea, positioned: .above, relativeTo: nil)
}

private final class WindowDragAreaView: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func viewDidMoveToWindow() {
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
        setAccessibilityHidden(true)
    }

    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}
