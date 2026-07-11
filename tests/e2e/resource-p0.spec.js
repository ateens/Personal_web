import { expect, test } from "@playwright/test";
import {
  FIXTURE_IDS,
  fixtureSnapshot,
  openMainResourceFromList,
  openResources,
  resetFixture,
  selectResourceMode,
} from "./helpers.js";

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
});

test("opening and scrolling a Resource do not mutate its timestamp or revision", async ({ page, request }) => {
  const before = await fixtureSnapshot(request);
  const note = await openMainResourceFromList(page);
  await note.locator(".resource-note-scroll").evaluate((element) => {
    element.scrollTop = Math.min(100, element.scrollHeight);
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForTimeout(500);

  const after = await fixtureSnapshot(request);
  const beforeResource = before.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource);
  const afterResource = after.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource);
  expect(afterResource.updatedAt).toBe(beforeResource.updatedAt);
  expect(afterResource.revision).toBe(beforeResource.revision);
});

test("P0 search retains its DOM node, focus, caret, and IME composition", async ({ page }) => {
  await openResources(page);
  const search = page.locator('[data-view-control-search="resources"]');
  await search.focus();
  await search.evaluate((element) => {
    element.dataset.e2eNodeIdentity = "search-node";
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "ㅎ" }));
    element.value = "한";
    element.setSelectionRange(1, 1);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "한",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
  });

  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute("data-e2e-node-identity", "search-node");
  await expect.poll(() => search.evaluate((element) => [element.selectionStart, element.selectionEnd])).toEqual([1, 1]);
  await search.evaluate((element) => element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한" })));
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("한");
});

test("P0 Database search and Full-text search expose and honor separate scopes", async ({ page }) => {
  await openResources(page);
  const search = page.locator('[data-view-control-search="resources"]');
  const databaseScope = page.locator('[data-resource-search-scope="database"]');
  const fullTextScope = page.locator('[data-resource-search-scope="fullText"]');

  await expect(databaseScope).toBeVisible();
  await expect(fullTextScope).toBeVisible();
  await databaseScope.click();
  await search.fill("body-only-secret-token");
  await expect(page.locator(`[data-select-id="${FIXTURE_IDS.bodySearchResource}"]`)).toHaveCount(0);

  await fullTextScope.click();
  await search.fill("body-only-secret-token");
  await expect(page.locator(`[data-select-id="${FIXTURE_IDS.bodySearchResource}"]`).first()).toBeVisible();
});

test("P0 Library Resource can be opened with Enter and Space", async ({ page }) => {
  await openResources(page);
  const openControl = page.locator([
    `[data-open-resource="${FIXTURE_IDS.resource}"]`,
    `button[data-select-id="${FIXTURE_IDS.resource}"]`,
    `a[data-select-id="${FIXTURE_IDS.resource}"]`,
  ].join(", ")).first();
  await openControl.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`)).toBeVisible();
  await page.locator(`[data-resource-close="${FIXTURE_IDS.resource}"]`).click();
  await openControl.focus();
  await page.keyboard.press("Space");
  await expect(page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`)).toBeVisible();
});

test("P0 title editing patches the list without replacing the view or editor", async ({ page }) => {
  const note = await openMainResourceFromList(page);
  await page.evaluate(() => {
    window.__e2eViewRoot = document.querySelector("#viewRoot");
    window.__e2eResourceNote = document.querySelector('[data-resource-note="fixture-resource-main"]');
  });
  const title = note.locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`);
  await title.fill("Patched Resource Title");

  expect(await page.evaluate(() => window.__e2eViewRoot === document.querySelector("#viewRoot"))).toBe(true);
  expect(await page.evaluate(() => window.__e2eResourceNote === document.querySelector('[data-resource-note="fixture-resource-main"]'))).toBe(true);
  await expect(page.locator(`[data-open-resource="${FIXTURE_IDS.resource}"] strong`)).toHaveText("Patched Resource Title");
  await expect(title).toBeFocused();
});

test("P0 Resource edits increment resource timestamp and revision", async ({ page, request }) => {
  const before = await fixtureSnapshot(request);
  const note = await openMainResourceFromList(page);
  await note.locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`).fill("Timestamp Revision Update");

  const beforeResource = before.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource);
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return snapshot.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource)?.revision;
  }).toBeGreaterThan(beforeResource.revision);
  const after = await fixtureSnapshot(request);
  const afterResource = after.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource);
  expect(Date.parse(afterResource.updatedAt)).toBeGreaterThan(Date.parse(beforeResource.updatedAt));
});

test("P0 parity mode omits advanced floating, dock, and split chrome", async ({ page }) => {
  const note = await openMainResourceFromList(page);
  await expect(note.locator("[data-resource-mode]")).toHaveCount(0);
  await expect(note.locator('[data-resource-layout="triple"]')).toHaveCount(0);
  await expect(note.locator(".resource-note-grip, [data-resource-resize]")).toHaveCount(0);
});
