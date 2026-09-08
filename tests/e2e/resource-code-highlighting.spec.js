import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const RESOURCE_ID = FIXTURE_IDS.bodySearchResource;
const codeBlock = (id, text, language = "javascript") => ({ id, type: "code", text, language, marks: [], checked: false, indent: 0, collapsed: false });
const examples = [
  ["javascript", "const answer = 42; // note"],
  ["typescript", "const answer: number = 42;"],
  ["python", 'def greet():\n    return "hello"'],
  ["java", 'public class Hello { String message = "hello"; }'],
  ["c", "int main(void) { return 42; }"],
  ["cpp", 'class Hello { public: int answer = 42; };'],
  ["csharp", 'public class Hello { string message = "hello"; }'],
  ["go", 'package main\nfunc main() { println("hello") }'],
  ["rust", 'fn main() { let answer = 42; }'],
  ["swift", 'let answer: Int = 42'],
  ["kotlin", 'fun main() { val answer = 42 }'],
  ["html", '<div class="greeting">hello &amp; bye</div>'],
  ["css", '.greeting { color: red; margin: 10px; }'],
  ["json", '{"answer": 42, "ready": true}'],
  ["sql", "SELECT name FROM users WHERE id = 42;"],
  ["bash", '#!/bin/bash\necho "hello"'],
  ["markdown", '# Heading\n**strong** [link](https://example.com)'],
  ["yaml", 'name: hello\nready: true'],
  ["php", '<?php function greet() { return "hello"; }'],
  ["ruby", 'def greet\n  puts "hello"\nend'],
];
const aliases = [["js", "javascript"], ["ts", "typescript"], ["py", "python"], ["c++", "cpp"], ["cs", "csharp"], ["xml", "html"], ["sh", "bash"], ["md", "markdown"], ["yml", "yaml"], ["rb", "ruby"]];

async function openResource(page) {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-nav-key="resources"]').evaluate((button) => button.click());
  await page.locator(`[data-resource-open="${RESOURCE_ID}"]`).click();
  const editor = page.locator(`.block-editor[data-owner-id="${RESOURCE_ID}"]`);
  await expect(editor).toBeVisible();
  return editor;
}

async function openBlocks(page, request, blocks) {
  await resetFixture(request);
  const before = await fixtureSnapshot(request);
  const state = structuredClone(before.state);
  state.resources.find((resource) => resource.id === RESOURCE_ID).blocks = blocks;
  expect((await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state, baseRevision: before.serverRevision },
  })).ok()).toBeTruthy();
  return openResource(page);
}

async function savedBlock(request, id) {
  const resource = (await fixtureSnapshot(request)).state.resources.find((entry) => entry.id === RESOURCE_ID);
  const { text, marks } = resource.blocks.find((entry) => entry.id === id);
  return { text, marks };
}

async function selectText(content, start, end = start) {
  await content.evaluate((element, { start, end }) => {
    element.focus();
    const point = (offset) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      let last;
      while ((node = walker.nextNode())) {
        last = node;
        if (offset <= node.length) return [node, offset];
        offset -= node.length;
      }
      return last ? [last, last.length] : [element, 0];
    };
    window.getSelection().setBaseAndExtent(...point(start), ...point(end));
  }, { start, end });
}

async function caret(content) {
  return content.evaluate((element) => {
    const selection = window.getSelection();
    if (!element.contains(selection.focusNode)) return null;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(selection.focusNode, selection.focusOffset);
    return range.toString().length;
  });
}

async function paste(content, text) {
  await content.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    clipboardData.setData("text/html", '<span class="hljs-keyword" style="color:red">untrusted HTML</span>');
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, text);
}

test.use({ reducedMotion: "reduce" });

