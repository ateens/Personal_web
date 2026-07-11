import { expect, test } from "@playwright/test";
import {
  FIXTURE_IDS,
  fixtureSnapshot,
  resetFixture,
} from "./helpers.js";

const RESOURCE_PATH = `/resources/${encodeURIComponent(FIXTURE_IDS.resource)}`;
const CUSTOM_BLOCK_MIME = "application/x-sygma-blocks";

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto(RESOURCE_PATH);
  await expect(resourceNote(page)).toBeVisible();
});

function resourceNote(page) {
  return page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
}

function editor(page) {
  return resourceNote(page).locator(`.block-editor[data-owner-type="resources"][data-owner-id="${FIXTURE_IDS.resource}"]`);
}

function block(page, blockId) {
  return editor(page).locator(`.block[data-block-id="${blockId}"]`);
}

function content(page, blockId) {
  return editor(page).locator(`[data-block-content="${blockId}"]`);
}

async function domBlockIds(page) {
  return editor(page).locator(".block[data-block-id]").evaluateAll((blocks) => blocks.map((entry) => entry.dataset.blockId));
}

async function selectedBlockIds(page) {
  return editor(page).locator(".block.is-selected[data-block-id]").evaluateAll((blocks) => blocks.map((entry) => entry.dataset.blockId));
}

async function serverResource(request) {
  const snapshot = await fixtureSnapshot(request);
  return snapshot.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource);
}

async function serverBlockIds(request) {
  return (await serverResource(request))?.blocks.map((entry) => entry.id) || [];
}

async function selectSingleBlock(page, blockId) {
  const target = content(page, blockId);
  await target.focus();
  await target.press("Escape");
  await expect(block(page, blockId)).toHaveClass(/is-selected/);
}

async function dragBlock(page, sourceId, targetId, options = {}) {
  const handle = block(page, sourceId).locator(`[data-block-drag="${sourceId}"]`);
  const target = block(page, targetId);
  await handle.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const handleBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  const targetContentBox = await target.locator(`[data-block-content="${targetId}"]`).boundingBox();
  expect(handleBox).toBeTruthy();
  expect(targetBox).toBeTruthy();
  expect(targetContentBox).toBeTruthy();
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const targetX = targetContentBox.x + Math.min(48, Math.max(12, targetContentBox.width * 0.1));
  const targetY = options.position === "before" ? targetBox.y + 2 : targetBox.y + targetBox.height - 2;

  if (options.copy) await page.keyboard.down("Alt");
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY + 8, { steps: 3 });
  await page.mouse.move(targetX, targetY, { steps: 8 });
  await expect(page.locator(".block-drag-ghost")).toBeVisible();
  if (options.cancel) {
    await page.keyboard.press("Escape");
    await expect(page.locator(".block-drag-ghost")).toHaveCount(0);
  }
  await page.mouse.up();
  if (options.copy) await page.keyboard.up("Alt");
}

async function dispatchClipboardEvent(target, type, values = {}) {
  return target.evaluate((element, payload) => {
    const transfer = new DataTransfer();
    for (const [mime, value] of Object.entries(payload.values)) transfer.setData(mime, value);
    const event = new ClipboardEvent(payload.type, {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    });
    element.dispatchEvent(event);
    const data = {};
    for (const mime of transfer.types) data[mime] = transfer.getData(mime);
    return {
      defaultPrevented: event.defaultPrevented,
      types: [...transfer.types],
      data,
    };
  }, { type, values });
}

test("single selection, Shift-click range, and Shift+Meta toggle preserve ordered block identity", async ({ page }) => {
  await selectSingleBlock(page, "fixture-block-paragraph");
  expect(await selectedBlockIds(page)).toEqual(["fixture-block-paragraph"]);

  await content(page, "fixture-block-heading-2").click({ modifiers: ["Shift"] });
  expect(await selectedBlockIds(page)).toEqual([
    "fixture-block-paragraph",
    "fixture-block-heading-1",
    "fixture-block-heading-2",
  ]);

  await content(page, "fixture-block-callout").click({ modifiers: ["Shift", "Meta"] });
  expect(await selectedBlockIds(page)).toEqual([
    "fixture-block-paragraph",
    "fixture-block-heading-1",
    "fixture-block-heading-2",
    "fixture-block-callout",
  ]);
  await content(page, "fixture-block-heading-1").click({ modifiers: ["Shift", "Meta"] });
  expect(await selectedBlockIds(page)).toEqual([
    "fixture-block-paragraph",
    "fixture-block-heading-2",
    "fixture-block-callout",
  ]);
});

