import AppKit
import Carbon.HIToolbox
import XCTest
@testable import SYGMAMac

final class QuickNotesTests: XCTestCase {
    @MainActor
    func testImagePasteboardDecoderHandlesImageDataAndFileURLs() throws {
        let image = NSImage(size: NSSize(width: 4, height: 4))
        image.lockFocus()
        NSColor.systemBlue.setFill()
        NSRect(x: 0, y: 0, width: 4, height: 4).fill()
        image.unlockFocus()
        let pasteboard = try XCTUnwrap(NSPasteboard(name: NSPasteboard.Name("SYGMAQuickNotesTests-\(UUID())")))
        XCTAssertTrue(pasteboard.setData(try XCTUnwrap(image.tiffRepresentation), forType: .tiff))
        XCTAssertNotNil(QuickNotesTextView.imageFromPasteboard(pasteboard))

        let imageURL = FileManager.default.temporaryDirectory.appendingPathComponent("clip-\(UUID()).png")
        defer { try? FileManager.default.removeItem(at: imageURL) }
        let png = try XCTUnwrap(NSBitmapImageRep(data: try XCTUnwrap(image.tiffRepresentation)))
            .representation(using: .png, properties: [:])
        try XCTUnwrap(png).write(to: imageURL, options: .atomic)
        pasteboard.clearContents()
        XCTAssertTrue(pasteboard.writeObjects([imageURL as NSURL]))
        XCTAssertNotNil(QuickNotesTextView.imageFromPasteboard(pasteboard))
    }

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
        XCTAssertEqual(backspacedList.string, "항목")
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: try XCTUnwrap(backspacedList.textStorage)), "항목")

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

    @MainActor
    func testNestedListIndentationRoundTripAndEditing() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("sygma-nested-list-\(UUID())", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = QuickNotesStore(rootURL: root)
        let noteID = try XCTUnwrap(store.selectedID)
        let markdown = "- parent\n  - child\n\t- tab\n    - four\n"
        let restored = QuickNoteMarkdownCodec.editorValue(markdown: markdown, noteID: noteID, store: store)
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: restored), markdown)

        let editor = QuickNotesTextView(frame: .zero)
        editor.allowsUndo = true
        editor.textStorage?.setAttributedString(QuickNoteMarkdownCodec.editorValue(
            markdown: "- parent\n- child",
            noteID: noteID,
            store: store
        ))
        editor.setSelectedRange(NSRange(location: (editor.string as NSString).length, length: 0))
        editor.insertTab(nil)
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: try XCTUnwrap(editor.textStorage)), "- parent\n    - child")
        editor.insertText("typed", replacementRange: editor.selectedRange())
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: try XCTUnwrap(editor.textStorage)), "- parent\n    - childtyped")
        let typedColor = try XCTUnwrap(editor.textStorage?.attribute(.foregroundColor, at: editor.selectedRange().location - 1, effectiveRange: nil) as? NSColor)
        XCTAssertFalse(typedColor.isEqual(NSColor.systemBlue))
        editor.insertNewline(nil)
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: try XCTUnwrap(editor.textStorage)), "- parent\n    - childtyped\n    - ")
        editor.insertText("after", replacementRange: editor.selectedRange())
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: try XCTUnwrap(editor.textStorage)), "- parent\n    - childtyped\n    - after")
        let afterColor = try XCTUnwrap(editor.textStorage?.attribute(.foregroundColor, at: editor.selectedRange().location - 1, effectiveRange: nil) as? NSColor)
        XCTAssertFalse(afterColor.isEqual(NSColor.systemBlue))
        editor.insertBacktab(nil)
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: try XCTUnwrap(editor.textStorage)), "- parent\n    - childtyped\n- after")

        let first = QuickNotesTextView(frame: .zero)
        first.textStorage?.setAttributedString(QuickNoteMarkdownCodec.editorValue(markdown: "- only", noteID: noteID, store: store))
        first.setSelectedRange(NSRange(location: 2, length: 0))
        first.insertTab(nil)
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: try XCTUnwrap(first.textStorage)), "- only")

        let nested = QuickNotesTextView(frame: .zero)
        nested.textStorage?.setAttributedString(QuickNoteMarkdownCodec.editorValue(markdown: "- parent\n  - child", noteID: noteID, store: store))
        nested.setSelectedRange(NSRange(location: 13, length: 0))
        nested.deleteBackward(nil)
        XCTAssertEqual(QuickNoteMarkdownCodec.markdown(from: try XCTUnwrap(nested.textStorage)), "- parent\n- child")
    }

    @MainActor
    func testShortcutSettingsAndAdaptiveTextColor() throws {
        let suite = "SYGMAQuickNotesTests.\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        var legacy = Dictionary(uniqueKeysWithValues: QuickNoteShortcutSettings.defaultShortcuts.map { ($0.key.rawValue, $0.value) })
        legacy[QuickNoteShortcutAction.hidePanel.rawValue] = QuickNoteShortcut(keyCode: UInt16(kVK_Escape), modifiers: [], key: "Esc")
        defaults.set(try JSONEncoder().encode(legacy), forKey: "SYGMAQuickNotesShortcutsV1")
        let settings = QuickNoteShortcutSettings(defaults: defaults)

        XCTAssertEqual(settings.shortcut(for: .hidePanel).display, "⌘W")
        XCTAssertNotNil(defaults.data(forKey: "SYGMAQuickNotesShortcutsV2"))
        XCTAssertEqual(settings.shortcut(for: .note1).display, "⌘1")
        XCTAssertEqual(settings.shortcut(for: .note9).display, "⌘9")
        XCTAssertEqual(QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_N), modifiers: .command, key: "ㅜ").display, "⌘N")
        XCTAssertEqual(Set(QuickNoteShortcutAction.allCases.map(settings.shortcut)).count, QuickNoteShortcutAction.allCases.count)
        XCTAssertNotNil(settings.validationMessage(for: settings.shortcut(for: .note1), action: .note2))

        let custom = QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_P), modifiers: [.command, .option], key: "P")
        settings.save(custom, for: .newNote)
        XCTAssertEqual(QuickNoteShortcutSettings(defaults: defaults).shortcut(for: .newNote), custom)

        let escape = QuickNoteShortcut(keyCode: UInt16(kVK_Escape), modifiers: [], key: "Esc")
        settings.save(escape, for: .hidePanel)
        XCTAssertEqual(QuickNoteShortcutSettings(defaults: defaults).shortcut(for: .hidePanel), escape)

        defaults.removeObject(forKey: "SYGMAQuickNotesShortcutsV2")
        legacy[QuickNoteShortcutAction.newNote.rawValue] = QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_W), modifiers: .command, key: "W")
        defaults.set(try JSONEncoder().encode(legacy), forKey: "SYGMAQuickNotesShortcutsV1")
        let conflictSettings = QuickNoteShortcutSettings(defaults: defaults)
        XCTAssertEqual(conflictSettings.shortcut(for: .hidePanel), escape)
        XCTAssertEqual(conflictSettings.shortcut(for: .newNote).display, "⌘W")

        let plainLetter = try XCTUnwrap(NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: [],
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            characters: "p",
            charactersIgnoringModifiers: "p",
            isARepeat: false,
            keyCode: UInt16(kVK_ANSI_P)
        ))
        XCTAssertNil(QuickNoteShortcut(event: plainLetter))

        func colorComponents(_ appearanceName: NSAppearance.Name) -> (white: CGFloat, alpha: CGFloat) {
            var white: CGFloat = -1
            var alpha: CGFloat = -1
            NSAppearance(named: appearanceName)?.performAsCurrentDrawingAppearance {
                NSColor.quickNoteText.usingColorSpace(.deviceGray)?.getWhite(&white, alpha: &alpha)
            }
            return (white, alpha)
        }
        let light = colorComponents(.aqua)
        let dark = colorComponents(.darkAqua)
        XCTAssertEqual(light.white, 0, accuracy: 0.01)
        XCTAssertEqual(dark.white, 1, accuracy: 0.01)
        XCTAssertEqual(light.alpha, 1, accuracy: 0.01)
        XCTAssertEqual(dark.alpha, 1, accuracy: 0.01)
        XCTAssertTrue(QuickNotesController.prefersLightText(luminance: 0.1))
        XCTAssertFalse(QuickNotesController.prefersLightText(luminance: 0.9))

        XCTAssertEqual(QuickNotesColorMode.dark.appearance, .darkAqua)
        XCTAssertEqual(QuickNotesColorMode.light.appearance, .aqua)
        XCTAssertNil(QuickNotesColorMode.system.appearance)
    }
}
