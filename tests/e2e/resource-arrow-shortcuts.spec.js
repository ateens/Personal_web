import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const resourceId = FIXTURE_IDS.bodySearchResource;
const paragraph = (id, text = "", marks = []) => ({ id, type: "paragraph", text, marks, checked: false, indent: 0, collapsed: false });

test.use({ reducedMotion: "reduce" });

async function savedBlocks(request) {
  return (await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === resourceId).blocks;
}

async function open(page) {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-nav-key="resources"]').evaluate((button) => button.click());
  await page.locator(`[data-resource-open="${resourceId}"]`).click();
  const editor = page.locator(`.block-editor[data-owner-id="${resourceId}"]`);
  await expect(editor).toBeVisible();
  return editor;
}

async function seed(page, request, blocks) {
  await resetFixture(request);
  const snapshot = await fixtureSnapshot(request);
  const state = structuredClone(snapshot.state);
  state.resources.find((resource) => resource.id === resourceId).blocks = blocks;
  const response = await request.put("/api/state", { headers: { "If-Match": `"state-${snapshot.serverRevision}"` }, data: { state, baseRevision: snapshot.serverRevision } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return open(page);
}

async function setCaret(content, offset) {
  await content.scrollIntoViewIfNeeded();
  await content.evaluate((element, offset) => {
    element.focus();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let node = walker.nextNode();
    while (node && remaining > node.textContent.length) { remaining -= node.textContent.length; node = walker.nextNode(); }
    const range = document.createRange();
    if (node) range.setStart(node, Math.min(remaining, node.textContent.length));
    else range.selectNodeContents(element);
    range.collapse(true);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, offset);
}

async function caret(content) {
  return content.evaluate((element) => {
    const selection = getSelection();
    if (!selection?.rangeCount || !element.contains(selection.focusNode)) return null;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(selection.focusNode, selection.focusOffset);
    return { offset: range.toString().length, collapsed: selection.isCollapsed, focused: document.activeElement === element };
  });
}

async function pasteText(content, text) {
  await content.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData });
    if (!element.dispatchEvent(event)) return;
    // Synthetic paste does not execute native default insertion. Preserve the
    // real insertFromPaste event type when the app leaves that path to the browser.
    if (!element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertFromPaste", data: text }))) return;
    const selection = getSelection();
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: text }));
  }, text);
}

test("typed arrows convert at the caret in ordinary, middle and consecutive text", async ({ page, request }) => {
  const editor = await seed(page, request, [paragraph("ordinary"), paragraph("middle-right", "앞 뒤"), paragraph("middle-left", "앞 뒤")]);
  const ordinary = editor.locator('[data-block-content="ordinary"]');
  await ordinary.pressSequentially("A -> B <- C -><-");
  const text = "A → B ← C →←";
  await expect(ordinary).toHaveText(text);
  expect(await caret(ordinary)).toEqual({ offset: text.length, collapsed: true, focused: true });
  await ordinary.pressSequentially(" 끝");
  await expect(ordinary).toHaveText(`${text} 끝`);
  for (const [id, source, result] of [["middle-right", "->", "→"], ["middle-left", "<-", "←"]]) {
    const content = editor.locator(`[data-block-content="${id}"]`);
    await setCaret(content, 2);
    await content.pressSequentially(source);
    await expect(content).toHaveText(`앞 ${result}뒤`);
    expect(await caret(content)).toEqual({ offset: 3, collapsed: true, focused: true });
  }
  await expect.poll(async () => (await savedBlocks(request)).map((block) => block.text)).toEqual([`${text} 끝`, "앞 →뒤", "앞 ←뒤"]);
  const reloaded = await open(page);
  await expect(reloaded.locator("[data-block-content]")).toHaveText([`${text} 끝`, "앞 →뒤", "앞 ←뒤"]);
});

test("arrow conversion preserves formatting offsets and has its own undo step", async ({ page, request }) => {
  const marks = [{ type: "bold", start: 0, end: 2 }, { type: "italic", start: 3, end: 5 }, { type: "link", start: 6, end: 8, href: "https://example.com" }];
  const editor = await seed(page, request, [paragraph("styled", "AB CD EF", marks)]);
  const content = editor.locator('[data-block-content="styled"]');
  await setCaret(content, 1);
  await content.pressSequentially("->");
  await expect(content).toHaveText("A→B CD EF");
  await expect(content.locator('[data-inline-mark="bold"]')).toHaveText("A→B");
  await content.press("Meta+z");
  await expect(content).toHaveText("A->B CD EF");
  await expect(content.locator('[data-inline-mark="bold"]')).toHaveText("A->B");
  await content.press("Meta+Shift+z");
  await expect(content).toHaveText("A→B CD EF");
  await setCaret(content, 5);
  await content.pressSequentially("<-");
  await expect(content).toHaveText("A→B C←D EF");
  await expect(content.locator('[data-inline-mark="italic"]')).toHaveText("C←D");
  expect(await caret(content)).toEqual({ offset: 6, collapsed: true, focused: true });
  const expected = { text: "A→B C←D EF", marks: [{ type: "bold", start: 0, end: 3 }, { type: "italic", start: 4, end: 7 }, { type: "link", start: 8, end: 10, href: "https://example.com" }] };
  await expect.poll(async () => { const [block] = await savedBlocks(request); return { text: block.text, marks: block.marks }; }).toEqual(expected);
  const reloaded = await open(page);
  await expect(reloaded.locator('[data-inline-mark="bold"]')).toHaveText("A→B");
  await expect(reloaded.locator('[data-inline-mark="italic"]')).toHaveText("C←D");
  await expect(reloaded.locator('[data-inline-mark="link"]')).toHaveText("EF");
});

