import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, openMainResourceFromList, resetFixture } from "./helpers.js";

const MIME = "application/x-sygma-blocks";
const RAW_TEXT_LIMIT_BYTES = 5_000_000;
const REPRESENTATION_LIMIT_BYTES = 250_000;
const RESOURCE_PUT_LIMIT_BYTES = 5_000_000;

async function openEditor(page) {
  await page.goto("/");
  const note = await openMainResourceFromList(page);
  const title = note.locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`);
  const paragraph = note.locator('[data-block-content="fixture-block-paragraph"]');
  await expect(title).toBeVisible();
  await expect(paragraph).toBeVisible();
  await expect(note.locator("[data-resource-save-status]")).toHaveAttribute("data-sync-state", "saved");
  return { note, title, paragraph };
}

async function resourceState(request) {
  const snapshot = await fixtureSnapshot(request);
  return {
    resource: snapshot.state.resources.find((entry) => entry.id === FIXTURE_IDS.resource),
    revision: snapshot.state.revision,
    writes: snapshot.writes,
    writeAttempts: snapshot.writeAttempts,
  };
}

async function captureNoop(page, request) {
  const state = await resourceState(request);
  return {
    state,
    dom: await page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`).evaluate((node) => node.innerHTML.replace(/ is-icon-hover/g, "").replace(/class="block "/g, "class=\"block\"").replace(/overflow-anchor: none;/g, "").replace(/ style=""/g, "")),
    focus: await page.evaluate(() => document.activeElement?.getAttribute("data-block-content") || document.activeElement?.getAttribute("data-resource-title") || document.activeElement?.tagName || ""),
    selection: await page.evaluate(() => ({ ...ui.blockSelection, ids: ui.blockSelection.ids.slice() })),
    selectedDom: await page.evaluate(() => [...document.querySelectorAll(".block.is-selected[data-block-id]")].map((node) => node.dataset.blockId)),
    nativeSelection: await page.evaluate(() => {
      const selection = window.getSelection();
      const nodePoint = (node, offset) => {
        if (!node) return null;
        const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        const root = element?.closest?.("[data-block-content], [data-resource-title]") || document.body;
        const path = [];
        let cursor = node;
        while (cursor && cursor !== root) {
          const parent = cursor.parentNode;
          if (!parent) break;
          path.unshift([...parent.childNodes].indexOf(cursor));
          cursor = parent;
        }
        return {
          root: root.getAttribute?.("data-block-content") || root.getAttribute?.("data-resource-title") || root.tagName || "",
          path,
          offset,
          nodeType: node.nodeType,
          text: node.nodeType === Node.TEXT_NODE ? node.textContent : null,
        };
      };
      return {
        rangeCount: selection?.rangeCount || 0,
        isCollapsed: selection?.isCollapsed ?? true,
        anchor: nodePoint(selection?.anchorNode, selection?.anchorOffset || 0),
        focus: nodePoint(selection?.focusNode, selection?.focusOffset || 0),
        ranges: selection
          ? Array.from({ length: selection.rangeCount }, (_, index) => {
            const range = selection.getRangeAt(index);
            return {
              start: nodePoint(range.startContainer, range.startOffset),
              end: nodePoint(range.endContainer, range.endOffset),
              collapsed: range.collapsed,
              text: range.toString(),
            };
          })
          : [],
      };
    }),
    editorHistory: await page.evaluate(() => JSON.parse(JSON.stringify(ui.editorHistory))),
  };
}

async function expectNoop(page, request, before) {
  await page.waitForTimeout(475);
  const after = await captureNoop(page, request);
  expect(after.state.resource).toEqual(before.state.resource);
  expect(after.state.revision).toBe(before.state.revision);
  expect(after.state.writes).toEqual(before.state.writes);
  expect(after.state.writeAttempts).toEqual(before.state.writeAttempts);
  expect(after.dom).toBe(before.dom);
  expect(after.focus).toBe(before.focus);
  expect(after.selection).toEqual(before.selection);
  expect(after.selectedDom).toEqual(before.selectedDom);
  expect(after.nativeSelection).toEqual(before.nativeSelection);
  expect(after.editorHistory).toEqual(before.editorHistory);
}

