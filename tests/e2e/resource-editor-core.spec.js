import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z8GQAAAAASUVORK5CYII=",
  "base64",
);

function paragraph(id, text = "") {
  return { id, type: "paragraph", text, marks: [], checked: false, indent: 0, collapsed: false };
}

async function seedResourceBlocks(request, resourceId, blocks) {
  const before = await fixtureSnapshot(request);
  const draft = structuredClone(before.state);
  const resource = draft.resources.find((entry) => entry.id === resourceId);
  resource.blocks = blocks;
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state: draft, baseRevision: before.serverRevision },
  });
  expect(response.ok()).toBeTruthy();
}

async function openResource(page, resourceId = FIXTURE_IDS.resource) {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-nav-key="resources"]').evaluate((button) => button.click());
  await page.locator(`[data-resource-open="${resourceId}"]`).click();
  await expect(page.locator(`[data-resource-document="${resourceId}"]`)).toBeVisible();
  return page.locator(`.block-editor[data-owner-type="resources"][data-owner-id="${resourceId}"]`);
}

async function createEmptyResource(page) {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-nav-key="resources"]').evaluate((button) => button.click());
  await page.locator('[data-resource-view] [data-action="new-resource"]').click();
  const document = page.locator("[data-resource-document]");
  const resourceId = await document.getAttribute("data-resource-document");
  await document.locator("[data-resource-title]").press("Enter");
  return { document, editor: document.locator(".block-editor"), resourceId };
}

async function persistedResource(request, resourceId) {
  const snapshot = await fixtureSnapshot(request);
  return snapshot.state.resources.find((resource) => resource.id === resourceId);
}

async function setCaret(content, offset) {
  await content.evaluate((element, requestedOffset) => {
    element.focus();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let remaining = requestedOffset;
    let node = walker.nextNode();
    while (node && remaining > node.textContent.length) {
      remaining -= node.textContent.length;
      node = walker.nextNode();
    }
    const range = document.createRange();
    if (node) range.setStart(node, Math.min(remaining, node.textContent.length));
    else range.selectNodeContents(element);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, offset);
}

async function settleAnimationFrames(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function activeCaret(page) {
  return page.evaluate(() => {
    const element = document.activeElement?.closest?.("[data-block-content]");
    const selection = window.getSelection();
    if (!element || !selection?.rangeCount || !element.contains(selection.focusNode)) return null;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(selection.focusNode, selection.focusOffset);
    const caret = selection.getRangeAt(0).cloneRange();
    const rect = caret.getClientRects()[0] || caret.getBoundingClientRect();
    return {
      blockId: element.dataset.blockContent,
      offset: range.toString().length,
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
    };
  });
}

async function resourceSelectionState(page) {
  return page.evaluate(() => {
    const selection = window.getSelection();
    const blockIdForNode = (node) => (node instanceof Element ? node : node?.parentElement)
      ?.closest?.("[data-block-content]")?.dataset.blockContent || "";
    return {
      text: selection?.toString() || "",
      anchorBlock: blockIdForNode(selection?.anchorNode),
      focusBlock: blockIdForNode(selection?.focusNode),
      selectedIds: [...document.querySelectorAll(".resource-document .block.is-selected")].map((block) => block.dataset.blockId),
    };
  });
}

async function pastePng(content) {
  await content.evaluate((element, bytes) => {
    element.focus();
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([new Uint8Array(bytes)], "clipboard.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, [...PIXEL_PNG]);
}

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("제목과 본문, 자동 링크가 저장되고 새로고침 뒤에도 그대로 복원된다", async ({ page, request }) => {
  const editor = await openResource(page, FIXTURE_IDS.bodySearchResource);
  const title = page.locator(`[data-resource-title="${FIXTURE_IDS.bodySearchResource}"]`);
  const body = editor.locator("[data-block-content]").first();

  await title.fill("저장되는 자료 제목");
  await body.fill("참고 링크 https://example.com/resource-path 확인 ");
  const link = body.locator('a[data-inline-mark="link"]');
  await expect(link).toHaveAttribute("href", "https://example.com/resource-path");

  await expect.poll(async () => {
    const resource = await persistedResource(request, FIXTURE_IDS.bodySearchResource);
    return {
      title: resource?.title,
      text: resource?.blocks[0]?.text,
      href: resource?.blocks[0]?.marks.find((mark) => mark.type === "link")?.href,
    };
  }).toEqual({
    title: "저장되는 자료 제목",
    text: "참고 링크 https://example.com/resource-path 확인 ",
    href: "https://example.com/resource-path",
  });

  const reloadedEditor = await openResource(page, FIXTURE_IDS.bodySearchResource);
  await expect(page.locator(`[data-resource-title="${FIXTURE_IDS.bodySearchResource}"]`)).toHaveValue("저장되는 자료 제목");
  await expect(reloadedEditor.locator("[data-block-content]").first()).toHaveText("참고 링크 https://example.com/resource-path 확인 ");
  await expect(reloadedEditor.locator('a[data-inline-mark="link"]')).toHaveAttribute("href", "https://example.com/resource-path");
});

test("Resource 연속 한글 조합은 이전 commit RAF가 다음 받침 입력을 건드리지 않고 안녕을 저장한다", async ({ page, request }) => {
  const blockId = "korean-composition";
  await seedResourceBlocks(request, FIXTURE_IDS.bodySearchResource, [paragraph(blockId)]);
  const editor = await openResource(page, FIXTURE_IDS.bodySearchResource);
  const content = editor.locator(`[data-block-content="${blockId}"]`);
  await setCaret(content, 0);

  await content.evaluate((element) => {
    const placeCaretAtEnd = () => {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    };
    const updateComposition = (prefix, data) => {
      element.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data }));
      element.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data,
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      element.textContent = `${prefix}${data}`;
      placeCaretAtEnd();
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data,
        inputType: "insertCompositionText",
        isComposing: true,
      }));
    };
    const compose = (updates) => {
      const prefix = element.textContent || "";
      element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      for (const data of updates) {
        updateComposition(prefix, data);
      }
      const committed = updates.at(-1);
      element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: committed }));
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: committed,
        inputType: "insertText",
      }));
    };

    compose(["ㅇ", "아", "안"]);
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    updateComposition("안", "ㄴ");
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

  await expect(content).toHaveText("안ㄴ");
  expect(await activeCaret(page)).toMatchObject({ blockId, offset: 2 });

  await content.evaluate((element) => {
    const updateComposition = (data) => {
      element.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data }));
      element.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data,
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      element.textContent = `안${data}`;
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data,
        inputType: "insertCompositionText",
        isComposing: true,
      }));
    };

    updateComposition("녀");
    updateComposition("녕");
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "녕" }));
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "녕",
      inputType: "insertText",
    }));
  });
  await settleAnimationFrames(page);

  await expect(content).toHaveText("안녕");
  await expect.poll(async () => {
    const resource = await persistedResource(request, FIXTURE_IDS.bodySearchResource);
    return { count: resource?.blocks.length, text: resource?.blocks[0]?.text };
  }).toEqual({ count: 1, text: "안녕" });
});

