import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const NOTE_ID = "fixture-floating-note";
const IMAGE_PATH = "assets/11111111-1111-4111-8111-111111111111.png";
const IMAGE_DATA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=";
const paragraph = (id, text = "", indent = 0) => ({ id, type: "paragraph", text, indent, marks: [], checked: false, collapsed: false });
const blocks = () => [
  ...Array.from({ length: 8 }, (_, index) => paragraph(`before-${index}`, `앞 문장 ${index}`)),
  paragraph("previous", "윗줄 끝"), paragraph("blank"), paragraph("middle", "가운데 문장"),
  ...Array.from({ length: 12 }, (_, index) => paragraph(`after-${index}`, `아랫문장 ${index}`)),
  paragraph("tail", "마지막 문장"),
];
const reorderedKeys = (value) => Array.isArray(value) ? value.map(reorderedKeys)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => b.localeCompare(a)).map(([key, entry]) => [key, reorderedKeys(entry)])) : value;

test.use({ viewport: { width: 496, height: 540 }, reducedMotion: "reduce" });
test.beforeEach(async ({ request }) => resetFixture(request));

async function openLocal(page, content = blocks(), id = NOTE_ID) {
  await page.addInitScript(() => {
    window.__quickMemoMessages = [];
    window.addEventListener("sygma:quickMemo", (event) => window.__quickMemoMessages.push(event.detail));
  });
  await page.goto("/?surface=quick-editor");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.evaluate(({ id, blocks }) => window.sygmaQuickEditor.loadLocal({ id, blocks }), { id, blocks: content });
  const editor = page.locator(`.block-editor[data-owner-id="quick-note:${id}"]`);
  await expect(editor.locator("[data-block-content]").last()).toBeFocused();
  await settleFrames(page);
  return editor;
}

async function setCaret(content, offset) {
  await content.evaluate((element, offset) => {
    element.scrollIntoView({ block: "center" });
    element.focus({ preventScroll: true });
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && offset > node.textContent.length) { offset -= node.textContent.length; node = walker.nextNode(); }
    const range = document.createRange();
    range.setStart(node || element, node ? offset : 0);
    range.collapse(true);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  }, offset);
}

async function caret(page) {
  return page.evaluate(() => {
    const selection = getSelection();
    const content = document.activeElement?.closest?.("[data-block-content]");
    if (!content || !selection?.rangeCount || !content.contains(selection.anchorNode)) return null;
    const range = document.createRange();
    range.selectNodeContents(content);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    return { blockId: content.dataset.blockContent, offset: range.toString().length, collapsed: selection.isCollapsed };
  });
}

async function settleFrames(page) {
  await page.evaluate(() => new Promise((resolve) => {
    let frames = 6;
    const next = () => --frames ? requestAnimationFrame(next) : resolve();
    requestAnimationFrame(next);
  }));
}

async function currentLocalPayload(page) {
  await page.evaluate(() => window.sygmaQuickEditor.flush());
  return page.evaluate(() => {
    const message = window.__quickMemoMessages.filter((entry) => entry.type === "localChange").at(-1);
    return { id: message.id, markdown: message.markdown, blocks: message.blocks };
  });
}

test("the native local note opens while the initial workspace request is blocked", async ({ page, request }) => {
  let releaseWorkspace;
  const stalled = new Promise((resolve) => { releaseWorkspace = resolve; });
  await page.route("**/api/state/status", async (route) => {
    await stalled;
    await route.continue();
  });
  await page.addInitScript((payload) => {
    window.__quickMemoMessages = [];
    window.addEventListener("sygma:quickMemo", ({ detail }) => {
      window.__quickMemoMessages.push(detail);
      if (detail.type === "localReady" || detail.type === "ready") {
        if (window.__localNoteLoaded) return;
        window.__localNoteLoaded = window.sygmaQuickEditor.loadLocal(payload);
      }
    });
  }, { id: NOTE_ID, blocks: blocks() });

  try {
    await page.goto("/?surface=quick-editor");
    const middle = page.locator('[data-block-content="middle"]');
    await expect(middle).toHaveText("가운데 문장", { timeout: 3000 });
    expect(await page.evaluate(() => window.__quickMemoMessages.some((message) => message.type === "ready"))).toBe(false);
    await setCaret(middle, 3);
    await page.keyboard.press("Backspace");
    await expect(middle).toHaveText("가운 문장");

    releaseWorkspace();
    await expect.poll(() => page.evaluate(() => window.__quickMemoMessages.find((message) => message.type === "ready")?.resources?.length || 0)).toBeGreaterThan(0);
    await expect(middle).toHaveText("가운 문장");
    expect(await caret(page)).toEqual({ blockId: "middle", offset: 2, collapsed: true });
    expect((await fixtureSnapshot(request)).writes).toEqual([]);
  } finally {
    releaseWorkspace();
  }
});

