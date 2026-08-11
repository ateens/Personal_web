import AppKit
import Carbon.HIToolbox
import Combine
import CoreGraphics
import SwiftUI

private let quickNotesPanelIdentifier = NSUserInterfaceItemIdentifier("SYGMAQuickNotesPanel")
private let quickNotesHotKeySignature: OSType = 0x5359474E // SYGN
private let quickNotesTransparencyKey = "SYGMAQuickNotesBackgroundTransparency"
private let quickNotesThemeKey = "SYGMAQuickNotesTheme"
private let quickNotesThemeChanged = Notification.Name("SYGMAQuickNotesThemeChanged")

enum QuickNotesColorMode: String, CaseIterable, Identifiable {
    case dark
    case light
    case system

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dark: "다크"
        case .light: "화이트"
        case .system: "시스템"
        }
    }

    var icon: String {
        switch self {
        case .dark: "moon.fill"
        case .light: "sun.max.fill"
        case .system: "circle.lefthalf.filled"
        }
    }

    var appearance: NSAppearance.Name? {
        switch self {
        case .dark: .darkAqua
        case .light: .aqua
        case .system: nil
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .dark: .dark
        case .light: .light
        case .system: nil
        }
    }
}

enum QuickNoteShortcutAction: String, CaseIterable, Codable, Identifiable {
    case togglePanel, newNote, previousNote, nextNote, togglePreview, hidePanel
    case note1, note2, note3, note4, note5, note6, note7, note8, note9

    var id: String { rawValue }

    var title: String {
        switch self {
        case .togglePanel: "열기 / 숨기기"
        case .newNote: "새 노트"
        case .previousNote: "이전 노트"
        case .nextNote: "다음 노트"
        case .togglePreview: "미리보기"
        case .hidePanel: "닫기"
        case .note1, .note2, .note3, .note4, .note5, .note6, .note7, .note8, .note9:
            "노트 \(noteNumber!)"
        }
    }

    var noteNumber: Int? {
        switch self {
        case .note1: 1
        case .note2: 2
        case .note3: 3
        case .note4: 4
        case .note5: 5
        case .note6: 6
        case .note7: 7
        case .note8: 8
        case .note9: 9
        default: nil
        }
    }
}

struct QuickNoteShortcut: Codable, Hashable {
    let keyCode: UInt16
    let modifiers: UInt
    let key: String

    private static let modifierMask: NSEvent.ModifierFlags = [.control, .option, .shift, .command]
    private static let unmodifiedKeys: Set<UInt16> = [
        UInt16(kVK_Escape), UInt16(kVK_F1), UInt16(kVK_F2), UInt16(kVK_F3), UInt16(kVK_F4),
        UInt16(kVK_F5), UInt16(kVK_F6), UInt16(kVK_F7), UInt16(kVK_F8), UInt16(kVK_F9),
        UInt16(kVK_F10), UInt16(kVK_F11), UInt16(kVK_F12), UInt16(kVK_F13), UInt16(kVK_F14),
        UInt16(kVK_F15), UInt16(kVK_F16), UInt16(kVK_F17), UInt16(kVK_F18), UInt16(kVK_F19),
        UInt16(kVK_F20),
    ]
    private static let ansiKeyLabels: [UInt16: String] = [
        UInt16(kVK_ANSI_A): "A", UInt16(kVK_ANSI_B): "B", UInt16(kVK_ANSI_C): "C",
        UInt16(kVK_ANSI_D): "D", UInt16(kVK_ANSI_E): "E", UInt16(kVK_ANSI_F): "F",
        UInt16(kVK_ANSI_G): "G", UInt16(kVK_ANSI_H): "H", UInt16(kVK_ANSI_I): "I",
        UInt16(kVK_ANSI_J): "J", UInt16(kVK_ANSI_K): "K", UInt16(kVK_ANSI_L): "L",
        UInt16(kVK_ANSI_M): "M", UInt16(kVK_ANSI_N): "N", UInt16(kVK_ANSI_O): "O",
        UInt16(kVK_ANSI_P): "P", UInt16(kVK_ANSI_Q): "Q", UInt16(kVK_ANSI_R): "R",
        UInt16(kVK_ANSI_S): "S", UInt16(kVK_ANSI_T): "T", UInt16(kVK_ANSI_U): "U",
        UInt16(kVK_ANSI_V): "V", UInt16(kVK_ANSI_W): "W", UInt16(kVK_ANSI_X): "X",
        UInt16(kVK_ANSI_Y): "Y", UInt16(kVK_ANSI_Z): "Z",
        UInt16(kVK_ANSI_0): "0", UInt16(kVK_ANSI_1): "1", UInt16(kVK_ANSI_2): "2",
        UInt16(kVK_ANSI_3): "3", UInt16(kVK_ANSI_4): "4", UInt16(kVK_ANSI_5): "5",
        UInt16(kVK_ANSI_6): "6", UInt16(kVK_ANSI_7): "7", UInt16(kVK_ANSI_8): "8",
        UInt16(kVK_ANSI_9): "9", UInt16(kVK_ANSI_Minus): "-", UInt16(kVK_ANSI_Equal): "=",
        UInt16(kVK_ANSI_LeftBracket): "[", UInt16(kVK_ANSI_RightBracket): "]",
        UInt16(kVK_ANSI_Backslash): "\\", UInt16(kVK_ANSI_Semicolon): ";",
        UInt16(kVK_ANSI_Quote): "'", UInt16(kVK_ANSI_Comma): ",",
        UInt16(kVK_ANSI_Period): ".", UInt16(kVK_ANSI_Slash): "/", UInt16(kVK_ANSI_Grave): "`",
    ]

    init(keyCode: UInt16, modifiers: NSEvent.ModifierFlags, key: String) {
        self.keyCode = keyCode
        self.modifiers = modifiers.intersection(Self.modifierMask).rawValue
        self.key = key
    }

    init?(event: NSEvent) {
        let flags = event.modifierFlags.intersection(Self.modifierMask)
        let key = Self.keyLabel(keyCode: event.keyCode, fallback: event.charactersIgnoringModifiers)
        guard !key.isEmpty, !flags.intersection([.command, .option, .control]).isEmpty || Self.unmodifiedKeys.contains(event.keyCode) else {
            return nil
        }
        self.init(keyCode: event.keyCode, modifiers: flags, key: key)
    }

    var modifierFlags: NSEvent.ModifierFlags { NSEvent.ModifierFlags(rawValue: modifiers) }
    var hasPrimaryModifier: Bool { !modifierFlags.intersection([.command, .option, .control]).isEmpty }
    var isSafe: Bool { !key.isEmpty && (hasPrimaryModifier || Self.unmodifiedKeys.contains(keyCode)) }

    var display: String {
        var result = ""
        if modifierFlags.contains(.control) { result += "⌃" }
        if modifierFlags.contains(.option) { result += "⌥" }
        if modifierFlags.contains(.shift) { result += "⇧" }
        if modifierFlags.contains(.command) { result += "⌘" }
        return result + Self.keyLabel(keyCode: keyCode, fallback: key)
    }

    var carbonModifiers: UInt32 {
        var result: UInt32 = 0
        if modifierFlags.contains(.control) { result |= UInt32(controlKey) }
        if modifierFlags.contains(.option) { result |= UInt32(optionKey) }
        if modifierFlags.contains(.shift) { result |= UInt32(shiftKey) }
        if modifierFlags.contains(.command) { result |= UInt32(cmdKey) }
        return result
    }

    func matches(_ event: NSEvent) -> Bool {
        keyCode == event.keyCode && modifierFlags == event.modifierFlags.intersection(Self.modifierMask)
    }

    static func == (lhs: QuickNoteShortcut, rhs: QuickNoteShortcut) -> Bool {
        lhs.keyCode == rhs.keyCode && lhs.modifiers == rhs.modifiers
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(keyCode)
        hasher.combine(modifiers)
    }