test("Markdown 목록, 인용, 토글과 Tab 계층 이동이 같은 편집기에서 동작한다", async ({ page, request }) => {
  const { editor, resourceId } = await createEmptyResource(page);
  let content = editor.locator("[data-block-content]").first();

  await content.type("- ");
  let block = content.locator("xpath=ancestor::*[@data-block-id][1]");
  await expect(block).toHaveAttribute("data-type", "bullet");
  await expect(block).toHaveAttribute("role", "listitem");
  await expect(block.locator("xpath=parent::*")).toHaveAttribute("role", "list");
  await expect(content).toHaveAttribute("aria-label", "글머리 기호 블록 편집");
  const marker = block.locator(".block-list-marker");
  await expect(marker).toHaveText("•");
  await expect(marker).toHaveAttribute("aria-hidden", "true");
  const emptyBulletGeometry = await content.evaluate((element) => {
    const markerElement = element.closest("[data-block-id]").querySelector(".block-list-marker");
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const rangeRect = range?.getClientRects()[0] || range?.getBoundingClientRect();
    const contentRect = element.getBoundingClientRect();
    const markerRect = markerElement.getBoundingClientRect();
    const caretLeft = rangeRect && (rangeRect.width || rangeRect.height) ? rangeRect.left : contentRect.left + 4;
    return { caretLeft, markerRight: markerRect.right };
  });
  expect(emptyBulletGeometry.caretLeft).toBeGreaterThanOrEqual(emptyBulletGeometry.markerRight - 1);

  await content.type("부모 항목");
  const parentId = await block.getAttribute("data-block-id");
  await content.press("Enter");

  content = editor.locator("[data-block-content]:focus");
  block = content.locator("xpath=ancestor::*[@data-block-id][1]");
  const continuationId = await block.getAttribute("data-block-id");
  await expect(editor.locator(`[data-block-id="${parentId}"] + [data-block-id="${continuationId}"]`)).toHaveCount(1);
  await expect(block).toHaveAttribute("data-type", "bullet");
  await expect(content).toBeFocused();
  await expect.poll(async () => (await activeCaret(page))?.offset).toBe(0);
  await content.type("자식 항목");
  await content.press("Tab");
  await expect(content.locator("xpath=ancestor::*[@data-block-id][1]")).toHaveAttribute("data-indent", "1");
  await content.press("Shift+Tab");
  await expect(content.locator("xpath=ancestor::*[@data-block-id][1]")).toHaveAttribute("data-indent", "0");

  await content.press("Enter");
  await editor.locator("[data-block-content]:focus").press("Enter");
  content = editor.locator("[data-block-content]:focus");
  await content.type("| ");
  await expect(content.locator("xpath=ancestor::*[@data-block-id][1]")).toHaveAttribute("data-type", "quote");
  await content.type("인용문");

  await content.press("Enter");
  await editor.locator("[data-block-content]:focus").press("Enter");
  content = editor.locator("[data-block-content]:focus");
  await content.type("> ");
  const toggleBlock = content.locator("xpath=ancestor::*[@data-block-id][1]");
  await expect(toggleBlock).toHaveAttribute("data-type", "toggle");
  await expect(toggleBlock.locator("[data-block-toggle]")).toBeVisible();
  await content.type("접을 수 있는 내용");

  await expect.poll(async () => (await persistedResource(request, resourceId))?.blocks.filter((block) => block.text).map((block) => block.type)).toEqual([
    "bullet",
    "bullet",
    "quote",
    "toggle",
  ]);
});

test("번호 목록 앞과 중간에서 Enter로 삽입해도 marker가 저장 순서대로 다시 매겨진다", async ({ page, request }) => {
  const firstId = "numbered-enter-first";
  const secondId = "numbered-enter-second";
  await seedResourceBlocks(request, FIXTURE_IDS.bodySearchResource, [
    { id: firstId, type: "numbered", text: "첫째 항목", marks: [], checked: false, indent: 0, collapsed: false, listStart: 1 },
    { id: secondId, type: "numbered", text: "둘째 항목", marks: [], checked: false, indent: 0, collapsed: false },
  ]);
  let editor = await openResource(page, FIXTURE_IDS.bodySearchResource);
  const markers = () => editor.locator(".block-list-marker");
  await expect(markers()).toHaveText(["1.", "2."]);

  const first = editor.locator(`[data-block-content="${firstId}"]`);
  await setCaret(first, 0);
  await page.keyboard.press("Enter");
  await expect(markers()).toHaveText(["1.", "2.", "3."]);
  await expect(first).toBeFocused();
  await expect.poll(async () => (await persistedResource(request, FIXTURE_IDS.bodySearchResource))?.blocks.length).toBe(3);
  await settleAnimationFrames(page);

  const second = editor.locator(`[data-block-content="${secondId}"]`);
  await setCaret(second, 2);
  await expect.poll(() => activeCaret(page)).toMatchObject({ blockId: secondId, offset: 2 });
  await page.keyboard.press("Enter");
  await expect(markers()).toHaveText(["1.", "2.", "3.", "4."]);
  const renderedMarkers = await markers().allTextContents();
  expect(new Set(renderedMarkers).size).toBe(renderedMarkers.length);

  await expect.poll(async () => {
    const resource = await persistedResource(request, FIXTURE_IDS.bodySearchResource);
    return resource?.blocks.map((block) => ({
      type: block.type,
      text: block.text,
      listStart: block.listStart || 0,
    }));
  }).toEqual([
    { type: "numbered", text: "", listStart: 1 },
    { type: "numbered", text: "첫째 항목", listStart: 0 },
    { type: "numbered", text: "둘째", listStart: 0 },
    { type: "numbered", text: " 항목", listStart: 0 },
  ]);

  editor = await openResource(page, FIXTURE_IDS.bodySearchResource);
  await expect(markers()).toHaveText(["1.", "2.", "3.", "4."]);
});