async function appPasteBlocks(locator, blocks, options = {}) {
  return locator.evaluate((node, { blocks, options }) => pasteBlocksFromClipboard({ target: node }, blocks, options), { blocks, options });
}

async function dispatchPaste(locator, payload) {
  return locator.evaluate((node, { plain = "", html = "", custom = "", file = false }) => {
    const data = new DataTransfer();
    if (plain) data.setData("text/plain", plain);
    if (html) data.setData("text/html", html);
    if (custom) data.setData("application/x-sygma-blocks", custom);
    if (file) data.items.add(new File(["x"], "x.txt", { type: "text/plain" }));
    return node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  }, payload);
}

async function dispatchDrop(locator, file = true) {
  return locator.evaluate((node, hasFile) => {
    const data = new DataTransfer();
    if (hasFile) data.items.add(new File(["x"], "x.txt", { type: "text/plain" }));
    return node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
  }, file);
}

async function dispatchFileDrag(locator, type) {
  return locator.evaluate((node, eventType) => {
    const data = new DataTransfer();
    data.items.add(new File(["x"], "x.txt", { type: "text/plain" }));
    data.effectAllowed = "all";
    data.dropEffect = "copy";
    const event = new DragEvent(eventType, { bubbles: true, cancelable: true, dataTransfer: data });
    const dispatched = node.dispatchEvent(event);
    return {
      dispatched,
      defaultPrevented: event.defaultPrevented,
      dropEffect: data.dropEffect,
    };
  }, type);
}

async function selectNativeTextRange(locator, start, end) {
  await locator.evaluate((node, offsets) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const textNode = walker.nextNode();
    if (!textNode) throw new Error("Expected a text node for the native selection fixture.");
    const range = document.createRange();
    range.setStart(textNode, Math.min(offsets.start, textNode.textContent.length));
    range.setEnd(textNode, Math.min(offsets.end, textNode.textContent.length));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, { start, end });
}

async function clipboardIngressGate(locator, payload) {
  return locator.evaluate((node, { plain = "", html = "", custom = "" }) => {
    const data = new DataTransfer();
    if (plain) data.setData("text/plain", plain);
    if (html) data.setData("text/html", html);
    if (custom) data.setData("application/x-sygma-blocks", custom);
    let result = null;
    node.addEventListener("paste", (event) => {
      const rejected = rejectOversizedResourceClipboardRepresentations(event, data);
      result = { rejected, defaultPrevented: event.defaultPrevented };
      event.stopImmediatePropagation();
      if (!event.defaultPrevented) event.preventDefault();
    }, { capture: true, once: true });
    node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    return result;
  }, payload);
}

function exactCustomPayload(byteLength, label = "x") {
  const prefix = JSON.stringify({ version: 1, blocks: [{ type: "paragraph", text: "" }] });
  const emptyTextToken = '"text":""';
  const textOffset = prefix.indexOf(emptyTextToken) + '"text":"'.length;
  const textBytes = byteLength - new TextEncoder().encode(prefix).length;
  if (textBytes < 0) throw new Error(`Cannot fit custom payload in ${byteLength} bytes.`);
  const fill = String(label || "x").slice(0, 1);
  if (new TextEncoder().encode(fill).length !== 1) throw new Error("Boundary fill must be one UTF-8 byte.");
  const payload = `${prefix.slice(0, textOffset)}${fill.repeat(textBytes)}${prefix.slice(textOffset)}`;
  expect(new TextEncoder().encode(payload)).toHaveLength(byteLength);
  return payload;
}

function exactHtmlPayload(byteLength, label = "h") {
  const opening = "<p>";
  const closing = "</p>";
  const fillBytes = byteLength - opening.length - closing.length;
  const payload = `${opening}${String(label || "h").slice(0, 1).repeat(fillBytes)}${closing}`;
  expect(new TextEncoder().encode(payload)).toHaveLength(byteLength);
  return payload;
}

