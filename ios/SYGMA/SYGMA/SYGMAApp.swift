import SwiftUI

@main
struct SYGMAApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @State private var store: AppStore

    init() {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        let appStore = arguments.contains("-SYGMAUseSeedState")
            ? AppStore(initialState: SeedState.make(), persistenceURL: nil, autoRefresh: false)
            : AppStore()
        if let marker = arguments.firstIndex(of: "-SYGMASection"),
           arguments.indices.contains(marker + 1),
           let section = AppSection(rawValue: arguments[marker + 1]) {
            appStore.selectedSection = section
        }
        if arguments.contains("-SYGMANavigationOpen") {
            appStore.isNavigationOpen = true
        }
        _store = State(initialValue: appStore)
        #else
        _store = State(initialValue: AppStore())
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .preferredColorScheme(.light)
                .onChange(of: scenePhase, initial: true) { _, phase in
                    switch phase {
                    case .active:
                        store.startLiveSync()
                    case .inactive:
                        store.stopLiveSync()
                        Task { await store.flushPendingChangesNow() }
                    case .background:
                        store.stopLiveSync()
                    @unknown default:
                        store.stopLiveSync()
                    }
                }
        }
    }
}
