import SwiftUI
import UIKit

struct RootView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showsQuickCreate = false
    @AccessibilityFocusState private var focusedNavigationSection: AppSection?
    @AccessibilityFocusState private var navigationToggleFocused: Bool

    var body: some View {
        ZStack(alignment: .bottom) {
            SYGMATheme.backgroundGradient
                .ignoresSafeArea()

            if store.isInitialRemoteLoadComplete {
                activeScreen
                    .id(store.selectedSection)
                    .transition(reduceMotion ? .identity : .opacity.combined(with: .move(edge: .trailing)))
                    .accessibilityHidden(store.isNavigationOpen)
                    .disabled(!store.isWorkspaceEditable && store.selectedSection != .settings)
            } else {
                initialLoadingView
            }

            if syncNeedsAttention, !store.isNavigationOpen {
                VStack {
                    Button {
                        store.select(.settings)
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                            Text(store.syncState.label)
                            Text("검토")
                                .fontWeight(.heavy)
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(SYGMATheme.rose)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 44)
                        .background(.ultraThinMaterial, in: Capsule())
                        .shadow(color: SYGMATheme.ink.opacity(0.12), radius: 10, y: 5)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("두 번 탭하여 동기화와 보안 설정을 엽니다.")
                    .padding(.top, 8)
                    Spacer()
                }
                .zIndex(2)
            }

            if store.isNavigationOpen {
                Color.clear
                    .contentShape(Rectangle())
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation(SYGMATheme.standardAnimation) { store.isNavigationOpen = false } }
                    .accessibilityHidden(true)

                GeometryReader { proxy in
                    let menuBottom: CGFloat = 110
                    let menuWidth = min(300, max(240, proxy.size.width - 76))
                    let menuHeight = min(720, max(320, proxy.size.height - menuBottom - 26))

                    NavigationMenu(focusedSection: $focusedNavigationSection) {
                        withAnimation(SYGMATheme.standardAnimation) { store.isNavigationOpen = false }
                    }
                    .frame(width: menuWidth, height: menuHeight)
                    .position(
                        x: proxy.size.width / 2,
                        y: proxy.size.height - menuBottom - menuHeight / 2
                    )
                    .transition(reduceMotion ? .opacity : .scale(scale: 0.02, anchor: .center).combined(with: .opacity))
                }
                .zIndex(3)
            }

            floatingControls
                .zIndex(4)
        }
        .animation(reduceMotion ? nil : SYGMATheme.standardAnimation, value: store.selectedSection)
        .animation(reduceMotion ? nil : .timingCurve(0.16, 0.92, 0.22, 1, duration: 0.34), value: store.isNavigationOpen)
        .sheet(isPresented: $showsQuickCreate) { QuickCreateSheet() }
        .onChange(of: store.isNavigationOpen) { _, isOpen in
            if isOpen {
                navigationToggleFocused = false
                focusedNavigationSection = store.selectedSection
            } else {
                focusedNavigationSection = nil
                navigationToggleFocused = true
            }
        }
    }

    @ViewBuilder
    private var activeScreen: some View {
        switch store.selectedSection {
        case .today: TodayView()
        case .inbox: InboxView()
        case .tasks: TasksView()
        case .projects: ProjectsView()
        case .goals: GoalsView()
        case .boxes: BoxesView()
        case .habits: HabitsView()
        case .journal: JournalView()
        case .calendar: CalendarView()
        case .settings: SettingsView()
        }
    }

    private var initialLoadingView: some View {
        VStack(spacing: 12) {
            ProgressView()
                .tint(SYGMATheme.blue)
            Text("서버 Workspace를 불러오는 중")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(SYGMATheme.muted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("서버 Workspace를 불러오는 중")
    }

    private var syncNeedsAttention: Bool {
        switch store.syncState {
        case .conflict, .authenticationRequired: true
        default: false
        }
    }

    private var floatingControls: some View {
        HStack(alignment: .bottom) {
            Spacer()
            NavigationToggle(isOpen: store.isNavigationOpen) {
                UIImpactFeedbackGenerator(style: .soft).impactOccurred()
                withAnimation { store.isNavigationOpen.toggle() }
            }
            .accessibilityFocused($navigationToggleFocused)
            Spacer()
        }
        .overlay(alignment: .bottomTrailing) {
            Button {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                showsQuickCreate = true
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 25, weight: .light))
                    .foregroundStyle(SYGMATheme.ink)
                    .frame(width: 58, height: 58)
                    .background(Color.white.opacity(0.24))
                    .overlay(alignment: .bottom) {
                        SYGMATheme.horizontalDivider().frame(width: 42, height: 1)
                    }
                    .shadow(color: SYGMATheme.ink.opacity(0.14), radius: 13, y: 8)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("빠른 생성")
            .disabled(!store.isWorkspaceEditable)
            .opacity(store.isWorkspaceEditable ? 1 : 0)
            .accessibilityHidden(store.isNavigationOpen)
            .allowsHitTesting(!store.isNavigationOpen)
            .padding(.trailing, 20)
        }
        .padding(.bottom, 6)
        .ignoresSafeArea(.keyboard)
    }
}

