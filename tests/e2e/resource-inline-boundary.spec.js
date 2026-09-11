import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const RESOURCE_ID = FIXTURE_IDS.bodySearchResource;
const block = (id, text, marks = []) => ({ id, type: "paragraph", text, marks, checked: false, indent: 0, collapsed: false });

async function openBlocks(page, request, blocks) {
  await resetFixture(request);
  const before = await fixtureSnapshot(request);
  const state = structuredClone(before.state);
  state.resources.find((resource) => resource.id === RESOURCE_ID).blocks = blocks;
  expect((await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state, baseRevision: before.serverRevision },
  })).ok()).toBeTruthy();
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-action="toggle-nav"]').click();
  await page.locator('[data-nav-key="resources"]').click();
  await page.locator(`[data-resource-open="${RESOURCE_ID}"]`).click();
  const editor = page.locator(`.block-editor[data-owner-id="${RESOURCE_ID}"]`);
  await expect(editor).toBeVisible();
  return editor;
}

async function insideMark(content, type, offset = 0) {
  await content.evaluate((element, { type, offset }) => {
    element.focus();
    const mark = element.querySelector(`[data-inline-mark="${type}"]`);
    const walker = document.createTreeWalker(mark, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    range.setStart(walker.nextNode(), offset);
    range.collapse(true);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }, { type, offset });
}

async function caret(content) {
  return content.evaluate((element) => {
    const selection = window.getSelection();
    const node = selection.anchorNode;
    const ancestors = [];
    for (let parent = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement; parent && parent !== element; parent = parent.parentElement) {
      if (parent.dataset.inlineMark) ancestors.push(parent.dataset.inlineMark);
    }
    const range = document.createRange();
    range.selectNodeContents(element);
    if (!element.contains(node)) return null;
    range.setEnd(node, selection.anchorOffset);
    return { offset: range.toString().length, marks: ancestors, collapsed: selection.isCollapsed };
  });
}

async function savedBlock(request, id) {
  const resource = (await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === RESOURCE_ID);
  const { text, marks } = resource.blocks.find((block) => block.id === id);
  return { text, marks };
}

async function expectOutsideCaret(content, type, side) {
  await expect(content).toHaveAttribute("data-inline-boundary-caret", "true");
  const geometry = await content.evaluate((element, { type, side }) => {
    const rect = element.getBoundingClientRect();
    const mark = element.querySelector(`[data-inline-mark="${type}"]`).getBoundingClientRect();
    const style = getComputedStyle(element, "::after");
    const contentStyle = getComputedStyle(element);
    const scaleX = rect.width / Number.parseFloat(contentStyle.width);
    const scaleY = rect.height / Number.parseFloat(contentStyle.height);
    const left = rect.left + (Number.parseFloat(style.left) - element.scrollLeft) * scaleX;
    return { left, right: left + Number.parseFloat(style.width) * scaleX, height: Number.parseFloat(style.height) * scaleY, top: rect.top + (Number.parseFloat(style.top) - element.scrollTop) * scaleY, mark: { left: mark.left, right: mark.right, top: mark.top, bottom: mark.bottom }, opacity: style.opacity, caret: contentStyle.caretColor };
  }, { type, side });
  expect(geometry.height).toBeGreaterThan(10);
  expect(geometry.opacity).toBe("1");
  expect(geometry.caret).toBe("rgba(0, 0, 0, 0)");
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.mark.top - 1);
  expect(geometry.top + geometry.height).toBeLessThanOrEqual(geometry.mark.bottom + 1);
  if (side === "left") expect(geometry.right).toBeLessThanOrEqual(geometry.mark.left + 0.1);
  else expect(geometry.left).toBeGreaterThanOrEqual(geometry.mark.right);
}

test.use({ reducedMotion: "reduce" });