test("Markdown 제목 4-6, fenced code 언어와 핵심 inline 문법을 붙여넣을 수 있다", async ({ page, request }) => {
  const { editor: liveEditor } = await createEmptyResource(page);
  let liveContent = liveEditor.locator("[data-block-content]").first();
  await liveContent.type("# ");
  let liveBlock = liveContent.locator("xpath=ancestor::*[@data-block-id][1]");
  await expect(liveBlock).toHaveAttribute("data-type", "heading1");
  await expect(liveContent.locator("xpath=parent::h1")).toHaveCount(1);
  await expect(liveContent).toHaveAttribute("aria-label", "제목 1 블록 편집");
  await liveContent.type("즉시 제목");
  await liveContent.press("Enter");

  liveContent = liveEditor.locator("[data-block-content]:focus");
  await liveContent.type("- [x] ");
  liveBlock = liveContent.locator("xpath=ancestor::*[@data-block-id][1]");
  await expect(liveBlock).toHaveAttribute("data-type", "todo");
  await expect(liveBlock).toHaveAttribute("data-checked", "true");
  await liveContent.type("완료 항목");
  await liveContent.press("Enter");

  liveContent = liveEditor.locator("[data-block-content]:focus");
  await liveContent.type("1. [ ] ");
  liveBlock = liveContent.locator("xpath=ancestor::*[@data-block-id][1]");
  await expect(liveBlock).toHaveAttribute("data-type", "todo");
  await expect(liveBlock).toHaveAttribute("data-checked", "false");
  await liveContent.type("미완료 항목");
  await liveContent.press("Enter");
  await liveEditor.locator("[data-block-content]:focus").press("Enter");

  liveContent = liveEditor.locator("[data-block-content]:focus");
  await liveContent.type("~~~python");
  await liveContent.press("Enter");
  await expect(liveEditor.locator('pre[data-code-language="python"] [data-block-content]:focus')).toBeVisible();

  const { editor, resourceId } = await createEmptyResource(page);
  const markdown = [
    "#### 제목 4",
    "##### 제목 5",
    "###### 제목 6",
    "```javascript",
    "const backtick = true;",
    "```",
    "~~~python",
    "print('tilde')",
    "~~~~",
    "5. 다섯 번째 항목",
    "Setext 제목",
    "=====",
    "연속 첫 줄",
    "연속 둘째 줄",
    "",
    "**굵게** *기울임* ~~취소선~~ ***굵고 기울임*** [링크](https://example.com/markdown) [참조 링크][docs]",
    "[docs]: https://example.com/reference",
  ].join("\n");
  await editor.locator("[data-block-content]").first().evaluate((element, text) => {
    element.focus();
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, markdown);

  await expect(editor.locator('h4 [data-block-content]')).toHaveText("제목 4");
  await expect(editor.locator('h5 [data-block-content]')).toHaveText("제목 5");
  await expect(editor.locator('h6 [data-block-content]')).toHaveText("제목 6");
  await expect(editor.locator('pre[data-code-language="javascript"] code')).toHaveText("const backtick = true;");
  await expect(editor.locator('pre[data-code-language="python"] code')).toHaveText("print('tilde')");
  const numbered = editor.locator('.block[data-type="numbered"]');
  await expect(numbered.locator(".block-list-marker")).toHaveText("5.");
  await expect(numbered.locator("[data-block-content]")).toHaveText("다섯 번째 항목");
  await expect(editor.locator('h1 [data-block-content]')).toHaveText("Setext 제목");
  await expect(editor.locator('.block[data-type="paragraph"] [data-block-content]').filter({ hasText: "연속 첫 줄" })).toHaveText("연속 첫 줄\n연속 둘째 줄");
  const inline = editor.locator('.block[data-type="paragraph"]').last();
  await expect(inline.locator('[data-inline-mark="bold"]').filter({ hasText: /^굵게$/ })).toHaveText("굵게");
  await expect(inline.locator('[data-inline-mark="italic"]').filter({ hasText: /^기울임$/ })).toHaveText("기울임");
  await expect(inline.locator('[data-inline-mark="strike"]')).toHaveText("취소선");
  const nested = inline.locator('[data-inline-mark="bold"]', { hasText: "굵고 기울임" });
  await expect(nested.locator('[data-inline-mark="italic"]')).toHaveText("굵고 기울임");
  await expect(inline.locator('a[data-inline-mark="link"]').filter({ hasText: /^링크$/ })).toHaveAttribute("href", "https://example.com/markdown");
  await expect(inline.locator('a[data-inline-mark="link"]', { hasText: "참조 링크" })).toHaveAttribute("href", "https://example.com/reference");

  await expect.poll(async () => {
    const resource = await persistedResource(request, resourceId);
    return resource?.blocks.map((block) => ({
      type: block.type,
      text: block.text,
      language: block.language || "",
      listStart: block.listStart || 0,
      marks: block.marks.map((mark) => mark.type),
    }));
  }).toEqual([
    { type: "heading4", text: "제목 4", language: "", listStart: 0, marks: [] },
    { type: "heading5", text: "제목 5", language: "", listStart: 0, marks: [] },
    { type: "heading6", text: "제목 6", language: "", listStart: 0, marks: [] },
    { type: "code", text: "const backtick = true;", language: "javascript", listStart: 0, marks: [] },
    { type: "code", text: "print('tilde')", language: "python", listStart: 0, marks: [] },
    { type: "numbered", text: "다섯 번째 항목", language: "", listStart: 5, marks: [] },
    { type: "heading1", text: "Setext 제목", language: "", listStart: 0, marks: [] },
    { type: "paragraph", text: "연속 첫 줄\n연속 둘째 줄", language: "", listStart: 0, marks: [] },
    { type: "paragraph", text: "굵게 기울임 취소선 굵고 기울임 링크 참조 링크", language: "", listStart: 0, marks: ["bold", "italic", "strike", "bold", "italic", "link", "link"] },
  ]);
});

test("중간 pipe table과 text fence를 native table 및 Plain Text Code Space로 보존한다", async ({ page, request }) => {
  const { editor, resourceId } = await createEmptyResource(page);
  const codeText = "plain <tag> & value\n두 번째 줄";
  const tableText = [
    "| 층 | dilation | 계산 | receptive field |",
    "| -- | -------: | -----------: | --------------: |",
    "| 시작 | - | 입력 하나 | 1 |",
    String.raw`| 1층 | 1 | (1+2\times1) | 3 |`,
    String.raw`| 2층 | 2 | (3+2\times2) | 7 |`,
    String.raw`| 3층 | 4 | (7+2\times4) | 15 |`,
  ].join("\n");
  const markdown = [
    "표 앞 일반 문단",
    "",
    ...tableText.split("\n"),
    "",
    "표 뒤 일반 문단",
    "",
    "```text",
    ...codeText.split("\n"),
    "```",
  ].join("\n");
  await editor.locator("[data-block-content]").first().evaluate((element, text) => {
    element.focus();
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    clipboardData.setData("text/html", text.split("\n").map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`).join(""));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, markdown);

  const table = editor.locator("table");
  await expect(table).toHaveCount(1);
  await expect(table.locator("thead th")).toHaveText(["층", "dilation", "계산", "receptive field"]);
  await expect(table.locator("tbody tr")).toHaveCount(4);
  await expect(table.locator("tbody tr").nth(0).locator("td")).toHaveText(["시작", "-", "입력 하나", "1"]);
  await expect(table.locator("tbody tr").nth(1).locator("td")).toHaveText(["1층", "1", String.raw`(1+2\times1)`, "3"]);
  await expect(table.locator("tbody tr").nth(2).locator("td")).toHaveText(["2층", "2", String.raw`(3+2\times2)`, "7"]);
  await expect(table.locator("tbody tr").nth(3).locator("td")).toHaveText(["3층", "4", String.raw`(7+2\times4)`, "15"]);
  await expect.poll(() => table.locator("thead th").last().evaluate((cell) => getComputedStyle(cell).textAlign)).toBe("right");
  expect(await table.evaluate((element) => element.closest("[data-resource-table-select]").getBoundingClientRect().height - element.getBoundingClientRect().height)).toBeLessThanOrEqual(2);
  await expect.poll(() => editor.evaluate((root) => {
    const contents = [...root.querySelectorAll("[data-block-content]")];
    const before = contents.find((element) => element.textContent === "표 앞 일반 문단");
    const tableElement = root.querySelector("table");
    const after = contents.find((element) => element.textContent === "표 뒤 일반 문단");
    return Boolean(
      before
      && tableElement
      && after
      && (before.compareDocumentPosition(tableElement) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (tableElement.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING),
    );
  })).toBe(true);

  const codeSpace = editor.locator("[data-code-space]");
  await expect(codeSpace).toHaveCount(1);
  await expect(codeSpace).toHaveClass(/is-plain-text/);
  await expect(codeSpace.locator(".code-space-title")).not.toBeVisible();
  await expect(codeSpace.locator("[data-code-line-numbers]")).toBeHidden();
  await expect(codeSpace.locator(".code-space-footer")).toBeHidden();
  await expect(codeSpace.locator(".code-space-window-controls")).toBeHidden();
  await expect(codeSpace.locator("[data-code-language-trigger]")).toContainText("Plain Text");
  await expect(codeSpace.locator("[data-code-language-trigger]")).toContainText("Language");
  await expect(codeSpace.locator("[data-code-copy]")).toHaveAttribute("aria-label", "Copy code");
  await expect(codeSpace.locator(".code-space-copy-icon")).toBeVisible();
  const plainSurface = await codeSpace.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { background: styles.backgroundColor, radius: Number.parseFloat(styles.borderRadius) };
  });
  expect(plainSurface).toEqual({ background: "rgb(243, 244, 246)", radius: 12 });
  await expect(codeSpace.locator("pre[data-code-language='plaintext'] code")).toHaveText(codeText);
  await expect.poll(async () => {
    const resource = await persistedResource(request, resourceId);
    return {
      table: resource?.blocks?.find((block) => block.type === "table")?.text || "",
      code: resource?.blocks?.find((block) => block.type === "code")?.text || "",
    };
  }).toEqual({ table: tableText, code: codeText });

  const reloadedEditor = await openResource(page, resourceId);
  await expect(reloadedEditor.locator("table thead th")).toHaveText(["층", "dilation", "계산", "receptive field"]);
  const reloadedCodeSpace = reloadedEditor.locator("[data-code-space]");
  await expect(reloadedCodeSpace.locator("[data-code-language-trigger]")).toContainText("Plain Text");
  await expect(reloadedCodeSpace.locator("pre[data-code-language='plaintext'] code")).toHaveText(codeText);
});

test("Resource 수식 단축키와 Markdown 수식 구분자가 저장 후에도 inline과 전체 줄을 구분한다", async ({ page, request }) => {
  const shortcutBlockId = "equation-shortcut";
  await seedResourceBlocks(request, FIXTURE_IDS.bodySearchResource, [paragraph(shortcutBlockId, "E = mc^2")]);
  const shortcutEditor = await openResource(page, FIXTURE_IDS.bodySearchResource);
  const shortcutContent = shortcutEditor.locator(`[data-block-content="${shortcutBlockId}"]`);
  await shortcutContent.evaluate((element) => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press("Meta+Shift+D");

  const equationDialog = page.getByRole("dialog", { name: "수식 편집" });
  const equationInput = equationDialog.getByRole("textbox", { name: "수식 입력" });
  await expect(equationInput).toHaveValue("E = mc^2");
  await equationInput.press("Enter");
  await expect(shortcutEditor.locator('[data-inline-mark="equation"]')).toHaveAttribute("data-equation-mode", "inline");
  await expect.poll(async () => (await persistedResource(request, FIXTURE_IDS.bodySearchResource))?.blocks[0]?.marks.find((mark) => mark.type === "equation")).toEqual({
    type: "equation",
    start: 0,
    end: 8,
    formula: "E = mc^2",
  });

  const liveBlockId = "equation-live";
  await seedResourceBlocks(request, FIXTURE_IDS.titleSearchResource, [paragraph(liveBlockId)]);
  const liveEditor = await openResource(page, FIXTURE_IDS.titleSearchResource);
  await liveEditor.locator(`[data-block-content="${liveBlockId}"]`).pressSequentially(String.raw`실시간 \(z^2\)`, { delay: 10 });
  await expect(liveEditor.locator('[data-inline-mark="equation"]')).toHaveAttribute("data-equation-formula", "z^2");

  const { editor, resourceId } = await createEmptyResource(page);
  const markdown = [
    String.raw`앞 \(x\)\(x\) 중간`,
    String.raw`\[ R=1+2\times1 \]`,
    String.raw`뒤 \(y^2\)`,
    String.raw`리터럴 \\(not math\\)`,
  ].join("\n");
  await editor.locator("[data-block-content]").first().evaluate((element, text) => {
    element.focus();
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    clipboardData.setData("text/html", text.split("\n").map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`).join(""));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, markdown);

  await expect(editor.locator("[data-block-content]")).toHaveCount(3);
  await expect(editor.locator('[data-equation-mode="inline"]')).toHaveCount(3);
  const displayEquation = editor.locator('[data-equation-mode="display"]');
  await expect(displayEquation).toHaveCount(1);
  await expect(displayEquation).toHaveAttribute("data-equation-formula", String.raw`R=1+2\times1`);
  await expect(displayEquation).toHaveAttribute("role", "math");
  await expect(editor.locator("[data-block-content]").last()).toHaveText(`뒤 y^2\n${String.raw`리터럴 \(not math\)`}`);
  await expect(editor.locator("[data-block-content]").last().locator('[data-inline-mark="equation"]')).toHaveCount(1);
  const displayGeometry = await displayEquation.evaluate((element) => {
    const parent = element.closest("[data-block-content]");
    return {
      display: getComputedStyle(element).display,
      width: element.getBoundingClientRect().width,
      parentWidth: parent.getBoundingClientRect().width,
    };
  });
  expect(displayGeometry.display).toBe("grid");
  expect(displayGeometry.width).toBeGreaterThanOrEqual(displayGeometry.parentWidth - 2);

  await expect.poll(async () => {
    const shortcutResource = await persistedResource(request, FIXTURE_IDS.bodySearchResource);
    const liveResource = await persistedResource(request, FIXTURE_IDS.titleSearchResource);
    const syntaxResource = await persistedResource(request, resourceId);
    return {
      shortcut: shortcutResource?.blocks[0]?.marks.find((mark) => mark.type === "equation"),
      live: liveResource?.blocks[0] ? {
        text: liveResource.blocks[0].text,
        equations: liveResource.blocks[0].marks.filter((mark) => mark.type === "equation"),
      } : null,
      syntax: syntaxResource?.blocks.map((block) => ({
        text: block.text,
        equations: block.marks.filter((mark) => mark.type === "equation"),
      })),
    };
  }).toEqual({
    shortcut: { type: "equation", start: 0, end: 8, formula: "E = mc^2" },
    live: { text: "실시간 z^2", equations: [{ type: "equation", start: 4, end: 7, formula: "z^2" }] },
    syntax: [
      { text: "앞 xx 중간", equations: [{ type: "equation", start: 2, end: 3, formula: "x" }, { type: "equation", start: 3, end: 4, formula: "x" }] },
      { text: String.raw`R=1+2\times1`, equations: [{ type: "equation", start: 0, end: 12, formula: String.raw`R=1+2\times1`, displayMode: true }] },
      { text: `뒤 y^2\n${String.raw`리터럴 \(not math\)`}`, equations: [{ type: "equation", start: 2, end: 5, formula: "y^2" }] },
    ],
  });

  const reloadedEditor = await openResource(page, resourceId);
  await expect(reloadedEditor.locator('[data-equation-mode="inline"]')).toHaveCount(3);
  await expect(reloadedEditor.locator('[data-equation-mode="display"]')).toHaveAttribute("data-equation-formula", String.raw`R=1+2\times1`);
});

test("fenced code는 Code Space UI에서 언어 선택과 줄 번호를 제공한다", async ({ page, request }) => {
  const { editor, resourceId } = await createEmptyResource(page);
  const content = editor.locator("[data-block-content]").first();
  await content.type("```javascript");
  await content.press("Enter");

  const codeSpace = editor.locator(".code-space");
  const code = codeSpace.locator("[data-block-content]");
  await expect(codeSpace).toBeVisible();
  await expect(codeSpace).toHaveClass(/is-code/);
  await expect(codeSpace.locator(".code-space-title")).toHaveText("Code Space");
  await expect(codeSpace.locator(".code-space-window-controls")).toBeVisible();
  await expect(codeSpace.locator(".code-space-footer")).toBeVisible();
  await expect(codeSpace.locator("[data-code-line-numbers]")).toBeVisible();
  await expect(codeSpace.locator("[data-code-language-trigger]")).toContainText("JavaScript");
  await expect(codeSpace.locator("[data-code-language-trigger]")).toContainText("Language");
  await expect(codeSpace.locator("[data-code-copy]")).toHaveAttribute("aria-label", "Copy code");
  await expect(codeSpace.locator(".code-space-copy-icon")).toBeVisible();

  await code.pressSequentially("const one = 1;");
  await code.press("Enter");
  await code.pressSequentially("const two = 2;");
  await expect(codeSpace.locator("[data-code-line-numbers] i")).toHaveCount(2);
  await expect(codeSpace.locator("[data-code-line-summary]")).toHaveText("2 lines");

  const languageTrigger = codeSpace.locator("[data-code-language-trigger]");
  await languageTrigger.focus();
  await languageTrigger.press("ArrowDown");
  const languageMenu = codeSpace.locator(".code-language-menu");
  await expect(languageMenu).toBeVisible();
  await expect(languageMenu).toHaveAttribute("popover", "manual");
  await expect.poll(() => languageMenu.evaluate((menu) => menu.matches(":popover-open"))).toBe(true);
  const menuGeometry = await languageMenu.evaluate((menu) => {
    const rect = menu.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportRight = viewportLeft + (viewport?.width || document.documentElement.clientWidth);
    const viewportBottom = viewportTop + (viewport?.height || document.documentElement.clientHeight);
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.bottom - 3);
    return {
      insideViewport: rect.left >= viewportLeft && rect.right <= viewportRight
        && rect.top >= viewportTop && rect.bottom <= viewportBottom,
      hitInside: Boolean(hit && menu.contains(hit)),
      fixed: getComputedStyle(menu).position === "fixed",
      cappedHeight: rect.height <= 320,
    };
  });
  expect(menuGeometry).toEqual({ insideViewport: true, hitInside: true, fixed: true, cappedHeight: true });
  await expect(codeSpace.locator("[data-code-language-value]").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(codeSpace.locator(".code-language-menu")).not.toBeVisible();
  await expect(languageTrigger).toBeFocused();

  await languageTrigger.click();
  await codeSpace.locator('[data-code-language-value="typescript"]').click();
  await expect(editor.locator('pre[data-code-language="typescript"]')).toBeVisible();
  await expect(editor.locator("[data-code-language-trigger]")).toContainText("TypeScript");

  await expect.poll(async () => {
    const resource = await persistedResource(request, resourceId);
    const block = resource?.blocks.find((entry) => entry.type === "code");
    return block ? { text: block.text, language: block.language } : null;
  }).toEqual({ text: "const one = 1;\nconst two = 2;", language: "typescript" });

  const reloadedEditor = await openResource(page, resourceId);
  await expect(reloadedEditor.locator('pre[data-code-language="typescript"] [data-block-content]')).toHaveText("const one = 1;\nconst two = 2;");
  await expect(reloadedEditor.locator("[data-code-language-trigger]")).toContainText("TypeScript");
});

test("슬래시 입력은 메뉴를 열지 않고 일반 텍스트로 저장된다", async ({ page, request }) => {
  const { editor, resourceId } = await createEmptyResource(page);
  const content = editor.locator("[data-block-content]").first();
  await content.type("/image");

  await expect(page.locator(".selected-block-menu")).toHaveCount(0);
  await expect(content).toHaveText("/image");
  await expect.poll(async () => {
    const resource = await persistedResource(request, resourceId);
    return resource?.blocks[0]?.text;
  }).toBe("/image");

  await content.press("Enter");
  await expect(editor.locator("[data-block-content]").first()).toHaveText("/image");
  await expect(editor.locator("[data-block-content]:focus")).toHaveText("");
});

test("붙여넣은 PNG 이미지는 클릭 선택 후 Backspace로 DOM과 저장 상태에서 제거된다", async ({ page, request }) => {
  const { editor, resourceId } = await createEmptyResource(page);
  await pastePng(editor.locator("[data-block-content]").first());

  const imageBlock = editor.locator('.block[data-type="image"]');
  const image = imageBlock.locator("img");
  await expect(image).toBeVisible();
  const src = await image.getAttribute("src");
  expect(src).toMatch(/^\/api\/resource-images\/[a-zA-Z0-9_-]+$/);
  await expect.poll(async () => {
    const resource = await persistedResource(request, resourceId);
    return resource?.blocks.some((block) => block.type === "image" && block.url === src);
  }).toBe(true);

  await image.click();
  await expect(imageBlock).toHaveClass(/\bis-selected\b/);
  await page.keyboard.press("Backspace");
  await expect(imageBlock).toHaveCount(0);
  await expect.poll(async () => {
    const resource = await persistedResource(request, resourceId);
    return resource?.blocks.some((block) => block.type === "image" && block.url === src);
  }).toBe(false);
});

test("Resource 저장 중 붙여넣은 PNG는 이전 저장 응답에 덮이지 않는다", async ({ page, request }) => {
  await page.addInitScript(() => {
    const NativeDate = Date;
    const frozenTime = NativeDate.parse("2026-08-12T03:00:00.000Z");
    class FrozenDate extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : [frozenTime]));
      }
      static now() {
        return frozenTime;
      }
    }
    Object.setPrototypeOf(FrozenDate, NativeDate);
    window.Date = FrozenDate;
  });
  let releaseFirstSave;
  let firstSaveCommitted;
  const releaseFirstSavePromise = new Promise((resolve) => { releaseFirstSave = resolve; });
  const firstSaveCommittedPromise = new Promise((resolve) => { firstSaveCommitted = resolve; });
  let intercepted = false;
  await page.route("**/api/state", async (route) => {
    if (route.request().method() !== "PUT" || intercepted) return route.continue();
    intercepted = true;
    const response = await route.fetch();
    firstSaveCommitted();
    await releaseFirstSavePromise;
    await route.fulfill({ response });
  });

  const editor = await openResource(page, FIXTURE_IDS.bodySearchResource);
  await page.locator(`[data-resource-title="${FIXTURE_IDS.bodySearchResource}"]`).fill("응답 대기 중인 제목");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await firstSaveCommittedPromise;

  const content = editor.locator("[data-block-content]").first();
  await pastePng(content);
  const localImage = editor.locator('.block[data-type="image"] img');
  await expect(localImage).toBeVisible();
  const src = await localImage.getAttribute("src");

  releaseFirstSave();
  await expect.poll(async () => {
    const resource = await persistedResource(request, FIXTURE_IDS.bodySearchResource);
    return resource?.blocks.find((block) => block.type === "image")?.url || "";
  }, { timeout: 3_000 }).toBe(src);
  await expect(localImage).toBeVisible();
});

