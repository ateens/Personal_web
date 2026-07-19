import SwiftUI

struct SettingsView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        SYGMAScreen(
            eyebrow: "Settings",
            title: "동기화",
            subtitle: "iPhone과 웹의 한 Workspace",
            actions: {
                Button("지금 동기화") { Task { await testConnection() } }
                    .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.blue))
            }
        ) {
            syncPanel
            calendarPanel
            appPanel
        }
        .refreshable { await testConnection() }
    }

    private var syncPanel: some View {
        SYGMAPanel {
            SYGMASectionHeader("동기화 상태", detail: store.syncState.label)
            VStack(alignment: .leading, spacing: 12) {
                LabeledContent("로컬 revision", value: String(store.revision))
                LabeledContent("저장 대기", value: store.hasPendingChanges ? "있음" : "없음")
                if let remoteRevision = store.conflictRemoteRevision {
                    LabeledContent("서버 revision", value: String(remoteRevision))
                }
                if let detail = store.syncState.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(syncTint)
                        .textSelection(.enabled)
                }
                if case .conflict = store.syncState {
                    Text("서버 Workspace를 다시 불러오면 이 기기의 충돌 상태는 자동으로 폐기됩니다.")
                        .font(.caption)
                        .foregroundStyle(SYGMATheme.rose)
                    Button("서버 다시 불러오기") { Task { await testConnection() } }
                        .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.blue))
                }
            }
            .font(.subheadline)
        }
    }

    private var calendarPanel: some View {
        SYGMAPanel {
            SYGMASectionHeader("Calendar 표시", detail: "웹과 공유")
            VStack(spacing: 8) {
                ForEach(CalendarSource.allCases) { source in
                    Toggle(isOn: Binding(
                        get: { store.snapshot.calendarSourceVisible(source) },
                        set: { store.setCalendarSource(source, visible: $0) }
                    )) {
                        Label(source.title, systemImage: sourceSymbol(source))
                    }
                    .tint(sourceTint(source))
                    .frame(minHeight: SYGMATheme.minimumTapTarget)
                }
                if !store.snapshot.googleCalendars.isEmpty {
                    Text("Google Calendars")
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundStyle(SYGMATheme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 8)
                    ForEach(store.snapshot.googleCalendars) { calendar in
                        Toggle(isOn: Binding(
                            get: { store.snapshot.googleCalendarVisible(calendar.id) },
                            set: { store.setGoogleCalendar(calendar.id, visible: $0) }
                        )) {
                            HStack(spacing: 8) {
                                Circle().fill(SYGMATheme.teal).frame(width: 7, height: 7)
                                Text(calendar.summary).lineLimit(2)
                            }
                        }
                        .tint(SYGMATheme.teal)
                        .frame(minHeight: SYGMATheme.minimumTapTarget)
                    }
                }
            }
            .disabled(!store.isWorkspaceEditable)
        }
    }

    private var appPanel: some View {
        SYGMAPanel {
            SYGMASectionHeader("앱 정보")
            VStack(alignment: .leading, spacing: 10) {
                LabeledContent("버전", value: appVersion)
                LabeledContent("데이터 범위", value: "Resource 제외")
                LabeledContent("서버", value: APIClient.productionURL.host ?? "Railway")
                Text("Resource 컬렉션과 알 수 없는 필드는 동기화할 때 원본 그대로 보존됩니다.")
                    .font(.caption)
                    .foregroundStyle(SYGMATheme.muted)
            }
            .font(.subheadline)
        }
    }

    private var syncTint: Color {
        switch store.syncState {
        case .synced: SYGMATheme.teal
        case .saving, .loading: SYGMATheme.amber
        case .authenticationRequired, .conflict: SYGMATheme.rose
        case .localOnly, .offline: SYGMATheme.muted
        }
    }

    private var appVersion: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "\(version) (\(build))"
    }

    @MainActor
    private func testConnection() async {
        await store.refreshFromRemote()
    }

    private func sourceSymbol(_ source: CalendarSource) -> String {
        switch source {
        case .task: "checkmark.square"
        case .project: "square.grid.2x2"
        case .google: "g.circle"
        }
    }

    private func sourceTint(_ source: CalendarSource) -> Color {
        switch source {
        case .task: SYGMATheme.blue
        case .project: SYGMATheme.violet
        case .google: SYGMATheme.teal
        }
    }
}
