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

test("기존 문장 앞의 Markdown 단축 입력은 본문과 인라인 서식을 보존하고 커서를 앞에 둔다", async ({ page, request }) => {
  const resourceId = FIXTURE_IDS.bodySearchResource;
  const text = "기존 강조와 자료 연결";
  const marks = [{ type: "bold", start: 3, end: 5 }, { type: "resourceLink", start: 7, end: 9, resourceId: FIXTURE_IDS.resource }];
  const shortcuts = [["#", "heading1"], ["##", "heading2"], ["######", "heading6"], ["-", "bullet"], ["3.", "numbered"], ["[x]", "todo"], [">", "toggle"], ["|", "quote"]];
  await seedResourceBlocks(request, resourceId, [
    ...shortcuts.map((_, index) => ({ ...paragraph(`prefix-${index}`, text), marks })),
    { ...paragraph("prefix-code", text), type: "code", language: "javascript" },
    paragraph("prefix-midline", "중간 문장"),
  ]);
  let editor = await openResource(page, resourceId);
  for (const [index, [prefix, type]] of shortcuts.entries()) {
    const content = editor.locator(`[data-block-content="prefix-${index}"]`);
    await setCaret(content, 0);
    await content.type(`${prefix} `);
    await expect(editor.locator(`[data-block-id="prefix-${index}"]`)).toHaveAttribute("data-type", type);
    await expect(content).toHaveText(text);
    await expect(content.locator('[data-inline-mark="bold"]')).toHaveText("강조");
    await expect(content.locator('[data-inline-mark="resourceLink"]')).toHaveText("자료");
    await expect.poll(async () => (await activeCaret(page))?.offset).toBe(0);
    if (index === 0) {
      await content.press("Meta+z");
      await expect(content).toHaveText(`# ${text}`);
      await expect(editor.locator('[data-block-id="prefix-0"]')).toHaveAttribute("data-type", "paragraph");
      await content.press("Meta+Shift+z");
      await expect(content).toHaveText(text);
      await content.type("추가");
      await expect(content).toHaveText(`추가${text}`);
      await content.press("Meta+z");
      await expect(content).toHaveText(text);
    }
  }
  const code = editor.locator('[data-block-content="prefix-code"]');
  await setCaret(code, 0);
  await code.type("# ");
  await expect(editor.locator('[data-block-id="prefix-code"]')).toHaveAttribute("data-type", "code");
  await expect(code).toHaveText(`# ${text}`);
  const midline = editor.locator('[data-block-content="prefix-midline"]');
  await setCaret(midline, 3);
  await midline.type("- ");
  await expect(midline).toHaveText("중간 - 문장");
  await expect(editor.locator('[data-block-id="prefix-midline"]')).toHaveAttribute("data-type", "paragraph");
  await midline.fill("");
  await midline.type("- 기존 글");
  await setCaret(midline, 0);
  await midline.type("# ");
  await expect(midline).toHaveText("기존 글");
  await expect(editor.locator('[data-block-id="prefix-midline"]')).toHaveAttribute("data-type", "heading1");
  await expect.poll(async () => (await persistedResource(request, resourceId)).blocks.slice(0, shortcuts.length).map((block) => ({ type: block.type, text: block.text, marks: block.marks }))).toEqual(shortcuts.map(([, type]) => ({ type, text, marks })));
  editor = await openResource(page, resourceId);
  for (const [index, [, type]] of shortcuts.entries()) {
    await expect(editor.locator(`[data-block-id="prefix-${index}"]`)).toHaveAttribute("data-type", type);
    await expect(editor.locator(`[data-block-content="prefix-${index}"]`)).toHaveText(text);
  }
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

test("서식이 있는 복사 내용도 모든 텍스트 서식의 커서 위치에 줄바꿈 없이 붙고 저장된다", async ({ page, request }) => {
  const resourceId = FIXTURE_IDS.bodySearchResource;
  const types = ["paragraph", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6", "bullet", "numbered", "todo", "toggle", "quote", "callout", "code"];
  await seedResourceBlocks(request, resourceId, types.map((type, index) => ({
    ...paragraph(`paste-caret-${index}`, "앞뒤"), type,
    marks: type === "code" ? [] : [{ type: "italic", start: 1, end: 2 }],
  })));
  let editor = await openResource(page, resourceId);
  for (const [index, type] of types.entries()) {
    const content = editor.locator(`[data-block-content="paste-caret-${index}"]`);
    await setCaret(content, 1);
    await content.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", " 복사 ");
      clipboardData.setData("text/html", " <span>복</span><strong>사</strong> ");
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    });
    await expect(content).toHaveText("앞 복사 뒤");
    await expect(editor.locator(`[data-block-id="paste-caret-${index}"]`)).toHaveAttribute("data-type", type);
    await expect.poll(async () => (await activeCaret(page))?.offset).toBe(5);
    if (type !== "code") {
      await expect(content.locator('[data-inline-mark="bold"]')).toHaveText("사");
      await expect(content.locator('[data-inline-mark="italic"]')).toHaveText("뒤");
    }
    if (index === 0) {
      await content.press("Meta+z");
      await expect(content).toHaveText("앞뒤");
      await expect.poll(async () => (await activeCaret(page))?.offset).toBe(1);
      await content.press("Meta+Shift+z");
      await expect(content).toHaveText("앞 복사 뒤");
    }
    await content.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "추가");
      clipboardData.setData("application/x-sygma-blocks", JSON.stringify({ version: 1, blocks: [{ type: "paragraph", text: "추가", marks: [], indent: 0 }] }));
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    });
    await expect(content).toHaveText("앞 복사 추가뒤");
    await expect.poll(async () => (await activeCaret(page))?.offset).toBe(7);
  }
  await expect(editor.locator(".block")).toHaveCount(types.length);
  await expect.poll(async () => (await persistedResource(request, resourceId)).blocks.map((block) => ({ type: block.type, text: block.text }))).toEqual(types.map((type) => ({ type, text: "앞 복사 추가뒤" })));
  editor = await openResource(page, resourceId);
  await expect(editor.locator(".block")).toHaveCount(types.length);
  await expect(editor.locator("[data-block-content]")).toHaveText(types.map(() => "앞 복사 추가뒤"));
  const first = editor.locator('[data-block-content="paste-caret-0"]');
  for (const [plain, html] of [
    ["A  B", '<span style="white-space:pre-wrap">A  <strong>B</strong></span>'],
    ["A B", "<span>A </span><strong> B</strong>"],
  ]) {
    await setCaret(first, 1);
    await first.evaluate((element, { plain, html }) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", plain);
      clipboardData.setData("text/html", html);
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    }, { plain, html });
    expect(await first.textContent()).toBe(`앞${plain} 복사 추가뒤`);
    await expect(first.locator('[data-inline-mark="bold"]').first()).toHaveText("B");
    await first.press("Meta+z");
    await expect(first).toHaveText("앞 복사 추가뒤");
  }
  await setCaret(first, 1);
  await first.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "첫째  줄\n중간\n둘째  줄");
    clipboardData.setData("text/html", '<span style="white-space:pre-wrap"><div>첫째  줄</div>중간<div>둘째  줄</div></span>');
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  expect(await first.textContent()).toBe("앞첫째  줄");
  await expect(editor.locator("[data-block-content]").nth(1)).toHaveText("중간");
  expect(await editor.locator("[data-block-content]").nth(2).textContent()).toBe("둘째  줄 복사 추가뒤");
  await expect.poll(async () => (await activeCaret(page))?.offset).toBe(5);
  await expect(editor.locator(".block")).toHaveCount(types.length + 2);
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
  expect(await table.evaluate((element) => {
    const scroller = element.closest("[data-resource-table-select]");
    const style = getComputedStyle(scroller);
    return scroller.getBoundingClientRect().height
      - element.getBoundingClientRect().height
      - parseFloat(style.paddingTop)
      - parseFloat(style.borderTopWidth)
      - parseFloat(style.borderBottomWidth);
  })).toBeLessThanOrEqual(2);
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