function markedCustomPayload(markCount, label) {
  const text = Array.from({ length: markCount }, (_, index) => `${index % 10} `).join("");
  const marks = Array.from({ length: markCount }, (_, index) => ({ type: "bold", start: index * 2, end: index * 2 + 1 }));
  const payload = JSON.stringify({ version: 1, blocks: [{ type: "paragraph", text: `${label}${text}`, marks: marks.map((mark) => ({ ...mark, start: mark.start + label.length, end: mark.end + label.length })) }] });
  return { payload, text: `${label}${text}`, marks };
}

async function selectResourceBlock(page, blockId) {
  await page.evaluate(({ resourceId, blockId }) => {
    selectSingleBlock("resources", resourceId, blockId);
  }, { resourceId: FIXTURE_IDS.resource, blockId });
  await expect(page.locator(`.block.is-selected[data-block-id="${blockId}"]`)).toHaveCount(1);
}

async function selectFixtureParagraphBlock(page) {
  await selectResourceBlock(page, "fixture-block-paragraph");
}

async function seedFixtureResourceBlocks(request, blocks) {
  const before = await fixtureSnapshot(request);
  const resource = structuredClone(before.state.resources.find((entry) => entry.id === FIXTURE_IDS.resource));
  resource.blocks = blocks;
  resource.commentThreads = [];
  resource.revision = Number(resource.revision || 0) + 1;
  resource.updatedAt = new Date(Math.max(Date.now(), Date.parse(resource.updatedAt || "") + 1000)).toISOString();
  const data = {
    resource,
    baseRevision: before.serverRevision,
    e2eFixtureGeneration: before.resetGeneration,
  };
  const bodyBytes = new TextEncoder().encode(JSON.stringify(data)).length;
  const response = await request.put(`/api/resources/${encodeURIComponent(FIXTURE_IDS.resource)}`, {
    headers: { "Content-Type": "application/json", "If-Match": `"state-${before.serverRevision}"` },
    data,
  });
  expect(response.ok()).toBeTruthy();
  const after = await fixtureSnapshot(request);
  expect(after.state.resources.find((entry) => entry.id === FIXTURE_IDS.resource)?.blocks.map((block) => block.id)).toEqual(blocks.map((block) => block.id));
  return { bodyBytes, serverRevision: after.serverRevision };
}

async function openSeededResource(page) {
  await page.goto(`/resources/${encodeURIComponent(FIXTURE_IDS.resource)}`);
  const note = page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
  await expect(note).toBeVisible();
  return note;
}

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("file paste/drop on Resource title, block, and page are atomic and leave unrelated drops available", async ({ page, request }) => {
  const { note, title, paragraph } = await openEditor(page);
  await paragraph.focus();
  const outsideResource = page.locator("#app");
  const outsideDrag = await dispatchFileDrag(outsideResource, "dragover");
  expect(outsideDrag.dispatched).toBe(true);
  expect(outsideDrag.defaultPrevented).toBe(false);
  expect(await dispatchDrop(outsideResource)).toBe(true);
  for (const target of [paragraph, title]) {
    const before = await captureNoop(page, request);
    expect(await dispatchPaste(target, { plain: "kept", file: true })).toBe(false);
    await expect(page.locator("#toast, #appAnnouncements").filter({ hasText: "Resource에는 파일 붙여넣기나 파일 드롭을 지원하지 않아요." }).first()).toBeVisible();
    await expectNoop(page, request, before);
  }
  for (const target of [paragraph, title, note]) {
    const dragBefore = await captureNoop(page, request);
    expect(await dispatchFileDrag(target, "dragover")).toEqual({
      dispatched: false,
      defaultPrevented: true,
      dropEffect: "none",
    });
    await expectNoop(page, request, dragBefore);
    const before = await captureNoop(page, request);
    expect(await dispatchDrop(target)).toBe(false);
    await expect(page.locator("#toast, #appAnnouncements").filter({ hasText: "Resource에는 파일 붙여넣기나 파일 드롭을 지원하지 않아요." }).first()).toBeVisible();
    await expectNoop(page, request, before);
  }
  expect(await page.evaluate(() => [...document.querySelectorAll("img,iframe,object,embed,a[download]")].some((node) => /^(data|blob):/i.test(node.src || node.href || "")))).toBe(false);
});

