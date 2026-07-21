import SwiftUI
import UIKit

struct SYGMAScreen<Content: View, Actions: View>: View {
    let eyebrow: String
    let title: String
    let subtitle: String
    private let actions: Actions
    private let content: Content

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    init(
        eyebrow: String,
        title: String,
        subtitle: String,
        @ViewBuilder actions: () -> Actions,
        @ViewBuilder content: () -> Content
    ) {
        self.eyebrow = eyebrow
        self.title = title
        self.subtitle = subtitle
        self.actions = actions()
        self.content = content()
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: sectionSpacing) {
                QuickCaptureBar()

                SYGMAViewHeader(eyebrow: eyebrow, title: title, subtitle: subtitle) {
                    actions
                }

                content
            }
            .padding(.horizontal, horizontalPadding)
            .padding(.top, topPadding)
            .padding(.bottom, bottomPadding)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color.white.opacity(0.18))
    }

    private var horizontalPadding: CGFloat {
        horizontalSizeClass == .compact
            ? SYGMATheme.screenCompactHorizontalPadding
            : SYGMATheme.screenHorizontalPadding
    }

    private var sectionSpacing: CGFloat {
        horizontalSizeClass == .compact ? SYGMATheme.screenCompactSectionSpacing : 42
    }

    private var topPadding: CGFloat {
        horizontalSizeClass == .compact ? SYGMATheme.screenCompactTopPadding : 28
    }

    private var bottomPadding: CGFloat {
        horizontalSizeClass == .compact ? SYGMATheme.screenCompactBottomPadding : 150
    }
}

extension SYGMAScreen where Actions == EmptyView {
    init(
        eyebrow: String,
        title: String,
        subtitle: String,
        @ViewBuilder content: () -> Content
    ) {
        self.init(eyebrow: eyebrow, title: title, subtitle: subtitle, actions: { EmptyView() }, content: content)
    }
}

struct QuickCaptureBar: View {
    @Environment(AppStore.self) private var store
    @State private var title = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 8) {
            TextField("빠르게 Inbox에 수집", text: $title)
                .textInputAutocapitalization(.sentences)
                .submitLabel(.done)
                .focused($focused)
                .frame(minHeight: 44)
                .overlay(alignment: .bottom) { SYGMATheme.horizontalDivider().frame(height: 1) }
                .onSubmit(create)

            Button("추가", action: create)
                .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.ink))
                .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .accessibilityElement(children: .contain)
    }

    private func create() {
        _ = store.createCapture(CaptureDraft(title: title))
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        title = ""
        focused = false
    }
}

struct TaskDropPanel: View {
    let title: String
    let detail: String
    let tasks: [SygmaTask]
    let lane: TaskLane
    var limit: Int?
    let onOpen: (SygmaTask) -> Void

    @Environment(AppStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SYGMASectionHeader(title, detail: detail, compactBottomPadding: 6)
            LazyVStack(spacing: 0) {
                let visible = limit.map { Array(tasks.prefix($0)) } ?? tasks
                if visible.isEmpty {
                    Text(lane.emptyMessage)
                        .font(.subheadline)
                        .foregroundStyle(SYGMATheme.muted)
                        .frame(maxWidth: .infinity, minHeight: SYGMATheme.emptyStateMinimumHeight)
                        .accessibilityLabel(lane.emptyMessage)
                } else {
                    ForEach(visible) { task in
                        TaskRow(task: task) { onOpen(task) }
                    }
                }
            }
        }
        .dropDestination(for: String.self) { taskIDs, _ in
            guard ![TaskLane.scheduled, .overdue].contains(lane) else { return false }
            for id in taskIDs { store.placeTask(id, in: lane) }
            if !taskIDs.isEmpty { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
            return !taskIDs.isEmpty
        }
        .accessibilityHint(
            [TaskLane.scheduled, .overdue].contains(lane)
                ? "날짜가 필요한 영역입니다. Task를 열어 날짜를 선택하세요."
                : "Task를 이 영역으로 드래그해 배치할 수 있습니다."
        )
    }
}