test("Korean composition leaves intermediate text untouched and converts once on final commit", async ({ page, request }) => {
  const editor = await seed(page, request, [paragraph("composing")]);
  const content = editor.locator('[data-block-content="composing"]');
  await content.focus();
  // Simulate composition events; operating-system IME input is outside Playwright.
  await content.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertCompositionText", data: "한글 ->", isComposing: true }));
    element.textContent = "한글 ->";
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "한글 ->", isComposing: true }));
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(content).toHaveText("한글 ->");
  await content.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한글 ->" }));
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromComposition", data: "한글 ->", isComposing: false }));
  });
  await expect(content).toHaveText("한글 →");
  expect(await caret(content)).toEqual({ offset: 4, collapsed: true, focused: true });
  await content.pressSequentially(" 다음 <-");
  await expect(content).toHaveText("한글 → 다음 ←");
  await expect.poll(async () => (await savedBlocks(request))[0].text).toBe("한글 → 다음 ←");
});

test("code blocks, inline code and unfinished code or math syntax retain literal arrows", async ({ page, request }) => {
  const raw = ["`a->b`", "$a->b$", "$$ a<-b $$", String.raw`\(a->b\)`];
  const editor = await seed(page, request, [
    { ...paragraph("plain-code"), type: "code", language: "" }, { ...paragraph("javascript-code"), type: "code", language: "javascript" },
    paragraph("inline-right", "x-y", [{ type: "code", start: 0, end: 3 }]), paragraph("inline-left", "x<y", [{ type: "code", start: 0, end: 3 }]),
    ...raw.map((text, index) => paragraph(`raw-${index}`)),
  ]);
  for (const id of ["plain-code", "javascript-code"]) {
    const content = editor.locator(`[data-block-content="${id}"]`);
    await content.pressSequentially("-> <-");
    await expect(content).toHaveText("-> <-");
  }
  for (const [id, input, expected] of [["inline-right", ">", "x->y"], ["inline-left", "-", "x<-y"]]) {
    const content = editor.locator(`[data-block-content="${id}"]`);
    await setCaret(content, 2);
    await content.pressSequentially(input);
    await expect(content.locator('[data-inline-mark="code"]')).toHaveText(expected);
  }
  for (const [index, text] of raw.entries()) {
    const content = editor.locator(`[data-block-content="raw-${index}"]`);
    await content.pressSequentially(text);
    if (index === 0) await expect(content.locator('[data-inline-mark="code"]')).toHaveText("a->b");
    else await expect(content.locator('[data-inline-mark="equation"]')).toHaveAttribute("data-equation-formula", index === 2 ? "a<-b" : "a->b");
  }
  await expect.poll(async () => (await savedBlocks(request)).map((block) => block.text)).toEqual(["-> <-", "-> <-", "x->y", "x<-y", "a->b", "a->b", "a<-b", "a->b"]);
});

test("arrows beside equations shift their marks while formula editing stays literal", async ({ page, request }) => {
  const editor = await seed(page, request, [paragraph("equation", "앞 x+y 뒤", [{ type: "equation", start: 2, end: 5, formula: "x+y" }])]);
  const content = editor.locator('[data-block-content="equation"]');
  await setCaret(content, 1);
  await content.pressSequentially("->");
  await expect.poll(async () => { const [block] = await savedBlocks(request); return { text: block.text, marks: block.marks }; }).toEqual({ text: "앞→ x+y 뒤", marks: [{ type: "equation", start: 3, end: 6, formula: "x+y" }] });
  await content.locator('[data-inline-mark="equation"]').click();
  const dialog = page.getByRole("dialog", { name: "수식 편집" });
  const input = dialog.getByRole("textbox", { name: "수식 입력" });
  await input.fill("");
  await input.pressSequentially("x->y<-z");
  await expect(input).toHaveValue("x->y<-z");
  await input.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => { const [block] = await savedBlocks(request); return { text: block.text, marks: block.marks }; }).toEqual({ text: "앞→ x->y<-z 뒤", marks: [{ type: "equation", start: 3, end: 10, formula: "x->y<-z" }] });
  const reloaded = await open(page);
  await expect(reloaded.locator('[data-inline-mark="equation"]')).toHaveAttribute("data-equation-formula", "x->y<-z");
});