for (const [name, prefix, extraMarks] of [["block start", "", []], ["middle", "A ", []], ["adjacent formatting", "A", [{ type: "bold", start: 0, end: 1 }]]]) {
  test(`ArrowLeft distinguishes inside and outside inline code at ${name}`, async ({ page, request }) => {
    const editor = await openBlocks(page, request, [block("previous", "previous"), block("target", `${prefix}abc Z`, [...extraMarks, { type: "code", start: prefix.length, end: prefix.length + 3 }])]);
    const content = editor.locator('[data-block-content="target"]');
    await insideMark(content, "code", 1);
    await page.keyboard.press("ArrowLeft");
    expect(await caret(content)).toEqual({ offset: prefix.length, marks: ["code"], collapsed: true });
    await page.keyboard.press("ArrowLeft");
    expect(await caret(content)).toEqual({ offset: prefix.length, marks: [], collapsed: true });
    await expectOutsideCaret(content, "code", "left");
    await page.keyboard.type("X");
    await expect(content).not.toHaveAttribute("data-inline-boundary-caret");
    await expect.poll(() => savedBlock(request, "target")).toEqual({
      text: `${prefix}Xabc Z`, marks: [...extraMarks, { type: "code", start: prefix.length + 1, end: prefix.length + 4 }],
    });
    await page.reload();
    await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
    await page.locator('[data-action="toggle-nav"]').click();
    await page.locator('[data-nav-key="resources"]').click();
    await page.locator(`[data-resource-open="${RESOURCE_ID}"]`).click();
    await expect(page.locator('[data-block-content="target"] [data-inline-mark="code"]')).toHaveText("abc");
  });
}

test("Nested inline boundaries can exit one format at a time and reenter with ArrowRight", async ({ page, request }) => {
  const editor = await openBlocks(page, request, [block("target", "abc", [{ type: "bold", start: 0, end: 3 }, { type: "code", start: 0, end: 3 }])]);
  const content = editor.locator('[data-block-content="target"]');
  await insideMark(content, "code");
  await page.keyboard.press("ArrowLeft");
  expect(await caret(content)).toEqual({ offset: 0, marks: ["bold"], collapsed: true });
  await page.keyboard.press("ArrowLeft");
  expect(await caret(content)).toEqual({ offset: 0, marks: [], collapsed: true });
  await page.keyboard.press("ArrowRight");
  expect(await caret(content)).toEqual({ offset: 0, marks: ["bold"], collapsed: true });
  await page.keyboard.press("ArrowRight");
  expect(await caret(content)).toEqual({ offset: 0, marks: ["code", "bold"], collapsed: true });
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("X");
  await expect.poll(() => savedBlock(request, "target")).toEqual({ text: "Xabc", marks: [{ type: "bold", start: 0, end: 4 }, { type: "code", start: 1, end: 4 }] });
});

test("Right inline boundary stays distinct and plain arrows still cross adjacent blocks", async ({ page, request }) => {
  const editor = await openBlocks(page, request, [block("previous", "previous"), block("target", "abc", [{ type: "code", start: 0, end: 3 }]), block("next", "next")]);
  const content = editor.locator('[data-block-content="target"]');
  await insideMark(content, "code", 3);
  await page.keyboard.press("ArrowRight");
  expect(await caret(content)).toEqual({ offset: 3, marks: [], collapsed: true });
  await expectOutsideCaret(content, "code", "right");
  await page.keyboard.press("ArrowRight");
  await expect(editor.locator('[data-block-content="next"]')).toBeFocused();
  await insideMark(content, "code");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(editor.locator('[data-block-content="previous"]')).toBeFocused();
});

test("Inside input expands its format while leaving a link keeps new text outside the link", async ({ page, request }) => {
  const editor = await openBlocks(page, request, [
    block("code", "A abc Z", [{ type: "code", start: 2, end: 5 }]),
    block("link", "A abc Z", [{ type: "link", start: 2, end: 5, href: "https://example.com" }]),
  ]);
  const code = editor.locator('[data-block-content="code"]');
  await insideMark(code, "code", 1);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("XY");
  await expect.poll(() => savedBlock(request, "code")).toEqual({ text: "A XYabc Z", marks: [{ type: "code", start: 2, end: 7 }] });
  const link = editor.locator('[data-block-content="link"]');
  await insideMark(link, "link");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("XY");
  await expect.poll(() => savedBlock(request, "link")).toEqual({ text: "A XYabc Z", marks: [{ type: "link", start: 4, end: 7, href: "https://example.com" }] });
});