test("긴 문서에서 위아래 이동은 선호 열을 유지하고 커서를 화면 안에 두며 모바일에서 넘치지 않는다", async ({ page, request }) => {
  const filler = Array.from({ length: 70 }, (_, index) => paragraph(`long-${index}`, `긴 문서 ${index} ${"내용 ".repeat(16)}`));
  const blocks = [
    ...filler,
    paragraph("caret-wide-before", "WWWWWWWWWWWWWWWWWWWW"),
    paragraph("caret-short", "WW"),
    paragraph("caret-wide-after", "WWWWWWWWWWWWWWWWWWWW"),
    paragraph("mobile-overflow", `https://example.com/${"very-long-path-".repeat(30)}`),
  ];
  await seedResourceBlocks(request, FIXTURE_IDS.bodySearchResource, blocks);
  const editor = await openResource(page, FIXTURE_IDS.bodySearchResource);
  const before = editor.locator('[data-block-content="caret-wide-before"]');
  await before.scrollIntoViewIfNeeded();
  await setCaret(before, 14);

  await before.press("ArrowDown");
  await expect.poll(() => activeCaret(page)).toMatchObject({ blockId: "caret-short", offset: 2 });
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => activeCaret(page)).toMatchObject({ blockId: "caret-wide-after" });
  const restored = await activeCaret(page);
  expect(restored.offset).toBeGreaterThanOrEqual(12);
  expect(restored.bottom).toBeLessThanOrEqual(restored.viewportHeight);
  expect(restored.top).toBeGreaterThanOrEqual(0);
  expect(await page.locator("[data-resource-document]").evaluate((document) => document.scrollTop)).toBeGreaterThan(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await editor.locator('[data-block-content="mobile-overflow"]').scrollIntoViewIfNeeded();
  const geometry = await page.locator("[data-resource-document]").evaluate((article) => {
    const body = article.querySelector(".resource-document-body");
    const title = article.querySelector("[data-resource-title]");
    const longBlock = article.querySelector('[data-block-content="mobile-overflow"]');
    const rect = article.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
      bodyOverflow: body.scrollWidth - body.clientWidth,
      blockOverflow: longBlock.scrollWidth - longBlock.clientWidth,
      titleOverflow: title.scrollWidth - title.clientWidth,
      blockWidth: longBlock.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.bodyOverflow).toBeLessThanOrEqual(1);
  expect(geometry.blockOverflow).toBeLessThanOrEqual(1);
  expect(geometry.titleOverflow).toBeLessThanOrEqual(1);
  expect(geometry.blockWidth).toBeGreaterThan(220);
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
});


test("Resource 왼쪽 여백을 세로로 드래그하면 지나간 줄 블록이 연속 선택된다", async ({ page, request }) => {
  const blockIds = ["marquee-line-1", "marquee-line-2", "marquee-line-3", "marquee-line-4", "marquee-line-5"];
  await seedResourceBlocks(
    request,
    FIXTURE_IDS.bodySearchResource,
    blockIds.map((id, index) => paragraph(id, `드래그 선택 줄 ${index + 1}`)),
  );
  const editor = await openResource(page, FIXTURE_IDS.bodySearchResource);
  const resourceDocument = page.locator(`[data-resource-document="${FIXTURE_IDS.bodySearchResource}"]`);
  const editorBox = await editor.boundingBox();
  const documentBox = await resourceDocument.boundingBox();
  const firstBox = await editor.locator(`[data-block-id="${blockIds[0]}"]`).boundingBox();
  const thirdBox = await editor.locator(`[data-block-id="${blockIds[2]}"]`).boundingBox();
  expect(editorBox && documentBox && firstBox && thirdBox).toBeTruthy();

  const gutterX = Math.max(documentBox.x + 8, editorBox.x - 18);
  await page.mouse.move(gutterX, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gutterX, thirdBox.y + thirdBox.height / 2, { steps: 8 });
  await expect(page.locator(".editor-marquee")).toBeVisible();
  await page.mouse.up();

  await expect(page.locator(".editor-marquee")).toHaveCount(0);
  await expect(editor.locator(".block.is-selected")).toHaveCount(3);
  await expect.poll(() => editor.locator(".block.is-selected").evaluateAll((elements) => elements.map((element) => element.dataset.blockId))).toEqual(blockIds.slice(0, 3));
  const announcements = resourceDocument.locator("[data-resource-announcements]");
  await expect(announcements).toHaveText("3개 블록 선택됨");
  expect(await announcements.evaluate((element) => Boolean(element.closest("[inert]")))).toBe(false);

  await page.mouse.move(gutterX, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gutterX, thirdBox.y + thirdBox.height / 2, { steps: 4 });
  await expect(page.locator(".editor-marquee")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".editor-marquee")).toHaveCount(0);
  await expect(editor.locator(".block.is-selected")).toHaveCount(0);
  await page.mouse.up();

  await page.mouse.move(gutterX, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gutterX, thirdBox.y + thirdBox.height / 2, { steps: 4 });
  await expect(page.locator(".editor-marquee")).toBeVisible();
  await resourceDocument.locator(".resource-document-close").evaluate((button) => button.click());
  await expect(resourceDocument).toHaveCount(0);
  await expect(page.locator(".editor-marquee")).toHaveCount(0);
  await page.waitForTimeout(40);
  await expect(page.locator("#appAnnouncements")).not.toHaveText("블록 선택 해제됨");
  await page.mouse.up();

  await page.locator(`[data-resource-open="${FIXTURE_IDS.bodySearchResource}"]`).click();
  const reopenedEditorBox = await editor.boundingBox();
  const reopenedDocumentBox = await resourceDocument.boundingBox();
  const reopenedFirstBox = await editor.locator(`[data-block-id="${blockIds[0]}"]`).boundingBox();
  const reopenedThirdBox = await editor.locator(`[data-block-id="${blockIds[2]}"]`).boundingBox();
  const reopenedGutterX = Math.max(reopenedDocumentBox.x + 8, reopenedEditorBox.x - 18);
  await page.mouse.move(reopenedGutterX, reopenedFirstBox.y + reopenedFirstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(reopenedGutterX, reopenedThirdBox.y + reopenedThirdBox.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(editor.locator(".block.is-selected")).toHaveCount(3);
  await resourceDocument.locator(".resource-document-close").click();
  await expect(resourceDocument).toHaveCount(0);
  await expect(page.locator(".block.is-selected")).toHaveCount(0);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await persistedResource(request, FIXTURE_IDS.bodySearchResource))?.blocks.length).toBe(blockIds.length);

  await page.locator(`[data-resource-open="${FIXTURE_IDS.bodySearchResource}"]`).click();
  const switchEditorBox = await editor.boundingBox();
  const switchDocumentBox = await resourceDocument.boundingBox();
  const switchFirstBox = await editor.locator(`[data-block-id="${blockIds[0]}"]`).boundingBox();
  const switchThirdBox = await editor.locator(`[data-block-id="${blockIds[2]}"]`).boundingBox();
  const switchGutterX = Math.max(switchDocumentBox.x + 8, switchEditorBox.x - 18);
  await page.mouse.move(switchGutterX, switchFirstBox.y + switchFirstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(switchGutterX, switchThirdBox.y + switchThirdBox.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(editor.locator(".block.is-selected")).toHaveCount(3);
  await page.evaluate((resourceId) => openResourceDocument(resourceId), FIXTURE_IDS.titleSearchResource);
  await expect(page.locator(`[data-resource-document="${FIXTURE_IDS.titleSearchResource}"]`)).toBeVisible();
  await expect(page.locator(".block.is-selected")).toHaveCount(0);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await persistedResource(request, FIXTURE_IDS.bodySearchResource))?.blocks.length).toBe(blockIds.length);
});