test("표 셀 편집과 두 가장자리 확장이 저장되고 드래그 단위 실행 취소 및 IME를 보존한다", async ({ page, request }) => {
  const resourceId = FIXTURE_IDS.bodySearchResource;
  const literal = "*literal* [square] `tick` \\path";
  const tableText = [
    "| 제목 | 값 | 비고 |", "| --- | ---: | --- |", "| **기존 강조** | 10 | 원본 |",
    String.raw`| \*literal\* \[square\] \`tick\` \\path | 20 | 유지 |`,
  ].join("\n");
  await seedResourceBlocks(request, resourceId, [
    { ...paragraph("editable-table", tableText), type: "table" },
    paragraph("after-editable-table", "표 아래 본문"),
  ]);
  const editor = await openResource(page, resourceId);
  const block = editor.locator('[data-block-id="editable-table"]');
  const table = block.locator("table");
  const cell = (row, column) => block.locator(`[data-resource-table-cell][data-table-row="${row}"][data-table-column="${column}"]`);
  const savedTable = async () => (await persistedResource(request, resourceId)).blocks.find((entry) => entry.id === "editable-table").text;
  await expect(cell(2, 0)).toHaveText(literal);
  await cell(2, 0).click();
  await cell(2, 1).click();
  await expect(cell(2, 0)).toHaveText(literal);
  await expect(cell(2, 0).locator("[data-inline-mark]")).toHaveCount(0);
  expect(await savedTable()).toBe(tableText);
  const addedLiteral = " 추가 *[새]`코드`*";
  await setCaret(cell(2, 0), literal.length);
  await page.keyboard.insertText(addedLiteral);
  await cell(2, 0).press("Tab");
  await expect(cell(2, 0)).toHaveText(literal + addedLiteral);
  await expect(cell(2, 0).locator("[data-inline-mark]")).toHaveCount(0);
  await expect.poll(savedTable).toContain("\\*literal\\* \\[square\\] \\`tick\\` \\\\path");
  await cell(1, 2).fill("직접 편집 | 테스트");
  await cell(1, 2).press("Tab");
  await expect(cell(2, 0)).toBeFocused();
  await expect.poll(savedTable).toContain("직접 편집 \\| 테스트");
  await expect(block.locator('[data-inline-mark="bold"]')).toHaveText("기존 강조");

  const dragEdge = async (axis, count, release = true) => {
    await block.hover();
    const edge = block.locator(`[data-resource-table-edge="${axis}"]`);
    const bounds = await edge.boundingBox();
    const step = await table.locator("tr").first().evaluate((row, vertical) => vertical ? row.getBoundingClientRect().height : row.cells[0].getBoundingClientRect().width, axis === "rows");
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (axis === "columns" ? step * count : 0), y + (axis === "rows" ? step * count : 0), { steps: 8 });
    if (release) await page.mouse.up();
  };
  await table.evaluate((element) => { window.__tableBeforeDrag = element; });
  const beforeGrowth = await savedTable();
  await dragEdge("rows", 2, false);
  await expect(table.locator("tr")).toHaveCount(5);
  expect(await savedTable()).toBe(beforeGrowth);
  expect(await table.evaluate((element) => element === window.__tableBeforeDrag)).toBe(true);
  await page.mouse.up();
  await expect.poll(async () => (await savedTable()).split("\n").length).toBe(6);
  await page.keyboard.press("Meta+z");
  await expect(table.locator("tr")).toHaveCount(3);
  await expect(cell(1, 2)).toHaveText("직접 편집 | 테스트");
  await page.keyboard.press("Meta+Shift+z");
  await expect(table.locator("tr")).toHaveCount(5);

  await dragEdge("columns", 1);
  await expect(table.locator("thead th")).toHaveCount(4);
  await expect(table.locator("tbody tr").first().locator("td")).toHaveCount(4);
  await page.keyboard.press("Meta+z");
  await expect(table.locator("thead th")).toHaveCount(3);
  await expect(table.locator("tr")).toHaveCount(5);
  await page.keyboard.press("Meta+Shift+z");
  await expect(table.locator("thead th")).toHaveCount(4);

  await dragEdge("rows", 2, false);
  await expect(table.locator("tr")).toHaveCount(7);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(table.locator("tr")).toHaveCount(5);
  await expect(block.locator(".resource-table-edge.is-dragging")).toHaveCount(0);

  await cell(2, 2).focus();
  await cell(2, 2).evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    element.textContent = "한글 받";
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "한글 받", isComposing: true }));
  });
  expect(await savedTable()).toContain("유지");
  await cell(2, 2).evaluate((element) => {
    element.textContent = "한글 받침";
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한글 받침" }));
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "한글 받침", isComposing: false }));
  });
  await expect(cell(2, 2)).toBeFocused();
  await expect.poll(savedTable).toContain("한글 받침");
  await cell(2, 2).press("Meta+z");
  await expect(cell(2, 2)).toHaveText("유지");
  await expect(cell(2, 2)).toBeFocused();
  await cell(2, 2).press("Meta+Shift+z");
  await expect(cell(2, 2)).toHaveText("한글 받침");
  await expect(editor.locator('[data-block-content="after-editable-table"]')).toHaveText("표 아래 본문");
  await expect.poll(async () => (await savedTable()).includes("한글 받침")).toBe(true);
  const reloaded = await openResource(page, resourceId);
  await expect(reloaded.locator("table tr")).toHaveCount(5);
  await expect(reloaded.locator("table thead th")).toHaveCount(4);
  await expect(reloaded.locator('[data-table-row="2"][data-table-column="2"]')).toHaveText("한글 받침");
  await expect(reloaded.locator('[data-table-row="2"][data-table-column="0"]')).toHaveText(literal + addedLiteral);
  await expect(reloaded.locator('[data-table-row="2"][data-table-column="0"] [data-inline-mark]')).toHaveCount(0);
  await reloaded.evaluate((element) => Promise.all(element.closest("[data-resource-window]").getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))));
  const widths = () => table.locator("tr").first().evaluate((row) => [...row.cells].map((cell) => Math.round(cell.getBoundingClientRect().width)));
  const beforeWidths = await widths();
  const resize = block.locator('[data-resource-table-width="0"]');
  const resizeBounds = await resize.boundingBox();
  await page.mouse.move(resizeBounds.x + resizeBounds.width / 2, resizeBounds.y + 16);
  await page.mouse.down();
  await page.mouse.move(resizeBounds.x + resizeBounds.width / 2 + 72, resizeBounds.y + 16, { steps: 8 });
  expect((await persistedResource(request, resourceId)).blocks.find((entry) => entry.id === "editable-table").columnWidths).toBeUndefined();
  await page.mouse.up();
  const resizedWidths = [beforeWidths[0] + 72, ...beforeWidths.slice(1)];
  expect(await widths()).toEqual(resizedWidths);
  await expect.poll(async () => (await persistedResource(request, resourceId)).blocks.find((entry) => entry.id === "editable-table").columnWidths).toEqual(resizedWidths);
  await page.keyboard.press("Meta+z");
  expect(await widths()).toEqual(beforeWidths);
  await page.keyboard.press("Meta+Shift+z");
  expect(await widths()).toEqual(resizedWidths);
  await resize.focus();
  await resize.press("ArrowRight");
  expect(await widths()).toEqual([resizedWidths[0] + 16, ...resizedWidths.slice(1)]);
  await page.keyboard.press("Meta+z");
  expect(await widths()).toEqual(resizedWidths);
  const cancelBounds = await resize.boundingBox();
  await page.mouse.move(cancelBounds.x + 4, cancelBounds.y + 16);
  await page.mouse.down();
  await page.mouse.move(cancelBounds.x + 44, cancelBounds.y + 16);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await widths()).toEqual(resizedWidths);
  await cell(0, 0).click();
  await cell(0, 0).press("Escape");
  await cell(0, 0).press("Escape");
  await expect(block).toHaveClass(/is-selected/);
  await expect(block).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(table.locator("th").first()).toHaveCSS("background-color", "rgba(35, 131, 226, 0.12)");
  const format = block.locator(".resource-table-format");
  await expect(format).toBeVisible();
  await format.locator('[data-resource-table-format="tableHeader"]').click();
  await format.locator('[data-resource-table-format="tableBold"]').click();
  for (const [field, value] of [["color", "blue"], ["backgroundColor", "yellow"], ["align", "center"]]) {
    const picker = format.locator("[data-finance-select]").filter({ has: page.locator(`[data-resource-table-format="${field}"]`) });
    await picker.locator("[data-finance-select-trigger]").click();
    await picker.locator(`[data-finance-select-option="${value}"]`).click();
  }
  await expect(table.locator("th")).toHaveCount(0);
  await expect(table.locator("td").first()).toHaveCSS("font-weight", "750");
  await expect(table.locator("td").first()).toHaveCSS("color", "rgb(51, 126, 169)");
  await expect(table.locator("td").first()).toHaveCSS("text-align", "center");
  for (const edge of await block.locator("[data-resource-table-edge]").all()) {
    const geometry = await edge.evaluate((element) => {
      const outer = element.getBoundingClientRect();
      const inner = element.querySelector("span").getBoundingClientRect();
      return { dx: Math.abs((inner.left + inner.right - outer.left - outer.right) / 2), dy: Math.abs((inner.top + inner.bottom - outer.top - outer.bottom) / 2), inside: inner.top >= outer.top && inner.bottom <= outer.bottom && inner.left >= outer.left && inner.right <= outer.right };
    });
    expect(geometry.dx).toBeLessThan(0.6);
    expect(geometry.dy).toBeLessThan(0.6);
    expect(geometry.inside).toBe(true);
  }
  await expect.poll(async () => (await persistedResource(request, resourceId)).blocks.find((entry) => entry.id === "editable-table").tableBold).toBe(true);
  await openResource(page, resourceId);
  await expect.poll(widths).toEqual(resizedWidths);
  await expect(table.locator("th")).toHaveCount(0);
  await expect(table.locator("td").first()).toHaveCSS("background-color", "rgb(251, 243, 219)");
  await seedResourceBlocks(request, FIXTURE_IDS.readOnlyResource, [{ ...paragraph("readonly-table", tableText), type: "table" }]);
  const readonlyEditor = await openResource(page, FIXTURE_IDS.readOnlyResource);
  await expect(readonlyEditor.locator("[data-resource-table-edge]")).toHaveCount(0);
  await expect(readonlyEditor.locator("[data-resource-table-cell]").first()).toHaveAttribute("contenteditable", "false");
  await readonlyEditor.locator("[data-resource-table-cell]").first().evaluate((element) => {
    element.textContent = "허용하지 않는 수정";
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "허용하지 않는 수정" }));
  });
  expect((await persistedResource(request, FIXTURE_IDS.readOnlyResource)).blocks[0].text).toBe(tableText);
});

