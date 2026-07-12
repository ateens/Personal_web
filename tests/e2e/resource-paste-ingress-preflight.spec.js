import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, openMainResourceFromList, resetFixture } from "./helpers.js";

const MIME = "application/x-sygma-blocks";

async function openEditor(page) {
  await page.goto("/");
  const note = await openMainResourceFromList(page);
  const title = note.locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`);
  const paragraph = note.locator('[data-block-content="fixture-block-paragraph"]');
  await expect(title).toBeVisible();
  await expect(paragraph).toBeVisible();
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

async function selectResourceBlock(page, blockId) {
  await page.evaluate(({ resourceId, blockId }) => {
    ui.blockSelection = { ownerType: "resources", ownerId: resourceId, ids: [blockId] };
    renderDetail({ soft: true });
  }, { resourceId: FIXTURE_IDS.resource, blockId });
}

async function selectFixtureParagraphBlock(page) {
  await selectResourceBlock(page, "fixture-block-paragraph");
}

async function seedResourceBlocks(page, request, blocks) {
  await page.evaluate(({ resourceId, blocks }) => {
    const resource = itemById("resources", resourceId);
    resource.blocks = blocks;
    saveState();
    renderDetail({ soft: true });
  }, { resourceId: FIXTURE_IDS.resource, blocks });
  await expect.poll(async () => (await resourceState(request)).resource.blocks.map((block) => block.id), { timeout: 15_000 }).toEqual(blocks.map((block) => block.id));
}

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("file paste/drop on Resource title, block, and page are atomic and leave unrelated drops available", async ({ page, request }) => {
  const { note, title, paragraph } = await openEditor(page);
  await paragraph.focus();
  for (const target of [paragraph, title]) {
    const before = await captureNoop(page, request);
    expect(await dispatchPaste(target, { plain: "kept", file: true })).toBe(false);
    await expect(page.locator("#toast, #appAnnouncements").filter({ hasText: "Resource에는 파일 붙여넣기나 파일 드롭을 지원하지 않아요." }).first()).toBeVisible();
    await expectNoop(page, request, before);
  }
  for (const target of [paragraph, title, note]) {
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
    const before = await captureNoop(page, request);
    expect(await dispatchPaste(paragraph, payload)).toBe(false);
    await expect(page.locator("#toast, #appAnnouncements").filter({ hasText: "Resource에 붙여넣을 수 있는 용량을 초과했어요." }).first()).toBeVisible();
    await expectNoop(page, request, before);
  }
});

test("Resource structural projection enforces exact block, text, and body limits atomically", async ({ page, request }) => {
  test.setTimeout(120_000);
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

  await seedResourceBlocks(page, request, [
    { id: "stale-selected", type: "paragraph", text: "stale selection", marks: [], checked: false, indent: 0, collapsed: false },
    { id: "large-target", type: "paragraph", text: "L".repeat(200_000), marks: [], checked: false, indent: 0, collapsed: false },
  ]);
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

  await resetFixture(request);
  await openEditor(page);
  await seedResourceBlocks(page, request, [
    { id: "boundary-target", type: "paragraph", text: "B".repeat(199_999), marks: [], checked: false, indent: 0, collapsed: false },
  ]);
  target = page.locator('[data-block-content="boundary-target"]');
  await target.focus();
  const exactBoundary = `- ${"c".repeat(50_001)}`;
  expect(await dispatchPaste(target, { plain: exactBoundary })).toBe(false);
  await expect.poll(async () => (await resourceState(request)).resource.blocks[0].text.length).toBe(250_000);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Z" : "Control+Z");
  await expect.poll(async () => (await resourceState(request)).resource.blocks[0].text.length).toBe(199_999);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Y");
  await expect.poll(async () => (await resourceState(request)).resource.blocks[0].text.length).toBe(250_000);

  await resetFixture(request);
  await openEditor(page);
  const nearBodyLimit = Array.from({ length: 21 }, (_, index) => ({ id: `body-${index}`, type: "paragraph", text: "z".repeat(237_000), marks: [], checked: false, indent: 0, collapsed: false }));
  await seedResourceBlocks(page, request, nearBodyLimit);
  target = page.locator('[data-block-content="body-0"]');
  await target.focus();
  const setupBodyBytes = await page.evaluate(() => {
    const resource = cloneForLocalPersistence(itemById("resources", "fixture-resource-main"));
    return utf8ByteLength(JSON.stringify({ resource, baseRevision: currentWorkspaceRevision(), ...e2eFixtureGenerationRequestFields() }));
  });
  expect(setupBodyBytes).toBeLessThan(5_000_000);
  const bodyBefore = await captureNoop(page, request);
  const bodyPayload = JSON.stringify({ version: 1, blocks: [{ type: "paragraph", text: "p".repeat(237_000) }] });
  expect(new TextEncoder().encode(bodyPayload).length).toBeLessThanOrEqual(250_000);
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
  expect(await dispatchPaste(paragraph, { plain: "- markdown ok" })).toBe(false);
  await expect(page.locator("text=markdown ok")).toBeVisible();
  await expect.poll(async () => (await resourceState(request)).resource.blocks.some((block) => block.text === "custom ok")).toBe(true);
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
  expect(await dispatchPaste(heading, { plain: "native single line" })).toBe(true);
  expect(await page.evaluate(() => ui.blockSelection.ids.length)).toBe(0);
});
