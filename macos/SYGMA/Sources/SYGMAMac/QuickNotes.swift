import AppKit
import Carbon.HIToolbox
import Combine
import SwiftUI

private let quickNotesPanelIdentifier = NSUserInterfaceItemIdentifier("SYGMAQuickNotesPanel")
private let quickNotesHotKeySignature: OSType = 0x5359474E // SYGN

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

enum QuickNoteMarkdownCodec {
    static let headingSentinel = "\u{200B}"
    private static let imagePattern = try! NSRegularExpression(
        pattern: #"!\[([^\]]*)\]\((assets/[0-9a-fA-F-]{36}\.png)\)"#
    )
    private static let headingPattern = try! NSRegularExpression(pattern: #"(?m)^(#{1,6})[ \t]+"#)
    private static let listPattern = try! NSRegularExpression(pattern: #"(?m)^-[ \t]+"#)

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
                value.insert(NSAttributedString(string: "- "), at: location)
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
            .foregroundColor: NSColor(calibratedWhite: 0.92, alpha: 1),
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
                .backgroundColor: NSColor(calibratedWhite: 0.28, alpha: 1),
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
            value.replaceCharacters(in: match.range, with: "• ")
            value.addAttribute(.quickNoteBlock, value: "list", range: NSRange(location: match.range.location, length: 2))
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
            super.insertText(insertString, replacementRange: replacementRange)
        }
    }

    override func insertNewline(_ sender: Any?) {
        let selection = selectedRange()
        guard selection.length == 0 else { super.insertNewline(sender); return }
        let source = string as NSString
        let paragraph = source.paragraphRange(for: NSRange(location: min(selection.location, source.length), length: 0))
        var end = NSMaxRange(paragraph)
        while end > paragraph.location, [10, 13].contains(source.character(at: end - 1)) { end -= 1 }
        let lineRange = NSRange(location: paragraph.location, length: end - paragraph.location)
        let line = source.substring(with: lineRange)

        if line.hasPrefix("• ") {
            if line.dropFirst(2).trimmingCharacters(in: .whitespaces).isEmpty {
                replaceCharacters(in: NSRange(location: paragraph.location, length: 2), with: NSAttributedString(), selection: paragraph.location)
            } else {
                let markerEnd = paragraph.location + 2
                let splitAt = max(selection.location, markerEnd)
                let insertion = NSMutableAttributedString(string: "\n", attributes: baseTypingAttributes)
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
        super.insertNewline(sender)
    }

    override func paste(_ sender: Any?) {
        if let image = NSImage(pasteboard: .general), let attachment = pasteImage?(image) {
            let range = selectedRange()
            let insertion = NSMutableAttributedString(string: range.location == 0 ? "" : "\n")
            insertion.append(NSAttributedString(attachment: attachment))
            insertion.append(NSAttributedString(string: "\n"))
            textStorage?.replaceCharacters(in: range, with: insertion)
            setSelectedRange(NSRange(location: range.location + insertion.length, length: 0))
            didChangeText()
            return
        }
        super.paste(sender)
    }

    private var baseTypingAttributes: [NSAttributedString.Key: Any] {
        [
            .font: NSFont.systemFont(ofSize: 16),
            .foregroundColor: NSColor(calibratedWhite: 0.92, alpha: 1),
        ]
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

    private func applyBlockShortcut(at location: Int) -> Bool {
        let source = string as NSString
        guard location <= source.length else { return false }
        let paragraph = source.paragraphRange(for: NSRange(location: location, length: 0))
        let prefixRange = NSRange(location: paragraph.location, length: location - paragraph.location)
        let prefix = source.substring(with: prefixRange)

        if prefix == "-" {
            let bullet = NSAttributedString(string: "• ", attributes: [.quickNoteBlock: "list"])
            guard replaceCharacters(in: prefixRange, with: bullet, selection: paragraph.location + 2) else { return false }
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
                .foregroundColor: NSColor(calibratedWhite: 0.92, alpha: 1),
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

private struct QuickNotesView: View {
    @ObservedObject var store: QuickNotesStore

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Color.white.opacity(0.08))
            if let noteID = store.selectedID {
                if store.isPreviewing {
                    QuickNotePreview(store: store, noteID: noteID)
                } else {
                    QuickNoteEditor(store: store, noteID: noteID)
                }
            }
            Divider().overlay(Color.white.opacity(0.08))
            footer
        }
        .frame(minWidth: 440, minHeight: 360)
        .background(Color(nsColor: NSColor(calibratedWhite: 0.20, alpha: 1)))
        .preferredColorScheme(.dark)
    }

    private var header: some View {
        ZStack {
            TextField("제목", text: Binding(
                get: { store.selectedNote?.title ?? "" },
                set: store.renameSelected
            ))
            .textFieldStyle(.plain)
            .font(.system(size: 13, weight: .medium))
            .multilineTextAlignment(.center)
            .frame(width: 230)

            HStack(spacing: 10) {
                Text("⌥⌘N").font(.system(size: 11, weight: .medium, design: .rounded)).foregroundStyle(.secondary)
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
                    .help("새 노트 · ⌘N")
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.trailing, 14)
        }
        .frame(height: 40)
    }

    private var footer: some View {
        ZStack {
            Text("\(store.selectedBody.count) characters")
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
            HStack {
                if !store.saveError.isEmpty {
                    Text(store.saveError).lineLimit(1).foregroundStyle(.red)
                }
                Spacer()
                Button(action: store.togglePreview) {
                    Text("T").font(.system(size: 15, weight: store.isPreviewing ? .bold : .regular, design: .serif))
                }
                .buttonStyle(.plain)
                .foregroundStyle(store.isPreviewing ? Color.blue : Color.secondary)
                .help("Markdown \(store.isPreviewing ? "편집" : "미리보기") · ⌘⇧M")
            }
            .padding(.horizontal, 14)
        }
        .font(.system(size: 11))
        .frame(height: 30)
    }

    private func displayTitle(_ note: QuickNoteRecord) -> String {
        let title = note.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !title.isEmpty { return title }
        let body = store.body(for: note.id)
        return body.split(whereSeparator: \.isNewline).first.map(String.init) ?? "새 노트"
    }
}

private final class GlobalHotKeys {
    private var handler: EventHandlerRef?
    private var references: [EventHotKeyRef] = []
    private let action: (UInt32) -> Void

    init(action: @escaping (UInt32) -> Void) { self.action = action }

    func start() {
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
            Unmanaged<GlobalHotKeys>.fromOpaque(userData).takeUnretainedValue().action(hotKeyID.id)
            return noErr
        }, 1, &eventType, Unmanaged.passUnretained(self).toOpaque(), &handler)

        if register(id: 1, key: UInt32(kVK_ANSI_N)) {
            NSLog("SYGMA Quick Notes registered ⌥⌘N.")
        } else {
            NSLog("SYGMA Quick Notes could not register ⌥⌘N; use the Notes menu instead.")
        }
    }

    deinit {
        for reference in references { UnregisterEventHotKey(reference) }
        if let handler { RemoveEventHandler(handler) }
    }

    private func register(id: UInt32, key: UInt32) -> Bool {
        var reference: EventHotKeyRef?
        let hotKeyID = EventHotKeyID(signature: quickNotesHotKeySignature, id: id)
        if RegisterEventHotKey(key, UInt32(cmdKey | optionKey), hotKeyID, GetApplicationEventTarget(), 0, &reference) == noErr,
           let reference {
            references.append(reference)
            return true
        }
        return false
    }
}

@MainActor
final class QuickNotesController: NSObject, NSWindowDelegate {
    private let store: QuickNotesStore
    private var panel: NSPanel?
    private var hotKeys: GlobalHotKeys?
    private var localKeyMonitor: Any?
    private var previousApplication: NSRunningApplication?

