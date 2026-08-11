import AppKit
import XCTest
@testable import SYGMAMac

final class QuickNotesTests: XCTestCase {
    @MainActor
    func testMarkdownImageAndPersistenceRoundTrip() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("sygma-notes-\(UUID())", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let store = QuickNotesStore(rootURL: root)
        let noteID = try XCTUnwrap(store.selectedID)
        store.renameSelected("테스트")

        let image = NSImage(size: NSSize(width: 4, height: 4))
        image.lockFocus()
        NSColor.systemBlue.setFill()
        NSRect(x: 0, y: 0, width: 4, height: 4).fill()
        image.unlockFocus()
        let attachment = try XCTUnwrap(store.saveImage(image, for: noteID))
        let value = NSMutableAttributedString(string: "# 제목\n\n")
        value.append(NSAttributedString(attachment: attachment))
        let markdown = QuickNoteMarkdownCodec.markdown(from: value)
        XCTAssertTrue(markdown.contains("![image](assets/"))

        let restored = QuickNoteMarkdownCodec.editorValue(markdown: markdown, noteID: noteID, store: store)
        var restoredImage = false
        restored.enumerateAttribute(.attachment, in: NSRange(location: 0, length: restored.length)) { value, _, _ in
            restoredImage = restoredImage || value is QuickNoteImageAttachment
        }
        XCTAssertTrue(restoredImage)
        XCTAssertNil(store.assetURL(noteID: noteID, relativePath: "assets/../../outside.png"))

        store.updateBody(markdown, for: noteID)
        store.flush()
        let reloaded = QuickNotesStore(rootURL: root)
        XCTAssertEqual(reloaded.selectedNote?.title, "테스트")
        XCTAssertEqual(reloaded.body(for: noteID), markdown)

        try Data("{".utf8).write(to: root.appendingPathComponent("index.json"), options: .atomic)
        let recovered = QuickNotesStore(rootURL: root)
        XCTAssertEqual(recovered.selectedID, noteID)
        XCTAssertEqual(recovered.selectedNote?.title, "제목")
        XCTAssertEqual(recovered.body(for: noteID), markdown)
        XCTAssertEqual(
            try FileManager.default.contentsOfDirectory(atPath: root.path).filter { $0.hasPrefix("index.corrupt-") }.count,
            1
        )
    }

