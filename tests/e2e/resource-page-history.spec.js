import { expect, test } from "@playwright/test";
import {
  FIXTURE_IDS,
  fixtureSnapshot,
  resetFixture,
} from "./helpers.js";

const RESOURCE_PATH = `/resources/${encodeURIComponent(FIXTURE_IDS.resource)}`;
const INITIAL_TITLE = "E2E Notion Parity Resource";
const INITIAL_BLOCK_TEXT = "Paragraph fixture fulltext-needle";
const BLOCK_ID = "fixture-block-paragraph";
const PERSISTENCE_TIMEOUT_MS = 20_000;

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto(RESOURCE_PATH);
  await expect(resourceNote(page)).toBeVisible();
});

function resourceNote(page) {
  return page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
}

function resourceTitle(page) {
  return resourceNote(page).locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`);
}

function blockContent(page) {
  return resourceNote(page).locator(`[data-block-content="${BLOCK_ID}"]`);
}

async function currentResource(request) {
  const snapshot = await fixtureSnapshot(request);
  return snapshot.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource);
}

async function expandProperties(page) {
  const note = resourceNote(page);
  const toggle = note.locator(`[data-resource-props="${FIXTURE_IDS.resource}"]`);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const panel = note.locator(`[data-resource-properties="${FIXTURE_IDS.resource}"]`);
  await expect(panel).toBeVisible();
  return panel;
}

async function openPageMenu(page) {
  const note = resourceNote(page);
  const trigger = note.locator(`[data-resource-page-menu="${FIXTURE_IDS.resource}"]`);
  const menu = page.locator(`[data-resource-page-menu-panel="${FIXTURE_IDS.resource}"]`);
  if (!(await menu.isVisible())) await trigger.click();
  await expect(menu).toBeVisible();
  return menu;
}

async function pressUndo(page) {
  await page.keyboard.press("Meta+z");
}

async function pressRedo(page) {
  await page.keyboard.press("Meta+Shift+z");
}

test("block text, title, property, icon, cover, and page settings share one chronological history", async ({ page, request }) => {
  test.setTimeout(120_000);
  const note = resourceNote(page);
  await blockContent(page).fill("History body");

  const title = resourceTitle(page);
  await title.fill("History title");
  const properties = await expandProperties(page);
  await properties.locator('[data-field="type"]').selectOption("scrap");

  await note.locator(`[data-resource-icon-edit="${FIXTURE_IDS.resource}"]`).click();
  await note.locator('[data-resource-icon-choice="📄"]').click();

  await note.locator(`[data-resource-cover-edit="${FIXTURE_IDS.resource}"]`).click();
  await note.locator(`[data-resource-cover-url="${FIXTURE_IDS.resource}"]`).fill("https://example.com/history-cover.jpg");
  await note.locator(`[data-resource-cover-apply="${FIXTURE_IDS.resource}"]`).click();

  const menu = await openPageMenu(page);
  await menu.locator('[data-resource-page-font="serif"]').click();

  await expect.poll(async () => {
    const resource = await currentResource(request);
    return {
      block: resource.blocks.find((entry) => entry.id === BLOCK_ID)?.text,
      title: resource.title,
      type: resource.type,
      icon: resource.icon,
      cover: resource.cover,
      font: resource.pageSettings.font,
    };
  }).toEqual({
    block: "History body",
    title: "History title",
    type: "scrap",
    icon: "📄",
    cover: { url: "https://example.com/history-cover.jpg", position: 50 },
    font: "serif",
  });

  await pressUndo(page);
  await expect(note).toHaveAttribute("data-resource-font", "default");
  await expect.poll(
    async () => (await currentResource(request)).pageSettings.font,
    { timeout: PERSISTENCE_TIMEOUT_MS },
  ).toBe("default");
  await pressUndo(page);
  await expect(note.locator(`[data-resource-cover="${FIXTURE_IDS.resource}"]`)).toHaveCount(0);
  await expect.poll(
    async () => (await currentResource(request)).cover.url,
    { timeout: PERSISTENCE_TIMEOUT_MS },
  ).toBe("");
  await pressUndo(page);
  await expect(note.locator(`[data-resource-icon="${FIXTURE_IDS.resource}"]`)).toHaveCount(0);
  await expect.poll(
    async () => (await currentResource(request)).icon,
    { timeout: PERSISTENCE_TIMEOUT_MS },
  ).toBe("");
  await pressUndo(page);
  await expect(note.locator('[data-field="type"]')).toHaveValue("note");
  await expect.poll(
    async () => (await currentResource(request)).type,
    { timeout: PERSISTENCE_TIMEOUT_MS },
  ).toBe("note");
  await pressUndo(page);
  await expect(resourceTitle(page)).toHaveValue(INITIAL_TITLE);
  await expect.poll(
    async () => (await currentResource(request)).title,
    { timeout: PERSISTENCE_TIMEOUT_MS },
  ).toBe(INITIAL_TITLE);
  await pressUndo(page);
  await expect(blockContent(page)).toHaveText(INITIAL_BLOCK_TEXT);
  await expect.poll(
    async () => (await currentResource(request)).blocks.find((entry) => entry.id === BLOCK_ID)?.text,
    { timeout: PERSISTENCE_TIMEOUT_MS },
  ).toBe(INITIAL_BLOCK_TEXT);

  for (const expected of ["History body", "History title", "scrap", "📄", "https://example.com/history-cover.jpg", "serif"]) {
    await pressRedo(page);
    if (expected === "History body") {
      await expect.poll(
        async () => (await currentResource(request)).blocks.find((entry) => entry.id === BLOCK_ID)?.text,
        { timeout: PERSISTENCE_TIMEOUT_MS },
      ).toBe(expected);
    } else if (expected === "History title") {
      await expect.poll(
        async () => (await currentResource(request)).title,
        { timeout: PERSISTENCE_TIMEOUT_MS },
      ).toBe(expected);
    } else if (expected === "scrap") {
      await expect.poll(
        async () => (await currentResource(request)).type,
        { timeout: PERSISTENCE_TIMEOUT_MS },
      ).toBe(expected);
    } else if (expected === "📄") {
      await expect.poll(
        async () => (await currentResource(request)).icon,
        { timeout: PERSISTENCE_TIMEOUT_MS },
      ).toBe(expected);
    } else if (expected.endsWith(".jpg")) {
      await expect.poll(
        async () => (await currentResource(request)).cover.url,
        { timeout: PERSISTENCE_TIMEOUT_MS },
      ).toBe(expected);
    } else {
      await expect.poll(
        async () => (await currentResource(request)).pageSettings.font,
        { timeout: PERSISTENCE_TIMEOUT_MS },
      ).toBe(expected);
    }
  }

  const finalResource = await currentResource(request);
  expect(finalResource.commentThreads.map((thread) => thread.id)).toEqual([
    FIXTURE_IDS.pageThread,
    FIXTURE_IDS.inlineThread,
  ]);
  await expect(resourceTitle(page)).toHaveValue("History title");
  await expect(blockContent(page)).toHaveText("History body");
});

test("title paste is plaintext-only, collapses newlines, preserves replacement caret, and rejects overflow atomically", async ({ page, request }) => {
  const title = resourceTitle(page);
  const pasteResult = await title.evaluate((element) => {
    element.focus();
    element.setSelectionRange(4, 10);
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "Line1\r\nLine2");
    clipboard.setData("text/html", "<b>ignored</b>");
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: clipboard,
    });
    element.dispatchEvent(event);
    return {
      prevented: event.defaultPrevented,
      value: element.value,
      start: element.selectionStart,
      end: element.selectionEnd,
    };
  });
  expect(pasteResult).toEqual({
    prevented: true,
    value: "E2E Line1 Line2 Parity Resource",
    start: 15,
    end: 15,
  });
  await title.blur();
  await expect.poll(async () => (await currentResource(request)).title).toBe("E2E Line1 Line2 Parity Resource");

  await title.focus();
  await pressUndo(page);
  await expect.poll(async () => (await currentResource(request)).title).toBe(INITIAL_TITLE);
  await expect.poll(async () => title.evaluate((element) => ({
    start: element.selectionStart,
    end: element.selectionEnd,
  }))).toEqual({ start: 4, end: 10 });
  await pressRedo(page);
  await expect.poll(async () => (await currentResource(request)).title).toBe("E2E Line1 Line2 Parity Resource");
  await expect.poll(async () => title.evaluate((element) => ({
    start: element.selectionStart,
    end: element.selectionEnd,
  }))).toEqual({ start: 15, end: 15 });

  const beforeOverflow = await resourceTitle(page).inputValue();
  const overflowResult = await resourceTitle(page).evaluate((element) => {
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "x".repeat(20_001));
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: clipboard,
    });
    element.dispatchEvent(event);
    return {
      prevented: event.defaultPrevented,
      value: element.value,
      invalid: element.getAttribute("aria-invalid"),
    };
  });
  expect(overflowResult).toEqual({ prevented: true, value: beforeOverflow, invalid: "true" });
  await expect.poll(async () => (await currentResource(request)).title).toBe(beforeOverflow);
});

test("native draft inputs keep native undo and do not consume page history", async ({ page, request }) => {
  const note = resourceNote(page);
  await note.locator(`[data-resource-icon-edit="${FIXTURE_IDS.resource}"]`).click();
  await note.locator('[data-resource-icon-choice="📄"]').click();
  await expect.poll(async () => (await currentResource(request)).icon).toBe("📄");

  await note.locator(`[data-resource-cover-edit="${FIXTURE_IDS.resource}"]`).click();
  const coverDraft = note.locator(`[data-resource-cover-url="${FIXTURE_IDS.resource}"]`);
  await coverDraft.type("https://example.com/native-draft.jpg");
  await coverDraft.press("Control+z");
  await expect(coverDraft).toHaveValue("");
  await expect.poll(async () => (await currentResource(request)).icon).toBe("📄");
  await expect.poll(async () => (await currentResource(request)).cover.url).toBe("");

  await note.locator(`[data-resource-cover-cancel="${FIXTURE_IDS.resource}"]`).click();
  const iconButton = note.locator(`[data-resource-icon-edit="${FIXTURE_IDS.resource}"]`);
  await iconButton.focus();
  await iconButton.press("Control+z");
  await expect.poll(async () => (await currentResource(request)).icon).toBe("");
});

test("coalesced block text and IME commits use app history while a new edit invalidates redo", async ({ page, request }) => {
  const content = blockContent(page);
  await content.fill("Coalesced typing");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (
    (await currentResource(request)).blocks.find((entry) => entry.id === BLOCK_ID)?.text
  )).toBe(INITIAL_BLOCK_TEXT);
  await page.keyboard.press("Control+y");
  await expect.poll(async () => (
    (await currentResource(request)).blocks.find((entry) => entry.id === BLOCK_ID)?.text
  )).toBe("Coalesced typing");

  await content.evaluate((element) => {
    element.focus();
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "ㅎ" }));
    element.textContent = "한글 입력";
    element.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "한글 입력" }));
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한글 입력" }));
  });
  await expect.poll(async () => (
    (await currentResource(request)).blocks.find((entry) => entry.id === BLOCK_ID)?.text
  )).toBe("한글 입력");
  await pressUndo(page);
  await expect.poll(async () => (
    (await currentResource(request)).blocks.find((entry) => entry.id === BLOCK_ID)?.text
  )).toBe("Coalesced typing");

  const title = resourceTitle(page);
  await title.fill("Redo invalidated");
  await title.blur();
  await expect.poll(async () => (await currentResource(request)).title).toBe("Redo invalidated");
  await pressRedo(page);
  await expect(resourceTitle(page)).toHaveValue("Redo invalidated");
  await expect(blockContent(page)).toHaveText("Coalesced typing");
  const resource = await currentResource(request);
  expect(resource.title).toBe("Redo invalidated");
  expect(resource.blocks.find((entry) => entry.id === BLOCK_ID)?.text).toBe("Coalesced typing");
});

test("history is session-only and a reload cannot undo a persisted pre-reload edit", async ({ page, request }) => {
  const title = resourceTitle(page);
  await title.fill("Persisted across reload");
  await title.blur();
  await expect.poll(async () => (await currentResource(request)).title).toBe("Persisted across reload");

  await page.reload();
  await expect(resourceNote(page)).toBeVisible();
  await expect(resourceTitle(page)).toHaveValue("Persisted across reload");
  await resourceTitle(page).focus();
  await pressUndo(page);
  await page.waitForTimeout(150);
  await expect(resourceTitle(page)).toHaveValue("Persisted across reload");
  await expect.poll(async () => (await currentResource(request)).title).toBe("Persisted across reload");
});
