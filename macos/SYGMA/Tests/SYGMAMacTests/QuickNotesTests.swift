import AppKit
import Carbon.HIToolbox
import XCTest
@testable import SYGMAMac

final class QuickNotesTests: XCTestCase {
    @MainActor
    func testWorkspaceBridgeReloadFlushesBeforeInvokingCurrentWebViewHandler() async {
        var events: [String] = []
        SYGMAWorkspaceBridge.flushHandler = {
            events.append("flush")
            return true
        }
        SYGMAWorkspaceBridge.reloadHandler = { events.append("reload") }
        defer {
            SYGMAWorkspaceBridge.flushHandler = nil
            SYGMAWorkspaceBridge.reloadHandler = nil
        }

        let reloaded = await SYGMAWorkspaceBridge.reloadCurrentPage()

        XCTAssertTrue(reloaded)
        XCTAssertEqual(events, ["flush", "reload"])
    }

    @MainActor
    func testWorkspaceBridgeReloadStopsWhenFlushFails() async {
        var reloadCount = 0
        SYGMAWorkspaceBridge.flushHandler = { false }
        SYGMAWorkspaceBridge.reloadHandler = { reloadCount += 1 }
        defer {
            SYGMAWorkspaceBridge.flushHandler = nil
            SYGMAWorkspaceBridge.reloadHandler = nil
        }

        let reloaded = await SYGMAWorkspaceBridge.reloadCurrentPage()

        XCTAssertFalse(reloaded)
        XCTAssertEqual(reloadCount, 0)
    }

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
        XCTAssertTrue(QuickNotesTextView.canPasteImage(from: pasteboard))

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
    func testSharedEditorBlocksPersistBesideMarkdownWithoutReplacingIt() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("sygma-editor-blocks-\(UUID())", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = QuickNotesStore(rootURL: root)
        let noteID = try XCTUnwrap(store.selectedID)
        let markdown = "# 제목\n본문"
        let blocks: [[String: Any]] = [[
            "id": "block-1",
            "type": "paragraph",
            "text": "본문",
            "marks": [["type": "bold", "start": 0, "end": 2]],
        ]]

        store.updateBody(markdown, blocks: blocks, for: noteID)
        store.flush()

        let directory = root.appendingPathComponent("notes/\(noteID.uuidString.lowercased())")
        XCTAssertEqual(try String(contentsOf: directory.appendingPathComponent("note.md"), encoding: .utf8), markdown)
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.appendingPathComponent("editor.json").path))
        let restored = QuickNotesStore(rootURL: root)
        let restoredBlocks = try XCTUnwrap(restored.blocks(for: noteID) as? [[String: Any]])
        XCTAssertEqual(restoredBlocks.first?["id"] as? String, "block-1")
        XCTAssertEqual(((restoredBlocks.first?["marks"] as? [[String: Any]])?.first)?["type"] as? String, "bold")
    }

    @MainActor
    func testQuickEditorLocalSelectionClearsResourceState() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("sygma-editor-session-\(UUID())", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = QuickNotesStore(rootURL: root)
        let session = QuickMemoEditorSession(store: store)
        store.isPreviewing = true

        session.handleBridgeMessage([
            "type": "resourceSelected",
            "id": "resource-1",
            "title": "자료 제목",
            "characterCount": 23,
        ])
        XCTAssertTrue(session.isResourceOpen)
        XCTAssertFalse(store.isPreviewing)
        XCTAssertEqual(session.resourceTitle, "자료 제목")
        XCTAssertEqual(session.characterCount, 23)

        session.handleBridgeMessage([
            "type": "localSelected",
            "id": store.selectedID?.uuidString.lowercased() ?? "",
            "title": "로컬 메모",
            "characterCount": 7,
        ])
        XCTAssertFalse(session.isResourceOpen)
        XCTAssertEqual(session.resourceTitle, "")
        XCTAssertEqual(session.characterCount, 7)
    }

    @MainActor
    func testLocalImageBridgeValidatesAndLoadsOnlyReferencedPNGAssets() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("sygma-local-image-bridge-\(UUID())", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = QuickNotesStore(rootURL: root)
        let noteID = try XCTUnwrap(store.selectedID)
        let image = NSImage(size: NSSize(width: 4, height: 4))
        image.lockFocus()
        NSColor.systemBlue.setFill()
        NSRect(x: 0, y: 0, width: 4, height: 4).fill()
        image.unlockFocus()
        let bitmap = try XCTUnwrap(NSBitmapImageRep(data: try XCTUnwrap(image.tiffRepresentation)))
        let png = try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
        let jpeg = try XCTUnwrap(bitmap.representation(using: .jpeg, properties: [:]))
        let dataURL = "data:image/png;base64,\(png.base64EncodedString())"

        let saved = try XCTUnwrap(store.saveLocalImage(dataURL: dataURL, for: noteID))
        _ = try XCTUnwrap(store.saveImage(image, for: noteID))
        store.updateBody("![image](\(saved.path))", blocks: [["id": "image", "type": "image", "url": saved.path]], for: noteID)
        let assets = store.localAssetDataURLs(for: noteID)
        XCTAssertEqual(assets.count, 1)
        XCTAssertEqual(assets[saved.path], saved.dataURL)
        let savedJPEG = try XCTUnwrap(store.saveLocalImage(
            dataURL: "data:image/jpeg;base64,\(jpeg.base64EncodedString())",
            for: noteID
        ))
        XCTAssertTrue(savedJPEG.path.hasSuffix(".png"))
        XCTAssertTrue(savedJPEG.dataURL.hasPrefix("data:image/png;base64,"))
        let savedJPEGURL = try XCTUnwrap(store.assetURL(noteID: noteID, relativePath: savedJPEG.path))
        XCTAssertTrue(try Data(contentsOf: savedJPEGURL).starts(with: [0x89, 0x50, 0x4E, 0x47]))
        XCTAssertNil(store.saveLocalImage(dataURL: "data:image/jpeg;base64,\(png.base64EncodedString())", for: noteID))
        XCTAssertNil(store.saveLocalImage(dataURL: "data:image/png;base64,not-base64", for: noteID))
        XCTAssertNil(store.saveLocalImage(dataURL: dataURL, for: UUID()))

        let session = QuickMemoEditorSession(store: store)
        session.loadLocal(noteID, revision: store.contentRevision)
        session.handleBridgeMessage(["type": "ready"])
        let assetsDirectory = root.appendingPathComponent("notes/\(noteID.uuidString.lowercased())/assets")
        let before = try FileManager.default.contentsOfDirectory(atPath: assetsDirectory.path).count
        session.handleBridgeMessage([
            "type": "saveLocalImage",
            "requestId": "wrong-note",
            "id": UUID().uuidString.lowercased(),
            "dataURL": dataURL,
        ])
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: assetsDirectory.path).count, before)
        session.handleBridgeMessage([
            "type": "saveLocalImage",
            "requestId": "valid-note",
            "id": noteID.uuidString.lowercased(),
            "dataURL": dataURL,
        ])
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: assetsDirectory.path).count, before + 1)
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
    func testInboxCaptureStateMutationPreservesWorkspace() throws {
        let boxID = "box-one"
        let projectID = "project-one"
        var state: [String: Any] = [
            "captures": [["id": "capture-existing", "title": "기존 Inbox"]],
            "tasks": [["id": "task-existing", "title": "기존 Task"]],
            "boxes": [["id": boxID, "name": "업무"]],
            "projects": [["id": projectID, "name": "출시", "boxId": boxID]],
            "futureField": ["keep": true],
            "updatedAt": "2026-08-01T00:00:00.000Z",
        ]
        let captureID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let taskID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let blockID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        let date = Date(timeIntervalSince1970: 1_786_426_800)

        let capture = InboxStateMutation.capture(title: "문서 https://example.com/a", id: captureID, date: date)
        XCTAssertTrue(try capture.apply(to: &state))
        XCTAssertFalse(try capture.apply(to: &state))
        let captures = try XCTUnwrap(state["captures"] as? [[String: Any]])
        XCTAssertEqual(captures.count, 2)
        XCTAssertEqual(captures.last?["url"] as? String, "https://example.com/a")
        XCTAssertNil(captures.last?["status"])
        XCTAssertNil(captures.last?["convertedTo"])
        XCTAssertNil(captures.last?["convertedId"])
        XCTAssertNil(captures.last?["processedAt"])

        let task = InboxStateMutation.task(
            title: "출시 확인",
            boxID: boxID,
            projectID: projectID,
            dueDate: "2026-08-20",
            id: taskID,
            blockID: blockID,
            date: date
        )
        XCTAssertTrue(try task.apply(to: &state))
        let tasks = try XCTUnwrap(state["tasks"] as? [[String: Any]])
        let savedTask = try XCTUnwrap(tasks.last)
        XCTAssertEqual(savedTask["status"] as? String, "scheduled")
        XCTAssertEqual(savedTask["boxId"] as? String, boxID)
        XCTAssertEqual(savedTask["projectId"] as? String, projectID)
        XCTAssertEqual(savedTask["dueDate"] as? String, "2026-08-20")
        XCTAssertEqual(savedTask["resourceId"] as? String, "")
        let block = try XCTUnwrap((savedTask["blocks"] as? [[String: Any]])?.first)
        XCTAssertEqual(block["id"] as? String, blockID.uuidString.lowercased())
        XCTAssertEqual(block["type"] as? String, "paragraph")
        XCTAssertEqual(block["checked"] as? Bool, false)
        XCTAssertEqual(block["indent"] as? Int, 0)
        XCTAssertEqual((state["futureField"] as? [String: Bool])?["keep"], true)
        XCTAssertEqual(InboxWorkspaceOptions(state: state).projects.first?.boxID, boxID)
        XCTAssertTrue(JSONSerialization.isValidJSONObject(state))

        let scheduled = InboxStateMutation.task(
            title: "날짜 미정",
            boxID: "",
            projectID: "",
            dueDate: "",
            id: UUID(uuidString: "66666666-6666-4666-8666-666666666666")!,
            blockID: UUID(uuidString: "77777777-7777-4777-8777-777777777777")!,
            date: date
        )
        XCTAssertEqual(scheduled.item["status"] as? String, "scheduled")
        XCTAssertEqual(scheduled.item["dueDate"] as? String, "")

        var seoul = Calendar(identifier: .gregorian)
        seoul.timeZone = try XCTUnwrap(TimeZone(identifier: "Asia/Seoul"))
        let reference = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-08-11T15:30:00Z"))
        let timingModel = InboxCaptureModel()
        timingModel.timing = .today
        XCTAssertEqual(timingModel.dueDateKey(now: reference, calendar: seoul), "2026-08-12")
        timingModel.timing = .tomorrow
        XCTAssertEqual(timingModel.dueDateKey(now: reference, calendar: seoul), "2026-08-13")
        timingModel.timing = .scheduled
        XCTAssertEqual(timingModel.dueDateKey(now: reference, calendar: seoul), "")

        timingModel.setOptions(InboxWorkspaceOptions(state: [
            "boxes": [
                ["id": "box-a", "name": "A"],
                ["id": "box-b", "name": "B"],
            ],
            "projects": [
                ["id": "project-a", "name": "A Project", "boxId": "box-a"],
                ["id": "project-b", "name": "B Project", "boxId": "box-b"],
            ],
        ]))
        XCTAssertEqual(timingModel.availableProjects.count, 2)
        timingModel.setProject("project-a")
        XCTAssertEqual(timingModel.selectedBoxID, "box-a")
        XCTAssertEqual(timingModel.availableProjects.map(\.id), ["project-a"])
        timingModel.setBox("box-b")
        XCTAssertEqual(timingModel.selectedProjectID, "")
        XCTAssertEqual(timingModel.availableProjects.map(\.id), ["project-b"])

        var movedState = state
        var movedProjects = try XCTUnwrap(movedState["projects"] as? [[String: Any]])
        movedProjects[0]["boxId"] = "box-two"
        movedState["projects"] = movedProjects
        let movedTask = InboxStateMutation.task(
            title: "이동 후 확인",
            boxID: boxID,
            projectID: projectID,
            dueDate: "",
            id: UUID(uuidString: "44444444-4444-4444-8444-444444444444")!,
            blockID: UUID(uuidString: "55555555-5555-4555-8555-555555555555")!,
            date: date
        )
        XCTAssertTrue(try movedTask.apply(to: &movedState))
        XCTAssertEqual((movedState["tasks"] as? [[String: Any]])?.last?["boxId"] as? String, "box-two")
    }

    @MainActor
    func testShortcutSettingsAndAdaptiveTextColor() throws {
        let suite = "SYGMAQuickNotesTests.\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        var legacy = Dictionary(uniqueKeysWithValues: QuickNoteShortcutSettings.defaultShortcuts.map { ($0.key.rawValue, $0.value) })
        legacy.removeValue(forKey: QuickNoteShortcutAction.captureInbox.rawValue)
        let customizedToggle = QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_L), modifiers: [.command, .shift], key: "L")
        legacy[QuickNoteShortcutAction.togglePanel.rawValue] = customizedToggle
        legacy[QuickNoteShortcutAction.hidePanel.rawValue] = QuickNoteShortcut(keyCode: UInt16(kVK_Escape), modifiers: [], key: "Esc")
        defaults.set(try JSONEncoder().encode(legacy), forKey: "SYGMAQuickNotesShortcutsV1")
        let settings = QuickNoteShortcutSettings(defaults: defaults)

        XCTAssertEqual(settings.shortcut(for: .hidePanel).display, "⌘W")
        XCTAssertEqual(settings.shortcut(for: .togglePanel), customizedToggle)
        XCTAssertEqual(settings.shortcut(for: .captureInbox).display, "⌥Space")
        XCTAssertEqual(QuickNoteShortcutSettings.defaultShortcuts[.togglePanel]?.display, "⇧⌘L")
        XCTAssertEqual(SYGMAWebRuntime.quickEditorURL.query, "surface=quick-editor")
        XCTAssertNotNil(defaults.data(forKey: "SYGMAQuickNotesShortcutsV2"))
        XCTAssertEqual(settings.shortcut(for: .note1).display, "⌘1")
        XCTAssertEqual(settings.shortcut(for: .note9).display, "⌘9")
        XCTAssertEqual(QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_N), modifiers: .command, key: "ㅜ").display, "⌘N")
        XCTAssertEqual(Set(QuickNoteShortcutAction.allCases.map(settings.shortcut)).count, QuickNoteShortcutAction.allCases.count)
        XCTAssertNotNil(settings.validationMessage(for: settings.shortcut(for: .note1), action: .note2))

        let custom = QuickNoteShortcut(keyCode: UInt16(kVK_ANSI_P), modifiers: [.command, .option], key: "P")
        settings.save(custom, for: .newNote)
        XCTAssertEqual(QuickNoteShortcutSettings(defaults: defaults).shortcut(for: .newNote), custom)
        XCTAssertNotNil(settings.validationMessage(for: custom, action: .togglePanel))

        let escape = QuickNoteShortcut(keyCode: UInt16(kVK_Escape), modifiers: [], key: "Esc")
        settings.save(escape, for: .hidePanel)
        XCTAssertEqual(QuickNoteShortcutSettings(defaults: defaults).shortcut(for: .hidePanel), escape)
        let escapeEvent = try XCTUnwrap(NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: [],
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            characters: "\u{1b}",
            charactersIgnoringModifiers: "\u{1b}",
            isARepeat: false,
            keyCode: UInt16(kVK_Escape)
        ))
        let commandWEvent = try XCTUnwrap(NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: .command,
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            characters: "w",
            charactersIgnoringModifiers: "w",
            isARepeat: false,
            keyCode: UInt16(kVK_ANSI_W)
        ))
        XCTAssertTrue(settings.shortcut(for: .hidePanel).matches(escapeEvent))
        XCTAssertFalse(settings.shortcut(for: .hidePanel).matches(commandWEvent))

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