test("table cells share arrow conversion and undo while preserving inline code", async ({ page, request }) => {
  const editor = await seed(page, request, [{ ...paragraph("table", "| 값 | 코드 |\n| --- | --- |\n| **AB** | `x-y` |"), type: "table" }]);
  const cell = (column) => editor.locator(`[data-resource-table-cell][data-table-row="1"][data-table-column="${column}"]`);
  await setCaret(cell(0), 1);
  await cell(0).pressSequentially("->");
  await expect(cell(0)).toHaveText("A→B");
  await expect(cell(0).locator('[data-inline-mark="bold"]')).toHaveText("A→B");
  await cell(0).press("Meta+z");
  await expect(cell(0)).toHaveText("A->B");
  await cell(0).press("Meta+Shift+z");
  await expect(cell(0)).toHaveText("A→B");
  await setCaret(cell(0), 2);
  await cell(0).pressSequentially("<-");
  await expect(cell(0)).toHaveText("A→←B");
  expect(await caret(cell(0))).toEqual({ offset: 3, collapsed: true, focused: true });
  await setCaret(cell(1), 2);
  await cell(1).pressSequentially(">");
  await expect(cell(1).locator('[data-inline-mark="code"]')).toHaveText("x->y");
  await expect.poll(async () => (await savedBlocks(request))[0].text).toContain("A→←B");
  await open(page);
  await expect(cell(0).locator('[data-inline-mark="bold"]')).toHaveText("A→←B");
  await expect(cell(1).locator('[data-inline-mark="code"]')).toHaveText("x->y");
});

test("existing literal arrows and pasted content are not rewritten by unrelated edits or reload", async ({ page, request }) => {
  const editor = await seed(page, request, [paragraph("existing", "원문 -> 유지 <-"), paragraph("pasted")]);
  const existing = editor.locator('[data-block-content="existing"]');
  await setCaret(existing, "원문 -> 유지 <-".length);
  await existing.pressSequentially("!");
  await expect(existing).toHaveText("원문 -> 유지 <-!");
  const pasted = editor.locator('[data-block-content="pasted"]');
  await setCaret(pasted, 0);
  await pasteText(pasted, "붙인 -> 원문 <-");
  await expect(pasted).toHaveText("붙인 -> 원문 <-");
  await expect.poll(async () => (await savedBlocks(request)).map((block) => block.text)).toEqual(["원문 -> 유지 <-!", "붙인 -> 원문 <-"]);
  const reloaded = await open(page);
  await expect(reloaded.locator("[data-block-content]")).toHaveText(["원문 -> 유지 <-!", "붙인 -> 원문 <-"]);
});

test("single-character paste stays literal in paragraphs and table cells without disabling later typing", async ({ page, request }) => {
  const editor = await seed(page, request, [paragraph("partial", "x-y"), { ...paragraph("paste-table", "| 값 |\n| --- |\n| x-y |"), type: "table" }]);
  const plain = editor.locator('[data-block-content="partial"]');
  const cell = editor.locator('[data-resource-table-cell][data-table-row="1"][data-table-column="0"]');
  for (const content of [plain, cell]) {
    await setCaret(content, 2);
    await pasteText(content, ">");
    await expect(content).toHaveText("x->y");
  }
  await expect.poll(async () => (await savedBlocks(request))[0].text).toBe("x->y");
  await expect.poll(async () => (await savedBlocks(request))[1].text).toContain("x-&gt;y");
  await setCaret(plain, 4);
  await plain.pressSequentially("->");
  await expect(plain).toHaveText("x->y→");
  await setCaret(cell, 4);
  await cell.pressSequentially("<-");
  await expect(cell).toHaveText("x->y←");
  await expect.poll(async () => (await savedBlocks(request))[1].text).toContain("x-&gt;y←");
  await open(page);
  await expect(plain).toHaveText("x->y→");
  await expect(cell).toHaveText("x->y←");
});

test("arrows typed immediately after heading and list Markdown shortcuts still convert", async ({ page, request }) => {
  const editor = await seed(page, request, [paragraph("pending-heading"), paragraph("pending-bullet")]);
  for (const [id, prefix, type] of [["pending-heading", "#", "heading1"], ["pending-bullet", "-", "bullet"]]) {
    const content = editor.locator(`[data-block-content="${id}"]`);
    await content.pressSequentially(`${prefix} ->`);
    await expect(editor.locator(`[data-block-id="${id}"]`)).toHaveAttribute("data-type", type);
    await expect(content).toHaveText("→");
    expect(await caret(content)).toEqual({ offset: 1, collapsed: true, focused: true });
  }
  await expect.poll(async () => (await savedBlocks(request)).map(({ type, text }) => ({ type, text }))).toEqual([{ type: "heading1", text: "→" }, { type: "bullet", text: "→" }]);
});
