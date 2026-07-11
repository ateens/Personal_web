import { expect } from "@playwright/test";
import { FIXTURE_IDS } from "../fixtures/state.mjs";

export { FIXTURE_IDS };

export async function resetFixture(request) {
  const response = await request.post("/__e2e__/reset", {
    headers: { "x-e2e-reset-token": "sygma-local-e2e-reset" },
  });
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["x-e2e-production-write-guard"]).toBe("active");
}

export async function fixtureSnapshot(request) {
  const response = await request.get("/__e2e__/state");
  expect(response.ok()).toBeTruthy();
  return response.json();
}

export async function openResources(page) {
  const navToggle = page.locator('[data-action="toggle-nav"]');
  if (await navToggle.isVisible()) {
    await navToggle.click();
    await expect(page.locator("[data-sidebar]")).toHaveClass(/is-open/);
  }
  await page.locator('[data-nav-key="resources"]').click();
  await expect(page.locator('[data-resource-view="library"]')).toBeVisible();
  await expect(page.locator(`[data-select-id="${FIXTURE_IDS.resource}"]`).first()).toBeVisible();
}

export async function selectResourceMode(page, mode) {
  await page.locator(`[data-view-control-mode="resources"][data-control-mode="${mode}"]`).click();
  await expect(page.locator(`[data-resource-view="${mode}"]`)).toBeVisible();
}

export async function openMainResourceFromList(page) {
  await openResources(page);
  await selectResourceMode(page, "list");
  await page.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`).click();
  const note = page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
  await expect(note).toBeVisible();
  return note;
}