test("표 클릭 추가와 셀 선택 이동, 행·열 삭제는 내용과 실행 취소를 보존한다", async ({ page, request }) => {
  const resourceId = FIXTURE_IDS.bodySearchResource;
  await seedResourceBlocks(request, resourceId, [
    { ...paragraph("cell-table", "| A | B | C |\n| --- | --- | --- |\n| 첫 행 | 값 | 오른쪽 |\n| 끝 행 | 아래 | 끝 |"), type: "table", columnWidths: [160, 200, 180] },
    paragraph("after-cell-table", "본문 보존"),
  ]);
  const editor = await openResource(page, resourceId);
  const block = editor.locator('[data-block-id="cell-table"]');
  const table = block.locator("table");
  const cell = (row, column) => block.locator(`[data-resource-table-cell][data-table-row="${row}"][data-table-column="${column}"]`);
  const saved = async () => (await persistedResource(request, resourceId)).blocks.find((entry) => entry.id === "cell-table");
  await block.hover();
  await block.locator('[data-resource-table-edge="rows"]').click();
  await expect(table.locator("tr")).toHaveCount(4);
  await block.locator('[data-resource-table-edge="columns"]').click();
  await expect(table.locator("thead th")).toHaveCount(4);
  await expect.poll(async () => (await saved()).text.split("\n").length).toBe(5);
  await page.keyboard.press("Meta+z");
  await expect(table.locator("thead th")).toHaveCount(3);
  await expect(cell(0, 0)).toBeFocused();
  await page.keyboard.press("Meta+Shift+z");
  await expect(table.locator("thead th")).toHaveCount(4);
  await expect(cell(0, 0)).toBeFocused();

  await setCaret(cell(1, 1), 0);
  await cell(1, 1).press("Escape");
  await expect(cell(1, 1)).toHaveClass(/is-cell-selected/);
  await expect(cell(1, 1)).toHaveAttribute("contenteditable", "false");
  await expect(cell(1, 1)).toBeFocused();
  await expect(block).not.toHaveClass(/is-selected/);
  expect(await page.evaluate(() => window.getSelection().toString())).toBe("");
  for (const [key, row, column] of [["ArrowRight", 1, 2], ["ArrowDown", 2, 2], ["ArrowLeft", 2, 1], ["ArrowUp", 1, 1]]) {
    await page.keyboard.press(key);
    await expect(cell(row, column)).toHaveClass(/is-cell-selected/);
    await expect(cell(row, column)).toBeFocused();
    await expect(block.locator(".resource-table-cell.is-cell-selected")).toHaveCount(1);
  }
  await page.keyboard.press("Enter");
  await expect(cell(1, 1)).toHaveAttribute("contenteditable", "true");
  await expect(cell(1, 1)).toBeFocused();
  expect(await cell(1, 1).evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(selection.focusNode, selection.focusOffset);
    return range.toString().length === element.textContent.length && selection.isCollapsed;
  })).toBe(true);
  await page.keyboard.insertText(" 추가");
  await expect(cell(1, 1)).toHaveText("값 추가");
  await page.keyboard.press("Tab");
  await expect(cell(1, 2)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(cell(1, 1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(cell(2, 1)).toBeFocused();
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.insertText("줄바꿈");
  await expect(cell(2, 1)).toBeFocused();
  await expect.poll(async () => (await saved()).text).toContain("아래<br>줄바꿈");
  await expect(table.locator("tr")).toHaveCount(4);

  await cell(1, 1).click();
  await cell(1, 1).press("Escape");
  await block.locator('[data-resource-table-delete="row"]').click();
  await expect(table.locator("tr")).toHaveCount(3);
  await expect(cell(1, 0)).toHaveText("끝 행");
  await expect(cell(1, 1)).toHaveClass(/is-cell-selected/);
  await page.keyboard.press("Meta+z");
  await expect(table.locator("tr")).toHaveCount(4);
  await expect(cell(1, 1)).toHaveText("값 추가");
  await expect(cell(1, 1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(cell(1, 1)).toHaveClass(/is-cell-selected/);
  await block.locator('[data-resource-table-delete="column"]').click();
  await expect(table.locator("thead th")).toHaveText(["A", "C", ""]);
  await expect(cell(1, 1)).toHaveText("오른쪽");
  await expect.poll(async () => (await saved()).columnWidths).toEqual([160, 180, 160]);
  await page.keyboard.press("Meta+z");
  await expect(table.locator("thead th")).toHaveText(["A", "B", "C", ""]);
  await expect(cell(1, 1)).toBeFocused();
  await page.keyboard.press("Meta+Shift+z");
  await expect(table.locator("thead th")).toHaveText(["A", "C", ""]);
  await expect(cell(1, 1)).toBeFocused();

  await cell(0, 0).click();
  await cell(0, 0).press("Escape");
  await block.locator('[data-resource-table-delete="row"]').click();
  await expect(table.locator("thead th")).toHaveText(["첫 행", "오른쪽", ""]);
  await block.locator('[data-resource-table-delete="column"]').click();
  await block.locator('[data-resource-table-delete="column"]').click();
  await expect(table.locator("thead th")).toHaveCount(1);
  await expect(block.locator('[data-resource-table-delete="column"]')).toBeDisabled();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await expect(cell(0, 0)).toHaveClass(/is-cell-selected/);
  await block.locator('[data-resource-table-delete="row"]').click();
  await block.locator('[data-resource-table-delete="row"]').click();
  await expect(table.locator("tr")).toHaveCount(1);
  await expect(block.locator('[data-resource-table-delete="row"]')).toBeDisabled();
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("한 칸");
  await expect.poll(async () => (await saved()).text).toBe("| 한 칸 |\n| --- |");
  await openResource(page, resourceId);
  await expect(table.locator("tr")).toHaveCount(1);
  await expect(cell(0, 0)).toHaveText("한 칸");
  await expect(editor.locator('[data-block-content="after-cell-table"]')).toHaveText("본문 보존");
});

test("표 열 너비와 서식은 잘못된 저장 요청을 거부한다", async ({ request }) => {
  const before = await fixtureSnapshot(request);
  for (const fields of [{ columnWidths: [-1] }, { columnWidths: [1201] }, { columnWidths: [80.5] }, { columnWidths: "160" }, { tableHeader: "false" }, { tableBold: 1 }]) {
    const state = structuredClone(before.state);
    state.resources.find((entry) => entry.id === FIXTURE_IDS.resource).blocks.push({ ...paragraph("invalid-table", "| A | B |\n| --- | --- |\n| 1 | 2 |"), type: "table", ...fields });
    const response = await request.put("/api/state", {
      headers: { "If-Match": `"state-${before.serverRevision}"` },
      data: { state, baseRevision: before.serverRevision },
    });
    expect(response.status()).toBe(422);
  }
  expect((await fixtureSnapshot(request)).state).toEqual(before.state);
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
    String.raw`\[ \sum_{i=1}^{n}\frac{x_i^2}{1+x_i} \]`,
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
  await expect(displayEquation).toHaveAttribute("data-equation-formula", String.raw`\sum_{i=1}^{n}\frac{x_i^2}{1+x_i}`);
  await expect(displayEquation).toHaveAttribute("role", "math");
  const fullEquation = displayEquation.locator("sygma-display-equation");
  await expect(fullEquation).toHaveAttribute("data-equation-rendered", "true");
  await expect(fullEquation.locator("munderover")).toHaveCount(1);
  const fraction = fullEquation.locator("[data-equation-fraction]");
  await expect(fraction).toHaveCount(1);
  const fractionGeometry = await fraction.evaluate((element) => {
    const numerator = element.querySelector("[data-equation-numerator]").getBoundingClientRect();
    const denominator = element.querySelector("[data-equation-denominator]").getBoundingClientRect();
    return {
      stacked: numerator.bottom < denominator.top,
      centered: Math.abs((numerator.left + numerator.right - denominator.left - denominator.right) / 2) < 2,
    };
  });
  expect(fractionGeometry).toEqual({ stacked: true, centered: true });
  await expect(editor.locator('[data-equation-mode="inline"] sygma-display-equation')).toHaveCount(0);
  const parserGuards = await page.evaluate(() => ({
    malformed: renderDisplayEquationMathML(String.raw`\frac{a}{`),
    tooDeep: renderDisplayEquationMathML(`${"{".repeat(65)}x${"}".repeat(65)}`),
    exclusiveMarks: normalizeInlineMarks("abc", [
      { type: "equation", start: 0, end: 3, formula: "abc", displayMode: true },
      { type: "bold", start: 0, end: 3 },
      { type: "equation", start: 1, end: 3, formula: "bc" },
    ]).map((mark) => mark.type),
  }));
  expect(parserGuards).toEqual({ malformed: "", tooDeep: "", exclusiveMarks: ["equation"] });
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
      { text: String.raw`\sum_{i=1}^{n}\frac{x_i^2}{1+x_i}`, equations: [{ type: "equation", start: 0, end: 33, formula: String.raw`\sum_{i=1}^{n}\frac{x_i^2}{1+x_i}`, displayMode: true }] },
      { text: `뒤 y^2\n${String.raw`리터럴 \(not math\)`}`, equations: [{ type: "equation", start: 2, end: 5, formula: "y^2" }] },
    ],
  });

  const reloadedEditor = await openResource(page, resourceId);
  await expect(reloadedEditor.locator('[data-equation-mode="inline"]')).toHaveCount(3);
  const reloadedDisplayEquation = reloadedEditor.locator('[data-equation-mode="display"]');
  await expect(reloadedDisplayEquation).toHaveAttribute("data-equation-formula", String.raw`\sum_{i=1}^{n}\frac{x_i^2}{1+x_i}`);
  await expect(reloadedDisplayEquation.locator("[data-equation-fraction]")).toHaveCount(1);
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

test("슬래시 검색은 검색어 뒤 첫 공백까지만 유지한다", async ({ page }) => {
  const { editor } = await createEmptyResource(page);
  const content = editor.locator("[data-block-content]").first();
  const menu = page.locator(".resource-slash-menu");

  await content.type("/");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Space");
  await expect(menu).toHaveCount(0);

  await content.fill("");
  await content.type("/heading");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Space");
  await expect(menu).toBeVisible();
  await page.keyboard.type("2");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Space");
  await expect(menu).toHaveCount(0);
});

test("슬래시 메뉴는 고정된 DOM에서 검색하고 서식과 표를 생성한다", async ({ page, request }) => {
  const { editor, resourceId } = await createEmptyResource(page);
  const content = editor.locator("[data-block-content]").first();
  await content.type("/");
  const menu = page.locator(".resource-slash-menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator("[data-resource-slash-id]")).toHaveCount(54);
  await menu.evaluate((element) => { window.slashMenuIdentity = element; window.slashOptionsIdentity = [...element.querySelectorAll("[role=option]")]; });
  const bounds = await menu.boundingBox();
  for (const character of "heading2") {
    await page.keyboard.type(character);
    expect(await menu.evaluate((element) => element === window.slashMenuIdentity && [...element.querySelectorAll("[role=option]")].every((option, index) => option === window.slashOptionsIdentity[index]))).toBe(true);
    expect((await menu.boundingBox()).height).toBe(bounds.height);
    expect(await menu.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
    await expect(content).toBeFocused();
  }
  await menu.locator('[data-resource-slash-id="heading2"]').click();
  await expect(menu).toHaveCount(0);
  await expect(editor.locator('.block[data-type="heading2"]')).toBeVisible();
  await page.keyboard.type("Heading");
  await expect.poll(async () => {
    const resource = await persistedResource(request, resourceId);
    return { text: resource?.blocks[0]?.text, type: resource?.blocks[0]?.type };
  }).toEqual({ text: "Heading", type: "heading2" });

  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  const composing = editor.locator('[data-block-content]:focus');
  await composing.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    element.textContent = "/표";
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", isComposing: true, data: "표" }));
  });
  await expect(page.locator('.resource-slash-option:not([hidden])')).toHaveCount(1);
  await expect(page.locator('.resource-slash-option:not([hidden])')).toHaveAttribute("data-resource-slash-id", "table");
  await composing.evaluate((element) => element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "표" })));
  await page.keyboard.press("Enter");
  await expect(editor.locator('.block[data-type="table"] table')).toBeVisible();
  await expect(editor.locator('.block[data-type="table"] tr')).toHaveCount(3);
  await expect.poll(async () => (await persistedResource(request, resourceId))?.blocks.some((block) => block.type === "table")).toBe(true);
});