    override init() {
        store = QuickNotesStore()
        super.init()
    }

    func start() {
        let hotKeys = GlobalHotKeys { [weak self] id in
            DispatchQueue.main.async {
                guard let self else { return }
                if id == 1 { self.toggle() }
            }
        }
        hotKeys.start()
        self.hotKeys = hotKeys
        localKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, self.panel?.isKeyWindow == true else { return event }
            return self.handle(event) ? nil : event
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
            contentRect: NSRect(x: 0, y: 0, width: 620, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
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
        panel.backgroundColor = NSColor(calibratedWhite: 0.20, alpha: 1)
        panel.minSize = NSSize(width: 440, height: 360)
        panel.setFrameAutosaveName("SYGMAQuickNotes")
        panel.collectionBehavior = [.canJoinAllSpaces, .canJoinAllApplications]
        panel.contentViewController = NSHostingController(rootView: QuickNotesView(store: store))
        panel.delegate = self
        panel.center()
        self.panel = panel
        return panel
    }

    func toggle() {
        let panel = panelWindow()
        panel.isVisible ? hide() : show()
    }

    private func show() {
        let panel = panelWindow()
        previousApplication = NSWorkspace.shared.frontmostApplication
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
    }

    private func hide() {
        let restorePreviousApplication = panel?.isKeyWindow == true && NSApp.isActive
        store.flush()
        panel?.orderOut(nil)
        if restorePreviousApplication { previousApplication?.activate() }
    }

    private func handle(_ event: NSEvent) -> Bool {
        if event.keyCode == UInt16(kVK_Escape) { hide(); return true }
        guard event.modifierFlags.intersection(.deviceIndependentFlagsMask).contains(.command) else { return false }
        if event.charactersIgnoringModifiers == "n" { store.createNote(); return true }
        if event.charactersIgnoringModifiers == "[" { store.select(offset: -1); return true }
        if event.charactersIgnoringModifiers == "]" { store.select(offset: 1); return true }
        if event.charactersIgnoringModifiers == "m", event.modifierFlags.contains(.shift) { store.togglePreview(); return true }
        if let value = Int(event.charactersIgnoringModifiers ?? ""), (1...9).contains(value) { store.select(number: value); return true }
        return false
    }
}
