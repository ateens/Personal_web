import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  FIXTURE_IDS,
  openResources,
  resetFixture,
  selectResourceMode,
} from "./helpers.js";

const RESOURCE_PATH = `/resources/${encodeURIComponent(FIXTURE_IDS.resource)}`;
const EVIDENCE_DIR = path.resolve("output/playwright/resource-visual-state-matrix-2026-07-12");

test.use({ reducedMotion: "reduce" });

test.beforeAll(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

function resourceShell(page, mode = "center") {
  return page.locator(
    `[data-resource-note="${FIXTURE_IDS.resource}"][data-resource-shell="${mode}"]`,
  );
}

function resourceBlock(page, blockId) {
  return page.locator(
    `[data-resource-note="${FIXTURE_IDS.resource}"] .block[data-block-id="${blockId}"]`,
  );
}

function resourceBlockContent(page, blockId) {
  return page.locator(
    `[data-resource-note="${FIXTURE_IDS.resource}"] [data-block-content="${blockId}"]`,
  );
}

async function settle(page) {
  const saveStatus = page.locator("[data-resource-save-status]").first();
  if (await saveStatus.count()) {
    await expect(saveStatus).not.toHaveAttribute("data-sync-state", /^(loading|saving)$/);
  }
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    for (const animation of document.getAnimations()) {
      try {
        animation.finish();
      } catch {}
    }
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  });
}

async function capture(page, fileName, locator = null) {
  await settle(page);
  const screenshotPath = path.join(EVIDENCE_DIR, fileName);
  const options = {
    path: screenshotPath,
    animations: "disabled",
    caret: "hide",
  };
  if (locator) await locator.screenshot(options);
  else await page.screenshot({ ...options, fullPage: false });
  return screenshotPath;
}

async function openCenter(page) {
  await page.goto("/");
  await openResources(page);
  await page.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`).first().click();
  const shell = resourceShell(page, "center");
  await expect(shell).toBeVisible();
  await settle(page);
  return shell;
}

async function openSide(page) {
  await page.goto("/");
  await openResources(page);
  await selectResourceMode(page, "list");
  await page.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`).first().click();
  const shell = resourceShell(page, "side");
  await expect(shell).toBeVisible();
  await settle(page);
  return shell;
}

