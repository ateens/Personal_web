import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const RESOURCE_PATH = `/resources/${encodeURIComponent(FIXTURE_IDS.resource)}`;
const TARGET_BLOCK_ID = "fixture-block-paragraph";
const CUSTOM_BLOCK_MIME = "application/x-sygma-blocks";

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto(RESOURCE_PATH);
  await expect(resourceNote(page)).toBeVisible();
});

function resourceNote(page) {
  return page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
}

function targetBlock(page) {
  return resourceNote(page).locator(`[data-block-id="${TARGET_BLOCK_ID}"]`);
}

function targetContent(page) {
  return targetBlock(page).locator(`[data-block-content="${TARGET_BLOCK_ID}"]`);
}

function choiceMenu(page) {
  return page.locator("[data-url-paste-choice-menu]");
}

async function serverBlock(request, blockId = TARGET_BLOCK_ID) {
  const snapshot = await fixtureSnapshot(request);
  const resource = snapshot.state.resources.find((entry) => entry.id === FIXTURE_IDS.resource);
  return resource?.blocks.find((entry) => entry.id === blockId) || null;
}

async function setTargetText(page, request, text) {
  await targetContent(page).evaluate((element, nextText) => {
    element.focus();
    element.textContent = nextText;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: nextText ? "insertText" : "deleteContentBackward",
      data: nextText || null,
    }));
  }, text);
  await expect.poll(async () => (await serverBlock(request))?.text).toBe(text);
}

async function selectTargetText(page, start, end) {
  await targetContent(page).evaluate((element, offsets) => {
    element.focus();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNode = walker.nextNode() || element.appendChild(document.createTextNode(""));
    const range = document.createRange();
    range.setStart(textNode, Math.min(offsets.start, textNode.textContent.length));
    range.setEnd(textNode, Math.min(offsets.end, textNode.textContent.length));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, { start, end });
}

async function placeCaretInEmptyTarget(page) {
  await targetContent(page).evaluate((element) => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

async function dispatchPaste(page, values) {
  return targetContent(page).evaluate((element, clipboardValues) => {
    const transfer = new DataTransfer();
    for (const [mime, value] of Object.entries(clipboardValues)) transfer.setData(mime, value);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    });
    element.dispatchEvent(event);
    return { defaultPrevented: event.defaultPrevented, types: [...transfer.types] };
  }, values);
}

test("Link choice keeps selected text editable, persists a safe mark, and supports undo/redo", async ({ page, request }) => {
  const originalText = await targetContent(page).textContent();
  const url = "https://example.com/linked?q=1";
  await selectTargetText(page, 0, "Paragraph".length);

  const paste = await dispatchPaste(page, { "text/plain": url });
  expect(paste.defaultPrevented).toBe(true);
  await expect(choiceMenu(page)).toBeVisible();
  await expect(page.locator('[data-url-paste-choice-action="link"]')).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(choiceMenu(page)).toHaveCount(0);
  await expect(targetBlock(page)).toHaveAttribute("data-type", "paragraph");
  await expect(targetContent(page)).toHaveText(originalText);
  const link = targetContent(page).locator('a[data-inline-mark="link"]');
  await expect(link).toHaveText("Paragraph");
  await expect(link).toHaveAttribute("href", url);
  await expect.poll(async () => (await serverBlock(request))?.marks.some((mark) => (
    mark.type === "link" && mark.start === 0 && mark.end === "Paragraph".length && mark.href === url
  ))).toBe(true);

  await page.keyboard.press("Meta+z");
  await expect(targetContent(page).locator('a[data-inline-mark="link"]')).toHaveCount(0);
  await page.keyboard.press("Meta+Shift+z");
  await expect(targetContent(page).locator('a[data-inline-mark="link"]')).toHaveAttribute("href", url);
});

test("Bookmark choice is keyboard reachable, clamped in a short viewport, and survives reload", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 260 });
  await setTargetText(page, request, "");
  await targetContent(page).scrollIntoViewIfNeeded();
  await placeCaretInEmptyTarget(page);
  const url = "https://example.com/bookmark/path?source=e2e";

  expect((await dispatchPaste(page, { "text/plain": url })).defaultPrevented).toBe(true);
  await expect(choiceMenu(page)).toBeVisible();
  await expect.poll(async () => {
    const menuBox = await choiceMenu(page).boundingBox();
    return Boolean(menuBox && menuBox.y + menuBox.height <= 253);
  }).toBe(true);
  const box = await choiceMenu(page).boundingBox();
  expect(box).toBeTruthy();
  expect(box.x).toBeGreaterThanOrEqual(7);
  expect(box.y).toBeGreaterThanOrEqual(7);
  expect(box.x + box.width).toBeLessThanOrEqual(383);
  expect(box.y + box.height).toBeLessThanOrEqual(253);

  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[data-url-paste-choice-action="bookmark"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(targetBlock(page)).toHaveAttribute("data-type", "bookmark");
  await expect(targetBlock(page).locator('[data-url-block-preview="bookmark"]')).toBeVisible();
  await expect(targetBlock(page).locator("[data-url-block-open]")).toHaveAttribute("href", url);
  await expect.poll(async () => {
    const block = await serverBlock(request);
    return { type: block?.type, text: block?.text, url: block?.url };
  }).toEqual({ type: "bookmark", text: url, url });

  await page.reload();
  await expect(resourceNote(page)).toBeVisible();
  await expect(targetBlock(page)).toHaveAttribute("data-type", "bookmark");
  await expect(targetBlock(page).locator("[data-url-block-open]")).toHaveAttribute("href", url);
});