test("oversized raw/custom/html representations reject before native or fallback mutation", async ({ page, request }) => {
  const { paragraph } = await openEditor(page);
  await paragraph.focus();
  for (const payload of [
    { plain: "x".repeat(5_000_001) },
    { custom: "x".repeat(250_001), plain: "fallback" },
    { custom: "{bad", html: `<p>${"h".repeat(250_001)}</p>`, plain: "fallback" },
  ]) {
    await selectNativeTextRange(paragraph, 1, 6);
    const before = await captureNoop(page, request);
    expect(await dispatchPaste(paragraph, payload)).toBe(false);
    await expect(page.locator("#toast, #appAnnouncements").filter({ hasText: "Resource에 붙여넣을 수 있는 용량을 초과했어요." }).first()).toBeVisible();
    await expectNoop(page, request, before);
  }
});

test("raw, custom, and HTML ingress gates accept their exact byte boundaries and reject the next byte", async ({ page }) => {
  test.setTimeout(120_000);
  const { paragraph } = await openEditor(page);
  const exactRaw = "r".repeat(RAW_TEXT_LIMIT_BYTES);
  const exactCustom = exactCustomPayload(REPRESENTATION_LIMIT_BYTES);
  const exactHtml = exactHtmlPayload(REPRESENTATION_LIMIT_BYTES);

  expect(await clipboardIngressGate(paragraph, { plain: exactRaw })).toEqual({ rejected: false, defaultPrevented: false });
  expect(await clipboardIngressGate(paragraph, { plain: `${exactRaw}r` })).toEqual({ rejected: true, defaultPrevented: true });
  expect(await clipboardIngressGate(paragraph, { custom: exactCustom })).toEqual({ rejected: false, defaultPrevented: false });
  expect(await clipboardIngressGate(paragraph, { custom: `${exactCustom}x` })).toEqual({ rejected: true, defaultPrevented: true });
  expect(await clipboardIngressGate(paragraph, { html: exactHtml })).toEqual({ rejected: false, defaultPrevented: false });
  expect(await clipboardIngressGate(paragraph, { html: `${exactHtml}h` })).toEqual({ rejected: true, defaultPrevented: true });
});

test("exact 250000-byte custom representation commits and survives reload", async ({ page, request }) => {
  test.setTimeout(120_000);
  const { paragraph } = await openEditor(page);
  const payload = exactCustomPayload(REPRESENTATION_LIMIT_BYTES, "c");
  const expectedText = JSON.parse(payload).blocks[0].text;
  await paragraph.focus();
  expect(await dispatchPaste(paragraph, { custom: payload, plain: "boundary fallback" })).toBe(false);
  await expect.poll(async () => (await resourceState(request)).resource.blocks.some((block) => block.text === expectedText), { timeout: 30_000 }).toBe(true);
  const persisted = (await resourceState(request)).resource.blocks.find((block) => block.text === expectedText);
  expect(persisted).toMatchObject({ type: "paragraph", text: expectedText });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(`[data-block-content="${persisted.id}"]`)).toHaveText(expectedText);
});

test("exact 250000-byte HTML representation commits and survives reload", async ({ page, request }) => {
  test.setTimeout(120_000);
  const { paragraph } = await openEditor(page);
  const html = exactHtmlPayload(REPRESENTATION_LIMIT_BYTES, "h");
  const expectedText = "h".repeat(REPRESENTATION_LIMIT_BYTES - "<p></p>".length);
  await paragraph.focus();
  expect(await dispatchPaste(paragraph, { html, plain: "boundary fallback" })).toBe(false);
  await expect.poll(async () => (await resourceState(request)).resource.blocks.some((block) => block.text === expectedText), { timeout: 30_000 }).toBe(true);
  const persisted = (await resourceState(request)).resource.blocks.find((block) => block.text === expectedText);
  expect(persisted).toMatchObject({ type: "paragraph", text: expectedText });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(`[data-block-content="${persisted.id}"]`)).toHaveText(expectedText);
});