private struct NavigationToggle: View {
    let isOpen: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                line
                    .rotationEffect(.degrees(isOpen ? 45 : 0))
                    .offset(y: isOpen ? 0 : -7)
                line
                    .scaleEffect(x: isOpen ? 0 : 1)
                    .opacity(isOpen ? 0 : 1)
                line
                    .rotationEffect(.degrees(isOpen ? -45 : 0))
                    .offset(y: isOpen ? 0 : 7)
            }
            .frame(width: 46, height: 78)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isOpen ? "목차 닫기" : "목차 열기")
        .accessibilityValue(isOpen ? "열림" : "닫힘")
    }

    private var line: some View {
        Rectangle()
            .fill(SYGMATheme.ink)
            .frame(width: 18, height: 1)
    }
}

private struct NavigationMenu: View {
    @Environment(AppStore.self) private var store
    @AccessibilityFocusState.Binding var focusedSection: AppSection?
    let close: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text("S")
                    .font(.headline.weight(.black))
                    .foregroundStyle(.white)
                    .frame(width: 42, height: 42)
                    .background(SYGMATheme.ink, in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text("SYGMA OS").font(.headline.weight(.heavy)).foregroundStyle(SYGMATheme.ink)
                    Text("Personal iPhone OS").font(.caption).foregroundStyle(SYGMATheme.muted)
                }
                Spacer()
            }
            .padding(.horizontal, 22)
            .padding(.top, 22)
            .padding(.bottom, 20)

            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(AppSection.allCases) { section in
                        Button {
                            UISelectionFeedbackGenerator().selectionChanged()
                            withAnimation(SYGMATheme.standardAnimation) { store.select(section) }
                        } label: {
                            HStack(spacing: 13) {
                                Image(systemName: section.symbol)
                                    .font(.system(size: 17, weight: store.selectedSection == section ? .bold : .regular))
                                    .frame(width: 26)
                                Text(section.title)
                                    .font(.body.weight(store.selectedSection == section ? .bold : .medium))
                                Spacer()
                                if store.selectedSection == section {
                                    Circle().fill(SYGMATheme.ink).frame(width: 5, height: 5)
                                }
                            }
                            .foregroundStyle(store.selectedSection == section ? SYGMATheme.ink : SYGMATheme.muted)
                            .frame(minHeight: 48)
                            .padding(.horizontal, 22)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(store.selectedSection == section ? .isSelected : [])
                        .accessibilityFocused($focusedSection, equals: section)
                    }
                }
            }
            .scrollIndicators(.hidden)

            Button {
                switch store.syncState {
                case .conflict, .authenticationRequired:
                    store.select(.settings)
                default:
                    Task { await store.refreshFromRemote() }
                }
            } label: {
                HStack {
                    Text(store.syncState.label)
                    Spacer()
                    Circle()
                        .fill(syncColor)
                        .frame(width: 8, height: 8)
                        .shadow(color: syncColor.opacity(0.25), radius: 5)
                }
                .font(.caption)
                .foregroundStyle(SYGMATheme.muted)
                .frame(minHeight: 44)
                .padding(.horizontal, 10)
                .overlay(alignment: .top) { SYGMATheme.horizontalDivider().frame(height: 1) }
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 14)
            .padding(.bottom, 14)
        }
        .background(Color(red: 0.976, green: 0.984, blue: 0.992))
        .shadow(color: SYGMATheme.ink.opacity(0.16), radius: 30, y: 16)
        .accessibilityElement(children: .contain)
        .accessibilityAction(.escape, close)
    }

    private var syncColor: Color {
        switch store.syncState {
        case .synced: SYGMATheme.teal
        case .saving, .loading: SYGMATheme.amber
        case .conflict: SYGMATheme.rose
        case .authenticationRequired: SYGMATheme.rose
        case .localOnly, .offline: SYGMATheme.muted
        }
    }
}
