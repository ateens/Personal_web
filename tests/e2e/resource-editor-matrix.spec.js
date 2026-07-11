import { expect, test } from "@playwright/test";
import {
  FIXTURE_IDS,
  fixtureSnapshot,
  resetFixture,
} from "./helpers.js";

const RESOURCE_PATH = `/resources/${encodeURIComponent(FIXTURE_IDS.resource)}`;
const EDITOR_BLOCKS = ".block-editor[data-owner-type='resources'] .block[data-block-id]";

const BLOCK_MARKDOWN_CASES = [
  { blockId: "fixture-block-paragraph", source: "# ", type: "heading1" },
  { blockId: "fixture-block-heading-1", source: "## ", type: "heading2" },
  { blockId: "fixture-block-heading-2", source: "### ", type: "heading3" },
  { blockId: "fixture-block-heading-3", source: "- ", type: "bullet" },
  { blockId: "fixture-block-bullet", source: "* ", type: "bullet" },
  { blockId: "fixture-block-numbered", source: "+ ", type: "bullet" },
  { blockId: "fixture-block-todo", source: "1. ", type: "numbered" },
  { blockId: "fixture-block-toggle", source: "[] ", type: "todo" },
  { blockId: "fixture-block-quote", source: "> ", type: "toggle" },
  { blockId: "fixture-block-callout", source: "---", type: "divider" },
];

const INLINE_MARKDOWN_CASES = [
  { source: "**bold**", text: "bold", mark: "bold" },
  { source: "*italic*", text: "italic", mark: "italic" },
  { source: "`inline code`", text: "inline code", mark: "code" },
  { source: "~strike~", text: "strike", mark: "strike" },
];

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto(RESOURCE_PATH);
  await expect(resourceNote(page)).toBeVisible();
});

function resourceNote(page) {
  return page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
}

function blockElement(page, blockId) {
  return resourceNote(page).locator(`[data-block-id="${blockId}"]`);
}

function blockContent(page, blockId) {
  return resourceNote(page).locator(`[data-block-content="${blockId}"]`);
}

