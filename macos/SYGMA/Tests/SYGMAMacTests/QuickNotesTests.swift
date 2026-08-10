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
}