test("Embed choice persists an inert deterministic preview and is undoable", async ({ page, request }) => {
  await setTargetText(page, request, "");
  await placeCaretInEmptyTarget(page);
  const url = "https://example.com/%3Cimg%20src=x%20onerror=window.__urlPasteXss=1%3E";

  expect((await dispatchPaste(page, { "text/plain": url })).defaultPrevented).toBe(true);
  await page.locator('[data-url-paste-choice-action="embed"]').click();

  await expect(targetBlock(page)).toHaveAttribute("data-type", "embed");
  const preview = targetBlock(page).locator('[data-url-block-preview="embed"]');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("외부 콘텐츠는 자동 실행하지 않습니다");
  const open = preview.locator("[data-url-block-open]");
  await expect(open).toHaveAttribute("href", url);
  await expect(open).toHaveAttribute("rel", /noopener/);
  await expect(resourceNote(page).locator("iframe, script, object, embed, img, [onerror], [onclick]")) .toHaveCount(0);
  expect(await page.evaluate(() => window.__urlPasteXss || 0)).toBe(0);
  await expect.poll(async () => {
    const block = await serverBlock(request);
    return { type: block?.type, url: block?.url };
  }).toEqual({ type: "embed", url });

  await page.keyboard.press("Meta+z");
  await expect(targetBlock(page)).toHaveAttribute("data-type", "paragraph");
  await expect(targetContent(page)).toHaveText("");
  await page.keyboard.press("Meta+Shift+z");
  await expect(targetBlock(page)).toHaveAttribute("data-type", "embed");
  await expect(targetBlock(page).locator("iframe, script, object, embed, img")).toHaveCount(0);
});

test("Cancel button and Escape leave the empty target unchanged", async ({ page, request }) => {
  await setTargetText(page, request, "");
  await placeCaretInEmptyTarget(page);
  const url = "https://example.com/cancel";

  expect((await dispatchPaste(page, { "text/plain": url })).defaultPrevented).toBe(true);
  await page.locator('[data-url-paste-choice-action="cancel"]').click();
  await expect(choiceMenu(page)).toHaveCount(0);
  await expect(targetContent(page)).toHaveText("");
  expect((await serverBlock(request))?.type).toBe("paragraph");

  await placeCaretInEmptyTarget(page);
  expect((await dispatchPaste(page, { "text/plain": url })).defaultPrevented).toBe(true);
  await page.keyboard.press("Escape");
  await expect(choiceMenu(page)).toHaveCount(0);
  await expect(targetContent(page)).toHaveText("");
  await expect(targetContent(page)).toBeFocused();
});