test("Resource Cmd+A는 현재 줄 텍스트, 현재 블록, 전체 블록 순서로 선택한다", async ({ page, request }) => {
  const blockIds = ["keyboard-select-1", "keyboard-select-2", "keyboard-select-3", "keyboard-select-4"];
  const blockTexts = blockIds.map((_, index) => `키보드 선택 줄 ${index + 1}`);
  await seedResourceBlocks(
    request,
    FIXTURE_IDS.bodySearchResource,
    blockIds.map((id, index) => paragraph(id, blockTexts[index])),
  );
  const editor = await openResource(page, FIXTURE_IDS.bodySearchResource);
  const second = editor.locator(`[data-block-content="${blockIds[1]}"]`);

  await setCaret(second, 4);
  await page.keyboard.press("Meta+A");
  await expect.poll(() => resourceSelectionState(page)).toEqual({
    text: blockTexts[1],
    anchorBlock: blockIds[1],
    focusBlock: blockIds[1],
    selectedIds: [],
  });
  await page.keyboard.press("Meta+A");
  await expect.poll(() => resourceSelectionState(page)).toMatchObject({ text: "", selectedIds: [blockIds[1]] });
  await page.keyboard.press("Meta+A");
  await expect.poll(() => resourceSelectionState(page)).toMatchObject({ text: "", selectedIds: blockIds });
});

