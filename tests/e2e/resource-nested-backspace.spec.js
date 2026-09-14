import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const RESOURCE_ID = FIXTURE_IDS.bodySearchResource;
const paragraph = (id, text = "", indent = 0, marks = []) => ({ id, type: "paragraph", text, indent, marks, checked: false, collapsed: false });
const toggle = (id, indent = 0) => ({ ...paragraph(id, id, indent), type: "toggle" });

test.use({ reducedMotion: "reduce" });

async function seed(request, blocks) {
  await resetFixture(request);
  const before = await fixtureSnapshot(request);
  before.state.resources.find((resource) => resource.id === RESOURCE_ID).blocks = blocks;
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state: before.state, baseRevision: before.serverRevision },
  });
  expect(response.ok()).toBeTruthy();
}

async function open(page) {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-nav-key="resources"]').evaluate((button) => button.click());
  await page.locator(`[data-resource-open="${RESOURCE_ID}"]`).click();
  return page.locator(`.block-editor[data-owner-id="${RESOURCE_ID}"]`);
}

async function setCaret(content, offset) {
  await content.evaluate((element, offset) => {
    element.focus();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && offset > node.textContent.length) { offset -= node.textContent.length; node = walker.nextNode(); }
    const range = document.createRange();
    range.setStart(node || element, node ? offset : 0); range.collapse(true);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  }, offset);
}

async function caret(content) {
  return content.evaluate((element) => {
    const selection = getSelection();
    if (!selection?.rangeCount || !element.contains(selection.anchorNode)) return null;
    const range = document.createRange(); range.selectNodeContents(element);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    return { focused: document.activeElement === element, offset: range.toString().length, collapsed: selection.isCollapsed };
  });
}

const savedBlocks = async (request) => (await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === RESOURCE_ID).blocks;

for (const context of ["indent", "toggle", "nested-toggle"]) {
  test(`${context}: 돌아온 문장 안 Backspace는 글자를 지우고 줄 시작에서는 같은 단계 이전 문장 끝에 합친다`, async ({ page, request }) => {
    const indent = context === "nested-toggle" ? 2 : 1;
    const parents = context === "indent" ? [paragraph("parent", "들여쓰기 부모")]
      : [toggle("outer"), ...(context === "nested-toggle" ? [toggle("inner", 1)] : [])];
    const blocks = [paragraph("intro", "문서 앞"), ...parents,
      paragraph("previous", "LEFT", indent, [{ type: "bold", start: 0, end: 4 }]),
      paragraph("target", "TEXT", indent, [{ type: "italic", start: 0, end: 4 }]),
      paragraph("following", "NEXT", indent), paragraph("tail", "TAIL", indent), paragraph("outside", "문서 뒤")];
    await seed(request, blocks);
    const editor = await open(page);
    const previous = editor.locator('[data-block-content="previous"]');
    const target = editor.locator('[data-block-content="target"]');
    await setCaret(editor.locator('[data-block-content="following"]'), 4);
    await page.keyboard.press("ArrowUp");
    await expect(target).toBeFocused();
    await page.keyboard.press("Backspace");
    await expect(target).toHaveText("TEX");
    await expect(editor.locator('[data-block-id="target"]')).toHaveAttribute("data-indent", String(indent));
    await setCaret(target, 0);
    await page.keyboard.press("Backspace");
    await expect(target).toHaveCount(0);
    await expect(previous).toHaveText("LEFTTEX");
    await expect(editor.locator('[data-block-id="previous"]')).toHaveAttribute("data-indent", String(indent));
    await expect.poll(() => caret(previous)).toEqual({ focused: true, offset: 4, collapsed: true });
    const expectedIds = blocks.filter((block) => block.id !== "target").map((block) => block.id);
    await expect.poll(async () => (await savedBlocks(request)).map((block) => block.id)).toEqual(expectedIds);
    await expect.poll(async () => (await savedBlocks(request)).find((block) => block.id === "previous").marks).toEqual([
      { type: "bold", start: 0, end: 4 }, { type: "italic", start: 4, end: 7 },
    ]);
    await page.keyboard.press("Backspace");
    await expect(previous).toHaveText("LEFTEX");
    await expect.poll(() => caret(previous)).toMatchObject({ focused: true, offset: 3 });
    await page.keyboard.press("ControlOrMeta+z");
    await expect(previous).toHaveText("LEFTTEX");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(previous).toHaveText("LEFT");
    await expect(target).toHaveText("TEX");
    await expect.poll(() => caret(target)).toEqual({ focused: true, offset: 0, collapsed: true });
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(previous).toHaveText("LEFTTEX");
    await expect.poll(async () => (await savedBlocks(request)).map((block) => block.id)).toEqual(expectedIds);
    await open(page);
    await expect(previous).toHaveText("LEFTTEX");
    await expect(editor.locator('[data-block-id="previous"]')).toHaveAttribute("data-indent", String(indent));
  });
}