struct TaskRow: View {
    let task: SygmaTask
    let onOpen: () -> Void

    @Environment(AppStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pendingCompletion: Bool?

    private var displayedCompletion: Bool { pendingCompletion ?? task.isDone }
    private var completionAnimation: Animation {
        SYGMATheme.standardAnimation
    }

    var body: some View {
        SYGMACard(accent: SYGMATheme.blue) {
            HStack(alignment: .top, spacing: 10) {
                SYGMATaskCheck(isCompleted: displayedCompletion, label: task.title, action: toggleCompletion)
                    .allowsHitTesting(pendingCompletion == nil)

                Button(action: onOpen) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(task.title)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(displayedCompletion ? SYGMATheme.soft : SYGMATheme.ink)
                            .overlay {
                                GeometryReader { proxy in
                                    Rectangle()
                                        .fill(SYGMATheme.soft)
                                        .frame(width: proxy.size.width, height: 1.5)
                                        .scaleEffect(x: displayedCompletion ? 1 : 0, anchor: .leading)
                                        .frame(maxHeight: .infinity, alignment: .center)
                                }
                                .allowsHitTesting(false)
                            }
                            .animation(
                                reduceMotion ? nil : completionAnimation,
                                value: displayedCompletion
                            )
                            .multilineTextAlignment(.leading)

                        HStack(spacing: 7) {
                            if !task.dateKey.isEmpty {
                                Text(dateLabel)
                                    .foregroundStyle(dateTint)
                            }
                            if ["scheduled", "doing", "waiting", "canceled"].contains(task.status) {
                                if !task.dateKey.isEmpty { separatorDot }
                                Text(statusLabel).foregroundStyle(SYGMATheme.amber)
                            }
                        }
                        .font(.caption.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(SYGMATheme.soft)
                    .frame(minWidth: 30, minHeight: 44)
                    .accessibilityHidden(true)
            }
        }
        .draggable(task.id) {
            Text(task.title)
                .font(.callout.weight(.semibold))
                .padding(12)
                .background(.regularMaterial)
        }
        .contextMenu {
            Button("오늘") { store.placeTask(task.id, in: .today) }
            Button("내일") { store.placeTask(task.id, in: .tomorrow) }
            Button("미계획") { store.placeTask(task.id, in: .unplanned) }
            Button(task.isDone ? "완료 취소" : "완료") { store.toggleTask(task.id) }
            Divider()
            Button("삭제", role: .destructive) { store.deleteTask(task.id) }
        }
        .accessibilityAction(named: "오늘로 이동") { store.placeTask(task.id, in: .today) }
        .accessibilityAction(named: "내일로 이동") { store.placeTask(task.id, in: .tomorrow) }
    }

    private func toggleCompletion() {
        guard pendingCompletion == nil else { return }
        let next = !task.isDone
        withAnimation(reduceMotion ? nil : completionAnimation) {
            pendingCompletion = next
        }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        Task { @MainActor in
            if !reduceMotion { try? await Task.sleep(for: .milliseconds(300)) }
            store.toggleTask(task.id)
            pendingCompletion = nil
        }
    }

    private var separatorDot: some View {
        Circle().fill(SYGMATheme.muted.opacity(0.45)).frame(width: 4, height: 4)
    }

    private var dateLabel: String {
        guard let date = Date.from(dateKey: task.dateKey) else { return task.dateKey }
        if task.dateKey == Date().dateKey { return "오늘" }
        if task.dateKey == Date().addingDays(1).dateKey { return "내일" }
        return date.formatted(.dateTime.locale(Locale(identifier: "ko_KR")).month(.abbreviated).day())
    }

    private var dateTint: Color {
        task.dateKey < Date().dateKey && !task.isDone ? SYGMATheme.rose : SYGMATheme.blue
    }

    private var statusLabel: String {
        switch task.status {
        case "scheduled": "예정"
        case "doing": "진행중"
        case "waiting": "대기"
        case "canceled": "중단"
        default: task.status
        }
    }
}