test("all 20 code languages and their aliases show token colors without changing source or stored marks", async ({ page, request }) => {
  const blocks = examples.map(([language, text]) => codeBlock(language, text, language));
  for (const [alias, language] of aliases) blocks.push(codeBlock(`alias-${alias}`, examples.find(([key]) => key === language)[1], alias));
  const editor = await openBlocks(page, request, blocks);
  for (const block of blocks) {
    const content = editor.locator(`[data-block-content="${block.id}"]`);
    expect(await content.textContent(), block.language).toBe(block.text);
    const tokens = await content.evaluate((element) => [...element.querySelectorAll('[class*="hljs-"]')].map((token) => ({ text: token.textContent, color: getComputedStyle(token).color, plain: getComputedStyle(element).color })));
    expect(tokens.some((token) => token.text && token.color !== token.plain), block.language).toBe(true);
    await expect(content.locator("[data-inline-mark]")).toHaveCount(0);
  }
  for (const [alias, language] of aliases) {
    expect(await editor.locator(`[data-block-content="alias-${alias}"]`).innerHTML()).toBe(await editor.locator(`[data-block-content="${language}"]`).innerHTML());
  }
  await expect(editor.locator('[data-block-content="javascript"] .hljs-keyword')).toHaveText("const");
  await expect(editor.locator('[data-block-content="javascript"] .hljs-number')).toHaveText("42");
  await expect(editor.locator('[data-block-content="javascript"] .hljs-comment')).toHaveText("// note");
  expect(await editor.locator('[data-block-content="javascript"]').evaluate((element) => getComputedStyle(element.closest(".code-space")).backgroundColor)).toBe("rgb(11, 16, 32)");
  const saved = (await fixtureSnapshot(request)).state.resources.find((entry) => entry.id === RESOURCE_ID).blocks;
  expect(saved.map(({ text, marks }) => ({ text, marks }))).toEqual(blocks.map(({ text, marks }) => ({ text, marks })));
});

test("highlighted typing, indentation, paste, copy, undo, redo and reload keep exact code and caret", async ({ page, request }) => {
  const original = 'const value = "one";';
  const editor = await openBlocks(page, request, [codeBlock("editing", original)]);
  const content = editor.locator('[data-block-content="editing"]');
  await selectText(content, original.indexOf("one"), original.indexOf("one") + 3);
  await page.keyboard.type("two");
  expect(await content.textContent()).toBe('const value = "two";');
  expect(await caret(content)).toBe(original.indexOf("one") + 3);
  await selectText(content, original.length);
  await page.keyboard.press("Enter");
  await expect(content).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(content).toBeFocused();
  await page.keyboard.type("const next = 2;");
  const beforePaste = 'const value = "two";\n\tconst next = 2;';
  expect(await content.textContent()).toBe(beforePaste);
  await expect(content.locator(".hljs-keyword")).toHaveText(["const", "const"]);
  await selectText(content, 0, 5);
  const inserted = 'let pasted = "<tag> & value";\nlet';
  await paste(content, inserted);
  const afterPaste = inserted + beforePaste.slice(5);
  await expect.poll(() => content.textContent()).toBe(afterPaste);
  expect(await caret(content)).toBe(inserted.length);
  await expect(content.locator("tag")).toHaveCount(0);
  await page.keyboard.press("Meta+z");
  await expect.poll(() => content.textContent()).toBe(beforePaste);
  await page.keyboard.press("Meta+Shift+z");
  await expect.poll(() => content.textContent()).toBe(afterPaste);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => { window.__copiedCode = value; } } });
  });
  await editor.locator('[data-code-copy="editing"]').click();
  await expect.poll(() => page.evaluate(() => window.__copiedCode)).toBe(afterPaste);
  await expect.poll(() => savedBlock(request, "editing")).toEqual({ text: afterPaste, marks: [] });
  const reloaded = await openResource(page);
  expect(await reloaded.locator('[data-block-content="editing"]').textContent()).toBe(afterPaste);
  await expect(reloaded.locator('[data-block-content="editing"] .hljs-keyword')).toHaveCount(3);
});

test("IME composition is not rerendered until commit and retains Korean text with empty marks", async ({ page, request }) => {
  const original = 'const message = "";';
  const editor = await openBlocks(page, request, [codeBlock("ime", original)]);
  const content = editor.locator('[data-block-content="ime"]');
  await selectText(content, original.indexOf('"') + 1);
  await content.evaluate((element) => {
    window.__compositionKeyword = element.querySelector(".hljs-keyword");
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const text = document.createTextNode("한글");
    range.insertNode(text);
    range.setStartAfter(text);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: "한글", inputType: "insertCompositionText", isComposing: true }));
  });
  await expect.poll(() => content.textContent()).toBe('const message = "한글";');
  expect(await content.evaluate((element) => element.querySelector(".hljs-keyword") === window.__compositionKeyword)).toBe(true);
  expect(await savedBlock(request, "ime")).toEqual({ text: original, marks: [] });
  await content.evaluate((element) => element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한글" })));
  await expect.poll(() => savedBlock(request, "ime")).toEqual({ text: 'const message = "한글";', marks: [] });
  await expect(content.locator(".hljs-string")).toHaveText('"한글"');
  expect(await caret(content)).toBe(original.indexOf('"') + 3);
  await page.keyboard.press("Meta+z");
  await expect.poll(() => content.textContent()).toBe(original);
});