test("floating local Backspace keeps the preceding caret through repeated identical native save echoes", async ({ page, request }) => {
  const editor = await openLocal(page);
  await setCaret(editor.locator('[data-block-content="blank"]'), 0);
  await page.keyboard.press("Backspace");
  await expect(editor.locator('[data-block-content="blank"]')).toHaveCount(0);
  const expectedCaret = { blockId: "previous", offset: 4, collapsed: true };
  await expect.poll(() => caret(page)).toEqual(expectedCaret);
  await settleFrames(page);
  const payload = await currentLocalPayload(page);
  await editor.evaluate((element) => { window.__floatingEditorIdentity = element; });
  const scrollBefore = await page.evaluate(() => document.scrollingElement.scrollTop);
  for (let index = 0; index < 3; index += 1) {
    await page.evaluate((payload) => window.sygmaQuickEditor.loadLocal(payload), index === 1 ? reorderedKeys(payload) : payload);
    await settleFrames(page);
    expect(await editor.evaluate((element) => element === window.__floatingEditorIdentity)).toBe(true);
    expect(await caret(page)).toEqual(expectedCaret);
    expect(Math.abs(await page.evaluate(() => document.scrollingElement.scrollTop) - scrollBefore)).toBeLessThanOrEqual(1);
  }
  await page.keyboard.insertText("!");
  await expect(editor.locator('[data-block-content="previous"]')).toHaveText("윗줄 끝!");
  const after = await currentLocalPayload(page);
  expect(after.blocks.map((block) => block.id)).toEqual(blocks().filter((block) => block.id !== "blank").map((block) => block.id));
  expect((await fixtureSnapshot(request)).writes).toEqual([]);
});

for (const changed of [false, true]) test(`${changed ? "changed native peer and image refreshes" : "identical native echoes"} preserve in-progress Korean composition in a middle floating paragraph`, async ({ page }) => {
  const editor = await openLocal(page);
  const payload = reorderedKeys(await currentLocalPayload(page));
  if (changed) {
    payload.blocks.find((block) => block.id === "tail").text = "조합 중 들어온 외부 변경";
    payload.assets = { [IMAGE_PATH]: IMAGE_DATA };
  }
  const content = editor.locator('[data-block-content="middle"]');
  await setCaret(content, 6);
  await content.evaluate((element) => {
    window.__floatingComposingContent = element;
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertCompositionText", data: "ㅎ", isComposing: true }));
    element.textContent = "가운데 문장ㅎ";
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "ㅎ", isComposing: true }));
  });
  await page.evaluate((payload) => window.sygmaQuickEditor.loadLocal(payload), payload);
  await settleFrames(page);
  expect(await content.evaluate((element) => element === window.__floatingComposingContent)).toBe(true);
  await expect(content).toHaveText("가운데 문장ㅎ");
  expect(await caret(page)).toEqual({ blockId: "middle", offset: 7, collapsed: true });
  await content.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "한" }));
    element.textContent = "가운데 문장한";
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "한", isComposing: true }));
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한" }));
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "한" }));
  });
  await settleFrames(page);
  const saved = await currentLocalPayload(page);
  expect(saved.blocks.find((block) => block.id === "middle").text).toBe("가운데 문장한");
  expect(saved.blocks.find((block) => block.id === "tail").text).toBe(changed ? "조합 중 들어온 외부 변경" : "마지막 문장");
  if (changed) {
    await expect(editor.locator('[data-block-content="tail"]')).toHaveText("조합 중 들어온 외부 변경");
    expect(await page.evaluate((path) => quickEditor.localAssets[path], IMAGE_PATH)).toBe(IMAGE_DATA);
  }
});

test("switching notes cancels a native refresh queued during Korean composition", async ({ page }) => {
  const editor = await openLocal(page);
  const payload = await currentLocalPayload(page);
  payload.blocks.find((block) => block.id === "tail").text = "이전 노트의 지연 갱신";
  payload.assets = { [IMAGE_PATH]: IMAGE_DATA };
  const middle = editor.locator('[data-block-content="middle"]');
  await setCaret(middle, 6);
  const nextBlocks = [paragraph("new-first", "새 노트 앞"), paragraph("new-tail", "새 노트 끝")];
  await middle.evaluate((element, { payload, nextBlocks }) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    element.textContent += "한";
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "한", isComposing: true }));
    window.sygmaQuickEditor.loadLocal(payload);
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한" }));
    window.sygmaQuickEditor.loadLocal({ id: "switched-note", blocks: nextBlocks });
  }, { payload, nextBlocks });
  await settleFrames(page);
  await expect(page.locator('.block-editor[data-owner-id="quick-note:switched-note"]')).toBeVisible();
  await expect(editor).toHaveCount(0);
  expect(await caret(page)).toEqual({ blockId: "new-tail", offset: 6, collapsed: true });
  const saved = await currentLocalPayload(page);
  expect(saved.id).toBe("switched-note");
  expect(saved.blocks.map(({ id, text }) => ({ id, text }))).toEqual(nextBlocks.map(({ id, text }) => ({ id, text })));
  expect(await page.evaluate(() => Object.keys(quickEditor.localAssets))).toEqual([]);
});

