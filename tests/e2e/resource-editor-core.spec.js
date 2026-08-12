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
  await content.type("> ");
  await expect(content.locator("xpath=ancestor::*[@data-block-id][1]")).toHaveAttribute("data-type", "quote");
  await content.type("인용문");

  await content.press("Enter");
  await editor.locator("[data-block-content]:focus").press("Enter");
  content = editor.locator("[data-block-content]:focus");
  await content.type(">> ");
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
  await expect(liveEditor.locator('pre[data-code-language="python"] code:focus')).toBeVisible();

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

test("이미지를 업로드하면 안전한 이미지 블록으로 저장되고 다시 열어도 보인다", async ({ page, request }) => {
  const { editor, resourceId } = await createEmptyResource(page);
  const content = editor.locator("[data-block-content]").first();
  await content.type("/image");
  const imageAction = page.locator('[data-slash-action="image:upload"]');
  await expect(imageAction).toBeVisible();

  const chooserPromise = page.waitForEvent("filechooser");
  await imageAction.click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: "pixel.png", mimeType: "image/png", buffer: PIXEL_PNG });

  const image = editor.locator('.block[data-type="image"] img');
  await expect(image).toBeVisible();
  const src = await image.getAttribute("src");
  expect(src).toMatch(/^\/api\/resource-images\/[a-zA-Z0-9_-]+$/);
  const imageResponse = await request.get(src);
  expect(imageResponse.ok()).toBeTruthy();
  expect(imageResponse.headers()["content-type"]).toContain("image/png");

  await expect.poll(async () => {
    const resource = await persistedResource(request, resourceId);
    const block = resource?.blocks.find((entry) => entry.type === "image");
    return block ? { type: block.type, url: block.url } : null;
  }).toEqual({ type: "image", url: src });

  const reloadedEditor = await openResource(page, resourceId);
  await expect(reloadedEditor.locator(`.block[data-type="image"] img[src="${src}"]`)).toBeVisible();
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