async function selectText(content, start, end) {
  await content.evaluate((element, offsets) => {
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
      return {
        node,
        offset: node.nodeType === Node.TEXT_NODE ? node.data.length : 0,
      };
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

async function seedLongResource(request) {
  const response = await request.get("/api/state");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  const state = structuredClone(payload.state);
  const resource = state.resources.find((entry) => entry.id === FIXTURE_IDS.resource);
  expect(resource).toBeTruthy();
  resource.commentThreads = (resource.commentThreads || []).filter((thread) => thread.scope === "page");
  resource.blocks = Array.from({ length: 84 }, (_, index) => ({
    id: `visual-long-block-${String(index).padStart(3, "0")}`,
    type: index % 12 === 0 ? "heading2" : index % 7 === 0 ? "bullet" : "paragraph",
    text: `Long page visual fixture ${String(index + 1).padStart(2, "0")}`,
    marks: [],
    checked: false,
    indent: 0,
    collapsed: false,
  }));
  const write = await request.put("/api/state", {
    headers: {
      "If-Match": response.headers().etag || `"state-${payload.revision}"`,
    },
    data: { state, baseRevision: payload.revision },
  });
  expect(write.ok()).toBeTruthy();
}

async function beginBlockDrag(page, sourceId, targetId) {
  const source = resourceBlock(page, sourceId);
  const handle = source.locator(`[data-block-drag="${sourceId}"]`);
  const target = resourceBlock(page, targetId);
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
  const targetX = targetContentBox.x + Math.min(44, Math.max(12, targetContentBox.width * 0.1));
  const targetY = targetBox.y + 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY + 8, { steps: 3 });
  await page.mouse.move(targetX, targetY, { steps: 8 });
}

test("settled library, Center, Side, toolbar, properties, and no-media hover evidence", async ({ page }) => {
  await page.goto("/");
  await openResources(page);
  const library = page.locator('[data-resource-view="library"]');
  await expect(library).toBeVisible();
  await capture(page, "01-library-database-1440x1000.png");

  await page.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`).first().click();
  let shell = resourceShell(page, "center");
  await expect(shell).toBeVisible();
  await capture(page, "02-center-settled-1440x1000.png");
  await capture(
    page,
    "03-center-toolbar-1440x1000.png",
    shell.locator(":scope > .resource-page-toolbar"),
  );

  const propertiesToggle = shell.locator(`[data-resource-props="${FIXTURE_IDS.resource}"]`);
  await expect(propertiesToggle).toHaveAttribute("aria-expanded", "false");
  await capture(page, "04-properties-closed-1440x1000.png");
  await propertiesToggle.click();
  await expect(propertiesToggle).toHaveAttribute("aria-expanded", "true");
  await expect(shell.locator(`[data-resource-properties="${FIXTURE_IDS.resource}"]`)).toBeVisible();
  await capture(page, "05-properties-open-1440x1000.png");
  await propertiesToggle.click();
  await expect(propertiesToggle).toHaveAttribute("aria-expanded", "false");

  const media = shell.locator(`[data-resource-media="${FIXTURE_IDS.resource}"]`);
  await expect(media).not.toHaveClass(/has-(cover|icon)/);
  await media.hover();
  await expect(media.locator(`[data-resource-cover-edit="${FIXTURE_IDS.resource}"]`)).toBeVisible();
  await expect(media.locator(`[data-resource-icon-edit="${FIXTURE_IDS.resource}"]`)).toBeVisible();
  await capture(page, "06-no-icon-no-cover-hover-1440x1000.png");

  shell = await openSide(page);
  await capture(page, "07-side-settled-1440x1000.png");
  await expect(shell).toBeVisible();
});

test("settled block hover, slash, selection, block-menu, and drag-guide evidence", async ({ page }) => {
  await openCenter(page);

  const normalBlock = resourceBlock(page, "fixture-block-heading-1");
  const normalHandle = normalBlock.locator('[data-block-drag="fixture-block-heading-1"]');
  await normalHandle.scrollIntoViewIfNeeded();
  await normalHandle.hover();
  await expect(normalBlock).toHaveClass(/is-icon-hover/);
  await expect(normalHandle).toBeVisible();
  await expect(normalBlock.locator('[data-block-add="fixture-block-heading-1"]')).toBeVisible();
  await capture(page, "08-normal-block-hover-1440x1000.png");

  const emptyContent = resourceBlockContent(page, "fixture-block-paragraph");
  await emptyContent.fill("");
  const emptyBlock = resourceBlock(page, "fixture-block-paragraph");
  const emptyHandle = emptyBlock.locator('[data-block-drag="fixture-block-paragraph"]');
  await emptyHandle.hover();
  await expect(emptyBlock).toHaveClass(/is-icon-hover/);
  await expect(emptyContent).toHaveText("");
  await capture(page, "09-empty-block-hover-1440x1000.png");

  const slashContent = resourceBlockContent(page, "fixture-block-heading-2");
  await slashContent.scrollIntoViewIfNeeded();
  await slashContent.fill("/");
  const slashMenu = page.locator(".slash-menu");
  await expect(slashMenu).toBeVisible();
  await capture(page, "10-slash-default-1440x1000.png");

  await slashContent.fill("/heading");
  await expect(slashMenu.locator('[data-block-type="heading1"]')).toBeVisible();
  await capture(page, "11-slash-search-heading-1440x1000.png");

  await slashContent.fill("/");
  await expect(slashMenu).toBeVisible();
  for (let index = 0; index < 13; index += 1) await slashContent.press("ArrowDown");
  await expect.poll(() => slashMenu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await capture(page, "12-slash-scrolled-keyboard-1440x1000.png");
  await slashContent.press("Escape");
  await expect(slashMenu).toHaveCount(0);

  const selectionContent = resourceBlockContent(page, "fixture-block-heading-3");
  await selectionContent.scrollIntoViewIfNeeded();
  await selectionContent.fill("Selection toolbar visual evidence");
  await selectText(selectionContent, 0, 9);
  await expect(page.locator(".inline-format-toolbar")).toBeVisible();
  await capture(page, "13-selection-toolbar-1440x1000.png");
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-format-toolbar")).toHaveCount(0);

  const menuContent = resourceBlockContent(page, "fixture-block-callout");
  await menuContent.scrollIntoViewIfNeeded();
  await menuContent.click();
  await menuContent.press("Escape");
  await expect(resourceBlock(page, "fixture-block-callout")).toHaveClass(/is-selected/);
  await page.keyboard.press("Meta+/");
  const blockMenu = page.locator(".slash-menu.is-selection-menu");
  await expect(blockMenu).toBeVisible();
  await capture(page, "14-selected-block-menu-1440x1000.png");
  await page.keyboard.press("Escape");
  await expect(blockMenu).toHaveCount(0);
  await page.keyboard.press("Escape");

  await beginBlockDrag(page, "fixture-block-heading-1", "fixture-block-numbered");
  await expect(page.locator(".block-drag-ghost")).toBeVisible();
  await expect(page.locator(".is-block-drop-before, .is-block-drop-after")).toHaveCount(1);
  await capture(page, "15-drag-insertion-guide-1440x1000.png");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".block-drag-ghost")).toHaveCount(0);
});

test("settled long-page middle, bottom, and comments-pane evidence", async ({ page, request }) => {
  await seedLongResource(request);
  const shell = await openCenter(page);
  await expect(shell.locator(".block[data-block-id]")).toHaveCount(84);
  const scroll = shell.locator(".resource-note-scroll");
  const middlePosition = await scroll.evaluate((element) => {
    const maximum = element.scrollHeight - element.clientHeight;
    element.scrollTop = Math.round(maximum * 0.5);
    return { maximum, current: element.scrollTop };
  });
  expect(middlePosition.maximum).toBeGreaterThan(0);
  expect(middlePosition.current).toBeGreaterThan(0);
  await capture(page, "16-long-page-middle-1440x1000.png");

  const bottomPosition = await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return {
      maximum: element.scrollHeight - element.clientHeight,
      current: element.scrollTop,
    };
  });
  expect(bottomPosition.current).toBe(bottomPosition.maximum);
  await capture(page, "17-long-page-bottom-1440x1000.png");

  await shell.locator(`[data-resource-comments-toggle="${FIXTURE_IDS.resource}"]`).first().click();
  const comments = page.locator(`[data-resource-comments-pane="${FIXTURE_IDS.resource}"]`);
  await expect(comments).toBeVisible();
  await capture(page, "18-comments-pane-1440x1000.png");
});

test.describe("touch-emulated mobile evidence", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("settled mobile Resource toolbar is visible after touch focus", async ({ page }) => {
    await page.goto(RESOURCE_PATH);
    const shell = resourceShell(page, "center");
    await expect(shell).toBeVisible();
    const toolbar = shell.locator(`[data-resource-mobile-toolbar="${FIXTURE_IDS.resource}"]`);
    await expect(toolbar).toBeVisible();
    await expect(toolbar.locator("button")).toHaveCount(5);
    const content = resourceBlockContent(page, "fixture-block-paragraph");
    await content.scrollIntoViewIfNeeded();
    await content.tap();
    await expect(content).toBeFocused();
    await expect(toolbar).toBeVisible();
    await capture(page, "19-mobile-toolbar-touch-emulated-390x844.png");
  });
});