test("Explicit bold typing and Korean composition retain the chosen inline boundary", async ({ page, request }) => {
  const editor = await openBlocks(page, request, [block("bold", "abc", [{ type: "code", start: 0, end: 3 }]), block("ime", "abc", [{ type: "code", start: 0, end: 3 }]), block("off", "abc", [{ type: "bold", start: 0, end: 3 }])]);
  const bold = editor.locator('[data-block-content="bold"]');
  await insideMark(bold, "code");
  await page.keyboard.press("Meta+b");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("X");
  await expect.poll(() => savedBlock(request, "bold")).toEqual({ text: "Xabc", marks: [{ type: "bold", start: 0, end: 1 }, { type: "code", start: 1, end: 4 }] });
  await page.keyboard.press("Meta+b");
  const ime = editor.locator('[data-block-content="ime"]');
  await insideMark(ime, "code");
  await page.keyboard.press("ArrowLeft");
  await ime.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    document.execCommand("insertText", false, "한");
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한" }));
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: "한", inputType: "insertCompositionText" }));
  });
  await expect.poll(() => savedBlock(request, "ime")).toEqual({ text: "한abc", marks: [{ type: "code", start: 1, end: 4 }] });
  const off = editor.locator('[data-block-content="off"]');
  await insideMark(off, "bold", 1);
  await page.keyboard.press("Meta+b");
  await page.keyboard.press("Meta+b");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("X");
  await expect.poll(() => savedBlock(request, "off")).toEqual({ text: "Xabc", marks: [{ type: "bold", start: 1, end: 4 }] });
});

test("Table cells share inline boundary typing without absorbing subsequent characters", async ({ page, request }) => {
  const table = { ...block("table", "| abc | tail |\n| --- | --- |\n| one | two |"), type: "table", tableCellMarks: { "0:0": [{ type: "code", start: 0, end: 3 }] } };
  const editor = await openBlocks(page, request, [table]);
  const cell = editor.locator('[data-resource-table-cell][data-table-row="0"][data-table-column="0"]');
  await insideMark(cell, "code", 1);
  await page.keyboard.press("ArrowLeft");
  expect(await caret(cell)).toEqual({ offset: 0, marks: ["code"], collapsed: true });
  await page.keyboard.press("ArrowLeft");
  expect(await caret(cell)).toEqual({ offset: 0, marks: [], collapsed: true });
  await expectOutsideCaret(cell, "code", "left");
  await page.keyboard.type("XY");
  await expect(cell.locator('[data-inline-mark="code"]')).toHaveText("abc");
  await expect.poll(async () => {
    const resource = (await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === RESOURCE_ID);
    return resource.blocks.find((block) => block.id === "table").tableCellMarks["0:0"];
  }).toEqual([{ type: "code", start: 2, end: 5 }]);
});

for (const width of [1440, 390]) test(`One arrow leaves an inline edge visibly and the next moves into neighboring text at ${width}px`, async ({ page, request }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  const editor = await openBlocks(page, request, [block("target", "A abc Z", [{ type: "code", start: 2, end: 5 }]), block("next", "next")]);
  const content = editor.locator('[data-block-content="target"]');
  await insideMark(content, "code", 0);
  await page.keyboard.press("ArrowLeft");
  expect(await caret(content)).toEqual({ offset: 2, marks: [], collapsed: true });
  await expectOutsideCaret(content, "code", "left");
  await content.screenshot({ path: info.outputPath(`code-outside-left-caret-${width}.png`), caret: "initial" });
  await page.keyboard.press("ArrowLeft");
  expect(await caret(content)).toEqual({ offset: 1, marks: [], collapsed: true });
  await expect(content).not.toHaveAttribute("data-inline-boundary-caret");

  await insideMark(content, "code", 3);
  await page.keyboard.press("ArrowRight");
  expect(await caret(content)).toEqual({ offset: 5, marks: [], collapsed: true });
  await expectOutsideCaret(content, "code", "right");
  await content.screenshot({ path: info.outputPath(`code-outside-right-caret-${width}.png`), caret: "initial" });
  await page.keyboard.press("ArrowRight");
  expect(await caret(content)).toEqual({ offset: 6, marks: [], collapsed: true });
  await expect(content).not.toHaveAttribute("data-inline-boundary-caret");

  await insideMark(content, "code", 0);
  await page.keyboard.press("ArrowLeft");
  await editor.locator('[data-block-content="next"]').click();
  await expect(content).not.toHaveAttribute("data-inline-boundary-caret");
  expect(await savedBlock(request, "target")).toEqual({ text: "A abc Z", marks: [{ type: "code", start: 2, end: 5 }] });
});

