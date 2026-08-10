import { expect, test } from "@playwright/test";
import { fixtureSnapshot, resetFixture } from "./helpers.js";

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
});

test("Resource entry points open only the new shell and never mutate persisted Resources", async ({ page, request }) => {
  const before = await fixtureSnapshot(request);

  await page.locator('[data-capture-zone] [data-action="new-resource"]').click();
  const view = page.locator("#viewRoot .view");
  await expect(view.locator(".eyebrow")).toHaveText("Resources");
  await expect(view.locator("h1")).toHaveText("자료");
  await expect(view.locator(".view-copy")).toHaveText("새로 준비 중");
  await expect(page.locator("#toast")).toContainText("자료 기능을 새로 준비 중입니다.");

  await expect(view.locator("[data-resource-view], [data-resource-note], [data-select-type='resources'], [data-view-controls='resources']")).toHaveCount(0);
  await view.locator('[data-action="new-resource"]').click();
  await expect(view.locator("h1")).toHaveText("자료");

  const after = await fixtureSnapshot(request);
  expect(after.serverRevision).toBe(before.serverRevision);
  expect(after.state.resources).toEqual(before.state.resources);
  expect(after.writes).toEqual(before.writes);
  expect(after.writeAttempts).toEqual(before.writeAttempts);
});