    private static func keyLabel(keyCode: UInt16, fallback: String?) -> String {
        if let label = ansiKeyLabels[keyCode] { return label }
        switch Int(keyCode) {
        case kVK_Escape: return "Esc"
        case kVK_Return: return "↩"
        case kVK_Tab: return "Tab"
        case kVK_Space: return "Space"
        case kVK_Delete: return "⌫"
        case kVK_ForwardDelete: return "⌦"
        case kVK_LeftArrow: return "←"
        case kVK_RightArrow: return "→"
        case kVK_UpArrow: return "↑"
        case kVK_DownArrow: return "↓"
        case kVK_F1: return "F1"
        case kVK_F2: return "F2"
        case kVK_F3: return "F3"
        case kVK_F4: return "F4"
        case kVK_F5: return "F5"
        case kVK_F6: return "F6"
        case kVK_F7: return "F7"
        case kVK_F8: return "F8"
        case kVK_F9: return "F9"
        case kVK_F10: return "F10"
        case kVK_F11: return "F11"
        case kVK_F12: return "F12"
        case kVK_F13: return "F13"
        case kVK_F14: return "F14"
        case kVK_F15: return "F15"
        case kVK_F16: return "F16"
        case kVK_F17: return "F17"
        case kVK_F18: return "F18"
        case kVK_F19: return "F19"
        case kVK_F20: return "F20"
        default: return (fallback ?? "").uppercased()
        }
    }
}

@MainActor
final class QuickNoteShortcutSettings: ObservableObject {
    private static let defaultsKey = "SYGMAQuickNotesShortcutsV2"
    private static let legacyDefaultsKey = "SYGMAQuickNotesShortcutsV1"
    private static let legacyHideShortcut = QuickNoteShortcut(keyCode: UInt16(kVK_Escape), modifiers: [], key: "Esc")
    @Published private(set) var shortcuts: [QuickNoteShortcutAction: QuickNoteShortcut]
    @Published var capturingAction: QuickNoteShortcutAction?
    @Published private(set) var message = ""
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let currentData = defaults.data(forKey: Self.defaultsKey)
        let legacyData = currentData == nil ? defaults.data(forKey: Self.legacyDefaultsKey) : nil
        if let data = currentData ?? legacyData,
           let stored = try? JSONDecoder().decode([String: QuickNoteShortcut].self, from: data) {
            let decoded = Dictionary(uniqueKeysWithValues: QuickNoteShortcutAction.allCases.compactMap { action in
                stored[action.rawValue].map { (action, $0) }
            })
            var loaded = decoded.count == QuickNoteShortcutAction.allCases.count
                && Set(decoded.values).count == decoded.count
                && decoded.values.allSatisfy(\.isSafe)
                ? decoded
                : Self.defaultShortcuts
            if legacyData != nil,
               loaded[.hidePanel] == Self.legacyHideShortcut,
               !loaded.contains(where: { $0.key != .hidePanel && $0.value == Self.defaultShortcuts[.hidePanel] }) {
                loaded[.hidePanel] = Self.defaultShortcuts[.hidePanel]
            }
            shortcuts = loaded
            if legacyData != nil {
                let stored = Dictionary(uniqueKeysWithValues: loaded.map { ($0.key.rawValue, $0.value) })
                if let data = try? JSONEncoder().encode(stored) { defaults.set(data, forKey: Self.defaultsKey) }
            }
        } else {
            shortcuts = Self.defaultShortcuts
        }
    }

    func shortcut(for action: QuickNoteShortcutAction) -> QuickNoteShortcut {
        shortcuts[action] ?? Self.defaultShortcuts[action]!
    }

    func beginCapture(_ action: QuickNoteShortcutAction) {
        capturingAction = action
        message = ""
    }

    func cancelCapture() { capturingAction = nil }

    func validationMessage(for shortcut: QuickNoteShortcut, action: QuickNoteShortcutAction) -> String? {
        if action == .togglePanel, !shortcut.hasPrimaryModifier {
            return "전역 단축키에는 Command, Option 또는 Control이 필요합니다."
        }
        return shortcuts.contains(where: { $0.key != action && $0.value == shortcut }) ? "이미 사용 중인 단축키입니다." : nil
    }

    func save(_ shortcut: QuickNoteShortcut, for action: QuickNoteShortcutAction) {
        shortcuts[action] = shortcut
        capturingAction = nil
        message = ""
        let stored = Dictionary(uniqueKeysWithValues: shortcuts.map { ($0.key.rawValue, $0.value) })
        if let data = try? JSONEncoder().encode(stored) { defaults.set(data, forKey: Self.defaultsKey) }
    }

    func fail(_ reason: String) { message = reason }

    static let defaultShortcuts: [QuickNoteShortcutAction: QuickNoteShortcut] = {
        let command: NSEvent.ModifierFlags = .command
        return [
            .togglePanel: QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_N), modifiers: [.command, .option], key: "N"),
            .newNote: QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_N), modifiers: command, key: "N"),
            .previousNote: QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_LeftBracket), modifiers: command, key: "["),
            .nextNote: QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_RightBracket), modifiers: command, key: "]"),
            .togglePreview: QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_M), modifiers: [.command, .shift], key: "M"),
            .hidePanel: QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_W), modifiers: command, key: "W"),
            .note1: QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_1), modifiers: command, key: "1"),
            .note2: QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_2), modifiers: command, key: "2"),
            .note3: QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_3), modifiers: command, key: "3"),
            .note4: QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_4), modifiers: command, key: "4"),
            .note5: QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_5), modifiers: command, key: "5"),
            .note6: QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_6), modifiers: command, key: "6"),
            .note7: QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_7), modifiers: command, key: "7"),
            .note8: QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_8), modifiers: command, key: "8"),
            .note9: QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_9), modifiers: command, key: "9"),
        ]
    }()
}

struct QuickNoteRecord: Codable, Identifiable, Equatable {
    let id: UUID
    var title: String
    var updatedAt: Date
}

struct QuickNotesIndex: Codable, Equatable {
    var selectedID: UUID?
    var notes: [QuickNoteRecord]
}

@MainActor
final class QuickNotesStore: ObservableObject {
    @Published private(set) var notes: [QuickNoteRecord] = []
    @Published private(set) var selectedID: UUID?
    @Published private(set) var contentRevision = 0
    @Published var isPreviewing = false
    @Published private(set) var saveError = ""

    let rootURL: URL
    private var bodies: [UUID: String] = [:]
    private var dirtyBodyIDs = Set<UUID>()
    private var saveTimer: Timer?

    init(rootURL: URL = QuickNotesStore.defaultRootURL()) {
        self.rootURL = rootURL
        load()
    }