test("Resource Shift+ArrowUp은 현재 줄 텍스트, 현재 블록, 위 인접 블록 순서로 선택한다", async ({ page, request }) => {
  const blockIds = ["keyboard-up-1", "keyboard-up-2", "keyboard-up-3", "keyboard-up-4"];
  const blockTexts = blockIds.map((_, index) => `위쪽 선택 줄 ${index + 1}`);
  await seedResourceBlocks(
    request,
    FIXTURE_IDS.bodySearchResource,
    blockIds.map((id, index) => paragraph(id, blockTexts[index])),
  );
  await openResource(page, FIXTURE_IDS.bodySearchResource);
  const third = page.locator(`[data-block-content="${blockIds[2]}"]`);

  await setCaret(third, blockTexts[2].length);
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(() => resourceSelectionState(page)).toEqual({
    text: blockTexts[2],
    anchorBlock: blockIds[2],
    focusBlock: blockIds[2],
    selectedIds: [],
  });
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(() => resourceSelectionState(page)).toMatchObject({ text: "", selectedIds: [blockIds[2]] });
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(() => resourceSelectionState(page)).toMatchObject({ text: "", selectedIds: blockIds.slice(1, 3) });
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(() => resourceSelectionState(page)).toMatchObject({ text: "", selectedIds: blockIds.slice(0, 3) });
});

