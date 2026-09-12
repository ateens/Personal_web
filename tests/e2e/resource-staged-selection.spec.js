import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const RESOURCE_ID = FIXTURE_IDS.bodySearchResource;
const paragraph = (id, text) => ({ id, type: "paragraph", text, marks: [], checked: false, indent: 0, collapsed: false });

test.beforeEach(async ({ request }) => resetFixture(request));

async function seed(request, blocks) {
  const before = await fixtureSnapshot(request);
  const draft = structuredClone(before.state);
  draft.resources.find((resource) => resource.id === RESOURCE_ID).blocks = blocks;
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state: draft, baseRevision: before.serverRevision },
  });
  expect(response.ok()).toBeTruthy();
}

async function open(page) {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-nav-key="resources"]').evaluate((button) => button.click());
  await page.locator(`[data-resource-open="${RESOURCE_ID}"]`).click();
  const resourceWindow = page.locator(`[data-resource-window="${RESOURCE_ID}"]`);
  await expect(resourceWindow).toBeVisible();
  await expect.poll(() => resourceWindow.evaluate((element) => element.getAnimations().every((animation) => animation.playState !== "running"))).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  return resourceWindow.locator(".block-editor");
}

async function caret(content, offset) {
  await content.evaluate((element, position) => {
    element.focus();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && position > node.length) {
      position -= node.length;
      node = walker.nextNode();
    }
    const range = document.createRange();
    range.setStart(node || element, node ? position : 0);
    range.collapse(true);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }, offset);
}

async function selectedText(page) {
  return page.evaluate(() => window.getSelection()?.toString() || "");
}

for (const width of [1440, 390]) {
  for (const direction of [-1, 1]) {
    test(`Resource ${width}px Shift ${direction < 0 ? "Up" : "Down"} selects visual line then paragraph then adjacent blocks`, async ({ page, request }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const text = "시각적으로접힌현재문단의한줄선택범위를정확히확인합니다".repeat(12);
      const blocks = [paragraph("stage-before-2", "이전 두 번째"), paragraph("stage-before", "이전 문단"), paragraph("stage-current", text), paragraph("stage-after", "다음 문단"), paragraph("stage-after-2", "다음 두 번째")];
      await seed(request, blocks);
      const editor = await open(page);
      const content = editor.locator('[data-block-content="stage-current"]');
      const line = await content.evaluate((element) => {
        const node = element.firstChild;
        const lines = [];
        for (let offset = 0; offset < node.length; offset += 1) {
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          const rect = range.getBoundingClientRect();
          let line = lines.find((entry) => Math.abs(entry.top - rect.top) < 2);
          if (!line) lines.push(line = { top: rect.top, start: offset, end: offset + 1 });
          line.end = offset + 1;
        }
        return { ...lines[Math.floor(lines.length / 2)], count: lines.length };
      });
      expect(line.count).toBeGreaterThan(2);
      const offset = Math.floor((line.start + line.end) / 2);
      const forward = direction < 0 ? "Shift+ArrowUp" : "Shift+ArrowDown";
      const reverse = direction < 0 ? "Shift+ArrowDown" : "Shift+ArrowUp";
      const lineText = direction < 0 ? text.slice(line.start, offset) : text.slice(offset, line.end);
      const ids = () => editor.locator(".block.is-selected").evaluateAll((elements) => elements.map((element) => element.dataset.blockId));
      const rangeIds = (focus) => blocks.slice(Math.min(2, focus), Math.max(2, focus) + 1).map((block) => block.id);
      await caret(content, offset);

      await page.keyboard.press(forward);
      await expect.poll(() => selectedText(page)).toBe(lineText);
      await expect.poll(ids).toEqual([]);
      await content.screenshot({ path: testInfo.outputPath("visual-line-selection.png") });
      await page.keyboard.press(forward);
      await expect.poll(() => selectedText(page)).toBe(text);
      await expect.poll(ids).toEqual([]);

      await page.keyboard.press(reverse);
      await expect.poll(() => selectedText(page)).toBe(lineText);
      await page.keyboard.press(reverse);
      await expect.poll(() => selectedText(page)).toBe("");
      await expect.poll(() => content.evaluate((element) => {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        range.setEnd(selection.focusNode, selection.focusOffset);
        return range.toString().length;
      })).toBe(offset);

      await page.keyboard.press(forward);
      await page.keyboard.press(forward);
      await page.keyboard.press(forward);
      await expect.poll(ids).toEqual(rangeIds(2 + direction));
      await page.keyboard.press(forward);
      await expect.poll(ids).toEqual(rangeIds(2 + 2 * direction));
      await page.keyboard.press(reverse);
      await expect.poll(ids).toEqual(rangeIds(2 + direction));
      await page.keyboard.press(reverse);
      await expect.poll(ids).toEqual(rangeIds(2));
      expect((await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === RESOURCE_ID).blocks).toEqual(blocks);
    });
  }
}