    nonisolated static func defaultRootURL() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("SYGMA/QuickNotes", isDirectory: true)
    }

    var selectedNote: QuickNoteRecord? {
        guard let selectedID else { return nil }
        return notes.first { $0.id == selectedID }
    }

    var selectedBody: String {
        guard let selectedID else { return "" }
        return body(for: selectedID)
    }

    func body(for id: UUID) -> String {
        if let body = bodies[id] { return body }
        let body = (try? String(contentsOf: noteFileURL(id), encoding: .utf8)) ?? ""
        bodies[id] = body
        return body
    }

    @discardableResult
    func createNote() -> UUID {
        let note = QuickNoteRecord(id: UUID(), title: "새 노트", updatedAt: Date())
        notes.append(note)
        selectedID = note.id
        bodies[note.id] = ""
        dirtyBodyIDs.insert(note.id)
        isPreviewing = false
        contentRevision += 1
        scheduleSave()
        return note.id
    }

    func select(_ id: UUID) {
        guard notes.contains(where: { $0.id == id }) else { return }
        selectedID = id
        isPreviewing = false
        contentRevision += 1
        scheduleSave()
    }

    func select(offset: Int) {
        guard !notes.isEmpty else { return }
        let current = notes.firstIndex { $0.id == selectedID } ?? 0
        select(notes[(current + offset + notes.count) % notes.count].id)
    }

    func select(number: Int) {
        guard notes.indices.contains(number - 1) else { return }
        select(notes[number - 1].id)
    }

    func renameSelected(_ title: String) {
        guard let selectedID, let index = notes.firstIndex(where: { $0.id == selectedID }) else { return }
        notes[index].title = title
        notes[index].updatedAt = Date()
        scheduleSave()
    }

    func updateBody(_ body: String, for id: UUID) {
        guard notes.contains(where: { $0.id == id }), bodies[id] != body else { return }
        bodies[id] = body
        dirtyBodyIDs.insert(id)
        if let index = notes.firstIndex(where: { $0.id == id }) { notes[index].updatedAt = Date() }
        contentRevision += 1
        scheduleSave()
    }

    func deleteSelected() {
        guard let selectedID, let index = notes.firstIndex(where: { $0.id == selectedID }) else { return }
        notes.remove(at: index)
        bodies.removeValue(forKey: selectedID)
        dirtyBodyIDs.remove(selectedID)
        try? FileManager.default.removeItem(at: noteDirectoryURL(selectedID))
        if notes.isEmpty {
            createNote()
        } else {
            self.selectedID = notes[min(index, notes.count - 1)].id
            contentRevision += 1
            scheduleSave()
        }
    }

    func togglePreview() {
        isPreviewing.toggle()
        contentRevision += 1
    }

    func saveImage(_ image: NSImage, for noteID: UUID) -> QuickNoteImageAttachment? {
        guard notes.contains(where: { $0.id == noteID }),
              let tiff = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else { return nil }
        let name = "\(UUID().uuidString.lowercased()).png"
        let relativePath = "assets/\(name)"
        guard let url = assetURL(noteID: noteID, relativePath: relativePath) else { return nil }
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try png.write(to: url, options: .atomic)
            return QuickNoteImageAttachment(relativePath: relativePath, image: image)
        } catch {
            saveError = error.localizedDescription
            return nil
        }
    }

    func image(noteID: UUID, relativePath: String) -> NSImage? {
        guard let url = assetURL(noteID: noteID, relativePath: relativePath) else { return nil }
        return NSImage(contentsOf: url)
    }

    func assetURL(noteID: UUID, relativePath: String) -> URL? {
        let parts = relativePath.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2,
              parts[0] == "assets",
              parts[1].hasSuffix(".png"),
              UUID(uuidString: String(parts[1].dropLast(4))) != nil else { return nil }
        return noteDirectoryURL(noteID).appendingPathComponent(relativePath)
    }

    func flush() {
        saveTimer?.invalidate()
        saveTimer = nil
        do {
            try FileManager.default.createDirectory(at: notesDirectoryURL, withIntermediateDirectories: true)
            for id in dirtyBodyIDs {
                let url = noteFileURL(id)
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try (bodies[id] ?? "").write(to: url, atomically: true, encoding: .utf8)
            }
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            encoder.dateEncodingStrategy = .iso8601
            let data = try encoder.encode(QuickNotesIndex(selectedID: selectedID, notes: notes))
            try data.write(to: indexURL, options: .atomic)
            dirtyBodyIDs.removeAll()
            saveError = ""
        } catch {
            saveError = error.localizedDescription
        }
    }

    private var indexURL: URL { rootURL.appendingPathComponent("index.json") }
    private var notesDirectoryURL: URL { rootURL.appendingPathComponent("notes", isDirectory: true) }
    private func noteDirectoryURL(_ id: UUID) -> URL { notesDirectoryURL.appendingPathComponent(id.uuidString.lowercased(), isDirectory: true) }
    private func noteFileURL(_ id: UUID) -> URL { noteDirectoryURL(id).appendingPathComponent("note.md") }

    private func load() {
        do {
            try FileManager.default.createDirectory(at: notesDirectoryURL, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: indexURL.path) {
                do {
                    let decoder = JSONDecoder()
                    decoder.dateDecodingStrategy = .iso8601
                    let index = try decoder.decode(QuickNotesIndex.self, from: Data(contentsOf: indexURL))
                    notes = index.notes
                    selectedID = notes.contains(where: { $0.id == index.selectedID }) ? index.selectedID : notes.first?.id
                } catch {
                    let backup = rootURL.appendingPathComponent("index.corrupt-\(Int(Date().timeIntervalSince1970)).json")
                    try? FileManager.default.copyItem(at: indexURL, to: backup)
                    recoverNotes()
                    flush()
                    saveError = "손상된 노트 목록을 보존하고 새 목록을 만들었습니다."
                }
            }
        } catch {
            saveError = error.localizedDescription
        }
        if notes.isEmpty { createNote() }
    }

    private func recoverNotes() {
        let keys: Set<URLResourceKey> = [.contentModificationDateKey, .isDirectoryKey]
        let directories = (try? FileManager.default.contentsOfDirectory(
            at: notesDirectoryURL,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles]
        )) ?? []
        notes = directories.compactMap { directory in
            guard UUID(uuidString: directory.lastPathComponent) != nil,
                  (try? directory.resourceValues(forKeys: keys).isDirectory) == true else { return nil }
            let file = directory.appendingPathComponent("note.md")
            guard let body = try? String(contentsOf: file, encoding: .utf8) else { return nil }
            let id = UUID(uuidString: directory.lastPathComponent)!
            bodies[id] = body
            let firstLine = body.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
            let title = firstLine.replacingOccurrences(of: #"^\s*#+\s*"#, with: "", options: .regularExpression)
            let updatedAt = (try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? Date()
            return QuickNoteRecord(id: id, title: title.isEmpty ? "복구된 노트" : title, updatedAt: updatedAt)
        }
        .sorted { $0.updatedAt > $1.updatedAt }
        selectedID = notes.first?.id
    }

    private func scheduleSave() {
        saveTimer?.invalidate()
        saveTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.flush() }
        }
    }
}

final class QuickNoteImageAttachment: NSTextAttachment {
    let relativePath: String

    init(relativePath: String, image: NSImage) {
        self.relativePath = relativePath
        super.init(data: nil, ofType: "public.png")
        self.image = image
        let scale = min(1, 680 / max(image.size.width, 1))
        bounds = NSRect(origin: .zero, size: NSSize(width: image.size.width * scale, height: image.size.height * scale))
    }

    required init?(coder: NSCoder) { nil }
}

extension NSAttributedString.Key {
    static let quickNoteBlock = NSAttributedString.Key("SYGMAQuickNoteBlock")
}

extension NSColor {
    static let quickNoteText = NSColor(name: "SYGMAQuickNoteText") { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? .white : .black
    }
}

