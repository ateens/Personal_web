import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const RESOURCE_PATH = `/resources/${encodeURIComponent(FIXTURE_IDS.resource)}`;
const PARAGRAPH_ID = "fixture-block-paragraph";

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto(RESOURCE_PATH);
  await expect(resourceNote(page)).toBeVisible();
});

function resourceNote(page) {
  return page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
}

function blockContent(page, blockId = PARAGRAPH_ID) {
  return resourceNote(page).locator(`[data-block-content="${blockId}"]`);
}

function inlineToolbar(page) {
  return page.locator("[data-inline-toolbar]");
}

async function selectText(page, block, start, end) {
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
  await expect(inlineToolbar(page)).toBeVisible();
}

async function fixtureBlock(request, blockId = PARAGRAPH_ID) {
  const snapshot = await fixtureSnapshot(request);
  return snapshot.state.resources
    .find((resource) => resource.id === FIXTURE_IDS.resource)
    ?.blocks.find((block) => block.id === blockId);
}

test("mouse color and equation actions persist normalized marks across reload", async ({ page, request }) => {
  const content = blockContent(page);
  await content.fill("Color Equation");

  await selectText(page, content, 0, 5);
  await inlineToolbar(page).locator("[data-inline-color-menu-toggle]").click();
  const blueText = page.locator('[data-inline-color-choice="text:blue"]');
  await expect(blueText).toHaveAttribute("role", "menuitemradio");
  await blueText.click();
  const textColor = blockContent(page).locator('[data-inline-mark="textColor"][data-inline-color="blue"]');
  await expect(textColor).toHaveText("Color");

  await expect.poll(async () => (await fixtureBlock(request))?.marks).toContainEqual({
    type: "textColor",
    start: 0,
    end: 5,
    color: "blue",
  });

  await page.reload();
  await expect(blockContent(page).locator('[data-inline-mark="textColor"][data-inline-color="blue"]')).toHaveText("Color");

  await selectText(page, blockContent(page), 6, 14);
  await inlineToolbar(page).locator("[data-inline-equation-open]").click();
  const equationInput = page.locator("[data-inline-equation-input]");
  await expect(equationInput).toBeFocused();
  await expect(equationInput).toHaveValue("Equation");
  await equationInput.fill("x^2 + y^2");
  await equationInput.press("Enter");
  const equation = blockContent(page).locator('[data-inline-mark="equation"]');
  await expect(equation).toHaveAttribute("data-equation-formula", "x^2 + y^2");
  await expect.poll(async () => (await fixtureBlock(request))?.marks.some((mark) => mark.type === "equation" && mark.formula === "x^2 + y^2")).toBe(true);
});

test("keyboard color and equation actions are undoable and redoable", async ({ page, request }) => {
  const content = blockContent(page);
  await content.fill("Keyboard color");
  await selectText(page, content, 0, 8);

  const colorTrigger = inlineToolbar(page).locator("[data-inline-color-menu-toggle]");
  await colorTrigger.focus();
  await colorTrigger.press("Enter");
  const colorMenu = page.locator("[data-inline-color-menu]");
  await expect(colorMenu).toBeVisible();
  const firstChoice = colorMenu.locator('[role="menuitemradio"]').first();
  await expect(firstChoice).toBeFocused();
  await firstChoice.press("End");
  const redBackground = page.locator('[data-inline-color-choice="background:red"]');
  await expect(redBackground).toBeFocused();
  await redBackground.press("Enter");

  const background = blockContent(page).locator('[data-inline-mark="backgroundColor"][data-inline-color="red"]');
  await expect(background).toHaveText("Keyboard");
  await expect.poll(async () => (await fixtureBlock(request))?.marks.some((mark) => mark.type === "backgroundColor" && mark.color === "red")).toBe(true);

  await page.keyboard.press("Meta+z");
  await expect(blockContent(page).locator('[data-inline-mark="backgroundColor"]')).toHaveCount(0);
  await page.keyboard.press("Meta+Shift+z");
  await expect(blockContent(page).locator('[data-inline-mark="backgroundColor"][data-inline-color="red"]')).toHaveText("Keyboard");

  await selectText(page, blockContent(page), 9, 14);
  const equationButton = inlineToolbar(page).locator("[data-inline-equation-open]");
  await equationButton.focus();
  await equationButton.press("Enter");
  const equationInput = page.locator("[data-inline-equation-input]");
  await expect(equationInput).toBeFocused();
  await expect(equationInput).toHaveValue("color");
  await equationInput.fill("z^3");
  await equationInput.press("Enter");
  await expect(blockContent(page).locator('[data-inline-mark="equation"][data-equation-formula="z^3"]')).toBeVisible();
});