test("sanitized-empty HTML is consumed without native insertion and uses only a safe plain fallback", async ({ page, request }) => {
  const { paragraph } = await openEditor(page);
  await paragraph.focus();
  await selectNativeTextRange(paragraph, 1, 6);
  const emptyBefore = await captureNoop(page, request);
  expect(await dispatchPaste(paragraph, { html: "<script>window.__unsafePaste = true</script><style>body{display:none}</style>" })).toBe(false);
  await expectNoop(page, request, emptyBefore);
  expect(await page.evaluate(() => window.__unsafePaste)).toBeUndefined();

  const safeFallback = "safe sanitized HTML fallback";
  await selectNativeTextRange(paragraph, 0, Number.MAX_SAFE_INTEGER);
  expect(await dispatchPaste(paragraph, {
    html: '<script src="https://example.invalid/unsafe.js"></script><template><img src=x onerror=window.__unsafePaste=true></template>',
    plain: safeFallback,
  })).toBe(false);
  await expect.poll(async () => (await resourceState(request)).resource.blocks.some((block) => block.text === safeFallback)).toBe(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(safeFallback, { exact: true })).toBeVisible();
  expect(await page.locator("script[src='https://example.invalid/unsafe.js'], template img").count()).toBe(0);
  expect(await page.evaluate(() => window.__unsafePaste)).toBeUndefined();
});

test("Resource structural projection enforces exact block-count bounds", async ({ page }) => {
  await openEditor(page);
  expect(await page.evaluate(() => {
    const resource = cloneForLocalPersistence(itemById("resources", "fixture-resource-main"));
    resource.blocks = Array.from({ length: 5000 }, (_, index) => ({ id: `limit-${index}`, type: "paragraph", text: "x", marks: [], checked: false, indent: 0, collapsed: false }));
    return resourcePasteProjectionValid(resource);
  })).toBe(true);
  expect(await page.evaluate(() => {
    const resource = cloneForLocalPersistence(itemById("resources", "fixture-resource-main"));
    resource.blocks = Array.from({ length: 5001 }, (_, index) => ({ id: `limit-over-${index}`, type: "paragraph", text: "x", marks: [], checked: false, indent: 0, collapsed: false }));
    return resourcePasteProjectionValid(resource);
  })).toBe(false);
});

test("structural merge overflow preserves stale selection and prior history", async ({ page, request }) => {
  test.setTimeout(120_000);
  await seedFixtureResourceBlocks(request, [
    { id: "stale-selected", type: "paragraph", text: "stale selection", marks: [], checked: false, indent: 0, collapsed: false },
    { id: "large-target", type: "paragraph", text: "L".repeat(200_000), marks: [], checked: false, indent: 0, collapsed: false },
  ]);
  await openSeededResource(page);
  let target = page.locator('[data-block-content="large-target"]');
  await target.focus();
  expect(await appPasteBlocks(target, [{ type: "paragraph", text: "prior real edit" }])).toBe(true);
  await expect.poll(async () => (await resourceState(request)).resource.blocks.some((block) => block.text === "prior real edit")).toBe(true);
  await selectResourceBlock(page, "stale-selected");
  await expect(page.locator('.block.is-selected[data-block-id="stale-selected"]')).toHaveCount(1);
  const mergeBefore = await captureNoop(page, request);
  const mergeOverflow = `- ${"x".repeat(50_001)}`;
  expect(new TextEncoder().encode(mergeOverflow).length).toBeLessThan(250_000);
  expect(await dispatchPaste(target, { plain: mergeOverflow })).toBe(false);
  await expect(page.locator("#toast, #appAnnouncements").filter({ hasText: "Resource에 붙여넣을 수 있는 용량을 초과했어요." }).first()).toBeVisible();
  await expectNoop(page, request, mergeBefore);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Z" : "Control+Z");
  await expect(page.locator("text=prior real edit")).toHaveCount(0);
});

test("exact 250000-character structural merge commits as one undo-redo transaction", async ({ page, request }) => {
  test.setTimeout(120_000);
  await seedFixtureResourceBlocks(request, [
    { id: "boundary-target", type: "paragraph", text: "B".repeat(199_999), marks: [], checked: false, indent: 0, collapsed: false },
  ]);
  await openSeededResource(page);
  const target = page.locator('[data-block-content="boundary-target"]');
  await target.focus();
  const exactBoundary = `- ${"c".repeat(50_001)}`;
  expect(await dispatchPaste(target, { plain: exactBoundary })).toBe(false);
  await expect.poll(async () => (await resourceState(request)).resource.blocks[0].text.length).toBe(250_000);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Z" : "Control+Z");
  await expect.poll(async () => (await resourceState(request)).resource.blocks[0].text.length).toBe(199_999);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Y");
  await expect.poll(async () => (await resourceState(request)).resource.blocks[0].text.length).toBe(250_000);
});