enum QuickNoteMarkdownCodec {
    static let headingSentinel = "\u{200B}"
    private static let imagePattern = try! NSRegularExpression(
        pattern: #"!\[([^\]]*)\]\((assets/[0-9a-fA-F-]{36}\.png)\)"#
    )
    private static let headingPattern = try! NSRegularExpression(pattern: #"(?m)^(#{1,6})[ \t]+"#)
    private static let listPattern = try! NSRegularExpression(pattern: #"(?m)^([ \t]*)-[ \t]+"#)

    static func markdown(from attributed: NSAttributedString) -> String {
        let value = NSMutableAttributedString(attributedString: attributed)
        var blocks: [Int: (block: String, marker: NSRange)] = [:]
        value.enumerateAttribute(.quickNoteBlock, in: NSRange(location: 0, length: value.length)) { block, range, _ in
            guard let block = block as? String, range.length > 0 else { return }
            let paragraph = (value.string as NSString).paragraphRange(for: NSRange(location: range.location, length: 0))
            blocks[paragraph.location] = (block, range)
        }
        for (location, valueBlock) in blocks.sorted(by: { $0.key > $1.key }) {
            let (block, marker) = valueBlock
            if block.hasPrefix("h"), let level = Int(block.dropFirst()), (1...6).contains(level) {
                guard marker.location < value.length,
                      (value.string as NSString).substring(with: NSRange(location: marker.location, length: 1)) == headingSentinel else { continue }
                value.deleteCharacters(in: NSRange(location: marker.location, length: 1))
                value.insert(NSAttributedString(string: "\(String(repeating: "#", count: level)) "), at: location)
            } else if block == "list", marker.location + 2 <= value.length,
                      (value.string as NSString).substring(with: NSRange(location: marker.location, length: 2)) == "• " {
                value.deleteCharacters(in: NSRange(location: marker.location, length: 2))
                value.insert(NSAttributedString(string: "- "), at: marker.location)
            }
        }
        var replacements: [(NSRange, String)] = []
        value.enumerateAttribute(.attachment, in: NSRange(location: 0, length: value.length)) { attachment, range, _ in
            guard let image = attachment as? QuickNoteImageAttachment else { return }
            replacements.append((range, "![image](\(image.relativePath))"))
        }
        for (range, token) in replacements.reversed() { value.replaceCharacters(in: range, with: token) }
        return value.string
    }

    @MainActor
    static func editorValue(markdown: String, noteID: UUID, store: QuickNotesStore) -> NSAttributedString {
        let value = NSMutableAttributedString(string: markdown)
        let matches = imagePattern.matches(in: markdown, range: NSRange(markdown.startIndex..., in: markdown))
        for match in matches.reversed() {
            guard let pathRange = Range(match.range(at: 2), in: markdown),
                  let image = store.image(noteID: noteID, relativePath: String(markdown[pathRange])) else { continue }
            value.replaceCharacters(in: match.range, with: NSAttributedString(attachment: QuickNoteImageAttachment(relativePath: String(markdown[pathRange]), image: image)))
        }
        materializeBlocks(in: value)
        applySourceStyle(to: value)
        return value
    }

    static func headingFont(level: Int) -> NSFont {
        NSFont.systemFont(ofSize: max(18, 27 - CGFloat(level) * 2), weight: .semibold)
    }

    static func applySourceStyle(to value: NSMutableAttributedString) {
        let range = NSRange(location: 0, length: value.length)
        guard range.length > 0 else { return }
        value.removeAttribute(.font, range: range)
        value.removeAttribute(.foregroundColor, range: range)
        value.removeAttribute(.backgroundColor, range: range)
        value.removeAttribute(.underlineStyle, range: range)
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 5
        paragraph.paragraphSpacing = 8
        value.addAttributes([
            .font: NSFont.systemFont(ofSize: 16),
            .foregroundColor: NSColor.quickNoteText,
            .paragraphStyle: paragraph,
        ], range: range)

        style(#"\*\*([^*\n]+)\*\*"#, in: value) { match in
            value.addAttribute(.font, value: NSFont.systemFont(ofSize: 16, weight: .bold), range: match.range(at: 1))
        }
        style(#"(?<!\*)\*([^*\n]+)\*(?!\*)"#, in: value) { match in
            value.addAttribute(.font, value: NSFontManager.shared.convert(NSFont.systemFont(ofSize: 16), toHaveTrait: .italicFontMask), range: match.range(at: 1))
        }
        style(#"`([^`\n]+)`"#, in: value) { match in
            value.addAttributes([
                .font: NSFont.monospacedSystemFont(ofSize: 14, weight: .regular),
                .backgroundColor: NSColor.quaternaryLabelColor,
            ], range: match.range(at: 1))
        }
        style(#"\[([^\]]+)\]\((https?://[^)]+)\)"#, in: value) { match in
            value.addAttributes([
                .foregroundColor: NSColor.systemBlue,
                .underlineStyle: NSUnderlineStyle.single.rawValue,
            ], range: match.range(at: 1))
        }
        style(#"(?m)^\s*(?:[-*+]|>)\s+"#, in: value) { match in
            value.addAttribute(.foregroundColor, value: NSColor.systemBlue, range: match.range)
        }
        var blocks: [Int: String] = [:]
        value.enumerateAttribute(.quickNoteBlock, in: range) { block, blockRange, _ in
            guard let block = block as? String else { return }
            blocks[(value.string as NSString).paragraphRange(for: NSRange(location: blockRange.location, length: 0)).location] = block
            if block == "list" {
                value.addAttribute(.foregroundColor, value: NSColor.systemBlue, range: blockRange)
            }
        }
        for (location, block) in blocks {
            guard block.hasPrefix("h"), let level = Int(block.dropFirst()), (1...6).contains(level) else { continue }
            var contentRange = paragraphContentRange(at: location, in: value.string as NSString)
            if contentRange.length > 0,
               (value.string as NSString).substring(with: NSRange(location: contentRange.location, length: 1)) == headingSentinel {
                contentRange.location += 1
                contentRange.length -= 1
            }
            if contentRange.length > 0 { value.addAttribute(.font, value: headingFont(level: level), range: contentRange) }
        }
    }

    static func previewSegments(markdown: String) -> [(text: String?, imagePath: String?)] {
        let nsRange = NSRange(markdown.startIndex..., in: markdown)
        var cursor = 0
        var segments: [(String?, String?)] = []
        for match in imagePattern.matches(in: markdown, range: nsRange) {
            if match.range.location > cursor, let range = Range(NSRange(location: cursor, length: match.range.location - cursor), in: markdown) {
                segments.append((String(markdown[range]), nil))
            }
            if let range = Range(match.range(at: 2), in: markdown) { segments.append((nil, String(markdown[range]))) }
            cursor = NSMaxRange(match.range)
        }
        if cursor < nsRange.length, let range = Range(NSRange(location: cursor, length: nsRange.length - cursor), in: markdown) {
            segments.append((String(markdown[range]), nil))
        }
        return segments.isEmpty ? [(markdown, nil)] : segments
    }

    private static func style(_ pattern: String, in value: NSMutableAttributedString, apply: (NSTextCheckingResult) -> Void) {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return }
        for match in regex.matches(in: value.string, range: NSRange(location: 0, length: value.length)) { apply(match) }
    }

    private static func materializeBlocks(in value: NSMutableAttributedString) {
        let headingMatches = headingPattern.matches(in: value.string, range: NSRange(location: 0, length: value.length))
        for match in headingMatches.reversed() {
            let level = match.range(at: 1).length
            value.replaceCharacters(
                in: match.range,
                with: NSAttributedString(string: headingSentinel, attributes: [.quickNoteBlock: "h\(level)"])
            )
        }

        let listMatches = listPattern.matches(in: value.string, range: NSRange(location: 0, length: value.length))
        for match in listMatches.reversed() {
            let indentLength = match.range(at: 1).length
            let indent = (value.string as NSString).substring(with: match.range(at: 1))
            value.replaceCharacters(in: match.range, with: "\(indent)• ")
            value.addAttribute(
                .quickNoteBlock,
                value: "list",
                range: NSRange(location: match.range.location + indentLength, length: 2)
            )
        }
    }

    private static func paragraphContentRange(at location: Int, in value: NSString) -> NSRange {
        let paragraph = value.paragraphRange(for: NSRange(location: min(location, value.length), length: 0))
        var end = NSMaxRange(paragraph)
        while end > paragraph.location, [10, 13].contains(value.character(at: end - 1)) { end -= 1 }
        return NSRange(location: paragraph.location, length: end - paragraph.location)
    }
}

final class QuickNotesTextView: NSTextView {
    var pasteImage: ((NSImage) -> NSTextAttachment?)?
    private var caretScrollPending = false

    static func imageFromPasteboard(_ pasteboard: NSPasteboard = .general) -> NSImage? {
        if let image = NSImage(pasteboard: pasteboard) { return image }
        for item in pasteboard.pasteboardItems ?? [] {
            for type in item.types {
                if let data = item.data(forType: type), let image = NSImage(data: data) { return image }
            }
        }
        for object in pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) ?? [] {
            if let url = (object as? NSURL)?.filePathURL, let image = NSImage(contentsOf: url) { return image }
        }
        return nil
    }

    static func canPasteImage(from pasteboard: NSPasteboard = .general) -> Bool {
        imageFromPasteboard(pasteboard) != nil
    }

    override func validateUserInterfaceItem(_ item: NSValidatedUserInterfaceItem) -> Bool {
        if item.action == #selector(paste(_:)) {
            return isEditable && Self.canPasteImage()
                || super.validateUserInterfaceItem(item)
        }
        return super.validateUserInterfaceItem(item)
    }

    override func insertText(_ insertString: Any, replacementRange: NSRange) {
        let inserted = (insertString as? NSAttributedString)?.string ?? (insertString as? String)
        let range = replacementRange.location == NSNotFound ? selectedRange() : replacementRange
        if inserted == " ", range.length == 0, applyBlockShortcut(at: range.location) { return }
        let protectedRange = protectedInsertionRange(range)
        if protectedRange != range {
            setSelectedRange(protectedRange)
            typingAttributes = baseTypingAttributes
            super.insertText(insertString, replacementRange: NSRange(location: NSNotFound, length: 0))
        } else {
            normalizeTypingAttributes()
            super.insertText(insertString, replacementRange: replacementRange)
        }
        ensureCaretVisible()
    }

    override func insertNewline(_ sender: Any?) {
        let selection = selectedRange()
        guard selection.length == 0 else {
            super.insertNewline(sender)
            ensureCaretVisible()
            return
        }
        let source = string as NSString

        if let list = listContext(at: selection.location) {
            if source.substring(with: list.content).trimmingCharacters(in: .whitespaces).isEmpty {
                if let indentUnit = indentUnitRange(in: list.indent) {
                    replaceCharacters(
                        in: indentUnit,
                        with: NSAttributedString(),
                        selection: max(list.paragraph.location, selection.location - indentUnit.length)
                    )
                } else {
                    replaceCharacters(in: list.marker, with: NSAttributedString(), selection: list.paragraph.location)
                }
            } else {
                let markerEnd = NSMaxRange(list.marker)
                let splitAt = max(selection.location, markerEnd)
                let insertion = NSMutableAttributedString(string: "\n", attributes: baseTypingAttributes)
                insertion.append(NSAttributedString(string: source.substring(with: list.indent), attributes: baseTypingAttributes))
                insertion.append(NSAttributedString(string: "• ", attributes: [.quickNoteBlock: "list"]))
                let caret = selection.location <= markerEnd ? markerEnd : splitAt + insertion.length
                replaceCharacters(
                    in: NSRange(location: splitAt, length: 0),
                    with: insertion,
                    selection: caret
                )
            }
            typingAttributes = baseTypingAttributes
            return
        }

        let paragraph = source.paragraphRange(for: NSRange(location: min(selection.location, source.length), length: 0))
        var end = NSMaxRange(paragraph)
        while end > paragraph.location, [10, 13].contains(source.character(at: end - 1)) { end -= 1 }
        let lineRange = NSRange(location: paragraph.location, length: end - paragraph.location)
        let line = source.substring(with: lineRange)

        if line.hasPrefix(QuickNoteMarkdownCodec.headingSentinel) {
            if line == QuickNoteMarkdownCodec.headingSentinel {
                replaceCharacters(
                    in: lineRange,
                    with: NSAttributedString(string: "\n", attributes: baseTypingAttributes),
                    selection: paragraph.location + 1
                )
            } else {
                replaceCharacters(
                    in: selection,
                    with: NSAttributedString(string: "\n", attributes: baseTypingAttributes),
                    selection: selection.location + 1
                )
            }
            typingAttributes = baseTypingAttributes
            return
        }
        typingAttributes = baseTypingAttributes
        super.insertNewline(sender)
        ensureCaretVisible()
    }

    override func insertTab(_ sender: Any?) {
        guard let list = listContext(at: selectedRange().location), selectedRange().length == 0,
              list.paragraph.location > 0,
              listContext(at: list.paragraph.location - 1) != nil else { return }
        replaceCharacters(
            in: NSRange(location: list.paragraph.location, length: 0),
            with: NSAttributedString(string: "    ", attributes: baseTypingAttributes),
            selection: selectedRange().location + 4
        )
        typingAttributes = baseTypingAttributes
    }

    override func insertBacktab(_ sender: Any?) {
        guard let list = listContext(at: selectedRange().location), selectedRange().length == 0,
              let indentUnit = indentUnitRange(in: list.indent) else { return }
        replaceCharacters(
            in: indentUnit,
            with: NSAttributedString(),
            selection: max(list.paragraph.location, selectedRange().location - indentUnit.length)
        )
        typingAttributes = baseTypingAttributes
    }

    override func deleteBackward(_ sender: Any?) {
        let selection = selectedRange()
        guard let list = listContext(at: selection.location) else {
            super.deleteBackward(sender)
            ensureCaretVisible()
            return
        }
        if selection.length > 0, NSIntersectionRange(selection, list.marker).length > 0 {
            let end = max(NSMaxRange(selection), NSMaxRange(list.marker))
            replaceCharacters(
                in: NSRange(location: list.paragraph.location, length: end - list.paragraph.location),
                with: NSAttributedString(),
                selection: list.paragraph.location
            )
            return
        }
        guard selection.length == 0, selection.location <= NSMaxRange(list.marker) else {
            super.deleteBackward(sender)
            ensureCaretVisible()
            return
        }
        if let indentUnit = indentUnitRange(in: list.indent) {
            replaceCharacters(
                in: indentUnit,
                with: NSAttributedString(),
                selection: max(list.paragraph.location, selection.location - indentUnit.length)
            )
        } else {
            replaceCharacters(in: list.marker, with: NSAttributedString(), selection: list.paragraph.location)
        }
    }

    override func paste(_ sender: Any?) {
        if let image = Self.imageFromPasteboard(), let attachment = pasteImage?(image) {
            let range = selectedRange()
            let insertion = NSMutableAttributedString(string: range.location == 0 ? "" : "\n")
            insertion.append(NSAttributedString(attachment: attachment))
            insertion.append(NSAttributedString(string: "\n"))
            textStorage?.replaceCharacters(in: range, with: insertion)
            setSelectedRange(NSRange(location: range.location + insertion.length, length: 0))
            didChangeText()
            ensureCaretVisible()
            return
        }
        super.paste(sender)
        ensureCaretVisible()
    }

    private var baseTypingAttributes: [NSAttributedString.Key: Any] {
        [
            .font: NSFont.systemFont(ofSize: 16),
            .foregroundColor: NSColor.quickNoteText,
        ]
    }

    private func normalizeTypingAttributes() {
        var attributes = typingAttributes
        attributes[.font] = attributes[.font] ?? NSFont.systemFont(ofSize: 16)
        attributes[.foregroundColor] = NSColor.quickNoteText
        attributes.removeValue(forKey: .quickNoteBlock)
        typingAttributes = attributes
    }

    private func ensureCaretVisible() {
        guard window != nil, !caretScrollPending else { return }
        caretScrollPending = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.caretScrollPending = false
            guard let textContainer = self.textContainer,
                  self.selectedRange().location != NSNotFound else { return }
            self.layoutManager?.ensureLayout(for: textContainer)
            self.scrollRangeToVisible(self.selectedRange())
        }
    }