test("Resource 마지막 줄에서 Enter를 눌러도 caret 아래에 최소 한 줄 여유가 남는다", async ({ page, request }) => {
  const blocks = Array.from({ length: 34 }, (_, index) => paragraph(`caret-scroll-${index + 1}`, `스크롤 확인 줄 ${index + 1}`));
  await seedResourceBlocks(request, FIXTURE_IDS.bodySearchResource, blocks);
  const editor = await openResource(page, FIXTURE_IDS.bodySearchResource);
  const lastContent = editor.locator(`[data-block-content="${blocks.at(-1).id}"]`);
  await setCaret(lastContent, blocks.at(-1).text.length);
  const beforeScrollTop = await page.locator(`[data-resource-document="${FIXTURE_IDS.bodySearchResource}"]`).evaluate((element) => element.scrollTop);
  await page.keyboard.press("Enter");

  const focusedContent = editor.locator("[data-block-content]:focus");
  await expect(focusedContent).toBeVisible();
  await expect(focusedContent).not.toHaveAttribute("data-block-content", blocks.at(-1).id);
  await expect(editor.locator("[data-block-content]")).toHaveCount(blocks.length + 1);
  await expect.poll(async () => (await persistedResource(request, FIXTURE_IDS.bodySearchResource))?.blocks.length).toBe(blocks.length + 1);
  await expect.poll(async () => page.evaluate(() => {
    const content = document.activeElement?.closest?.("[data-block-content]");
    const resourceDocument = content?.closest?.(".resource-document");
    const selection = window.getSelection();
    if (!content || !resourceDocument || !selection?.rangeCount) return false;
    const range = selection.getRangeAt(0).cloneRange();
    const rawCaret = range.getClientRects()[0] || range.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const caretBottom = rawCaret && (rawCaret.width || rawCaret.height)
      ? rawCaret.bottom
      : Math.min(contentRect.bottom, contentRect.top + 24);
    const panel = resourceDocument.getBoundingClientRect();
    const style = getComputedStyle(content);
    const lineHeight = Number.parseFloat(style.lineHeight) || (Number.parseFloat(style.fontSize) || 16) * 1.55;
    return resourceDocument.scrollTop > 0 && panel.bottom - caretBottom >= lineHeight - 2;
  })).toBe(true);

  const geometry = await page.evaluate(() => {
    const content = document.activeElement.closest("[data-block-content]");
    const resourceDocument = content.closest(".resource-document");
    const selection = window.getSelection();
    const rawCaret = selection.getRangeAt(0).getClientRects()[0] || selection.getRangeAt(0).getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const caretBottom = rawCaret && (rawCaret.width || rawCaret.height)
      ? rawCaret.bottom
      : Math.min(contentRect.bottom, contentRect.top + 24);
    const panel = resourceDocument.getBoundingClientRect();
    const style = getComputedStyle(content);
    const lineHeight = Number.parseFloat(style.lineHeight) || (Number.parseFloat(style.fontSize) || 16) * 1.55;
    return { scrollTop: resourceDocument.scrollTop, bottomGap: panel.bottom - caretBottom, lineHeight };
  });
  expect(geometry.scrollTop).toBeGreaterThan(beforeScrollTop);
  expect(geometry.bottomGap).toBeGreaterThanOrEqual(geometry.lineHeight - 2);
});