test("Resource visual-line selection preserves inline formatting and rendered equations", async ({ page, request }) => {
  const text = "앞 코드 x+y 끝\n아래 문장의 선택 범위";
  const formatted = { ...paragraph("stage-formatted", text), marks: [
    { type: "bold", start: 0, end: 1 },
    { type: "code", start: 2, end: 4 },
    { type: "equation", start: 5, end: 8, formula: "x+y", displayMode: false },
  ] };
  const blocks = [paragraph("stage-before", "앞 문단"), formatted, paragraph("stage-after", "뒷 문단")];
  await seed(request, blocks);
  const editor = await open(page);
  const content = editor.locator('[data-block-content="stage-formatted"]');
  await expect(content.locator("sygma-display-equation")).toHaveAttribute("data-equation-rendered", "true");
  await content.evaluate((element) => { window.__stagedEquation = element.querySelector("sygma-display-equation"); });
  const selectedSource = () => page.evaluate(() => window.getSelection().getRangeAt(0).toString());
  await caret(content, 4);
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(selectedSource).toBe(text.slice(4, text.indexOf("\n")));
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(selectedSource).toBe(text);
  await page.keyboard.press("Shift+ArrowDown");
  await expect(editor.locator(".block.is-selected")).toHaveCount(2);
  expect(await content.evaluate((element) => element.querySelector("sygma-display-equation") === window.__stagedEquation)).toBe(true);
  expect((await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === RESOURCE_ID).blocks).toEqual(blocks);
  const reloaded = await open(page);
  await expect(reloaded.locator('[data-block-content="stage-formatted"] [data-inline-mark="code"]')).toHaveText("코드");
  await expect(reloaded.locator('[data-block-content="stage-formatted"] sygma-display-equation')).toHaveAttribute("data-formula", "x+y");
});

test("Resource staged selection resets after horizontal navigation, pointer placement, and IME", async ({ page, request }) => {
  const text = "첫 번째 줄의 선택\n두 번째 줄의 선택";
  await seed(request, [paragraph("stage-reset", text)]);
  const editor = await open(page);
  const content = editor.locator('[data-block-content="stage-reset"]');
  await caret(content, 4);
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(() => selectedText(page)).toBe(text.slice(0, 4));
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(() => selectedText(page)).toBe(text.slice(1, 4));
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(() => selectedText(page)).toBe(text.slice(4, text.indexOf("\n")));

  await content.click();
  await caret(content, 4);
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(() => selectedText(page)).toBe(text.slice(0, 4));
  await caret(content, 4);
  const composing = await content.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    const allowed = element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, isComposing: true, bubbles: true, cancelable: true }));
    const selected = window.getSelection().toString();
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }));
    return { allowed, selected };
  });
  expect(composing).toEqual({ allowed: true, selected: "" });
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(() => selectedText(page)).toBe(text.slice(0, 4));
  await expect(editor.locator(".block.is-selected")).toHaveCount(0);
});

test("Resource one-line paragraph keeps the visual-line and whole-paragraph presses separate", async ({ page, request }) => {
  const text = "한 줄짜리 문장";
  await seed(request, [paragraph("stage-before", "이전 문장"), paragraph("stage-one-line", text)]);
  const editor = await open(page);
  const content = editor.locator('[data-block-content="stage-one-line"]');
  await caret(content, text.length);
  for (let index = 0; index < 2; index += 1) {
    await page.keyboard.press("Shift+ArrowUp");
    await expect.poll(() => selectedText(page)).toBe(text);
    await expect(editor.locator(".block.is-selected")).toHaveCount(0);
  }
  await page.keyboard.press("Shift+ArrowUp");
  await expect(editor.locator(".block.is-selected")).toHaveCount(2);
});