    private func protectedInsertionRange(_ range: NSRange) -> NSRange {
        guard range.length == 0, let textStorage, range.location <= textStorage.length else { return range }
        let paragraph = (textStorage.string as NSString).paragraphRange(for: NSRange(location: range.location, length: 0))
        var marker: NSRange?
        textStorage.enumerateAttribute(.quickNoteBlock, in: paragraph) { block, blockRange, stop in
            guard block != nil else { return }
            marker = blockRange
            stop.pointee = true
        }
        guard let marker, range.location < NSMaxRange(marker) else { return range }
        return NSRange(location: NSMaxRange(marker), length: 0)
    }

    private func listContext(at location: Int) -> (paragraph: NSRange, indent: NSRange, marker: NSRange, content: NSRange)? {
        guard let textStorage, location <= textStorage.length else { return nil }
        let source = textStorage.string as NSString
        let paragraph = source.paragraphRange(for: NSRange(location: min(location, source.length), length: 0))
        var marker: NSRange?
        textStorage.enumerateAttribute(.quickNoteBlock, in: paragraph) { block, range, stop in
            guard block as? String == "list", range.length == 2,
                  NSMaxRange(range) <= source.length,
                  source.substring(with: range) == "• " else { return }
            marker = range
            stop.pointee = true
        }
        guard let marker, marker.location >= paragraph.location else { return nil }
        var end = NSMaxRange(paragraph)
        while end > paragraph.location, [10, 13].contains(source.character(at: end - 1)) { end -= 1 }
        return (
            paragraph,
            NSRange(location: paragraph.location, length: marker.location - paragraph.location),
            marker,
            NSRange(location: NSMaxRange(marker), length: max(0, end - NSMaxRange(marker)))
        )
    }