test("슬래시 수식은 블록과 인라인을 구분하고 닫기와 코드 안의 슬래시는 본문을 보존한다", async ({ page, request }) => {
  const { editor, resourceId } = await createEmptyResource(page);
  const content = editor.locator("[data-block-content]").first();
  await content.type("before /inline equation");
  await page.keyboard.press("Enter");
  await page.locator("[data-inline-equation-input]").fill("\\frac{a}{b}");
  await page.locator("[data-inline-equation-input]").press("Enter");
  await expect(editor.locator('[data-equation-mode="inline"]')).toBeVisible();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/block equation");
  await page.keyboard.press("Enter");
  await page.locator("[data-inline-equation-input]").fill("\\frac{a}{b}");
  await page.locator("[data-inline-equation-input]").press("Enter");
  await expect(editor.locator('[data-equation-mode="display"] math')).toBeVisible();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/does-not-exist");
  await expect(page.locator(".resource-slash-empty")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".resource-slash-menu")).toHaveCount(0);
  await page.keyboard.type(" literal");
  await expect(page.locator(".resource-slash-menu")).toHaveCount(0);
  await expect(editor.locator('[data-block-content]:focus')).toHaveText("/does-not-exist literal");
  await expect.poll(async () => (await persistedResource(request, resourceId))?.blocks.some((block) => block.text === "/does-not-exist literal")).toBe(true);
  await page.keyboard.press("Enter");
  await page.keyboard.type("/code");
  await page.locator('[data-resource-slash-id="code"]').click();
  await page.keyboard.type("/not-a-command");
  await expect(page.locator(".resource-slash-menu")).toHaveCount(0);
  await expect(editor.locator('.block[data-type="code"] [data-block-content]')).toHaveText("/not-a-command");
});

