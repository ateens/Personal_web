import Foundation
import SwiftUI
import WebKit
import WidgetKit

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

enum SYGMAWebRuntime {
    static let homeURL = URL(string: "https://personalweb-production-81a6.up.railway.app/")!
    static let quickEditorURL: URL = {
        var components = URLComponents(url: homeURL, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "surface", value: "quick-editor")]
        return components.url!
    }()
    static let mutationBridge = #"""
    (() => {
      if (window.__sygmaNativeMutationBridge) return;
      window.__sygmaNativeMutationBridge = true;
      const originalFetch = window.fetch;
      window.fetch = async function(input, options) {
        const response = await originalFetch.apply(this, arguments);
        try {
          const request = input instanceof Request ? input : null;
          const method = String(options?.method || request?.method || "GET").toUpperCase();
          const url = new URL(request?.url || String(input), window.location.href);
          if (response.ok && url.origin === window.location.origin && !["GET", "HEAD", "OPTIONS"].includes(method)) {
            window.webkit?.messageHandlers?.sygmaStateChanged?.postMessage(null);
          }
        } catch {}
        return response;
      };
    })();
    """#

    static func isInternal(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme?.lowercased() == homeURL.scheme
            && url.host?.lowercased() == homeURL.host
            && url.port == homeURL.port
    }

    static func isGoogleAuthStart(_ url: URL?) -> Bool {
        isInternal(url) && url?.path == "/api/google/auth/start"
    }

    @MainActor
    static func flushPendingChanges(in webView: WKWebView) async -> Bool {
        let script = #"""
        if (typeof persistLocalResourceDraft !== "function" || typeof flushRemoteStateSave !== "function") return true;
        if (typeof flushResourceWindowInputs === "function" && typeof ui === "object") {
          for (const record of [...(ui.resourceWindows || [])]) flushResourceWindowInputs(record.id);
        }
        if (typeof flushPendingEditorTextHistory === "function") flushPendingEditorTextHistory();
        const locallyPersisted = await persistLocalResourceDraft();
        if (locallyPersisted !== true) return false;
        const waitForSave = async () => {
          const deadline = Date.now() + 12000;
          while (remoteStateSaveInFlight && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 40));
          }
          return !remoteStateSaveInFlight;
        };
        if (!(await waitForSave())) return false;
        if (typeof hasAutomaticallySaveableLocalOperations === "function" && hasAutomaticallySaveableLocalOperations()) {
          remoteStateSavePending = true;
        }
        if (remoteStateSavePending) {
          const saved = await flushRemoteStateSave({ singleAttempt: true, preserveConflict: true });
          if (!saved) return false;
        }
        if (!(await waitForSave())) return false;
        return !remoteStateSavePending && !remoteStateSaveBlocked;
        """#
        do {
            let result = try await webView.callAsyncJavaScript(
                script,
                arguments: [:],
                in: nil,
                contentWorld: .page
            )
            return (result as? Bool) == true
        } catch {
            return false
        }
    }

    @MainActor
    static func closeActiveResourceWindow(in webView: WKWebView) async throws -> Bool {
        let handled = try await webView.callAsyncJavaScript(
            "return typeof window.closeActiveResourceWindowFromShortcut === 'function' ? window.closeActiveResourceWindowFromShortcut() : false;",
            arguments: [:],
            in: nil,
            contentWorld: .page
        )
        return (handled as? Bool) == true
    }
}

@MainActor
enum SYGMAWorkspaceBridge {
    static var flushHandler: (@MainActor () async -> Bool)?
    static var reloadHandler: (@MainActor () -> Void)?

    static func flushPendingChanges() async -> Bool {
        guard let flushHandler else { return true }
        return await flushHandler()
    }

    @discardableResult
    static func reloadCurrentPage() async -> Bool {
        guard await flushPendingChanges() else { return false }
        reloadHandler?()
        return true
    }

}

#if canImport(UIKit)
struct SYGMAWebView: UIViewRepresentable {
    func makeCoordinator() -> SYGMAWebCoordinator { SYGMAWebCoordinator() }

    func makeUIView(context: Context) -> WKWebView {
        context.coordinator.makeMainWebView()
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: SYGMAWebCoordinator) {
        coordinator.tearDown(webView)
    }
}
#elseif canImport(AppKit)
struct SYGMAWebView: NSViewRepresentable {
    func makeCoordinator() -> SYGMAWebCoordinator { SYGMAWebCoordinator() }

    func makeNSView(context: Context) -> WKWebView {
        context.coordinator.makeMainWebView()
    }

    func updateNSView(_ webView: WKWebView, context: Context) {}

    static func dismantleNSView(_ webView: WKWebView, coordinator: SYGMAWebCoordinator) {
        coordinator.tearDown(webView)
    }
}
#endif

@MainActor
final class SYGMAWebCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
    private weak var mainWebView: WKWebView?
    private weak var rootWebView: WKWebView?
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]
    var quickMemoMessageHandler: (([String: Any]) -> Void)?

    #if canImport(UIKit)
    private var popupControllers: [ObjectIdentifier: UIViewController] = [:]
    #elseif canImport(AppKit)
    private var popupWindows: [ObjectIdentifier: NSWindow] = [:]
    private var popupWebViews: [ObjectIdentifier: WKWebView] = [:]
    private var resourceCloseKeyMonitor: Any?
    private var resourceCloseInFlight = false
    #endif

    func makeMainWebView() -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: makeConfiguration())
        mainWebView = webView
        rootWebView = webView
        configure(webView)
        configureWorkspaceBridge(for: webView)
        #if canImport(AppKit) && !canImport(UIKit)
        configureResourceCloseShortcut(for: webView)
        #endif
        webView.load(URLRequest(url: SYGMAWebRuntime.homeURL))
        return webView
    }

    func makeCompanionWebView(url: URL) -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: makeConfiguration())
        rootWebView = webView
        configure(webView)
        webView.load(URLRequest(url: url))
        return webView
    }

    private func makeConfiguration() -> WKWebViewConfiguration {
        let contentController = WKUserContentController()
        contentController.addUserScript(WKUserScript(
            source: SYGMAWebRuntime.mutationBridge,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        contentController.add(self, name: "sygmaStateChanged")
        contentController.add(self, name: "quickMemo")

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController = contentController
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        return configuration
    }

    func tearDown(_ webView: WKWebView) {
        #if canImport(AppKit) && !canImport(UIKit)
        if let resourceCloseKeyMonitor {
            NSEvent.removeMonitor(resourceCloseKeyMonitor)
            self.resourceCloseKeyMonitor = nil
        }
        #endif
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "sygmaStateChanged")
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "quickMemo")
        if mainWebView === webView {
            SYGMAWorkspaceBridge.flushHandler = nil
            SYGMAWorkspaceBridge.reloadHandler = nil
            mainWebView = nil
        }
        if rootWebView === webView { rootWebView = nil }
        closeAllPopups()
    }

    #if canImport(AppKit) && !canImport(UIKit)
    private func configureResourceCloseShortcut(for webView: WKWebView) {
        resourceCloseKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self, weak webView] event in
            guard let self, let webView,
                  let window = webView.window,
                  window === NSApp.keyWindow,
                  event.window === window,
                  SYGMAWebRuntime.isInternal(webView.url),
                  event.modifierFlags.intersection([.command, .shift, .option, .control]) == .command,
                  event.keyCode == 13 || event.charactersIgnoringModifiers?.lowercased() == "w" else { return event }
            // Consume repeats as well: holding Cmd+W must never fall through to closing the app window.
            guard !event.isARepeat, !self.resourceCloseInFlight else { return nil }
            self.resourceCloseInFlight = true
            Task { @MainActor [weak self, weak webView, weak window] in
                guard let self else { return }
                defer { self.resourceCloseInFlight = false }
                guard self.resourceCloseKeyMonitor != nil,
                      let webView, let window,
                      window === NSApp.keyWindow,
                      webView.window === window,
                      SYGMAWebRuntime.isInternal(webView.url) else { return }
                do {
                    let handled = try await SYGMAWebRuntime.closeActiveResourceWindow(in: webView)
                    guard self.resourceCloseKeyMonitor != nil,
                          window === NSApp.keyWindow,
                          webView.window === window,
                          SYGMAWebRuntime.isInternal(webView.url) else { return }
                    if !handled { window.performClose(nil) }
                } catch {
                    NSSound.beep()
                }
            }
            return nil
        }
    }
    #endif

    private func configureWorkspaceBridge(for webView: WKWebView) {
        SYGMAWorkspaceBridge.flushHandler = { [weak webView] in
            guard let webView else { return true }
            return await SYGMAWebRuntime.flushPendingChanges(in: webView)
        }
        SYGMAWorkspaceBridge.reloadHandler = { [weak webView] in
            webView?.reload()
        }
    }

    private func configure(_ webView: WKWebView) {
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, SYGMAWebRuntime.isInternal(message.webView?.url) else { return }
        if message.name == "quickMemo", let body = message.body as? [String: Any] {
            quickMemoMessageHandler?(body)
        } else if message.name == "sygmaStateChanged", message.webView === mainWebView {
            WidgetCenter.shared.reloadTimelines(ofKind: "SYGMAFourWeekCalendar")
            WidgetCenter.shared.reloadTimelines(ofKind: "SYGMATodayTasks")
        }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }

        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        // Google rejects OAuth inside embedded user agents. Keep the web flow,
        // but complete its one secure sign-in hop in the system browser.
        if SYGMAWebRuntime.isGoogleAuthStart(url) {
            openExternally(url)
            if webView !== rootWebView { closePopup(webView) }
            decisionHandler(.cancel)
            return
        }

        if navigationAction.targetFrame == nil, url.absoluteString != "about:blank" {
            openExternally(url)
            decisionHandler(.cancel)
            return
        }

        if url.absoluteString == "about:blank" || SYGMAWebRuntime.isInternal(url) {
            decisionHandler(.allow)
            return
        }

        if webView !== rootWebView, url.scheme?.lowercased() == "https" {
            decisionHandler(.allow)
            return
        }

        openExternally(url)
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, url.absoluteString != "about:blank" {
            openExternally(url)
            return nil
        }

        let popup = WKWebView(frame: .zero, configuration: configuration)
        configure(popup)
        presentPopup(popup)
        return popup
    }

    func webViewDidClose(_ webView: WKWebView) {
        closePopup(webView)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let destination = uniqueDownloadURL(for: suggestedFilename)
        downloadDestinations[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let destination = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        #if canImport(UIKit)
        let activity = UIActivityViewController(activityItems: [destination], applicationActivities: nil)
        topViewController()?.present(activity, animated: true)
        #elseif canImport(AppKit)
        NSWorkspace.shared.activateFileViewerSelecting([destination])
        #endif
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard let destination = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        try? FileManager.default.removeItem(at: destination)
    }

    private func uniqueDownloadURL(for suggestedFilename: String) -> URL {
        let fileManager = FileManager.default
        #if canImport(UIKit)
        let directory = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        #else
        let directory = fileManager.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        #endif
        let filename = URL(fileURLWithPath: suggestedFilename).lastPathComponent.isEmpty
            ? "SYGMA Export"
            : URL(fileURLWithPath: suggestedFilename).lastPathComponent
        let source = URL(fileURLWithPath: filename)
        let stem = source.deletingPathExtension().lastPathComponent
        let fileExtension = source.pathExtension
        var destination = directory.appendingPathComponent(filename)
        var suffix = 2
        while fileManager.fileExists(atPath: destination.path) {
            let nextName = fileExtension.isEmpty ? "\(stem)-\(suffix)" : "\(stem)-\(suffix).\(fileExtension)"
            destination = directory.appendingPathComponent(nextName)
            suffix += 1
        }
        return destination
    }

    private func openExternally(_ url: URL) {
        guard ["http", "https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") else { return }
        #if canImport(UIKit)
        UIApplication.shared.open(url)
        #elseif canImport(AppKit)
        NSWorkspace.shared.open(url)
        #endif
    }

    #if canImport(UIKit)
    private func presentPopup(_ popup: WKWebView) {
        let content = UIViewController()
        content.title = "Google 로그인"
        content.view.backgroundColor = .systemBackground
        popup.translatesAutoresizingMaskIntoConstraints = false
        content.view.addSubview(popup)
        NSLayoutConstraint.activate([
            popup.leadingAnchor.constraint(equalTo: content.view.leadingAnchor),
            popup.trailingAnchor.constraint(equalTo: content.view.trailingAnchor),
            popup.topAnchor.constraint(equalTo: content.view.topAnchor),
            popup.bottomAnchor.constraint(equalTo: content.view.bottomAnchor),
        ])
        content.navigationItem.rightBarButtonItem = UIBarButtonItem(
            systemItem: .close,
            primaryAction: UIAction { [weak self, weak popup] _ in
                guard let popup else { return }
                Task { _ = try? await popup.evaluateJavaScript("window.close()") }
                self?.closePopup(popup)
            }
        )
        let controller = UINavigationController(rootViewController: content)
        controller.modalPresentationStyle = .pageSheet
        controller.isModalInPresentation = true
        popupControllers[ObjectIdentifier(popup)] = controller
        topViewController()?.present(controller, animated: true)
    }

    private func closePopup(_ popup: WKWebView) {
        popup.navigationDelegate = nil
        popup.uiDelegate = nil
        popupControllers.removeValue(forKey: ObjectIdentifier(popup))?.dismiss(animated: true)
    }

    private func closeAllPopups() {
        let controllers = Array(popupControllers.values)
        popupControllers.removeAll()
        controllers.forEach { $0.dismiss(animated: false) }
    }

    private func topViewController() -> UIViewController? {
        let root = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .rootViewController
        return topViewController(from: root)
    }

    private func topViewController(from controller: UIViewController?) -> UIViewController? {
        if let presented = controller?.presentedViewController { return topViewController(from: presented) }
        if let navigation = controller as? UINavigationController { return topViewController(from: navigation.visibleViewController) }
        if let tab = controller as? UITabBarController { return topViewController(from: tab.selectedViewController) }
        return controller
    }
    #elseif canImport(AppKit)
    private func presentPopup(_ popup: WKWebView) {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 680),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Google 로그인"
        window.contentView = popup
        window.delegate = self
        window.isReleasedWhenClosed = false
        popupWindows[ObjectIdentifier(popup)] = window
        popupWebViews[ObjectIdentifier(window)] = popup
        window.center()
        window.makeKeyAndOrderFront(nil)
    }

    private func closePopup(_ popup: WKWebView) {
        popup.navigationDelegate = nil
        popup.uiDelegate = nil
        popupWindows.removeValue(forKey: ObjectIdentifier(popup))?.close()
    }

    private func closeAllPopups() {
        let windows = Array(popupWindows.values)
        popupWindows.removeAll()
        popupWebViews.removeAll()
        windows.forEach {
            $0.delegate = nil
            $0.close()
        }
    }
    #endif
}

#if canImport(AppKit)
extension SYGMAWebCoordinator: NSWindowDelegate {
    func windowWillClose(_ notification: Notification) {
        guard let window = notification.object as? NSWindow,
              let popup = popupWebViews.removeValue(forKey: ObjectIdentifier(window)) else { return }
        popupWindows.removeValue(forKey: ObjectIdentifier(popup))
        popup.navigationDelegate = nil
        popup.uiDelegate = nil
    }
}
#endif