test("토글의 첫 번째 내용 줄은 Backspace로 토글 제목에 합쳐지거나 바깥으로 이동하지 않는다", async ({ page, request }) => {
  const blocks = [paragraph("intro", "문서 앞"), toggle("outer"), toggle("inner", 1),
    paragraph("first-child", "첫 번째 내용", 2), paragraph("next-child", "다음 내용", 2), paragraph("outside", "문서 뒤")];
  await seed(request, blocks);
  const editor = await open(page);
  const content = editor.locator('[data-block-content="first-child"]');
  await setCaret(content, 0);
  await page.keyboard.press("Backspace");
  await expect(content).toHaveText("첫 번째 내용");
  await expect(editor.locator('[data-block-id="first-child"]')).toHaveAttribute("data-indent", "2");
  await expect.poll(() => caret(content)).toEqual({ focused: true, offset: 0, collapsed: true });
  expect(await savedBlocks(request)).toEqual(blocks);
});

test("접힌 형제 토글의 숨은 내용에는 합치지 않고 중첩 목록은 이전 목록 문장과 합친다", async ({ page, request }) => {
  const blocks = [toggle("outer"), { ...toggle("closed", 1), collapsed: true }, paragraph("hidden", "숨은 내용", 2),
    { ...paragraph("previous", "목록 앞", 1), type: "bullet" }, { ...paragraph("target", "목록 뒤", 1), type: "bullet" }, paragraph("outside", "문서 뒤")];
  await seed(request, blocks);
  const editor = await open(page);
  const previous = editor.locator('[data-block-content="previous"]');
  await setCaret(previous, 0);
  await page.keyboard.press("Backspace");
  await expect(previous).toHaveText("목록 앞");
  await expect(editor.locator('[data-block-id="previous"]')).toHaveAttribute("data-indent", "1");
  const target = editor.locator('[data-block-content="target"]');
  await setCaret(target, 0);
  await page.keyboard.press("Backspace");
  await expect(previous).toHaveText("목록 앞목록 뒤");
  await expect(target).toHaveCount(0);
  await expect(editor.locator('[data-block-id="previous"]')).toHaveAttribute("data-type", "bullet");
  await expect(editor.locator('[data-block-id="hidden"]')).toBeHidden();
  await expect.poll(() => caret(previous)).toEqual({ focused: true, offset: 4, collapsed: true });
});

for (const context of ["indent", "toggle", "nested-toggle"]) {
  test(`${context}: 중간의 빈 줄 Backspace는 그 줄만 삭제하고 바로 윗줄 끝에 커서를 둔다`, async ({ page, request }, testInfo) => {
    if (context === "nested-toggle") await page.setViewportSize({ width: 390, height: 900 });
    const indent = context === "nested-toggle" ? 2 : 1;
    const parents = context === "indent" ? [paragraph("parent", "부모")]
      : [toggle("outer"), ...(context === "nested-toggle" ? [toggle("inner", 1)] : [])];
    const blocks = [...parents, paragraph("previous", "윗줄 끝", indent, [{ type: "bold", start: 0, end: 4 }]),
      paragraph("blank", "", indent), paragraph("following", "아랫줄", indent),
      paragraph("last", "마지막 내용", indent), paragraph("outside", "토글 밖")];
    await seed(request, blocks);
    const editor = await open(page);
    const blank = editor.locator('[data-block-content="blank"]');
    const previous = editor.locator('[data-block-content="previous"]');
    await setCaret(editor.locator('[data-block-content="following"]'), 0);
    await page.keyboard.press("ArrowUp");
    await expect(blank).toBeFocused();
    await editor.screenshot({ path: testInfo.outputPath("before-backspace.png"), caret: "initial" });
    await page.keyboard.press("Backspace");
    await expect(blank).toHaveCount(0);
    await expect.poll(() => caret(previous)).toEqual({ focused: true, offset: 4, collapsed: true });
    const expected = blocks.filter((block) => block.id !== "blank");
    await expect.poll(() => savedBlocks(request)).toEqual(expected);
    await editor.screenshot({ path: testInfo.outputPath("after-backspace.png"), caret: "initial" });
    await page.keyboard.insertText("!");
    await expect(previous).toHaveText("윗줄 끝!");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(previous).toHaveText("윗줄 끝");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(blank).toBeFocused();
    await expect.poll(() => savedBlocks(request)).toEqual(blocks);
    expect(await blank.evaluate((element) => element.dispatchEvent(new InputEvent("beforeinput", {
      inputType: "deleteContentBackward", bubbles: true, cancelable: true,
    })))).toBe(false);
    await expect.poll(() => savedBlocks(request)).toEqual(expected);
    await expect.poll(() => caret(previous)).toEqual({ focused: true, offset: 4, collapsed: true });
    await page.keyboard.press("ControlOrMeta+z");
    await expect(blank).toBeFocused();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(() => savedBlocks(request)).toEqual(expected);
    await expect.poll(() => caret(previous)).toEqual({ focused: true, offset: 4, collapsed: true });
    await open(page);
    await expect(blank).toHaveCount(0);
    await expect.poll(() => savedBlocks(request)).toEqual(expected);
  });
}