    @MainActor
    func testLiveMarkdownBlockShortcutsAndPersistenceRoundTrip() throws {
        func insert(_ value: String, into editor: QuickNotesTextView) {
            editor.insertText(value, replacementRange: editor.selectedRange())
        }

        let heading = QuickNotesTextView(frame: .zero)
        let headingWindow = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 300, height: 200), styleMask: [], backing: .buffered, defer: false)
        headingWindow.contentView = heading
        heading.allowsUndo = true
        heading.string = "#"
        heading.setSelectedRange(NSRange(location: 1, length: 0))
        insert(" ", into: heading)
        XCTAssertEqual(heading.string, QuickNoteMarkdownCodec.headingSentinel)
        XCTAssertEqual(heading.selectedRange(), NSRange(location: 1, length: 0))
        XCTAssertEqual((heading.typingAttributes[.font] as? NSFont)?.pointSize, 25)

        let undoManager = try XCTUnwrap(heading.undoManager)
        undoManager.undo()
        XCTAssertEqual(heading.string, "#")
        undoManager.redo()
        XCTAssertEqual(heading.string, QuickNoteMarkdownCodec.headingSentinel)
        heading.setSelectedRange(NSRange(location: 1, length: 0))
        insert("제목", into: heading)
        XCTAssertEqual(heading.string.replacingOccurrences(of: QuickNoteMarkdownCodec.headingSentinel, with: ""), "제목")
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: try XCTUnwrap(heading.textStorage)), "# 제목")

        heading.setSelectedRange(NSRange(location: 0, length: 0))
        heading.insertNewline(nil)
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: try XCTUnwrap(heading.textStorage)), "\n# 제목")

        let list = QuickNotesTextView(frame: .zero)
        list.string = "-"
        list.setSelectedRange(NSRange(location: 1, length: 0))
        insert(" ", into: list)
        XCTAssertEqual(list.string, "• ")
        XCTAssertEqual(list.selectedRange(), NSRange(location: 2, length: 0))

        insert("항목", into: list)
        list.insertNewline(nil)
        XCTAssertEqual(list.string, "• 항목\n• ")
        XCTAssertEqual(list.selectedRange(), NSRange(location: 7, length: 0))
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: try XCTUnwrap(list.textStorage)), "- 항목\n- ")

        list.insertNewline(nil)
        XCTAssertEqual(list.string, "• 항목\n")
        XCTAssertEqual(list.selectedRange(), NSRange(location: 5, length: 0))
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: try XCTUnwrap(list.textStorage)), "- 항목\n")

        let listAtStart = QuickNotesTextView(frame: .zero)
        let listValue = NSMutableAttributedString(string: "• 항목")
        listValue.addAttribute(.quickNoteBlock, value: "list", range: NSRange(location: 0, length: 2))
        listAtStart.textStorage?.setAttributedString(listValue)
        listAtStart.setSelectedRange(NSRange(location: 0, length: 0))
        listAtStart.insertNewline(nil)
        XCTAssertEqual(listAtStart.string, "• \n• 항목")
        XCTAssertEqual(listAtStart.selectedRange(), NSRange(location: 2, length: 0))
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: try XCTUnwrap(listAtStart.textStorage)), "- \n- 항목")

        let displacedHeading = NSMutableAttributedString(string: "x")
        displacedHeading.append(NSAttributedString(string: QuickNoteMarkdownCodec.headingSentinel, attributes: [.quickNoteBlock: "h1"]))
        displacedHeading.append(NSAttributedString(string: "제목"))
        let displacedHeadingMarkdown = QuickNoteMarkdownCodec.markdown(from: displacedHeading)
        XCTAssertEqual(displacedHeadingMarkdown, "# x제목")
        XCTAssertFalse(displacedHeadingMarkdown.contains(QuickNoteMarkdownCodec.headingSentinel))

        let protectedHeading = QuickNotesTextView(frame: .zero)
        let protectedHeadingValue = NSMutableAttributedString(
            string: QuickNoteMarkdownCodec.headingSentinel,
            attributes: [.quickNoteBlock: "h1"]
        )
        protectedHeadingValue.append(NSAttributedString(string: "제목"))
        protectedHeading.textStorage?.setAttributedString(protectedHeadingValue)
        protectedHeading.setSelectedRange(NSRange(location: 0, length: 0))
        insert("y", into: protectedHeading)
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: try XCTUnwrap(protectedHeading.textStorage)), "# y제목")

        let protectedList = QuickNotesTextView(frame: .zero)
        let protectedListValue = NSMutableAttributedString(string: "• 항목")
        protectedListValue.addAttribute(.quickNoteBlock, value: "list", range: NSRange(location: 0, length: 2))
        protectedList.textStorage?.setAttributedString(protectedListValue)
        protectedList.setSelectedRange(NSRange(location: 0, length: 0))
        insert("x", into: protectedList)
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: try XCTUnwrap(protectedList.textStorage)), "- x항목")

        let damagedList = NSMutableAttributedString(string: "•항목")
        damagedList.addAttribute(.quickNoteBlock, value: "list", range: NSRange(location: 0, length: 1))
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: damagedList), "•항목")

        let backspacedList = QuickNotesTextView(frame: .zero)
        let backspacedListValue = NSMutableAttributedString(string: "• 항목")
        backspacedListValue.addAttribute(.quickNoteBlock, value: "list", range: NSRange(location: 0, length: 2))
        backspacedList.textStorage?.setAttributedString(backspacedListValue)
        backspacedList.setSelectedRange(NSRange(location: 2, length: 0))
        backspacedList.deleteBackward(nil)
        XCTAssertEqual(backspacedList.string, "•항목")
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: try XCTUnwrap(backspacedList.textStorage)), "•항목")

        let damagedEmptyList = NSMutableAttributedString(string: "•")
        damagedEmptyList.addAttribute(.quickNoteBlock, value: "list", range: NSRange(location: 0, length: 1))
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: damagedEmptyList), "•")

        let damagedHeading = NSMutableAttributedString(string: "제목")
        damagedHeading.addAttribute(.quickNoteBlock, value: "h1", range: NSRange(location: 0, length: 1))
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: damagedHeading), "제목")

        let root = FileManager.default.temporaryDirectory.appendingPathComponent("sygma-live-markdown-\(UUID())", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = QuickNotesStore(rootURL: root)
        let noteID = try XCTUnwrap(store.selectedID)
        let persisted = "# 제목\n- 항목\n"
        store.updateBody(persisted, for: noteID)
        store.flush()

        let reloaded = QuickNotesStore(rootURL: root)
        let restored = QuickNoteMarkdownCodec.editorValue(markdown: reloaded.body(for: noteID), noteID: noteID, store: reloaded)
        XCTAssertEqual(restored.string.replacingOccurrences(of: QuickNoteMarkdownCodec.headingSentinel, with: ""), "제목\n• 항목\n")
        XCTAssertEqual((restored.attribute(.font, at: 1, effectiveRange: nil) as? NSFont)?.pointSize, 25)
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: restored), persisted)

        let emptyHeading = QuickNoteMarkdownCodec.editorValue(markdown: "# \n", noteID: noteID, store: reloaded)
        XCTAssertEqual(emptyHeading.string, "\(QuickNoteMarkdownCodec.headingSentinel)\n")
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: emptyHeading), "# \n")
    }
}