test("Table typing reconciles native code expansion before the next Markdown shortcut", async ({ page, request }) => {
  const table = { ...block("table", "| abc | tail |\n| --- | --- |\n| one | two |"), type: "table", tableCellMarks: { "0:0": [{ type: "code", start: 0, end: 3 }] } };
  const editor = await openBlocks(page, request, [table]);
  const cell = editor.locator('[data-resource-table-cell][data-table-row="0"][data-table-column="0"]');
  await insideMark(cell, "code", 3);
  // Reproduce the native DOM result when a trailing space is absorbed into code.
  const codeAfterInput = await cell.evaluate((element) => {
    const code = element.querySelector('[data-inline-mark="code"]');
    code.textContent += " ";
    const range = document.createRange();
    range.selectNodeContents(code);
    range.collapse(false);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: " ", inputType: "insertText" }));
    return element.querySelector('[data-inline-mark="code"]').textContent;
  });
  expect(codeAfterInput).toBe("abc");
  await page.keyboard.type("~~strike~~");
  await expect(cell).toHaveText("abc strike");
  await expect(cell.locator('[data-inline-mark="strike"]')).toHaveText("strike");
});

test("A caret at the first or last document edge stays visibly outside on repeated arrows", async ({ page, request }) => {
  const editor = await openBlocks(page, request, [block("target", "abc", [{ type: "code", start: 0, end: 3 }])]);
  const content = editor.locator('[data-block-content="target"]');
  for (const [offset, key, side] of [[0, "ArrowLeft", "left"], [3, "ArrowRight", "right"]]) {
    await insideMark(content, "code", offset);
    await page.keyboard.press(key);
    await page.keyboard.press(key);
    expect(await caret(content)).toEqual({ offset, marks: [], collapsed: true });
    await expectOutsideCaret(content, "code", side);
  }
});

test("Table boundary caret clears on focus leaving the cell without changing the selection", async ({ page, request }) => {
  const table = { ...block("table", "| abc | tail |\n| --- | --- |\n| one | two |"), type: "table", tableCellMarks: { "0:0": [{ type: "code", start: 0, end: 3 }] } };
  const editor = await openBlocks(page, request, [table]);
  const cell = editor.locator('[data-resource-table-cell][data-table-row="0"][data-table-column="0"]');
  await insideMark(cell, "code", 0);
  await page.keyboard.press("ArrowLeft");
  await expectOutsideCaret(cell, "code", "left");
  await page.locator("[data-resource-title]").focus();
  await expect(cell).not.toHaveAttribute("data-inline-boundary-caret");
});

test("Boundary caret follows a wrapped mark when the Resource viewport becomes narrow", async ({ page, request }) => {
  const prefix = "문장 앞의 내용 ".repeat(12);
  const editor = await openBlocks(page, request, [block("target", `${prefix}abc Z`, [{ type: "code", start: prefix.length, end: prefix.length + 3 }])]);
  const content = editor.locator('[data-block-content="target"]');
  await insideMark(content, "code", 0);
  await page.keyboard.press("ArrowLeft");
  await expectOutsideCaret(content, "code", "left");
  await page.setViewportSize({ width: 390, height: 1000 });
  await expectOutsideCaret(content, "code", "left");
  await page.keyboard.type("X");
  await expect.poll(() => savedBlock(request, "target")).toEqual({ text: `${prefix}Xabc Z`, marks: [{ type: "code", start: prefix.length + 1, end: prefix.length + 4 }] });
});