async function selectText(block, start, end = start) {
  await block.evaluate((element, offsets) => {
    const textNodes = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    const pointAt = (offset) => {
      let remaining = offset;
      for (const node of textNodes) {
        if (remaining <= node.data.length) return { node, offset: remaining };
        remaining -= node.data.length;
      }
      const node = textNodes.at(-1) || element;
      return { node, offset: node.nodeType === Node.TEXT_NODE ? node.data.length : 0 };
    };
    const startPoint = pointAt(offsets.start);
    const endPoint = pointAt(offsets.end);
    const range = document.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    element.focus();
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, { start, end });
}

async function currentBlockText(block) {
  return block.evaluate((element) => element.textContent || "");
}

async function resourceBlockState(request, blockId) {
  const snapshot = await fixtureSnapshot(request);
  return snapshot.state.resources
    .find((resource) => resource.id === FIXTURE_IDS.resource)
    ?.blocks.find((block) => block.id === blockId);
}

async function resourceBlockCount(request) {
  const snapshot = await fixtureSnapshot(request);
  return snapshot.state.resources
    .find((resource) => resource.id === FIXTURE_IDS.resource)
    ?.blocks.length;
}

test("block Markdown shortcuts are converted by a data-driven matrix", async ({ page }) => {
  for (const entry of BLOCK_MARKDOWN_CASES) {
    const content = blockContent(page, entry.blockId);
    await content.fill("");
    await content.fill(entry.source);
    await expect(blockElement(page, entry.blockId), entry.source).toHaveAttribute("data-type", entry.type);
    if (entry.type !== "divider") await expect(content, entry.source).toHaveText("");
  }

  const divider = blockElement(page, "fixture-block-callout");
  await expect(divider).toHaveAttribute("data-type", "divider");
});

test("divider Markdown renders and focuses its continuation paragraph", async ({ page, request }) => {
  const blockId = "fixture-block-callout";
  const blocks = resourceNote(page).locator(EDITOR_BLOCKS);
  const beforeCount = await blocks.count();
  await blockContent(page, blockId).fill("---");
  await expect(blockElement(page, blockId)).toHaveAttribute("data-type", "divider");
  await expect.poll(() => resourceBlockCount(request)).toBe(beforeCount + 1);
  await expect(blocks).toHaveCount(beforeCount + 1);
  await expect(resourceNote(page).locator('[data-block-id="fixture-block-callout"] + .block [data-block-content]')).toBeFocused();
});

test("bold, italic, inline code, and strikethrough Markdown syntax becomes inline marks", async ({ page }) => {
  const blockId = "fixture-block-paragraph";
  for (const entry of INLINE_MARKDOWN_CASES) {
    const content = blockContent(page, blockId);
    await content.fill(entry.source);
    await expect(blockContent(page, blockId), entry.source).toHaveText(entry.text);
    await expect(blockContent(page, blockId).locator(`[data-inline-mark="${entry.mark}"]`), entry.source).toHaveText(entry.text);
  }
});

test("Enter splits a block while Shift+Enter inserts a soft line break", async ({ page }) => {
  const blocks = resourceNote(page).locator(EDITOR_BLOCKS);
  const beforeCount = await blocks.count();
  const paragraph = blockContent(page, "fixture-block-paragraph");
  await selectText(paragraph, 9);
  await paragraph.press("Shift+Enter");
  await expect(blocks).toHaveCount(beforeCount);
  await expect.poll(() => currentBlockText(blockContent(page, "fixture-block-paragraph"))).toBe("Paragraph\n fixture fulltext-needle");

  const headingId = "fixture-block-heading-2";
  const heading = blockContent(page, headingId);
  await selectText(heading, 7);
  await heading.press("Enter");
  await expect(blocks).toHaveCount(beforeCount + 1);
  await expect(blockContent(page, headingId)).toHaveText("Heading");
  const splitBlock = blockElement(page, headingId).locator("+ .block");
  await expect(splitBlock).toHaveAttribute("data-type", "paragraph");
  await expect(splitBlock.locator("[data-block-content]")).toHaveText(" two");
  await expect(splitBlock.locator("[data-block-content]")).toBeFocused();
});

test("Backspace and Delete respect block boundaries", async ({ page }) => {
  const blocks = resourceNote(page).locator(EDITOR_BLOCKS);
  const beforeCount = await blocks.count();
  const headingId = "fixture-block-heading-1";

  await selectText(blockContent(page, headingId), 0);
  await blockContent(page, headingId).press("Backspace");
  await expect(blockElement(page, headingId)).toHaveAttribute("data-type", "paragraph");
  await expect(blocks).toHaveCount(beforeCount);

  await selectText(blockContent(page, headingId), 0);
  await blockContent(page, headingId).press("Backspace");
  await expect(blockElement(page, headingId)).toHaveCount(0);
  await expect(blockContent(page, "fixture-block-paragraph")).toHaveText("Paragraph fixture fulltext-needleHeading one");
  await expect(blocks).toHaveCount(beforeCount - 1);

  const heading3 = blockContent(page, "fixture-block-heading-3");
  await selectText(heading3, (await currentBlockText(heading3)).length);
  await heading3.press("Delete");
  await expect(blockElement(page, "fixture-block-bullet")).toHaveCount(0);
  await expect(blockContent(page, "fixture-block-heading-3")).toHaveText("Heading threeBullet item");
  await expect(blocks).toHaveCount(beforeCount - 2);
});

test("Tab and Shift+Tab indent and outdent the current block", async ({ page }) => {
  const blockId = "fixture-block-bullet";
  const content = blockContent(page, blockId);
  await selectText(content, (await currentBlockText(content)).length);
  await content.press("Tab");
  await expect(blockElement(page, blockId)).toHaveAttribute("data-indent", "1");
  await blockContent(page, blockId).press("Shift+Tab");
  await expect(blockElement(page, blockId)).toHaveAttribute("data-indent", "0");
});

test("Cmd shortcuts apply B/I/U/K/E and inline comments to selected ranges", async ({ page }) => {
  const blockId = "fixture-block-paragraph";
  const plainText = "Alpha Beta Gamma Delta Link Comment";
  await blockContent(page, blockId).fill(plainText);
  const markCases = [
    { key: "Meta+b", type: "bold", start: 0, end: 5, text: "Alpha" },
    { key: "Meta+i", type: "italic", start: 6, end: 10, text: "Beta" },
    { key: "Meta+u", type: "underline", start: 11, end: 16, text: "Gamma" },
    { key: "Meta+e", type: "code", start: 17, end: 22, text: "Delta" },
  ];

  for (const entry of markCases) {
    await selectText(blockContent(page, blockId), entry.start, entry.end);
    await blockContent(page, blockId).press(entry.key);
    await expect(blockContent(page, blockId).locator(`[data-inline-mark="${entry.type}"]`), entry.key).toHaveText(entry.text);
  }

  await selectText(blockContent(page, blockId), 23, 27);
  await blockContent(page, blockId).press("Meta+k");
  const linkInput = page.locator("[data-inline-link-input]");
  await expect(linkInput).toBeVisible();
  await linkInput.fill("https://example.com/matrix");
  await linkInput.press("Enter");
  await expect(blockContent(page, blockId).locator('[data-inline-mark="link"]')).toHaveAttribute("href", "https://example.com/matrix");

  await selectText(blockContent(page, blockId), 28, 35);
  await blockContent(page, blockId).press("Meta+Shift+m");
  const commentInput = page.locator("[data-inline-comment-input]");
  await expect(commentInput).toBeVisible();
  await commentInput.fill("Matrix comment");
  await page.locator("[data-inline-comment-apply]").click();
  await expect(blockContent(page, blockId).locator('[data-inline-mark="comment"]')).toHaveText("Comment");
});

test("Cmd+A selects current text first and the block second", async ({ page }) => {
  const blockId = "fixture-block-paragraph";
  const content = blockContent(page, blockId);
  await content.fill("Select me");
  await selectText(content, 9);

  await content.press("Meta+a");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() || "")).toBe("Select me");
  await expect(blockElement(page, blockId)).not.toHaveClass(/is-selected/);

  await blockContent(page, blockId).press("Meta+a");
  await expect(blockElement(page, blockId)).toHaveClass(/is-selected/);
});