test("projected Resource PUT body overflow rejects below the custom representation cap", async ({ page, request }) => {
  test.setTimeout(120_000);
  const nearBodyLimit = Array.from({ length: 21 }, (_, index) => ({ id: `body-${index}`, type: "paragraph", text: "z".repeat(237_000), marks: [], checked: false, indent: 0, collapsed: false }));
  const seededBody = await seedFixtureResourceBlocks(request, nearBodyLimit);
  await openSeededResource(page);
  const target = page.locator('[data-block-content="body-0"]');
  await target.focus();
  const setupBodyBytes = await page.evaluate(() => {
    const resource = cloneForLocalPersistence(itemById("resources", "fixture-resource-main"));
    return utf8ByteLength(resourcePutRequestBody(resource));
  });
  expect(seededBody.bodyBytes).toBeGreaterThan(4_900_000);
  expect(seededBody.bodyBytes).toBeLessThan(5_000_000);
  expect(setupBodyBytes).toBeGreaterThan(4_900_000);
  expect(setupBodyBytes).toBeLessThan(5_000_000);
  const bodyBefore = await captureNoop(page, request);
  const bodyPayload = JSON.stringify({ version: 1, blocks: [{ type: "paragraph", text: "p".repeat(237_000) }] });
  expect(new TextEncoder().encode(bodyPayload).length).toBeLessThanOrEqual(250_000);
  const projection = await target.evaluate((node, custom) => {
    const data = new DataTransfer();
    data.setData("application/x-sygma-blocks", custom);
    const blocks = readClipboardBlocks(data);
    const pasteTarget = clipboardPasteTarget({ target: node });
    const resource = itemById(pasteTarget.ownerType, pasteTarget.ownerId);
    const prepared = prepareClipboardBlockPaste(resource, pasteTarget, blocks);
    const plan = resourcePasteProjectionPlan(prepared.item, { at: "2030-01-01T00:00:00.000Z" });
    return { valid: plan.valid, bytes: plan.bytes, bodyBytes: utf8ByteLength(plan.body) };
  }, bodyPayload);
  expect(projection.valid).toBe(false);
  expect(projection.bytes).toBe(projection.bodyBytes);
  expect(projection.bytes).toBeGreaterThan(RESOURCE_PUT_LIMIT_BYTES);
  expect(await dispatchPaste(target, { custom: bodyPayload, plain: "fallback" })).toBe(false);
  await expect(page.locator("#toast, #appAnnouncements").filter({ hasText: "Resource에 붙여넣을 수 있는 용량을 초과했어요." }).first()).toBeVisible();
  await expectNoop(page, request, bodyBefore);
});

test("accepted custom, html, markdown/plain transport paths still work through real paste events", async ({ page, request }) => {
  const { paragraph } = await openEditor(page);
  await paragraph.focus();
  expect(await dispatchPaste(paragraph, { custom: JSON.stringify({ version: 1, blocks: [{ type: "heading2", text: "custom ok" }] }), plain: "custom ok" })).toBe(false);
  await expect(page.locator("text=custom ok")).toBeVisible();
  await paragraph.focus();
  expect(await dispatchPaste(paragraph, { html: '<h3 data-block-type="heading3">html ok</h3>', plain: "html ok" })).toBe(false);
  await expect(page.locator("text=html ok")).toBeVisible();
  await paragraph.focus();
  expect(await dispatchPaste(paragraph, { plain: "plain lead\n- markdown ok" })).toBe(false);
  await expect(page.locator("text=markdown ok")).toBeVisible();
  await expect.poll(async () => {
    const blocks = (await resourceState(request)).resource.blocks;
    return blocks.some((block) => block.text === "custom ok")
      && blocks.some((block) => block.text === "html ok")
      && blocks.some((block) => block.type === "bullet" && block.text.startsWith("markdown ok"));
  }, { timeout: 30_000 }).toBe(true);
  const persistedBlocks = (await resourceState(request)).resource.blocks;
  const markdownBlock = persistedBlocks.find((block) => block.type === "bullet" && block.text.startsWith("markdown ok"));
  const expected = [
    { text: "custom ok", type: "heading2" },
    { text: "html ok", type: "heading3" },
    { text: markdownBlock?.text, type: "bullet" },
  ].map((entry) => ({ ...entry, id: persistedBlocks.find((block) => block.text === entry.text)?.id }));
  expect(expected.every((entry) => entry.id)).toBe(true);
  for (const entry of expected) expect(persistedBlocks.find((block) => block.id === entry.id)?.type).toBe(entry.type);

  await page.reload({ waitUntil: "domcontentloaded" });
  for (const entry of expected) {
    const block = page.locator(`[data-block-id="${entry.id}"]`);
    await expect(block).toHaveAttribute("data-type", entry.type);
    await expect(block.locator(`[data-block-content="${entry.id}"]`)).toContainText(entry.text);
  }
});