test("HTTP, unsafe schemes, non-standalone text, and a collapsed non-empty caret use normal paste fallback", async ({ page }) => {
  const originalText = await targetContent(page).textContent();
  for (const value of [
    "http://example.com/not-https",
    "javascript:window.__urlPasteXss=1",
    "data:text/html,<script>window.__urlPasteXss=1</script>",
    "https://example.com plus trailing text",
  ]) {
    await selectTargetText(page, 0, "Paragraph".length);
    const paste = await dispatchPaste(page, { "text/plain": value });
    expect(paste.defaultPrevented).toBe(false);
    await expect(choiceMenu(page)).toHaveCount(0);
  }
  await selectTargetText(page, originalText.length, originalText.length);
  expect((await dispatchPaste(page, { "text/plain": "https://example.com/collapsed" })).defaultPrevented).toBe(false);
  await expect(choiceMenu(page)).toHaveCount(0);
  await expect(targetContent(page)).toHaveText(originalText);
  await expect(targetContent(page).locator('a[href^="javascript:" i], script, img, iframe')).toHaveCount(0);
  expect(await page.evaluate(() => window.__urlPasteXss || 0)).toBe(0);
});

test("unsafe custom URL blocks degrade to escaped paragraph text without executable DOM", async ({ page, request }) => {
  await targetContent(page).focus();
  await targetContent(page).press("Escape");
  await expect(targetBlock(page)).toHaveClass(/is-selected/);
  const unsafeUrl = "javascript:window.__urlPasteXss=1";
  const paste = await dispatchPaste(page, {
    [CUSTOM_BLOCK_MIME]: JSON.stringify({
      version: 1,
      blocks: [{ type: "embed", text: unsafeUrl, url: unsafeUrl, marks: [] }],
    }),
    "text/plain": unsafeUrl,
  });

  expect(paste.defaultPrevented).toBe(true);
  const safeFallback = resourceNote(page).locator('.block[data-type="paragraph"]').filter({ hasText: unsafeUrl });
  await expect(safeFallback).toHaveCount(1);
  await expect(safeFallback.locator("[data-block-content]")).toHaveText(unsafeUrl);
  await expect(resourceNote(page).locator('a[href^="javascript:" i], script, img, iframe, object, embed, [onerror], [onclick]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__urlPasteXss || 0)).toBe(0);
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    const resource = snapshot.state.resources.find((entry) => entry.id === FIXTURE_IDS.resource);
    const block = resource?.blocks.find((entry) => entry.text === unsafeUrl);
    return { type: block?.type, text: block?.text, hasUrl: Object.prototype.hasOwnProperty.call(block || {}, "url") };
  }).toEqual({ type: "paragraph", text: unsafeUrl, hasUrl: false });
});

test("server rejects an unsafe bookmark URL without changing revision or stored state", async ({ request }) => {
  const before = await fixtureSnapshot(request);
  const draft = structuredClone(before.state);
  const resource = draft.resources.find((entry) => entry.id === FIXTURE_IDS.resource);
  resource.blocks[0] = {
    ...resource.blocks[0],
    type: "bookmark",
    text: "javascript:alert(1)",
    url: "javascript:alert(1)",
    marks: [],
  };

  const response = await request.put("/api/state", {
    headers: { "If-Match": `"${before.serverRevision}"` },
    data: { state: draft, baseRevision: before.serverRevision },
  });
  expect(response.status()).toBe(422);
  const payload = await response.json();
  expect(payload.code).toBe("INVALID_STATE");
  expect(payload.details?.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "unsafe_block_url" }),
  ]));

  const after = await fixtureSnapshot(request);
  expect(after.serverRevision).toBe(before.serverRevision);
  expect(after.state).toEqual(before.state);
});