test("copy exports selected blocks as custom MIME, HTML, and Markdown-compatible plain text", async ({ page }) => {
  await selectSingleBlock(page, "fixture-block-paragraph");
  await content(page, "fixture-block-heading-2").click({ modifiers: ["Shift"] });
  const copied = await dispatchClipboardEvent(content(page, "fixture-block-paragraph"), "copy");

  expect(copied.defaultPrevented).toBe(true);
  expect(copied.types).toEqual(expect.arrayContaining([CUSTOM_BLOCK_MIME, "text/html", "text/plain"]));
  const custom = JSON.parse(copied.data[CUSTOM_BLOCK_MIME]);
  expect(custom.version).toBe(1);
  expect(custom.blocks).toHaveLength(3);
  expect(custom.blocks.map((entry) => entry.type)).toEqual(["paragraph", "heading1", "heading2"]);
  expect(custom.blocks.every((entry) => !Object.prototype.hasOwnProperty.call(entry, "id"))).toBe(true);
  expect(copied.data["text/plain"]).toContain("Paragraph fixture fulltext-needle");
  expect(copied.data["text/plain"]).toContain("# Heading one");
  expect(copied.data["text/html"]).toContain('data-block-type="heading2"');
});

test("pointer drag moves a block and Cmd+Z restores its original order", async ({ page, request }) => {
  const before = await domBlockIds(page);
  await dragBlock(page, "fixture-block-heading-1", "fixture-block-heading-3", { position: "after" });

  const moved = await domBlockIds(page);
  expect(moved.indexOf("fixture-block-heading-1")).toBe(moved.indexOf("fixture-block-heading-3") + 1);
  await expect.poll(async () => (await serverBlockIds(request)).indexOf("fixture-block-heading-1")).toBe(moved.indexOf("fixture-block-heading-1"));

  await page.keyboard.press("Meta+z");
  await expect.poll(() => domBlockIds(page)).toEqual(before);
  await expect.poll(() => serverBlockIds(request)).toEqual(before);
});

test("Escape cancels an active pointer drag without changing order", async ({ page, request }) => {
  const before = await domBlockIds(page);
  await dragBlock(page, "fixture-block-bullet", "fixture-block-numbered", { position: "after", cancel: true });

  expect(await domBlockIds(page)).toEqual(before);
  await expect.poll(() => serverBlockIds(request)).toEqual(before);
  await expect(page.locator(".is-block-drop-before, .is-block-drop-after, .is-block-drag-source")).toHaveCount(0);
  await expect(block(page, "fixture-block-bullet")).toHaveClass(/is-selected/);
});

test("Alt-drag copies with a fresh ID and undo removes only the copy", async ({ page, request }) => {
  const beforeIds = await domBlockIds(page);
  const beforeCount = beforeIds.length;
  await dragBlock(page, "fixture-block-heading-1", "fixture-block-heading-3", { position: "after", copy: true });

  await expect(editor(page).locator(".block[data-block-id]")).toHaveCount(beforeCount + 1);
  await expect.poll(async () => (await serverResource(request))?.blocks.length).toBe(beforeCount + 1);
  const copiedState = await serverResource(request);
  const matching = copiedState.blocks.filter((entry) => entry.text === "Heading one" && entry.type === "heading1");
  expect(matching).toHaveLength(2);
  expect(new Set(matching.map((entry) => entry.id)).size).toBe(2);
  expect(matching.map((entry) => entry.id)).toContain("fixture-block-heading-1");

  await page.keyboard.press("Meta+z");
  await expect.poll(() => domBlockIds(page)).toEqual(beforeIds);
  await expect.poll(() => serverBlockIds(request)).toEqual(beforeIds);
});

test("keyboard-only Cmd+Shift+Arrow move is equivalent to drag and undoable", async ({ page, request }) => {
  const before = await domBlockIds(page);
  await selectSingleBlock(page, "fixture-block-paragraph");
  await page.keyboard.press("Meta+Shift+ArrowDown");

  const moved = await domBlockIds(page);
  expect(moved.slice(0, 2)).toEqual(["fixture-block-heading-1", "fixture-block-paragraph"]);
  await expect.poll(() => serverBlockIds(request)).toEqual(moved);
  await page.keyboard.press("Meta+z");
  await expect.poll(() => domBlockIds(page)).toEqual(before);
});