test("preflight serialization is byte-for-byte identical to the queued PUT and If-Match is the revision authority", async ({ page, request }) => {
  test.setTimeout(120_000);
  const { paragraph } = await openEditor(page);
  const before = await resourceState(request);
  await page.evaluate(() => {
    const original = window.resourcePasteProjectionPlan;
    if (typeof original !== "function") throw new Error("resourcePasteProjectionPlan must be globally observable for E2E preflight evidence.");
    window.__resourcePasteProjectionBodies = [];
    window.resourcePasteProjectionPlan = function observedResourcePasteProjectionPlan(...args) {
      const plan = original(...args);
      window.__resourcePasteProjectionBodies.push({ valid: plan.valid, body: plan.body, bytes: plan.bytes });
      return plan;
    };
  });

  const committedText = "serialized preflight and PUT are identical";
  const payload = JSON.stringify({ version: 1, blocks: [{ type: "heading2", text: committedText }] });
  const putPromise = page.waitForRequest((outgoing) => (
    outgoing.method() === "PUT" && outgoing.url().includes(`/api/resources/${FIXTURE_IDS.resource}`)
  ));
  await paragraph.focus();
  expect(await dispatchPaste(paragraph, { custom: payload, plain: committedText })).toBe(false);
  const putRequest = await putPromise;
  const actualPut = { body: putRequest.postData(), headers: putRequest.headers() };
  expect(actualPut.body).toBeTruthy();
  const plans = await page.evaluate(() => window.__resourcePasteProjectionBodies);
  const acceptedPlan = plans.findLast((plan) => plan.valid);
  expect(acceptedPlan).toBeTruthy();
  expect(acceptedPlan.body).toBe(actualPut.body);
  expect(acceptedPlan.bytes).toBe(new TextEncoder().encode(actualPut.body).length);

  const parsedPut = JSON.parse(actualPut.body);
  expect(parsedPut).not.toHaveProperty("baseRevision");
  expect(parsedPut.resource.blocks.some((block) => block.text === committedText)).toBe(true);
  expect(actualPut.headers["if-match"]).toBe(`"state-${before.revision}"`);

  await expect.poll(async () => (await resourceState(request)).resource.blocks.some((block) => block.text === committedText)).toBe(true);
  const remote = await resourceState(request);
  expect(remote.writeAttempts.at(-1).ifMatch).toBe(`"state-${before.revision}"`);
});