test("슬래시 변환은 토글 자식과 인라인 서식, 조합 종료 직후의 한글을 보존한다", async ({ page, request }) => {
  await seedResourceBlocks(request, FIXTURE_IDS.bodySearchResource, [
    paragraph("slash-inline"),
    { ...paragraph("slash-toggle", "Parent"), type: "toggle" },
    { ...paragraph("slash-child", "Child"), indent: 1 },
    paragraph("slash-ime"),
    paragraph("slash-text-color"),
    paragraph("slash-background-color"),
  ]);
  const editor = await openResource(page, FIXTURE_IDS.bodySearchResource);
  await editor.locator('[data-block-content="slash-inline"]').type("/inline code");
  await page.keyboard.press("Enter");
  await page.keyboard.type("const");
  await expect(editor.locator('[data-block-content="slash-inline"] [data-inline-mark="code"]')).toHaveText("const");
  await expect(editor.locator('[data-block-content="slash-inline"] [data-inline-mark="code"]')).toHaveCSS("color", "rgb(235, 87, 87)");
  await expect(editor.locator('[data-block-content="slash-inline"] [data-inline-mark="code"]')).toHaveCSS("background-color", "rgba(135, 131, 120, 0.15)");
  for (const [blockId, optionId, markType, property, expected] of [
    ["slash-text-color", "text-red", "textColor", "color", "rgb(212, 76, 71)"],
    ["slash-background-color", "background-red", "backgroundColor", "background-color", "rgb(253, 235, 236)"],
  ]) {
    await editor.locator(`[data-block-content="${blockId}"]`).type("/");
    await page.locator(`[data-resource-slash-id="${optionId}"]`).click();
    await expect(editor.locator(`[data-block-content="${blockId}"] [data-inline-mark="${markType}"]`)).toHaveCSS(property, expected);
  }
  const parent = editor.locator('[data-block-content="slash-toggle"]');
  await setCaret(parent, "Parent".length);
  await parent.type(" /table");
  await page.keyboard.press("Enter");
  await expect(editor.locator('.block[data-type="table"]')).toHaveCount(1);
  expect(await editor.locator('.block').evaluateAll((blocks) => blocks.map((block) => block.dataset.blockId).slice(0, 3))).toEqual(["slash-inline", "slash-toggle", "slash-child"]);
  await editor.locator('[data-block-toggle="slash-toggle"]').click();
  await expect(editor.locator('[data-block-id="slash-child"]')).toBeHidden();

  const composing = editor.locator('[data-block-content="slash-ime"]');
  await composing.type("/");
  await composing.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    element.textContent = "/표";
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "표" }));
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
  });
  await expect(editor.locator('.block[data-type="table"]')).toHaveCount(2);
  await expect.poll(async () => {
    const resource = await persistedResource(request, FIXTURE_IDS.bodySearchResource);
    return { tables: resource.blocks.filter((block) => block.type === "table").length, child: resource.blocks.find((block) => block.id === "slash-child")?.text };
  }).toEqual({ tables: 2, child: "Child" });
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

