import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const RESOURCE_ID = FIXTURE_IDS.resource;
const RESOURCE_PATH = `/resources/${encodeURIComponent(RESOURCE_ID)}`;
const TOGGLE_ID = "fixture-block-toggle";
const TOGGLE_CHILD_ID = "fixture-block-toggle-child";
const TOGGLE_SIBLING_ID = "fixture-block-toggle-sibling";
const DIVIDER_ID = "fixture-block-divider";
const BOOKMARK_ID = "fixture-block-deep-link-bookmark";

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

function shell(page) {
  return page.locator(`[data-resource-note="${RESOURCE_ID}"]`);
}

function block(page, blockId) {
  return shell(page).locator(`[data-block-id="${blockId}"]`);
}

async function updateFixtureResource(request, mutate) {
  const before = await fixtureSnapshot(request);
  const resource = structuredClone(before.state.resources.find((entry) => entry.id === RESOURCE_ID));
  mutate(resource);
  resource.revision += 1;
  resource.updatedAt = new Date(Math.max(Date.now(), Date.parse(resource.updatedAt || "") + 1000)).toISOString();
  const response = await request.put(`/api/resources/${encodeURIComponent(RESOURCE_ID)}`, {
    headers: {
      "Content-Type": "application/json",
      "If-Match": `"state-${before.serverRevision}"`,
    },
    data: { resource, baseRevision: before.serverRevision },
  });
  expect(response.ok()).toBeTruthy();
  return fixtureSnapshot(request);
}

test("collapsed descendant deep link reveals ancestors in the DOM without persisting expansion", async ({ page, request }) => {
  const afterSetup = await updateFixtureResource(request, (resource) => {
    const toggleIndex = resource.blocks.findIndex((entry) => entry.id === TOGGLE_ID);
    resource.blocks[toggleIndex].collapsed = true;
    resource.blocks.splice(toggleIndex + 2, 0, {
      id: TOGGLE_SIBLING_ID,
      type: "paragraph",
      text: "Toggle sibling",
      marks: [],
      checked: false,
      indent: 1,
      collapsed: false,
    });
  });

  await page.goto(`${RESOURCE_PATH}#block-${encodeURIComponent(TOGGLE_CHILD_ID)}`);
  await expect(shell(page)).toBeVisible();
  await expect(block(page, TOGGLE_CHILD_ID)).toBeVisible();
  await expect(block(page, TOGGLE_CHILD_ID).locator(`[data-block-content="${TOGGLE_CHILD_ID}"]`)).toBeFocused();
  await expect(block(page, TOGGLE_CHILD_ID)).toHaveClass(/is-route-target/);
  await expect(block(page, TOGGLE_ID)).toHaveAttribute("data-route-temporarily-expanded", "true");
  await expect(block(page, TOGGLE_ID).locator(`[data-block-toggle="${TOGGLE_ID}"]`)).toHaveAttribute("aria-expanded", "true");
  await expect(block(page, TOGGLE_SIBLING_ID)).toBeVisible();
  await expect(page.locator("#appAnnouncements")).toHaveText("링크된 블록으로 이동했습니다.");

  const afterRoute = await fixtureSnapshot(request);
  expect(afterRoute.serverRevision).toBe(afterSetup.serverRevision);
  expect(afterRoute.writes).toEqual(afterSetup.writes);
  expect(afterRoute.writeAttempts).toEqual(afterSetup.writeAttempts);
  expect(afterRoute.state.resources.find((entry) => entry.id === RESOURCE_ID)
    .blocks.find((entry) => entry.id === TOGGLE_ID).collapsed).toBe(true);

  await block(page, TOGGLE_ID).locator(`[data-block-toggle="${TOGGLE_ID}"]`).click();
  await expect(block(page, TOGGLE_ID)).not.toHaveAttribute("data-route-temporarily-expanded", "true");
  await expect(block(page, TOGGLE_ID).locator(`[data-block-toggle="${TOGGLE_ID}"]`)).toHaveAttribute("aria-expanded", "false");
  await expect(block(page, TOGGLE_CHILD_ID)).toBeHidden();
  await expect(block(page, TOGGLE_SIBLING_ID)).toBeHidden();

  const afterTemporaryCollapse = await fixtureSnapshot(request);
  expect(afterTemporaryCollapse.serverRevision).toBe(afterSetup.serverRevision);
  expect(afterTemporaryCollapse.writes).toEqual(afterSetup.writes);
  expect(afterTemporaryCollapse.writeAttempts).toEqual(afterSetup.writeAttempts);
  expect(afterTemporaryCollapse.state.resources.find((entry) => entry.id === RESOURCE_ID)
    .blocks.find((entry) => entry.id === TOGGLE_ID).collapsed).toBe(true);
});

test("an ordinary Resource route with no hash focuses the close control", async ({ page }) => {
  await page.goto(RESOURCE_PATH);
  await expect(shell(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  await expect(shell(page).locator(`[data-resource-close="${RESOURCE_ID}"]`)).toBeFocused();
  await expect(page.locator("#appAnnouncements")).not.toHaveText("링크된 블록을 찾지 못해 Resource 페이지로 이동했습니다.");
});

test("divider and URL-preview deep links focus a real visible target", async ({ page, request }) => {
  await updateFixtureResource(request, (resource) => {
    resource.blocks.push({
      id: BOOKMARK_ID,
      type: "bookmark",
      text: "https://example.com/deep-link",
      url: "https://example.com/deep-link",
      marks: [],
      checked: false,
      indent: 0,
      collapsed: false,
    });
  });

  await page.goto(`${RESOURCE_PATH}#block-${encodeURIComponent(DIVIDER_ID)}`);
  await expect(block(page, DIVIDER_ID)).toBeFocused();
  await expect(block(page, DIVIDER_ID)).toHaveClass(/is-route-target/);
  await expect(page.locator("#appAnnouncements")).toHaveText("링크된 블록으로 이동했습니다.");

  await page.goto(`${RESOURCE_PATH}#block-${encodeURIComponent(BOOKMARK_ID)}`);
  const preview = block(page, BOOKMARK_ID).locator('[data-url-block-preview="bookmark"]');
  await expect(preview).toBeVisible();
  await expect(preview).toBeFocused();
  await expect(block(page, BOOKMARK_ID)).toHaveClass(/is-route-target/);
  await expect(page.locator("#appAnnouncements")).toHaveText("링크된 블록으로 이동했습니다.");
});

test("missing or malformed block hashes focus the page shell without a false success", async ({ page }) => {
  for (const hash of ["#block-does-not-exist", "#not-a-block-anchor"]) {
    await page.goto(`${RESOURCE_PATH}${hash}`);
    await expect(shell(page)).toBeVisible();
    await expect(shell(page)).toBeFocused();
    await expect(page.locator("#appAnnouncements")).toHaveText("링크된 블록을 찾지 못해 Resource 페이지로 이동했습니다.");
    await expect(page.locator("#appAnnouncements")).not.toHaveText("링크된 블록으로 이동했습니다.");
  }
});