test("valid custom MIME beats conflicting HTML and plain text and regenerates all pasted IDs", async ({ page, request }) => {
  const targetId = "fixture-block-paragraph";
  await selectSingleBlock(page, targetId);
  const inboundId = "untrusted-fixed-id";
  const result = await dispatchClipboardEvent(content(page, targetId), "paste", {
    [CUSTOM_BLOCK_MIME]: JSON.stringify({
      version: 1,
      blocks: [
        { id: inboundId, type: "heading2", text: "CUSTOM WINS", marks: [], indent: 0 },
        { id: inboundId, type: "todo", text: "CUSTOM SECOND", marks: [], checked: true, indent: 0 },
      ],
    }),
    "text/html": "<h1>HTML MUST LOSE</h1>",
    "text/plain": "# PLAIN MUST LOSE",
  });

  expect(result.defaultPrevented).toBe(true);
  await expect(editor(page)).toContainText("CUSTOM WINS");
  await expect(editor(page)).toContainText("CUSTOM SECOND");
  await expect(editor(page)).not.toContainText("HTML MUST LOSE");
  await expect(editor(page)).not.toContainText("PLAIN MUST LOSE");
  await expect.poll(async () => (
    (await serverResource(request)).blocks.filter((entry) => entry.text.startsWith("CUSTOM")).length
  )).toBe(2);
  const pasted = (await serverResource(request)).blocks.filter((entry) => entry.text.startsWith("CUSTOM"));
  expect(pasted.map((entry) => entry.type)).toEqual(["heading2", "todo"]);
  expect(pasted.every((entry) => entry.id !== inboundId && entry.id !== targetId)).toBe(true);
  expect(new Set(pasted.map((entry) => entry.id)).size).toBe(2);
});

test("malformed custom MIME falls back to sanitized HTML before plain text", async ({ page, request }) => {
  const targetId = "fixture-block-paragraph";
  await selectSingleBlock(page, targetId);
  const result = await dispatchClipboardEvent(content(page, targetId), "paste", {
    [CUSTOM_BLOCK_MIME]: "{malformed-json",
    "text/html": `
      <h2 onclick="window.__transportXss='onclick'">
        HTML WINS <strong>Bold</strong>
        <script>window.__transportXss='script'</script>
        <a href="javascript:window.__transportXss='link'">BadLink</a>
        <img src="x" onerror="window.__transportXss='image'">
      </h2>
    `,
    "text/plain": "# PLAIN MUST LOSE",
  });

  expect(result.defaultPrevented).toBe(true);
  await expect(editor(page)).toContainText("HTML WINS");
  await expect(editor(page)).toContainText("Bold");
  await expect(editor(page)).toContainText("BadLink");
  await expect(editor(page)).not.toContainText("PLAIN MUST LOSE");
  await expect.poll(async () => (
    (await serverResource(request)).blocks.some((entry) => entry.text.includes("HTML WINS"))
  )).toBe(true);
  const htmlBlock = (await serverResource(request)).blocks.find((entry) => entry.text.includes("HTML WINS"));
  expect(htmlBlock?.type).toBe("heading2");
  expect(htmlBlock?.marks.some((mark) => mark.type === "bold")).toBe(true);
  expect(htmlBlock?.marks.some((mark) => mark.type === "link")).toBe(false);
  expect(await page.evaluate(() => window.__transportXss || "")).toBe("");
  await expect(resourceNote(page).locator('script, img, [onclick], [onerror], a[href^="javascript:" i]')).toHaveCount(0);
});

test("plain-text fallback parses Markdown blocks and inline marks with fresh IDs", async ({ page, request }) => {
  const targetId = "fixture-block-paragraph";
  const originalIds = new Set(await domBlockIds(page));
  await selectSingleBlock(page, targetId);
  const result = await dispatchClipboardEvent(content(page, targetId), "paste", {
    "text/plain": [
      "# Pasted heading",
      "- **Bold item**",
      "1. Transport numbered item",
      "[x] Completed item",
      "ordinary plain text",
    ].join("\n"),
  });

  expect(result.defaultPrevented).toBe(true);
  await expect.poll(async () => {
    const resource = await serverResource(request);
    return resource.blocks.filter((entry) => [
      "Pasted heading",
      "Bold item",
      "Transport numbered item",
      "Completed item",
      "ordinary plain text",
    ].includes(entry.text)).length;
  }).toBe(5);
  const resource = await serverResource(request);
  const pasted = resource.blocks.filter((entry) => [
    "Pasted heading",
    "Bold item",
    "Transport numbered item",
    "Completed item",
    "ordinary plain text",
  ].includes(entry.text));
  expect(pasted.map((entry) => entry.type)).toEqual(["heading1", "bullet", "numbered", "todo", "paragraph"]);
  expect(pasted.find((entry) => entry.text === "Bold item")?.marks.some((mark) => mark.type === "bold")).toBe(true);
  expect(pasted.find((entry) => entry.text === "Completed item")?.checked).toBe(true);
  expect(pasted.every((entry) => !originalIds.has(entry.id))).toBe(true);
  expect(new Set(pasted.map((entry) => entry.id)).size).toBe(pasted.length);
  await expect(editor(page)).toContainText("ordinary plain text");
});