test("floating native refresh of the same note preserves the active middle block and text offset", async ({ page }) => {
  const editor = await openLocal(page);
  const middle = editor.locator('[data-block-content="middle"]');
  await setCaret(middle, 3);
  await page.keyboard.press("Backspace");
  await expect(middle).toHaveText("가운 문장");
  await settleFrames(page);
  const payload = await currentLocalPayload(page);
  payload.blocks.find((block) => block.id === "tail").text = "외부에서 바뀐 마지막 문장";
  const scrollBefore = await page.evaluate(() => document.scrollingElement.scrollTop);
  await page.evaluate((payload) => window.sygmaQuickEditor.loadLocal(payload), payload);
  await settleFrames(page);
  await expect(editor.locator('[data-block-content="tail"]')).toHaveText("외부에서 바뀐 마지막 문장");
  expect(await caret(page)).toEqual({ blockId: "middle", offset: 2, collapsed: true });
  expect(Math.abs(await page.evaluate(() => document.scrollingElement.scrollTop) - scrollBefore)).toBeLessThanOrEqual(1);
  await page.keyboard.insertText("!");
  await expect(middle).toHaveText("가운! 문장");
});

test("same-note table refresh preserves the active cell and its caret", async ({ page }) => {
  const table = { ...paragraph("table", "| 첫 칸 | 둘째 칸 |\n| --- | --- |\n| 작성 중 | 원래 값 |"), type: "table" };
  const editor = await openLocal(page, [paragraph("first", "앞"), table, paragraph("tail", "마지막")]);
  const cell = editor.locator('[data-resource-table-cell][data-table-row="1"][data-table-column="0"]');
  await setCaret(cell, 2);
  const payload = await currentLocalPayload(page);
  payload.blocks.find((block) => block.id === "table").text = "| 첫 칸 | 둘째 칸 |\n| --- | --- |\n| 작성 중 | 갱신된 값 |";
  await page.evaluate((payload) => window.sygmaQuickEditor.loadLocal(payload), payload);
  await settleFrames(page);
  await expect(editor.locator('[data-resource-table-cell][data-table-row="1"][data-table-column="1"]')).toHaveText("갱신된 값");
  expect(await cell.evaluate((element) => {
    const selection = getSelection();
    if (!selection?.isCollapsed || !element.contains(selection.anchorNode)) return null;
    const range = document.createRange(); range.selectNodeContents(element); range.setEnd(selection.anchorNode, selection.anchorOffset);
    return { focused: document.activeElement === element, offset: range.toString().length };
  })).toEqual({ focused: true, offset: 2 });
  await page.keyboard.insertText("!");
  await expect(cell).toHaveText("작성! 중");
});

test("opening a different floating note still places the caret at its final editable line", async ({ page }) => {
  const editor = await openLocal(page);
  await setCaret(editor.locator('[data-block-content="middle"]'), 2);
  const nextBlocks = [paragraph("new-first", "새 노트 앞"), paragraph("new-tail", "새 노트 끝")];
  await page.evaluate((blocks) => window.sygmaQuickEditor.loadLocal({ id: "different-floating-note", blocks }), nextBlocks);
  await settleFrames(page);
  expect(await caret(page)).toEqual({ blockId: "new-tail", offset: 6, collapsed: true });
});

test("linked floating Resource Backspace keeps the preceding caret after autosave and remote refresh", async ({ page, request }) => {
  const before = await fixtureSnapshot(request);
  before.state.resources.find((resource) => resource.id === FIXTURE_IDS.bodySearchResource).blocks = blocks();
  const seed = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state: before.state, baseRevision: before.serverRevision },
  });
  expect(seed.ok()).toBeTruthy();
  await openLocal(page);
  await page.evaluate((id) => window.sygmaQuickEditor.openResource(id), FIXTURE_IDS.bodySearchResource);
  const editor = page.locator(`.block-editor[data-owner-id="${FIXTURE_IDS.bodySearchResource}"]`);
  await expect(editor.locator('[data-block-content="tail"]')).toBeFocused();
  await settleFrames(page);
  await setCaret(editor.locator('[data-block-content="blank"]'), 0);
  await page.keyboard.press("Backspace");
  await expect(editor.locator('[data-block-content="blank"]')).toHaveCount(0);
  await expect.poll(async () => (await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === FIXTURE_IDS.bodySearchResource).blocks.some((block) => block.id === "blank")).toBe(false);
  await settleFrames(page);
  expect(await caret(page)).toEqual({ blockId: "previous", offset: 4, collapsed: true });
  const saved = await fixtureSnapshot(request);
  saved.state.resources.find((resource) => resource.id === FIXTURE_IDS.bodySearchResource).blocks.find((block) => block.id === "tail").text = "원격 마지막 문장";
  const remote = await request.put("/api/state", {
    headers: { "If-Match": `"state-${saved.serverRevision}"` },
    data: { state: saved.state, baseRevision: saved.serverRevision },
  });
  expect(remote.ok()).toBeTruthy();
  await expect(editor.locator('[data-block-content="tail"]')).toHaveText("원격 마지막 문장");
  await settleFrames(page);
  expect(await caret(page)).toEqual({ blockId: "previous", offset: 4, collapsed: true });
  await page.keyboard.insertText("!");
  await expect(editor.locator('[data-block-content="previous"]')).toHaveText("윗줄 끝!");
});