test("plain, unknown and oversized code remain literal and highlighting failure never loses an edit", async ({ page, request }) => {
  const literal = 'const value = "<img src=x onerror=alert(1)> &";';
  const blocks = [codeBlock("plain", literal, "plaintext"), codeBlock("unknown", literal, "unsupported-language"), codeBlock("large", "// " + "x".repeat(50_000)), codeBlock("failure", literal)];
  const editor = await openBlocks(page, request, blocks);
  for (const block of blocks.slice(0, 3)) {
    const content = editor.locator(`[data-block-content="${block.id}"]`);
    expect(await content.textContent()).toBe(block.text);
    await expect(content.locator("span,img")).toHaveCount(0);
  }
  const content = editor.locator('[data-block-content="failure"]');
  await page.evaluate(() => { window.hljs.highlight = () => { throw new Error("Highlighter unavailable"); }; });
  await selectText(content, literal.length);
  await page.keyboard.type(" // preserved");
  expect(await content.textContent()).toBe(literal + " // preserved");
  await expect(content.locator("span,img")).toHaveCount(0);
  await expect.poll(() => savedBlock(request, "failure")).toEqual({ text: literal + " // preserved", marks: [] });
});

test("language changes and immediate typing after a code fence keep highlighting in sync", async ({ page, request }) => {
  const editor = await openBlocks(page, request, [{ ...codeBlock("fence", ""), type: "paragraph" }]);
  const content = editor.locator('[data-block-content="fence"]');
  await content.click();
  await page.keyboard.type("```js");
  await page.keyboard.press("Enter");
  await page.keyboard.type('const message = "hello";');
  await expect(content.locator(".hljs-keyword")).toHaveText("const");
  await editor.locator('[data-code-language-trigger="fence"]').click();
  await editor.locator('[data-code-language-value=""]').click();
  await expect(content.locator("span")).toHaveCount(0);
  await editor.locator('[data-code-language-trigger="fence"]').click();
  await editor.locator('[data-code-language-value="typescript"]').click();
  await expect(content.locator(".hljs-keyword")).toHaveText("const");
  await expect.poll(() => savedBlock(request, "fence")).toEqual({ text: 'const message = "hello";', marks: [] });
});

test("pending fence input recovery updates code line metrics and Mermaid preview source", async ({ page, request }) => {
  const editor = await openBlocks(page, request, [
    { ...codeBlock("pending-code", ""), type: "paragraph" },
    { ...codeBlock("pending-mermaid", ""), type: "paragraph" },
  ]);
  for (const [id, language, source] of [
    ["pending-code", "js", "const first = 1;\nconst second = 2;"],
    ["pending-mermaid", "mermaid", "flowchart LR\n A[시작] --> B[완료]"],
  ]) {
    await editor.locator(`[data-block-content="${id}"]`).click();
    await page.keyboard.type("```" + language);
    await page.keyboard.press("Enter");
    // Exercise the existing focus-recovery path separately from normal native input.
    expect(await page.evaluate(({ resourceId, id, source }) => appendPendingMarkdownText("resources", resourceId, id, source), { resourceId: RESOURCE_ID, id, source })).toBe(true);
    const content = editor.locator(`[data-block-content="${id}"]`);
    expect(await content.textContent()).toBe(source);
    expect(await caret(content)).toBe(source.length);
    await expect.poll(() => savedBlock(request, id)).toEqual({ text: source, marks: [] });
    if (language === "js") {
      const space = editor.locator(`[data-code-block-id="${id}"]`);
      await expect(content.locator(".hljs-keyword")).toHaveText(["const", "const"]);
      await expect(space.locator("[data-code-line-numbers] i")).toHaveCount(2);
      await expect(space.locator("[data-code-line-summary]")).toHaveText("2 lines");
    } else {
      const preview = editor.locator(`[data-code-block-id="${id}"] [data-mermaid-preview]`);
      await expect(preview).toHaveAttribute("data-source", source);
      await expect(preview).toHaveAttribute("data-mermaid-state", "ready");
      await expect(preview).toContainText("완료");
      await editor.locator(`[data-code-block-id="${id}"] [data-mermaid-edit]`).click();
      await expect(content).not.toBeVisible();
      await preview.click();
      await expect(content).not.toBeVisible();
      await expect(content).not.toBeFocused();
    }
  }
});