test("Cmd+D, undo, and redo keep the rendered editor in sync", async ({ page, request }) => {
  const blockId = "fixture-block-paragraph";
  const content = blockContent(page, blockId);
  await content.focus();
  await content.press("Escape");
  await expect(blockElement(page, blockId)).toHaveClass(/is-selected/);
  const blocks = resourceNote(page).locator(EDITOR_BLOCKS);
  const beforeCount = await blocks.count();

  await page.keyboard.press("Meta+d");
  await expect.poll(() => resourceBlockCount(request)).toBe(beforeCount + 1);
  const duplicateDomCount = await blocks.count();

  await page.keyboard.press("Meta+z");
  await expect.poll(() => resourceBlockCount(request)).toBe(beforeCount);
  const undoDomCount = await blocks.count();
  await page.keyboard.press("Meta+Shift+z");
  await expect.poll(() => resourceBlockCount(request)).toBe(beforeCount + 1);
  const redoDomCount = await blocks.count();

  expect({ duplicateDomCount, undoDomCount, redoDomCount }).toEqual({
    duplicateDomCount: beforeCount + 1,
    undoDomCount: beforeCount,
    redoDomCount: beforeCount + 1,
  });
});

test("slash, mention, emoji, and equation commands open, select, and apply", async ({ page }) => {
  const slashBlockId = "fixture-block-paragraph";
  await blockContent(page, slashBlockId).fill("/heading 2");
  await expect(page.locator('.slash-menu [data-block-type="heading2"]')).toBeVisible();
  await expect(blockContent(page, slashBlockId)).toHaveAttribute("aria-haspopup", "menu");
  await expect(blockContent(page, slashBlockId)).toHaveAttribute("aria-expanded", "true");
  expect(await blockContent(page, slashBlockId).evaluate((element) => {
    const controls = element.getAttribute("aria-controls");
    const active = element.getAttribute("aria-activedescendant");
    return Boolean(controls && active && document.getElementById(controls) && document.getElementById(active));
  })).toBe(true);
  await blockContent(page, slashBlockId).press("Enter");
  await expect(blockElement(page, slashBlockId)).toHaveAttribute("data-type", "heading2");

  const mentionBlockId = "fixture-block-heading-1";
  await blockContent(page, mentionBlockId).fill("@Body");
  await expect(page.locator('.mention-menu[aria-label="@ 멘션"]')).toBeVisible();
  expect(await blockContent(page, mentionBlockId).evaluate((element) => Boolean(
    document.getElementById(element.getAttribute("aria-controls")) &&
    document.getElementById(element.getAttribute("aria-activedescendant")),
  ))).toBe(true);
  await blockContent(page, mentionBlockId).press("Enter");
  await expect(blockContent(page, mentionBlockId).locator('[data-inline-mark="mention"][data-mention-target-type="resources"]')).toContainText("Body Search Fixture");

  const emojiBlockId = "fixture-block-heading-2";
  await blockContent(page, emojiBlockId).fill(":bulb");
  await expect(page.locator('.emoji-menu[aria-label="Emoji"]')).toBeVisible();
  await blockContent(page, emojiBlockId).press("Enter");
  await expect(blockContent(page, emojiBlockId)).toContainText("💡");

  const equationBlockId = "fixture-block-heading-3";
  await blockContent(page, equationBlockId).fill("/equation");
  await expect(page.locator('.slash-menu [data-slash-action="equation:open"]')).toBeVisible();
  await blockContent(page, equationBlockId).press("Enter");
  const equationInput = page.locator("[data-inline-equation-input]");
  await expect(equationInput).toBeVisible();
  await equationInput.fill("E=mc^2");
  await equationInput.press("Enter");
  await expect(blockContent(page, equationBlockId).locator('[data-inline-mark="equation"]')).toHaveAttribute("data-equation-formula", "E=mc^2");
});

