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
  await expect(content.locator("xpath=ancestor::*[@data-block-id][1]")).toHaveAttribute("data-type", "bullet");
  expect(await content.evaluate((element) => getComputedStyle(element, "::before").content)).toContain("•");
  await content.type("부모 항목");
  await content.press("Enter");

  content = editor.locator("[data-block-content]:focus");
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

test("Markdown 제목 4-6, fenced code 언어와 핵심 inline 문법을 붙여넣을 수 있다", async ({ page, request }) => {
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
    "**굵게** *기울임* ~~취소선~~ [링크](https://example.com/markdown)",
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
  const inline = editor.locator('.block[data-type="paragraph"]').last();
  await expect(inline.locator('[data-inline-mark="bold"]')).toHaveText("굵게");
  await expect(inline.locator('[data-inline-mark="italic"]')).toHaveText("기울임");
  await expect(inline.locator('[data-inline-mark="strike"]')).toHaveText("취소선");
  await expect(inline.locator('a[data-inline-mark="link"]')).toHaveAttribute("href", "https://example.com/markdown");

  await expect.poll(async () => {
    const resource = await persistedResource(request, resourceId);
    return resource?.blocks.map((block) => ({
      type: block.type,
      text: block.text,
      language: block.language || "",
      marks: block.marks.map((mark) => mark.type),
    }));
  }).toEqual([
    { type: "heading4", text: "제목 4", language: "", marks: [] },
    { type: "heading5", text: "제목 5", language: "", marks: [] },
    { type: "heading6", text: "제목 6", language: "", marks: [] },
    { type: "code", text: "const backtick = true;", language: "javascript", marks: [] },
    { type: "code", text: "print('tilde')", language: "python", marks: [] },
    { type: "paragraph", text: "굵게 기울임 취소선 링크", language: "", marks: ["bold", "italic", "strike", "link"] },
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
  await content.evaluate((element, bytes) => {
    element.focus();
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([new Uint8Array(bytes)], "clipboard.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, [...PIXEL_PNG]);
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
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

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
