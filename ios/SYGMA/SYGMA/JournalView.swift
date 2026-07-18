import SwiftUI
import UIKit

struct JournalView: View {
    @Environment(AppStore.self) private var store
    @State private var selectedJournal: SygmaJournal?
    @State private var showsCreate = false

    var body: some View {
        SYGMAScreen(
            eyebrow: "Journal",
            title: "회고",
            subtitle: "실행을 다음 선택으로 연결합니다",
            actions: {
                Button("새 리뷰") { showsCreate = true }
                .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.amber))
            }
        ) {
            SYGMAPanel {
                SYGMASectionHeader("최근 리뷰", detail: "\(store.snapshot.journals.count)개")
                if journals.isEmpty {
                    Text("아직 리뷰가 없습니다. 오늘의 만족도부터 가볍게 기록해 보세요.")
                        .font(.subheadline)
                        .foregroundStyle(SYGMATheme.muted)
                        .frame(maxWidth: .infinity, minHeight: SYGMATheme.emptyStateMinimumHeight + 8)
                        .multilineTextAlignment(.center)
                } else {
                    LazyVStack(spacing: 0) {
                        ForEach(journals) { journal in
                            SYGMACard(accent: satisfactionColor(journal.satisfaction)) {
                                Button { selectedJournal = journal } label: {
                                    HStack(spacing: 10) {
                                        VStack(alignment: .leading, spacing: 5) {
                                            Text(journal.title)
                                                .font(.body.weight(.semibold))
                                                .foregroundStyle(SYGMATheme.ink)
                                                .multilineTextAlignment(.leading)
                                            Text(journal.date.isEmpty ? "날짜 없음" : journal.date)
                                                .font(.caption)
                                                .foregroundStyle(SYGMATheme.muted)
                                            if !journal.reflection.isEmpty {
                                                Text(journal.reflection)
                                                    .font(.caption)
                                                    .foregroundStyle(SYGMATheme.muted)
                                                    .lineLimit(2)
                                            }
                                        }
                                        Spacer()
                                        Text("\(journal.satisfaction)/10")
                                            .font(.headline.weight(.heavy))
                                            .monospacedDigit()
                                            .foregroundStyle(satisfactionColor(journal.satisfaction))
                                        Image(systemName: "chevron.right")
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(SYGMATheme.soft)
                                            .frame(minWidth: 28, minHeight: 44)
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
        }
        .refreshable { await store.refreshFromRemote() }
        .sheet(item: $selectedJournal) { JournalEditorSheet(journal: $0) }
        .sheet(isPresented: $showsCreate) { JournalEditorSheet(journal: nil, initialDate: Date()) }
    }

    private var journals: [SygmaJournal] {
        store.snapshot.journals.sorted { ($0.date, $0.title) > ($1.date, $1.title) }
    }
}

struct JournalEditorSheet: View {
    let journal: SygmaJournal?

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft: JournalDraft
    @State private var date: Date
    @State private var confirmsDelete = false

    init(journal: SygmaJournal?, initialDate: Date = Date()) {
        self.journal = journal
        let value = journal.map(JournalDraft.init)
            ?? JournalDraft(title: "\(initialDate.dateKey) 리뷰", date: initialDate.dateKey)
        _draft = State(initialValue: value)
        _date = State(initialValue: Date.from(dateKey: value.date) ?? initialDate)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    SYGMAFormTextField(label: "제목", text: $draft.title)
                    DatePicker("날짜", selection: $date, displayedComponents: .date)
                        .tint(SYGMATheme.amber)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("오늘의 기록")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(SYGMATheme.muted)
                        TextEditor(text: $draft.reflection)
                            .frame(minHeight: 150)
                            .scrollContentBackground(.hidden)
                            .padding(.horizontal, 4)
                            .background(Color.white.opacity(0.28))
                            .overlay(alignment: .bottom) { SYGMATheme.horizontalDivider(SYGMATheme.amber).frame(height: 1) }
                    }
                    SYGMAFormTextField(label: "다음 행동", text: $draft.nextAction)
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("만족도").font(.caption.weight(.bold)).foregroundStyle(SYGMATheme.muted)
                            Spacer()
                            Text("\(draft.satisfaction)/10")
                                .font(.headline.weight(.heavy))
                                .monospacedDigit()
                                .foregroundStyle(satisfactionColor(draft.satisfaction))
                        }
                        Slider(
                            value: Binding(
                                get: { Double(draft.satisfaction) },
                                set: { draft.satisfaction = Int($0.rounded()) }
                            ),
                            in: 0...10,
                            step: 1
                        )
                        .tint(satisfactionColor(draft.satisfaction))
                        .accessibilityLabel("만족도")
                    }

                    Text("웹에서 만든 다른 블록과 서식은 그대로 보존됩니다.")
                        .font(.caption)
                        .foregroundStyle(SYGMATheme.muted)

                    HStack {
                        if journal != nil {
                            Button("삭제", role: .destructive) { confirmsDelete = true }
                                .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.rose))
                        }
                        Spacer()
                        Button("저장", action: save)
                            .buttonStyle(SYGMAUnderlineButtonStyle(tint: SYGMATheme.amber, isActive: true))
                            .disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(SYGMATheme.backgroundGradient.ignoresSafeArea())
            .navigationTitle(journal == nil ? "새 리뷰" : "리뷰 편집")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } } }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .confirmationDialog("이 리뷰를 삭제할까요?", isPresented: $confirmsDelete, titleVisibility: .visible) {
            Button("삭제", role: .destructive) {
                store.deleteJournal(draft.id)
                dismiss()
            }
        }
    }

    private func save() {
        draft.date = date.dateKey
        if journal == nil { store.createJournal(draft) } else { store.updateJournal(draft) }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        dismiss()
    }
}

private func satisfactionColor(_ value: Int) -> Color {
    if value >= 8 { return SYGMATheme.teal }
    if value >= 5 { return SYGMATheme.amber }
    return SYGMATheme.rose
}