test("toolbar flips around the selection and stays inside the 12px viewport inset", async ({ page }) => {
  await page.setViewportSize({ width: 280, height: 700 });
  const content = blockContent(page);
  await content.fill("Viewport placement fixture");
  const scroll = resourceNote(page).locator(".resource-note-scroll");

  await selectText(page, content, 0, 8);
  await scroll.evaluate((scrollElement, blockId) => {
    const element = scrollElement.querySelector(`[data-block-content="${blockId}"]`);
    scrollElement.scrollTop += element.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top;
  }, PARAGRAPH_ID);
  await expect.poll(async () => inlineToolbar(page).getAttribute("data-placement")).toBe("below");

  const bottomContent = blockContent(page, FIXTURE_IDS.inlineBlock);
  await selectText(page, bottomContent, 0, 4);
  await scroll.evaluate((scrollElement, blockId) => {
    const element = scrollElement.querySelector(`[data-block-content="${blockId}"]`);
    scrollElement.scrollTop += element.getBoundingClientRect().bottom - scrollElement.getBoundingClientRect().bottom;
  }, FIXTURE_IDS.inlineBlock);
  await expect.poll(async () => inlineToolbar(page).getAttribute("data-placement")).toBe("above");
  expect(await scroll.evaluate((element) => element.scrollTop)).toBeGreaterThanOrEqual(0);

  await page.setViewportSize({ width: 700, height: 300 });
  await expect.poll(async () => {
    const box = await inlineToolbar(page).boundingBox();
    return Boolean(box && box.x >= 12 && box.y >= 12 && box.x + box.width <= 688 && box.y + box.height <= 288);
  }).toBe(true);
  const box = await inlineToolbar(page).boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(12);
  expect(box.y).toBeGreaterThanOrEqual(12);
  expect(box.x + box.width).toBeLessThanOrEqual(688);
  expect(box.y + box.height).toBeLessThanOrEqual(288);
});

test("toolbar and color menu expose WCAG-compatible control semantics", async ({ page }) => {
  await selectText(page, blockContent(page), 0, 9);
  const toolbar = page.getByRole("toolbar", { name: "텍스트 서식" });
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "굵게" })).toHaveAttribute("aria-pressed", "false");
  await expect(toolbar.getByRole("button", { name: "수식" })).toBeVisible();
  const colorTrigger = toolbar.locator("[data-inline-color-menu-toggle]");
  await expect(colorTrigger).toHaveAttribute("aria-haspopup", "menu");
  await colorTrigger.click();
  await expect(colorTrigger).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("menu", { name: /색상/ });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "파랑 글자 색상" })).toHaveAttribute("aria-checked", "false");
  await expect(menu.getByRole("menuitemradio", { name: "기본 글자 색상" })).toHaveAttribute("aria-checked", "true");

  const results = await new AxeBuilder({ page })
    .include("[data-inline-toolbar]")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("server rejects arbitrary inline color payloads without mutating state", async ({ request }) => {
  const before = await fixtureSnapshot(request);
  const incomingState = structuredClone(before.state);
  const block = incomingState.resources
    .find((resource) => resource.id === FIXTURE_IDS.resource)
    ?.blocks.find((entry) => entry.id === PARAGRAPH_ID);
  block.marks = [{ type: "textColor", start: 0, end: 5, color: "url-javascript" }];

  const response = await request.put("/api/state", {
    headers: {
      "Content-Type": "application/json",
      "If-Match": `"state-${before.serverRevision}"`,
    },
    data: { state: incomingState, baseRevision: before.serverRevision },
  });
  const payload = await response.json();
  expect(response.status()).toBe(422);
  expect(payload.code).toBe("INVALID_STATE");
  expect(payload.details?.issues).toContainEqual(expect.objectContaining({
    path: expect.stringMatching(/\.marks\[0\]\.color$/),
    code: "unsupported_inline_color",
  }));
  const after = await fixtureSnapshot(request);
  expect(after.serverRevision).toBe(before.serverRevision);
  expect(after.state).toEqual(before.state);
});