    private func indentUnitRange(in indent: NSRange) -> NSRange? {
        guard indent.length > 0 else { return nil }
        let source = string as NSString
        let last = source.character(at: NSMaxRange(indent) - 1)
        if last == 9 { return NSRange(location: NSMaxRange(indent) - 1, length: 1) }
        var length = 0
        var cursor = NSMaxRange(indent)
        while cursor > indent.location, length < 4, source.character(at: cursor - 1) == 32 {
            cursor -= 1
            length += 1
        }
        return length > 0 ? NSRange(location: cursor, length: length) : nil
    }

    private func applyBlockShortcut(at location: Int) -> Bool {
        let source = string as NSString
        guard location <= source.length else { return false }
        let paragraph = source.paragraphRange(for: NSRange(location: location, length: 0))
        let prefixRange = NSRange(location: paragraph.location, length: location - paragraph.location)
        let prefix = source.substring(with: prefixRange)

        if prefix.last == "-", prefix.dropLast().allSatisfy({ $0 == " " || $0 == "\t" }) {
            let bullet = NSAttributedString(string: "• ", attributes: [.quickNoteBlock: "list"])
            let marker = NSRange(location: location - 1, length: 1)
            guard replaceCharacters(in: marker, with: bullet, selection: location + 1) else { return false }
            typingAttributes = baseTypingAttributes
            return true
        }

        guard (1...6).contains(prefix.count), prefix.allSatisfy({ $0 == "#" }) else { return false }
        let sentinel = NSAttributedString(
            string: QuickNoteMarkdownCodec.headingSentinel,
            attributes: [.quickNoteBlock: "h\(prefix.count)"]
        )
        guard replaceCharacters(in: prefixRange, with: sentinel, selection: paragraph.location + 1) else { return false }
        var attributes = baseTypingAttributes
        attributes[.font] = QuickNoteMarkdownCodec.headingFont(level: prefix.count)
        typingAttributes = attributes
        return true
    }

    @discardableResult
    private func replaceCharacters(in range: NSRange, with replacement: NSAttributedString, selection: Int) -> Bool {
        guard shouldChangeText(in: range, replacementString: replacement.string), let textStorage else { return false }
        textStorage.replaceCharacters(in: range, with: replacement)
        setSelectedRange(NSRange(location: selection, length: 0))
        didChangeText()
        ensureCaretVisible()
        return true
    }
}

private struct QuickNoteEditor: NSViewRepresentable {
    @ObservedObject var store: QuickNotesStore
    let noteID: UUID

    func makeCoordinator() -> Coordinator { Coordinator(store: store) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        let editor = QuickNotesTextView(frame: .zero)
        editor.delegate = context.coordinator
        editor.drawsBackground = false
        editor.isRichText = true
        editor.importsGraphics = false
        editor.allowsUndo = true
        editor.isVerticallyResizable = true
        editor.isHorizontallyResizable = false
        editor.autoresizingMask = [.width]
        editor.textContainerInset = NSSize(width: 24, height: 24)
        editor.textContainer?.widthTracksTextView = true
        editor.textContainer?.containerSize = NSSize(width: scroll.contentSize.width, height: .greatestFiniteMagnitude)
        editor.isAutomaticQuoteSubstitutionEnabled = false
        editor.isAutomaticDashSubstitutionEnabled = false
        editor.insertionPointColor = .systemRed
        editor.pasteImage = { [weak store] image in store?.saveImage(image, for: noteID) }
        scroll.documentView = editor
        context.coordinator.editor = editor
        context.coordinator.load(noteID)
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let editor = scroll.documentView as? QuickNotesTextView else { return }
        context.coordinator.store = store
        editor.pasteImage = { [weak store] image in store?.saveImage(image, for: noteID) }
        if context.coordinator.loadedID != noteID { context.coordinator.load(noteID) }
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var store: QuickNotesStore
        weak var editor: QuickNotesTextView?
        var loadedID: UUID?
        private var styling = false

        init(store: QuickNotesStore) { self.store = store }

        func load(_ id: UUID) {
            guard let editor else { return }
            styling = true
            editor.textStorage?.setAttributedString(QuickNoteMarkdownCodec.editorValue(markdown: store.body(for: id), noteID: id, store: store))
            editor.typingAttributes = [
                .font: NSFont.systemFont(ofSize: 16),
                .foregroundColor: NSColor.quickNoteText,
            ]
            loadedID = id
            styling = false
            DispatchQueue.main.async { editor.window?.makeFirstResponder(editor) }
        }

        func textDidChange(_ notification: Notification) {
            guard !styling, let editor, let loadedID, let storage = editor.textStorage else { return }
            styling = true
            let selection = editor.selectedRanges
            QuickNoteMarkdownCodec.applySourceStyle(to: storage)
            editor.selectedRanges = selection
            styling = false
            store.updateBody(QuickNoteMarkdownCodec.markdown(from: storage), for: loadedID)
        }
    }
}

private struct QuickNotePreview: View {
    @ObservedObject var store: QuickNotesStore
    let noteID: UUID

    var body: some View {
        let markdown = store.body(for: noteID)
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ForEach(Array(QuickNoteMarkdownCodec.previewSegments(markdown: markdown).enumerated()), id: \.offset) { _, segment in
                    if let text = segment.text, !text.isEmpty {
                        Text((try? AttributedString(
                            markdown: text,
                            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
                        )) ?? AttributedString(text))
                            .font(.system(size: 16))
                            .lineSpacing(5)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else if let path = segment.imagePath, let image = store.image(noteID: noteID, relativePath: path) {
                        Image(nsImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: 680, alignment: .leading)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
            .padding(.horizontal, 26)
            .padding(.vertical, 24)
        }
    }
}

private struct QuickNotesSettingsView: View {
    @ObservedObject var shortcuts: QuickNoteShortcutSettings
    @Binding var transparency: Double
    @State private var screenCaptureAllowed = CGPreflightScreenCaptureAccess()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if transparency >= 0.45, !screenCaptureAllowed {
                    VStack(alignment: .leading, spacing: 6) {
                        Button("배경 자동 대비 허용") {
                            screenCaptureAllowed = CGRequestScreenCaptureAccess()
                        }
                        .buttonStyle(.bordered)
                        Text("시스템 모드에서 배경에 맞춰 글자색을 바꿀 때 필요합니다.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if !shortcuts.message.isEmpty {
                    Text(shortcuts.message)
                        .font(.caption)
                        .foregroundStyle(.red)
                }

                shortcutSection(Array(QuickNoteShortcutAction.allCases.prefix(6)), title: "단축키")
                shortcutSection(Array(QuickNoteShortcutAction.allCases.dropFirst(6)), title: "노트 바로 이동")
            }
            .padding(18)
        }
        .frame(width: 390, height: 560)
        .onDisappear { shortcuts.cancelCapture() }
    }

    private func shortcutSection(_ actions: [QuickNoteShortcutAction], title: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.headline)
            ForEach(actions) { action in
                HStack {
                    Text(action.title)
                    Spacer()
                    Button {
                        shortcuts.beginCapture(action)
                    } label: {
                        Text(shortcuts.capturingAction == action ? "키 입력…" : shortcuts.shortcut(for: action).display)
                            .monospaced()
                            .frame(minWidth: 72)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityLabel("\(action.title) 단축키")
                }
            }
        }
    }
}

private struct QuickNotesView: View {
    @ObservedObject var store: QuickNotesStore
    @ObservedObject var shortcuts: QuickNoteShortcutSettings
    @AppStorage(quickNotesTransparencyKey) private var transparency = 0.70
    @AppStorage(quickNotesThemeKey) private var themeRawValue = QuickNotesColorMode.dark.rawValue
    @State private var showingSettings = false

