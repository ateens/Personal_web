import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, openResources, resetFixture } from "./helpers.js";

const fixtureGuardHeaders = { "x-e2e-reset-token": "sygma-local-e2e-reset" };

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
});

test("stale Resource save stops on conflict and an explicit remote reload resolves it", async ({ page, request }) => {
  test.setTimeout(45_000);
  await openResources(page);
  await page.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`).first().click();
  const note = page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
  await expect(note).toBeVisible();

  const externalTitle = "Remote collaborator title";
  const externalWrite = await request.post("/__e2e__/external-write", {
    headers: fixtureGuardHeaders,
    data: { title: externalTitle },
  });
  expect(externalWrite.ok()).toBeTruthy();
  expect((await externalWrite.json()).revision).toBe(2);

  await note.locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`).fill("Stale local title");
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return snapshot.writeAttempts.map((attempt) => attempt.outcome);
  }).toEqual(["conflict"]);

  const afterConflict = await fixtureSnapshot(request);
  expect(afterConflict.serverRevision).toBe(2);
  expect(afterConflict.writes).toHaveLength(0);
  expect(afterConflict.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource)?.title).toBe(externalTitle);
  expect(afterConflict.writeAttempts[0]).toMatchObject({
    baseRevision: 1,
    ifMatch: '"state-1"',
    serverRevision: 2,
    outcome: "conflict",
  });

  await page.waitForTimeout(REMOTE_RETRY_GUARD_MS);
  expect((await fixtureSnapshot(request)).writeAttempts).toHaveLength(1);

  await page.locator(`[data-resource-close="${FIXTURE_IDS.resource}"]`).click();
  await navigateTo(page, "database");
  const status = page.locator("[data-database-sync-status]");
  await expect(status).toContainText("원격 상태가 먼저 변경되어 로컬 저장을 중단했습니다");
  await expect(status).toContainText("자동 재시도하지 않습니다");

  await page.locator('[data-action="reload-remote-state"]').click();
  await expect(page.locator('[data-action="reload-remote-state"]')).toHaveCount(0);
  await expect(status).toContainText("app_state JSONB 레코드에 저장됩니다");

  await navigateTo(page, "resources");
  await expect(page.locator(`[data-open-resource="${FIXTURE_IDS.resource}"] [data-resource-title-display]`).first()).toHaveText(externalTitle);
  await page.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`).first().click();
  const reloadedTitle = page.locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`);
  await expect(reloadedTitle).toHaveValue(externalTitle);

  await reloadedTitle.fill("Saved after remote reload");
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return snapshot.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource)?.title;
  }).toBe("Saved after remote reload");
  const resolved = await fixtureSnapshot(request);
  expect(resolved.serverRevision).toBe(3);
  expect(resolved.writeAttempts).toHaveLength(2);
  expect(resolved.writeAttempts[1]).toMatchObject({ baseRevision: 2, ifMatch: '"state-2"', outcome: "saved" });
});

const REMOTE_RETRY_GUARD_MS = 3400;

async function navigateTo(page, key) {
  const navButton = page.locator(`[data-nav-key="${key}"]`);
  const sidebar = page.locator("[data-sidebar]");
  if (!(await sidebar.evaluate((element) => element.classList.contains("is-open")))) {
    await page.locator('[data-action="toggle-nav"]').click();
  }
  await expect(sidebar).toHaveClass(/is-open/);
  await expect(navButton).toBeVisible();
  await navButton.click();
  await expect(page.locator(`[data-view-controls="${key}"]`)).toBeVisible();
}