test("Escape closes slash without also closing the Resource page", async ({ page }) => {
  const blockId = "fixture-block-paragraph";
  const content = blockContent(page, blockId);
  await content.fill("/");
  await expect(page.locator(".slash-menu")).toBeVisible();

  await content.press("Escape");
  await expect(page.locator(".slash-menu")).toHaveCount(0);
  await expect(resourceNote(page)).toBeVisible();
});

test("Escape selects a block, clears the selection, then closes the Resource page", async ({ page }) => {
  const blockId = "fixture-block-paragraph";
  await blockContent(page, blockId).focus();
  await blockContent(page, blockId).press("Escape");
  await expect(blockElement(page, blockId)).toHaveClass(/is-selected/);
  await page.keyboard.press("Escape");
  await expect(blockElement(page, blockId)).not.toHaveClass(/is-selected/);
  await expect(resourceNote(page)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(resourceNote(page)).toHaveCount(0);
});

test("page title and first block support bidirectional Arrow navigation", async ({ page }) => {
  const title = resourceNote(page).locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`);
  const firstBlock = blockContent(page, "fixture-block-paragraph");
  await title.focus();
  await title.press("ArrowDown");
  await expect(firstBlock).toBeFocused();
  await selectText(firstBlock, 0);
  await firstBlock.press("ArrowUp");
  await expect(title).toBeFocused();
});

test("Korean IME composition ignores slash, Enter, Backspace, and single-line synthetic paste", async ({ page, request }) => {
  const blockId = "fixture-block-paragraph";
  const content = blockContent(page, blockId);
  const originalCount = await resourceNote(page).locator(EDITOR_BLOCKS).count();
  await selectText(content, 0, (await currentBlockText(content)).length);

  const intermediate = await content.evaluate((element) => {
    window.__matrixImeNode = element;
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "ㅎ" }));
    element.textContent = "한";
    element.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "한" }));
    const keys = ["/", "Enter", "Backspace"].map((key) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
        code: key === "/" ? "Slash" : key,
        isComposing: true,
        keyCode: 229,
      });
      element.dispatchEvent(event);
      return { key, defaultPrevented: event.defaultPrevented };
    });
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "안전");
    const paste = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    });
    element.dispatchEvent(paste);
    return { keys, pastePrevented: paste.defaultPrevented, text: element.textContent };
  });

  expect(intermediate).toEqual({
    keys: [
      { key: "/", defaultPrevented: false },
      { key: "Enter", defaultPrevented: false },
      { key: "Backspace", defaultPrevented: false },
    ],
    pastePrevented: false,
    text: "한",
  });
  await expect(page.locator(".slash-menu, .mention-menu, .emoji-menu")).toHaveCount(0);
  await expect(resourceNote(page).locator(EDITOR_BLOCKS)).toHaveCount(originalCount);
  expect(await page.evaluate(() => window.__matrixImeNode === document.querySelector('[data-block-content="fixture-block-paragraph"]'))).toBe(true);

  await content.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한" }));
  });
  await expect.poll(() => currentBlockText(blockContent(page, blockId))).toBe("한");
  await expect.poll(async () => (await resourceBlockState(request, blockId))?.text).toBe("한");
});

test("Korean IME composition is not replaced by multiline Markdown paste", async ({ page }) => {
  const blockId = "fixture-block-paragraph";
  const content = blockContent(page, blockId);
  const originalCount = await resourceNote(page).locator(EDITOR_BLOCKS).count();
  await selectText(content, 0, (await currentBlockText(content)).length);

  await content.evaluate((element) => {
    window.__matrixImePasteNode = element;
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "ㅎ" }));
    element.textContent = "한";
    element.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "한" }));
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "# 첫째\n- 둘째");
    const paste = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    });
    element.dispatchEvent(paste);
  });

  await expect(resourceNote(page).locator(EDITOR_BLOCKS)).toHaveCount(originalCount);
  expect(await page.evaluate(() => window.__matrixImePasteNode === document.querySelector('[data-block-content="fixture-block-paragraph"]'))).toBe(true);
  await expect(blockContent(page, blockId)).toHaveText("한");
});