test("Cmd+위아래 방향키는 표 안에서도 편집기 최상단과 최하단으로 이동한다", async ({ page, request }) => {
  const firstId = "command-edge-first";
  const middleId = "command-edge-middle";
  const lastId = "command-edge-last";
  await seedResourceBlocks(request, FIXTURE_IDS.bodySearchResource, [
    { ...paragraph("command-edge-top-divider"), type: "divider" },
    { ...paragraph(firstId, "| 처음 |\n| --- |\n| 첫 셀 |"), type: "table" },
    { ...paragraph(middleId, "| 중간 |\n| --- |\n| 가운데 |"), type: "table" },
    { ...paragraph(lastId, "| 마지막 |\n| --- |\n| 끝 셀 |"), type: "table" },
    { ...paragraph("command-edge-bottom-divider"), type: "divider" },
  ]);
  const editor = await openResource(page, FIXTURE_IDS.bodySearchResource);
  const cell = editor.locator(`[data-block-id="${middleId}"] [data-resource-table-cell]`).last();
  const firstCell = editor.locator(`[data-block-id="${firstId}"] [data-resource-table-cell]`).first();
  const lastCell = editor.locator(`[data-block-id="${lastId}"] [data-resource-table-cell]`).last();
  const caretOffset = (target) => target.evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(selection.focusNode, selection.focusOffset);
    return range.toString().length;
  });

  await setCaret(cell, 1);
  await cell.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowUp", metaKey: true, isComposing: true, keyCode: 229 }));
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }));
  });
  await expect(cell).toBeFocused();
  await page.keyboard.press("Meta+ArrowUp");
  await expect(firstCell).toBeFocused();
  expect(await caretOffset(firstCell)).toBe(0);

  await setCaret(cell, 1);
  await page.keyboard.press("Meta+ArrowDown");
  await expect(lastCell).toBeFocused();
  expect(await caretOffset(lastCell)).toBe((await lastCell.textContent()).length);
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

test("Resource 토글은 화살표가 첫 줄 중앙에 맞고 제목과 본문의 왼쪽 여백이 같다", async ({ page, request }) => {
  const variants = ["default", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6"];
  const blocks = variants.flatMap((variant, index) => {
    const toggle = {
      id: `toggle-alignment-${variant}`,
      type: "toggle",
      text: `${variant} 토글`,
      marks: [],
      checked: false,
      indent: 0,
      collapsed: index % 2 === 1,
    };
    if (variant !== "default") toggle.toggleHeading = variant;
    return [
      toggle,
      { id: `toggle-alignment-child-${index}`, type: "paragraph", text: "토글 자식", marks: [], checked: false, indent: 1, collapsed: false },
    ];
  });
  blocks.splice(2, 0,
    { ...paragraph("toggle-alignment-nested", "중첩 토글"), type: "toggle", toggleHeading: "heading2", indent: 1 },
    { ...paragraph("toggle-alignment-nested-child", "중첩 본문"), indent: 2 },
  );
  await seedResourceBlocks(request, FIXTURE_IDS.bodySearchResource, blocks);
  const editor = await openResource(page, FIXTURE_IDS.bodySearchResource);
  await settleAnimationFrames(page);

  const measurements = await editor.locator('[data-type="toggle"][data-indent="0"]').evaluateAll((elements) => elements.map((element) => {
    const control = element.querySelector("[data-block-toggle]");
    const content = element.querySelector("[data-block-content]");
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.textContent.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
    });
    const textNode = walker.nextNode();
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(1, textNode.textContent.length));
    const line = range.getClientRects()[0] || range.getBoundingClientRect();
    const controlRect = control.getBoundingClientRect();
    const controlCenter = controlRect.top + controlRect.height / 2;
    const lineCenter = line.top + line.height / 2;
    return {
      variant: element.dataset.toggleHeading || "default",
      controlCenter: Number(controlCenter.toFixed(3)),
      lineCenter: Number(lineCenter.toFixed(3)),
      delta: Number((controlCenter - lineCenter).toFixed(3)),
      absoluteDelta: Number(Math.abs(controlCenter - lineCenter).toFixed(3)),
    };
  }));
  expect(measurements.map(({ variant }) => variant)).toEqual(variants);
  for (const measurement of measurements) {
    expect.soft(
      measurement.absoluteDelta,
      `${measurement.variant}: toggle=${measurement.controlCenter}, first-line=${measurement.lineCenter}, delta=${measurement.delta}`,
    ).toBeLessThanOrEqual(2);
  }
  for (const variant of variants.filter((_, index) => index % 2 === 1)) {
    await editor.locator(`[data-block-toggle="toggle-alignment-${variant}"]`).click();
  }
  await expect(editor.locator(".toggle-child-animation-group")).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const maxLeftDelta = await editor.locator('[data-type="toggle"]').evaluateAll((elements) => Math.max(...elements.map((element) => {
      const title = element.querySelector("[data-block-content]").getBoundingClientRect();
      const body = element.nextElementSibling.querySelector("[data-block-content]").getBoundingClientRect();
      return Math.abs(body.left - title.left);
    })));
    expect(maxLeftDelta, `toggle body alignment at ${width}px`).toBeLessThanOrEqual(1);
  }
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

test("슬래시 표는 미완성 backtick과 파이프를 입력해도 닫기와 재접속 후 표로 남는다", async ({ page, request }) => {
  const demotedText = "| `구버전 | 남은 내용 |\n| --- | --- |\n| 본문 | 복구 |";
  await seedResourceBlocks(request, FIXTURE_IDS.bodySearchResource, [
    { ...paragraph("single-column-table", "| 제목 |\n| --- |\n| 내용 |"), type: "table" },
    { ...paragraph("legacy-code-pipe-table", "| 코드 | 값 |\n| --- | --- |\n| `a|b` | 유지 |"), type: "table" },
    paragraph("demoted-table", demotedText),
    { ...paragraph("marked-table-text", demotedText), marks: [{ type: "bold", start: 0, end: 1 }] },
  ]);
  await seedResourceBlocks(request, FIXTURE_IDS.readOnlyResource, [paragraph("readonly-table-text", demotedText)]);
  const { document, editor, resourceId } = await createEmptyResource(page);
  await editor.locator("[data-block-content]").fill("/표");
  await page.keyboard.press("Enter");
  await expect(editor.locator("table")).toHaveCount(1);
  await document.getByRole("button", { name: "자료 닫기", exact: true }).click();
  await page.locator(`[data-resource-open="${resourceId}"]`).click();
  await expect(editor.locator("table tr")).toHaveCount(3);

  const values = ["`미완성", "`다른 셀", "끝 | 값"];
  for (let column = 0; column < values.length; column += 1) {
    await editor.locator(`[data-table-row="0"][data-table-column="${column}"]`).fill(values[column]);
  }
  await document.getByRole("button", { name: "자료 닫기", exact: true }).click();
  await page.locator(`[data-resource-open="${resourceId}"]`).click();
  await expect(editor.locator("table thead th [data-resource-table-cell]")).toHaveText(values);
  await expect.poll(async () => (await persistedResource(request, resourceId))?.blocks[0]?.type).toBe("table");
  const reopened = await openResource(page, resourceId);
  await expect(reopened.locator("table thead th [data-resource-table-cell]")).toHaveText(values);

  const existing = await openResource(page, FIXTURE_IDS.bodySearchResource);
  await expect(existing.locator('[data-block-id="single-column-table"] table thead th')).toHaveText(["제목"]);
  await expect(existing.locator('[data-block-id="single-column-table"] table tbody td')).toHaveText(["내용"]);
  await expect(existing.locator('[data-block-id="legacy-code-pipe-table"] table tbody td')).toHaveText(["a|b", "유지"]);
  await expect(existing.locator('[data-block-id="demoted-table"]')).toHaveAttribute("data-type", "table");
  await expect(existing.locator('[data-block-id="marked-table-text"]')).toHaveAttribute("data-type", "paragraph");
  await expect.poll(async () => (await persistedResource(request, FIXTURE_IDS.bodySearchResource)).blocks.find((block) => block.id === "demoted-table")).toMatchObject({ type: "table", text: demotedText });
  const readOnly = await openResource(page, FIXTURE_IDS.readOnlyResource);
  await expect(readOnly.locator('[data-block-id="readonly-table-text"]')).toHaveAttribute("data-type", "paragraph");
  expect((await persistedResource(request, FIXTURE_IDS.readOnlyResource)).blocks[0]).toMatchObject({ type: "paragraph", text: demotedText });
});