    private var colorMode: QuickNotesColorMode {
        QuickNotesColorMode(rawValue: themeRawValue) ?? .dark
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            hairline
            if let noteID = store.selectedID {
                if store.isPreviewing {
                    QuickNotePreview(store: store, noteID: noteID)
                } else {
                    QuickNoteEditor(store: store, noteID: noteID)
                }
            }
            hairline
            footer
        }
        .frame(minWidth: 440, minHeight: 360)
        .foregroundStyle(Color(nsColor: .quickNoteText))
        .background(Color(nsColor: .windowBackgroundColor).opacity(1 - transparency))
        .preferredColorScheme(colorMode.colorScheme)
        .ignoresSafeArea(.container, edges: .top)
        .onChange(of: themeRawValue) { _, newValue in
            NotificationCenter.default.post(name: quickNotesThemeChanged, object: newValue)
        }
    }

    private var hairline: some View {
        Rectangle()
            .fill(Color.primary.opacity(0.12))
            .frame(height: 0.5)
    }

    private var header: some View {
        ZStack {
            Text(store.selectedNote.map(displayTitle) ?? "새 노트")
                .font(.system(size: 14, weight: .semibold))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .center)
                .allowsHitTesting(false)
                .accessibilityLabel("현재 노트 제목")

            HStack(spacing: 0) {
                Color.clear
                    .frame(width: 74)
                Spacer(minLength: 8)
                HStack(spacing: 10) {
                    Menu {
                        ForEach(Array(store.notes.enumerated()), id: \.element.id) { index, note in
                            Button("\(index + 1). \(displayTitle(note))") { store.select(note.id) }
                        }
                        Divider()
                        Button("현재 노트 삭제", role: .destructive) { store.deleteSelected() }
                    } label: {
                        Image(systemName: "rectangle.stack")
                    }
                    .menuStyle(.borderlessButton)
                    .frame(width: 22)
                    Button(action: { store.createNote() }) { Image(systemName: "plus") }
                        .buttonStyle(.plain)
                        .help("새 노트 · \(shortcuts.shortcut(for: .newNote).display)")
                    Menu {
                        ForEach(QuickNotesColorMode.allCases) { mode in
                            Button {
                                themeRawValue = mode.rawValue
                            } label: {
                                Label(mode.title, systemImage: mode.icon)
                            }
                        }
                    } label: {
                        Image(systemName: colorMode.icon)
                    }
                    .menuStyle(.borderlessButton)
                    .frame(width: 22)
                    .help("색상 모드 · \(colorMode.title)")
                    Button(action: { showingSettings.toggle() }) { Image(systemName: "gearshape") }
                        .buttonStyle(.plain)
                        .help("Quick Notes 설정")
                        .popover(isPresented: $showingSettings, arrowEdge: .top) {
                            QuickNotesSettingsView(shortcuts: shortcuts, transparency: $transparency)
                        }
                    }
                .padding(.trailing, 14)
            }
        }
        .frame(height: 40)
    }

    private var footer: some View {
        ZStack {
            Text("\(store.selectedBody.count) characters")
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
            HStack {
                HStack(spacing: 5) {
                    Image(systemName: "circle.lefthalf.filled")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(.secondary)
                    Slider(value: $transparency, in: 0...0.85, step: 0.05)
                        .frame(width: 72)
                        .help("배경 투명도 \(Int(transparency * 100))%")
                }
                if !store.saveError.isEmpty {
                    Text(store.saveError).lineLimit(1).foregroundStyle(.red)
                }
                Spacer()
                Button(action: store.togglePreview) {
                    Text("T").font(.system(size: 15, weight: store.isPreviewing ? .bold : .regular, design: .serif))
                }
                .buttonStyle(.plain)
                .foregroundStyle(store.isPreviewing ? Color.blue : Color.secondary)
                .help("Markdown \(store.isPreviewing ? "편집" : "미리보기") · \(shortcuts.shortcut(for: .togglePreview).display)")
            }
            .padding(.horizontal, 14)
        }
        .font(.system(size: 11))
        .frame(height: 30)
    }

    private func displayTitle(_ note: QuickNoteRecord) -> String {
        let body = store.body(for: note.id)
        let firstLine = body.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        let derived = firstLine
            .replacingOccurrences(of: #"^\s*(?:#{1,6}\s+|[-*+]\s+)"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return derived.isEmpty ? "새 노트" : derived
    }
}

private final class QuickNotesTrackingView: NSView {
    var onTitlebarHover: ((Bool) -> Void)?
    private var trackingArea: NSTrackingArea?

    override func updateTrackingAreas() {
        if let trackingArea { removeTrackingArea(trackingArea) }
        let height = min(48, bounds.height)
        trackingArea = NSTrackingArea(
            rect: NSRect(x: 0, y: bounds.height - height, width: bounds.width, height: height),
            options: [.mouseEnteredAndExited, .activeAlways],
            owner: self,
            userInfo: nil
        )
        if let trackingArea { addTrackingArea(trackingArea) }
        super.updateTrackingAreas()
    }

    override func mouseEntered(with event: NSEvent) { onTitlebarHover?(true) }
    override func mouseExited(with event: NSEvent) { onTitlebarHover?(false) }
}

private extension NSPanel {
    func setQuickNotesTrafficLightsVisible(_ visible: Bool) {
        for type in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            guard let button = standardWindowButton(type) else { continue }
            button.isHidden = !visible
            button.alphaValue = visible ? 1 : 0
        }
    }
}

private final class GlobalHotKeys {
    private var handler: EventHandlerRef?
    private var reference: EventHotKeyRef?
    private var shortcut: QuickNoteShortcut?
    private let action: () -> Void

    init(action: @escaping () -> Void) { self.action = action }

    func start(with shortcut: QuickNoteShortcut) -> Bool {
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, userData in
            guard let event, let userData else { return OSStatus(eventNotHandledErr) }
            var hotKeyID = EventHotKeyID()
            let result = GetEventParameter(
                event,
                EventParamName(kEventParamDirectObject),
                EventParamType(typeEventHotKeyID),
                nil,
                MemoryLayout<EventHotKeyID>.size,
                nil,
                &hotKeyID
            )
            guard result == noErr else { return result }
            guard hotKeyID.id == 1 else { return OSStatus(eventNotHandledErr) }
            Unmanaged<GlobalHotKeys>.fromOpaque(userData).takeUnretainedValue().action()
            return noErr
        }, 1, &eventType, Unmanaged.passUnretained(self).toOpaque(), &handler)
        return update(shortcut)
    }

    deinit {
        if let reference { UnregisterEventHotKey(reference) }
        if let handler { RemoveEventHandler(handler) }
    }

    func update(_ shortcut: QuickNoteShortcut) -> Bool {
        guard self.shortcut != shortcut else { return true }
        var nextReference: EventHotKeyRef?
        let hotKeyID = EventHotKeyID(signature: quickNotesHotKeySignature, id: 1)
        guard RegisterEventHotKey(
            UInt32(shortcut.keyCode),
            shortcut.carbonModifiers,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &nextReference
        ) == noErr, let nextReference else { return false }
        if let reference { UnregisterEventHotKey(reference) }
        reference = nextReference
        self.shortcut = shortcut
        NSLog("SYGMA Quick Notes registered %@.", shortcut.display)
        return true
    }
}

@MainActor
final class QuickNotesController: NSObject, NSWindowDelegate {
    private let store: QuickNotesStore
    private let shortcuts: QuickNoteShortcutSettings
    private var panel: NSPanel?
    private var hotKeys: GlobalHotKeys?
    private var localKeyMonitor: Any?
    private var contrastTimer: Timer?
    private var themeObserver: NSObjectProtocol?
    private var suppressLocalKeysUntil = Date.distantPast
    private var suppressedToggleKeyCode: UInt16?