test("Resource 토글은 첫 줄 중앙에 맞고 list 자식도 펼침과 접힘이 부드럽게 이어진다", async ({ page, request }) => {
  const toggleId = "animated-toggle-parent";
  const bulletId = "animated-toggle-bullet";
  const childId = "animated-toggle-paragraph";
  const siblingId = "animated-toggle-list-sibling";
  await seedResourceBlocks(request, FIXTURE_IDS.bodySearchResource, [
    { id: toggleId, type: "toggle", text: "정렬된 토글", marks: [], checked: false, indent: 0, collapsed: false },
    { id: childId, type: "paragraph", text: "일반 자식", marks: [], checked: false, indent: 1, collapsed: false },
    { id: bulletId, type: "bullet", text: "목록 자식", marks: [], checked: false, indent: 1, collapsed: false },
    { id: siblingId, type: "bullet", text: "비자식 목록 형제", marks: [], checked: false, indent: 0, collapsed: false },
    paragraph("animated-toggle-after", "토글 다음 줄"),
  ]);
  const editor = await openResource(page, FIXTURE_IDS.bodySearchResource);
  const toggle = editor.locator(`[data-block-id="${toggleId}"]`);
  const button = editor.locator(`[data-block-toggle="${toggleId}"]`);
  const child = editor.locator(`[data-block-id="${bulletId}"]`);
  const sibling = editor.locator(`[data-block-id="${siblingId}"]`);

  const alignment = await toggle.evaluate((element) => {
    const control = element.querySelector("[data-block-toggle]");
    const content = element.querySelector("[data-block-content]");
    const range = document.createRange();
    range.setStart(content.firstChild, 0);
    range.setEnd(content.firstChild, 1);
    const line = range.getBoundingClientRect();
    const controlRect = control.getBoundingClientRect();
    return Math.abs((controlRect.top + controlRect.height / 2) - (line.top + line.height / 2));
  });
  expect(alignment).toBeLessThanOrEqual(2);
  await expect(child.locator("xpath=parent::*")).toHaveAttribute("role", "list");
  const horizontalIndent = await Promise.all([
    toggle.locator("[data-block-content]").boundingBox(),
    child.locator("[data-block-content]").boundingBox(),
  ]);
  expect(horizontalIndent.every(Boolean)).toBe(true);
  expect(horizontalIndent[1].x).toBeGreaterThan(horizontalIndent[0].x);

  await page.evaluate(() => {
    window.__resourceToggleMotionProbe = [];
    window.__resourceToggleMotionObserver?.disconnect();
    window.__resourceToggleMotionObserver = new MutationObserver(() => {
      for (const element of document.querySelectorAll(".toggle-child-animation-group")) {
        const key = element.className;
        if (window.__resourceToggleMotionProbe.some((entry) => entry.key === key)) continue;
        window.__resourceToggleMotionProbe.push({
          key,
          animations: element.getAnimations().map((animation) => animation.animationName),
          hasList: Boolean(element.querySelector('[role="list"]')),
          blockIds: [...element.querySelectorAll(".block[data-block-id]")].map((block) => block.dataset.blockId),
        });
      }
    });
    window.__resourceToggleMotionObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  });

  await button.click();
  await expect(child).toBeHidden();
  await expect(sibling).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => page.evaluate(() => window.__resourceToggleMotionProbe)).toContainEqual(expect.objectContaining({
    key: expect.stringContaining("is-toggle-group-collapsing"),
    animations: expect.arrayContaining(["toggle-group-collapse"]),
    hasList: true,
    blockIds: expect.not.arrayContaining([siblingId]),
  }));

  await button.click();
  await expect(child).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => page.evaluate(() => window.__resourceToggleMotionProbe)).toContainEqual(expect.objectContaining({
    key: expect.stringContaining("is-toggle-group-revealing"),
    animations: expect.arrayContaining(["toggle-group-reveal"]),
    hasList: true,
    blockIds: expect.not.arrayContaining([siblingId]),
  }));
  await expect(editor.locator(".toggle-child-animation-group")).toHaveCount(0);

  await button.click();
  await page.waitForTimeout(50);
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(child).toBeVisible();
  await expect(editor.locator(".toggle-child-animation-group")).toHaveCount(0);

  await button.click();
  await expect(child).toBeHidden();
  await page.evaluate((id) => {
    window.__resourceToggleMotionProbe = [];
    document.querySelector(`[data-block-toggle="${id}"]`).click();
    document.querySelector(`[data-block-toggle="${id}"]`).click();
  }, toggleId);
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(child).toBeHidden();
  await expect(editor.locator(".toggle-child-animation-group")).toHaveCount(0);
  expect(await page.evaluate(() => window.__resourceToggleMotionProbe.some((entry) => entry.key.includes("is-toggle-group-revealing")))).toBe(false);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await button.click();
  await expect(child).toBeVisible();
  await expect(editor.locator(".toggle-child-animation-group")).toHaveCount(0);
  await button.click();
  await expect(child).toBeHidden();
  await expect(editor.locator(".toggle-child-animation-group")).toHaveCount(0);
  await button.click();
  await expect(child).toBeVisible();
  await expect.poll(async () => (await persistedResource(request, FIXTURE_IDS.bodySearchResource))?.blocks.find((block) => block.id === toggleId)?.collapsed).toBe(false);
});