test("긴 표의 높이는 본문 줄바꿈과 코멘트 사이드바 크기 변경 후에도 다음 문장과 겹치지 않는다", async ({ page, request }) => {
  const tableText = [
    "| 분류 | 설명 | 상태 | 값 |",
    "| --- | --- | --- | --- |",
    ...Array.from({ length: 16 }, (_, index) => `| 항목 ${index} | ${"실제 문서의 문장으로 셀이 여러 줄에 걸치도록 채웁니다. ".repeat(3)} | 연구실 현장 검증 | X |`),
  ].join("\n");
  await seedResourceBlocks(request, FIXTURE_IDS.bodySearchResource, [
    { ...paragraph("wrapped-body", `명시적 줄바꿈입니다.\n${"좁은 Resource에서 너비 때문에 자동으로 넘어가는 긴 문장입니다. ".repeat(8)}`), marks: [{ type: "bold", start: 0, end: 9 }] },
    { ...paragraph("long-table", tableText), type: "table" },
    { ...paragraph("after-table-heading", "4개년 계획"), type: "heading2" },
    paragraph("after-table-body", "겹치면 안 되는 표 아래 본문입니다."),
  ]);
  const editor = await openResource(page, FIXTURE_IDS.bodySearchResource);
  const gap = () => editor.evaluate((root) => {
    const table = root.querySelector("table").getBoundingClientRect();
    const block = root.querySelector('[data-block-id="long-table"]').getBoundingClientRect();
    const heading = root.querySelector('[data-block-id="after-table-heading"]').getBoundingClientRect();
    return { block: block.bottom - table.bottom, heading: heading.top - table.bottom };
  });
  const expectNoOverlap = async () => {
    const blocksContainContent = await editor.locator(".block").evaluateAll((blocks) => blocks.every((block, index) => {
      const content = block.querySelector("[data-block-content]");
      const next = blocks[index + 1];
      if (!content) return true;
      const blockRect = block.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      return blockRect.bottom >= contentRect.bottom && (!next || blockRect.bottom <= next.getBoundingClientRect().top);
    }));
    expect(blocksContainContent).toBe(true);
    await expect.poll(async () => (await gap()).block).toBeGreaterThanOrEqual(14);
    expect((await gap()).heading).toBeGreaterThanOrEqual(14);
  };
  await expectNoOverlap();
  await page.locator("[data-resource-comments-toggle]").click();
  await expect.poll(() => page.locator("[data-resource-document]").getAttribute("class")).toContain("comments-open");
  await page.waitForTimeout(300);
  await expectNoOverlap();
  await page.locator("[data-resource-comments-toggle]").click();
  await page.waitForTimeout(300);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoOverlap();
  const resource = await persistedResource(request, FIXTURE_IDS.bodySearchResource);
  expect(resource.blocks.find((block) => block.id === "long-table")?.text).toBe(tableText);
});