test("1000 serialized marks persist with formatting after reload and 1001 marks reject atomically", async ({ page, request }) => {
  test.setTimeout(120_000);
  const { paragraph } = await openEditor(page);
  const accepted = markedCustomPayload(1_000, "accepted-marks:");
  const rejected = markedCustomPayload(1_001, "rejected-marks:");
  const acceptedBytes = new TextEncoder().encode(accepted.payload).length;
  const rejectedBytes = new TextEncoder().encode(rejected.payload).length;
  expect(acceptedBytes).toBeLessThanOrEqual(REPRESENTATION_LIMIT_BYTES);
  expect(rejectedBytes).toBeLessThanOrEqual(REPRESENTATION_LIMIT_BYTES);
  expect(rejectedBytes).toBeGreaterThan(acceptedBytes);

  await paragraph.focus();
  expect(await dispatchPaste(paragraph, { custom: accepted.payload, plain: accepted.text })).toBe(false);
  await expect.poll(async () => {
    const block = (await resourceState(request)).resource.blocks.find((entry) => entry.text === accepted.text);
    return block?.marks?.length;
  }).toBe(1_000);
  const acceptedBlock = (await resourceState(request)).resource.blocks.find((block) => block.text === accepted.text);
  expect(acceptedBlock.marks).toHaveLength(1_000);

  await page.reload({ waitUntil: "domcontentloaded" });
  const rendered = page.locator(`[data-block-content="${acceptedBlock.id}"]`);
  await expect(rendered).toHaveText(accepted.text);
  await expect(rendered.locator('[data-inline-mark="bold"]')).toHaveCount(1_000);

  const target = page.locator('[data-block-content="fixture-block-paragraph"]');
  await target.focus();
  await selectNativeTextRange(target, 1, 6);
  const beforeRejected = await captureNoop(page, request);
  expect(await dispatchPaste(target, { custom: rejected.payload, plain: rejected.text })).toBe(false);
  await expect(page.locator("#toast, #appAnnouncements").filter({ hasText: "Resource에 붙여넣을 수 있는 용량을 초과했어요." }).first()).toBeVisible();
  await expectNoop(page, request, beforeRejected);
  expect((await resourceState(request)).resource.blocks.some((block) => block.text === rejected.text)).toBe(false);
});

test("block selection survives rejected ingress and undo reaches the prior real edit", async ({ page, request }) => {
  const { paragraph } = await openEditor(page);
  await paragraph.focus();
  await appPasteBlocks(paragraph, [{ type: "paragraph", text: "real edit" }]);
  await expect(page.locator("text=real edit")).toBeVisible();
  await expect.poll(async () => (await resourceState(request)).resource.blocks.some((block) => block.text === "real edit")).toBe(true);
  await selectFixtureParagraphBlock(page);
  const before = await captureNoop(page, request);
  await dispatchPaste(paragraph, { custom: JSON.stringify({ version: 1, blocks: [{ type: "paragraph", text: "x".repeat(250_001) }] }), plain: "fallback" });
  await expectNoop(page, request, before);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Z" : "Control+Z");
  await expect(page.locator("text=real edit")).toHaveCount(0);
});

test("stale selection branch clearing is scoped to accepted code, url, and native paths", async ({ page, request }) => {
  const { note } = await openEditor(page);
  const code = note.locator('[data-block-content="fixture-block-code"]');
  await code.focus();
  await selectFixtureParagraphBlock(page);
  const codeBefore = await captureNoop(page, request);
  expect(await dispatchPaste(code, { plain: "c".repeat(250_001) })).toBe(false);
  await expectNoop(page, request, codeBefore);

  await code.focus();
  await selectFixtureParagraphBlock(page);
  expect(await dispatchPaste(code, { plain: "code ok" })).toBe(false);
  await expect.poll(async () => (await page.evaluate(() => ui.blockSelection.ids.length))).toBe(0);
  await expect(code).toContainText("code ok");

  const heading = note.locator('[data-block-content="fixture-block-heading-1"]');
  await heading.focus();
  await selectFixtureParagraphBlock(page);
  await heading.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  expect(await dispatchPaste(heading, { plain: "https://example.com/resource" })).toBe(false);
  await expect.poll(async () => page.evaluate(() => Boolean(ui.urlPasteChoice))).toBe(true);
  expect(await page.evaluate(() => ui.blockSelection.ids.length)).toBe(0);

  await page.keyboard.press("Escape");
  await heading.focus();
  await selectFixtureParagraphBlock(page);
  expect(await dispatchPaste(heading, { plain: "native single line" })).toBe(false);
  expect(await page.evaluate(() => ui.blockSelection.ids.length)).toBe(0);
  await expect(heading).toContainText("native single line");
  await expect.poll(async () => (await resourceState(request)).resource.blocks.some((block) => block.text.includes("native single line"))).toBe(true);
});