    override init() {
        store = QuickNotesStore()
        shortcuts = QuickNoteShortcutSettings()
        super.init()
        themeObserver = NotificationCenter.default.addObserver(
            forName: quickNotesThemeChanged,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.startContrastUpdates() }
        }
    }

    deinit {
        if let themeObserver { NotificationCenter.default.removeObserver(themeObserver) }
    }

    func start() {
        let hotKeys = GlobalHotKeys { [weak self] in
            DispatchQueue.main.async {
                self?.suppressLocalKeysUntil = Date().addingTimeInterval(0.25)
                self?.suppressedToggleKeyCode = self?.shortcuts.shortcut(for: .togglePanel).keyCode
                self?.toggle()
            }
        }
        if !hotKeys.start(with: shortcuts.shortcut(for: .togglePanel)) {
            shortcuts.fail("전역 단축키를 등록하지 못했습니다. Notes 메뉴로 열 수 있습니다.")
        }
        self.hotKeys = hotKeys
        localKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            if self.isSuppressedGlobalDuplicate(event) { return nil }
            guard self.shortcuts.capturingAction != nil || self.panel?.isKeyWindow == true else { return event }
            if self.handle(event) { return nil }
            return event.keyCode == UInt16(kVK_ANSI_W)
                && event.modifierFlags.intersection([.control, .option, .shift, .command]) == .command ? nil : event
        }
    }

    func flush() { store.flush() }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        hide()
        return false
    }

    private func panelWindow() -> NSPanel {
        if let panel { return panel }
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 496, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.identifier = quickNotesPanelIdentifier
        panel.title = "Quick Notes"
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.titlebarSeparatorStyle = .none
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isMovableByWindowBackground = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.alphaValue = 1
        panel.minSize = NSSize(width: 440, height: 360)
        panel.setFrameAutosaveName("SYGMAQuickNotesCompact")
        panel.collectionBehavior = [.canJoinAllSpaces, .canJoinAllApplications]
        applyConfiguredAppearance(to: panel)
        panel.setQuickNotesTrafficLightsVisible(false)
        let trackingView = QuickNotesTrackingView()
        trackingView.onTitlebarHover = { [weak panel] hovering in
            panel?.setQuickNotesTrafficLightsVisible(hovering)
        }
        let hostingView = NSHostingView(rootView: QuickNotesView(store: store, shortcuts: shortcuts))
        hostingView.translatesAutoresizingMaskIntoConstraints = false
        trackingView.addSubview(hostingView)
        NSLayoutConstraint.activate([
            hostingView.leadingAnchor.constraint(equalTo: trackingView.leadingAnchor),
            hostingView.trailingAnchor.constraint(equalTo: trackingView.trailingAnchor),
            hostingView.topAnchor.constraint(equalTo: trackingView.topAnchor),
            hostingView.bottomAnchor.constraint(equalTo: trackingView.bottomAnchor),
        ])
        panel.contentView = trackingView
        panel.delegate = self
        panel.center()
        if let visibleFrame = (NSScreen.screens.first { $0.frame.origin == .zero } ?? NSScreen.main)?.visibleFrame {
            var frame = panel.frame
            frame.origin.x = visibleFrame.midX - frame.width / 2
            frame.origin.y = max(visibleFrame.minY, visibleFrame.maxY - frame.height)
            panel.setFrame(frame, display: false)
        }
        self.panel = panel
        return panel
    }

    func toggle() {
        let panel = panelWindow()
        panel.isVisible ? hide() : show()
    }

    private func show() {
        let panel = panelWindow()
        applyConfiguredAppearance(to: panel)
        panel.orderFrontRegardless()
        panel.makeKeyAndOrderFront(nil)
        startContrastUpdates()
    }

    private func hide() {
        store.flush()
        contrastTimer?.invalidate()
        contrastTimer = nil
        panel?.orderOut(nil)
    }

    private func startContrastUpdates() {
        contrastTimer?.invalidate()
        applyConfiguredAppearance()
        guard panel?.isVisible == true else { return }
        guard currentColorMode == .system else { return }
        refreshContrast()
        contrastTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshContrast() }
        }
    }

    private var currentColorMode: QuickNotesColorMode {
        QuickNotesColorMode(rawValue: UserDefaults.standard.string(forKey: quickNotesThemeKey) ?? "") ?? .dark
    }

    private func applyConfiguredAppearance(to panel: NSPanel? = nil) {
        let panel = panel ?? self.panel
        guard let panel else { return }
        if let name = currentColorMode.appearance {
            panel.appearance = NSAppearance(named: name)
        } else {
            panel.appearance = nil
        }
        panel.contentView?.needsDisplay = true
    }

    private func refreshContrast() {
        guard let panel, panel.isVisible, currentColorMode == .system else { return }
        let defaults = UserDefaults.standard
        let transparency = defaults.object(forKey: quickNotesTransparencyKey) == nil
            ? 0.70
            : defaults.double(forKey: quickNotesTransparencyKey)
        guard transparency >= 0.45, CGPreflightScreenCaptureAccess() else {
            panel.appearance = nil
            return
        }
        let windowID = CGWindowID(panel.windowNumber)
        guard let info = (CGWindowListCopyWindowInfo(.optionIncludingWindow, windowID) as? [[String: Any]])?.first,
              let boundsDictionary = info[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(dictionaryRepresentation: boundsDictionary),
              let image = CGWindowListCreateImage(
                CGRect(x: bounds.midX - 24, y: bounds.midY - 24, width: 48, height: 48),
                .optionOnScreenBelowWindow,
                windowID,
                [.bestResolution]
              ) else {
            panel.appearance = nil
            return
        }
        let bitmap = NSBitmapImageRep(cgImage: image)
        var luminance: CGFloat = 0
        var count: CGFloat = 0
        for x in stride(from: 0, to: bitmap.pixelsWide, by: max(1, bitmap.pixelsWide / 4)) {
            for y in stride(from: 0, to: bitmap.pixelsHigh, by: max(1, bitmap.pixelsHigh / 4)) {
                guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                luminance += 0.2126 * color.redComponent + 0.7152 * color.greenComponent + 0.0722 * color.blueComponent
                count += 1
            }
        }
        guard count > 0 else {
            panel.appearance = nil
            return
        }
        let appearanceName: NSAppearance.Name = Self.prefersLightText(luminance: luminance / count) ? .darkAqua : .aqua
        if panel.appearance?.name != appearanceName {
            panel.appearance = NSAppearance(named: appearanceName)
            panel.contentView?.needsDisplay = true
            NSLog("SYGMA Quick Notes contrast %@ (luminance %.2f).", appearanceName.rawValue, luminance / count)
        }
    }

    static func prefersLightText(luminance: CGFloat) -> Bool { luminance < 0.52 }

    private func isSuppressedGlobalDuplicate(_ event: NSEvent) -> Bool {
        Date() < suppressLocalKeysUntil
            && event.keyCode == suppressedToggleKeyCode
            && !event.modifierFlags.intersection([.command, .option, .control]).isEmpty
    }

    private func handle(_ event: NSEvent) -> Bool {
        if let action = shortcuts.capturingAction {
            if event.isARepeat { return true }
            guard let shortcut = QuickNoteShortcut(event: event) else {
                shortcuts.fail("문자 키는 Command, Option 또는 Control과 함께 입력해 주세요.")
                return true
            }
            if let message = shortcuts.validationMessage(for: shortcut, action: action) {
                shortcuts.fail(message)
                return true
            }
            if action == .togglePanel, hotKeys?.update(shortcut) != true {
                shortcuts.fail("이미 다른 앱에서 사용 중인 전역 단축키입니다.")
                return true
            }
            shortcuts.save(shortcut, for: action)
            return true
        }

        guard let action = QuickNoteShortcutAction.allCases.first(where: {
            $0 != .togglePanel && shortcuts.shortcut(for: $0).matches(event)
        }) else {
            return false
        }
        if event.isARepeat { return true }
        switch action {
        case .togglePanel: break
        case .newNote: store.createNote()
        case .previousNote: store.select(offset: -1)
        case .nextNote: store.select(offset: 1)
        case .togglePreview: store.togglePreview()
        case .hidePanel: hide()
        case .note1, .note2, .note3, .note4, .note5, .note6, .note7, .note8, .note9:
            store.select(number: action.noteNumber!)
        }
        return true
    }
}