test("행과 열 서식은 선택 범위에만 적용되고 저장과 행열 삭제 뒤에도 유지된다", async ({ page, request }) => {
  test.setTimeout(45_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedResourceBlocks(request, FIXTURE_IDS.bodySearchResource, [
    paragraph("table-scope-intro", "행과 열을 따로 선택합니다."),
    { ...paragraph("table-scope", "| 이름 | 상태 | 메모 |\n| --- | --- | --- |\n| 첫 행 | 진행 | 유지 |\n| 둘째 행 | 예정 | 확인 |"), type: "table", columnWidths: [180, 180, 180], tableCellMarks: { "1:2": [{ type: "code", start: 0, end: 2 }] } },
    paragraph("table-scope-paste"),
  ]);
  const editor = await openResource(page, FIXTURE_IDS.bodySearchResource);
  const block = editor.locator('[data-block-id="table-scope"]');
  const toolbar = block.locator(".resource-table-format");
  const cell = (row, column) => block.locator(`[data-resource-table-cell][data-table-row="${row}"][data-table-column="${column}"]`);
  const choose = async (field, value) => {
    const picker = toolbar.locator("[data-finance-select]").filter({ has: page.locator(`[data-resource-table-format="${field}"]`) });
    await picker.locator("[data-finance-select-trigger]").click();
    await picker.locator(`[data-finance-select-option="${value}"]`).click();
  };
  await block.hover();
  await block.getByRole("button", { name: "표 전체 선택", exact: true }).click();
  await expect(block).toHaveClass(/is-selected/);
  await toolbar.locator('[data-resource-table-format="tableHeader"]').click();
  await expect(block.locator("th")).toHaveCount(0);
  await expect(cell(0, 0).locator("..")).toHaveCSS("border-bottom-width", "1px");

  await block.getByRole("button", { name: "2행 선택", exact: true }).click();
  await expect(block.locator(".is-cell-selected")).toHaveCount(3);
  await expect(toolbar).toHaveAttribute("aria-label", "행 서식");
  await toolbar.locator('[data-resource-table-format="tableBold"]').click();
  await choose("color", "red");
  await choose("align", "center");
  await toolbar.locator('[data-resource-table-format="tableHeader"]').click();
  await expect(block.locator("tbody tr").first().locator("th")).toHaveCount(3);
  await expect(cell(1, 0)).toHaveCSS("font-weight", "750");
  await expect(cell(1, 0)).toHaveCSS("color", "rgb(212, 76, 71)");
  await expect(cell(1, 0)).toHaveCSS("text-align", "center");
  await expect(cell(2, 0)).toHaveCSS("font-weight", "400");
  await expect(cell(2, 0)).toHaveCSS("text-align", "left");

  await block.getByRole("button", { name: "2열 선택", exact: true }).click();
  await expect(block.locator(".is-cell-selected")).toHaveCount(3);
  await expect(toolbar).toHaveAttribute("aria-label", "열 서식");
  await choose("backgroundColor", "blue");
  await choose("align", "right");
  await cell(2, 2).click();
  for (const row of [0, 1, 2]) {
    await expect(cell(row, 1).locator("..")).toHaveCSS("background-color", "rgb(231, 243, 248)");
    await expect(cell(row, 1)).toHaveCSS("text-align", "right");
  }
  await expect(cell(2, 0).locator("..")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const stored = async () => (await persistedResource(request, FIXTURE_IDS.bodySearchResource)).blocks.find((entry) => entry.id === "table-scope");
  await expect.poll(async () => (await stored()).tableCellFormats?.["1:0"]).toEqual({ bold: true, color: "red", align: "center", header: true });
  await expect.poll(async () => (await stored()).tableCellFormats?.["2:1"]).toEqual({ backgroundColor: "blue", align: "right" });
  await openResource(page, FIXTURE_IDS.bodySearchResource);
  await expect(cell(1, 0)).toHaveCSS("color", "rgb(212, 76, 71)");
  await expect(cell(1, 1)).toHaveCSS("text-align", "right");

  await block.getByRole("button", { name: "1행 선택", exact: true }).click();
  await toolbar.getByRole("button", { name: "행 삭제", exact: true }).click();
  await expect(block.locator("tr")).toHaveCount(2);
  await expect(cell(0, 0)).toHaveText("첫 행");
  await expect(cell(0, 0)).toHaveCSS("color", "rgb(212, 76, 71)");
  await block.getByRole("button", { name: "1열 선택", exact: true }).click();
  await toolbar.getByRole("button", { name: "열 삭제", exact: true }).click();
  await expect(cell(0, 0)).toHaveText("진행");
  await expect(cell(0, 0)).toHaveCSS("text-align", "right");
  await expect.poll(async () => (await stored()).tableCellFormats?.["0:0"]).toEqual({ bold: true, color: "red", align: "right", header: true, backgroundColor: "blue" });
  await openResource(page, FIXTURE_IDS.bodySearchResource);
  await expect(block.locator("tr")).toHaveCount(2);
  await expect(cell(0, 0)).toHaveCSS("color", "rgb(212, 76, 71)");
  await expect(cell(0, 1).locator('[data-inline-mark="code"]')).toHaveText("유지");
  await block.getByRole("button", { name: "표 전체 선택", exact: true }).click();
  const copied = await block.evaluate((element) => {
    const data = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data }));
    return { text: data.getData("text/plain"), html: data.getData("text/html") };
  });
  expect(copied.html).toContain("data-block-table=");
  await page.keyboard.press("Meta+d");
  await expect(editor.locator("table")).toHaveCount(2);
  await editor.locator('[data-block-content="table-scope-paste"]').evaluate((element, copied) => {
    element.focus();
    const data = new DataTransfer();
    data.setData("text/plain", copied.text);
    data.setData("text/html", copied.html);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  }, copied);
  await expect(editor.locator("table")).toHaveCount(3);
  await expect.poll(async () => (await persistedResource(request, FIXTURE_IDS.bodySearchResource)).blocks.filter((entry) => entry.type === "table").length).toBe(3);
  const copies = (await persistedResource(request, FIXTURE_IDS.bodySearchResource)).blocks.filter((entry) => entry.type === "table");
  for (const copy of copies.slice(1)) {
    for (const field of ["text", "columnWidths", "tableHeader", "tableCellMarks", "tableCellFormats"]) expect(copy[field]).toEqual(copies[0][field]);
  }
  await expect(editor.locator('table [data-inline-mark="code"]')).toHaveText(["유지", "유지", "유지"]);
  const before = await fixtureSnapshot(request);
  const draft = structuredClone(before.state);
  const invalid = draft.resources.find((entry) => entry.id === FIXTURE_IDS.bodySearchResource).blocks.find((entry) => entry.id === "table-scope");
  invalid.tableCellFormats["99:0"] = { bold: true };
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state: draft, baseRevision: before.serverRevision },
  });
  expect(response.status()).toBe(422);
  expect((await fixtureSnapshot(request)).serverRevision).toBe(before.serverRevision);
  expect(errors).toEqual([]);
});

test("표 머리글을 꺼도 경계선이 남고 서식 메뉴는 여유 있게 중앙 정렬된다", async ({ page, request }, testInfo) => {
  await seedResourceBlocks(request, FIXTURE_IDS.bodySearchResource, [
    paragraph("table-layout-intro", "표 서식과 경계선"),
    { ...paragraph("table-layout", "| 제목 | 상태 |\n| --- | --- |\n| 첫 행 | 확인 |\n| 둘째 행 | 유지 |"), type: "table" },
  ]);
  const editor = await openResource(page, FIXTURE_IDS.bodySearchResource);
  const block = editor.locator('[data-block-id="table-layout"]');
  const cell = block.locator("[data-resource-table-cell]").first();
  await cell.click();
  await cell.press("Escape");
  await cell.press("Escape");
  const toolbar = block.locator(".resource-table-format");
  await toolbar.locator('[data-resource-table-format="tableHeader"]').click();
  await expect(block.locator("th")).toHaveCount(0);
  for (const row of await block.locator("tr").all()) {
    const isLast = await row.evaluate((element) => element === element.closest("table").rows[element.closest("table").rows.length - 1]);
    await expect(row.locator("td").first()).toHaveCSS("border-bottom-width", isLast ? "0px" : "1px");
  }
  expect(await toolbar.evaluate((element) => parseFloat(getComputedStyle(element).paddingLeft))).toBeGreaterThanOrEqual(10);
  for (const field of ["color", "backgroundColor", "align"]) {
    const picker = toolbar.locator("[data-finance-select]").filter({ has: page.locator(`[data-resource-table-format="${field}"]`) });
    const trigger = picker.locator("[data-finance-select-trigger]");
    const geometry = () => trigger.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const value = element.querySelector("[data-finance-select-value]").getBoundingClientRect();
      const arrow = element.lastElementChild.getBoundingClientRect();
      return { valueX: (value.left + value.right - box.left - box.right) / 2, valueY: (value.top + value.bottom - box.top - box.bottom) / 2, arrowY: (arrow.top + arrow.bottom - box.top - box.bottom) / 2 };
    });
    const closed = await geometry();
    await trigger.click();
    const list = picker.locator("[data-finance-select-options]");
    await expect(list).toBeVisible();
    await list.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {}))));
    const opened = await geometry();
    for (const value of [...Object.values(closed), ...Object.values(opened)]) expect(Math.abs(value)).toBeLessThanOrEqual(1);
    expect((await list.boundingBox()).width).toBeGreaterThanOrEqual(120);
    for (const option of await list.locator("[data-finance-select-option]").all()) {
      const layout = await option.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const value = element.querySelector("span").getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element.querySelector("span"));
        return { lines: range.getClientRects().length, dx: (value.left + value.right - box.left - box.right) / 2, dy: (value.top + value.bottom - box.top - box.bottom) / 2 };
      });
      expect(layout.lines).toBe(1);
      expect(Math.abs(layout.dx)).toBeLessThanOrEqual(1);
      expect(Math.abs(layout.dy)).toBeLessThanOrEqual(1);
    }
    if (field === "backgroundColor") await page.screenshot({ path: testInfo.outputPath("table-format-menu.png") });
    await trigger.click();
  }
});
