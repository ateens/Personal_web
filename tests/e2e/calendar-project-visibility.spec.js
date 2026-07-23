import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

test("project calendar visibility is shared and persisted", async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.evaluate((projectId) => {
    const project = window.itemById("projects", projectId);
    project.startDate = window.dateKey(new Date());
    project.endDate = window.dateKey(window.addDays(new Date(), 5));
    window.saveState();
  }, FIXTURE_IDS.project);

  await page.locator('[data-nav-key="calendar"]').evaluate((button) => button.click());
  await page.locator(".calendar-control-panel > summary").click();
  const toggle = page.locator(`[data-project-calendar-toggle="${FIXTURE_IDS.project}"]`);
  const event = page.locator(`.calendar-span-event[data-select-type="projects"][data-select-id="${FIXTURE_IDS.project}"]`).first();
  await expect(toggle).toBeChecked();
  await expect(event).toBeVisible();

  await toggle.uncheck();
  await expect(page.locator(".calendar-control-panel")).toHaveJSProperty("open", true);
  await expect(event).toHaveCount(0);
  await expect(page.locator(".calendar-project-toggle-list")).toHaveCSS("padding-left", "0px");
  await expect(page.locator(".calendar-month-day.is-today")).toHaveCSS("border-top-width", "0px");
  await expect(page.locator(".calendar-month-day.is-today")).toHaveCSS("border-right-width", "0px");
  await expect(page.locator(".calendar-month-day.is-today")).toHaveCSS("border-bottom-width", "0px");
  await expect(page.locator(".calendar-month-day.is-today")).toHaveCSS("border-left-width", "0px");
  await expect.poll(async () => (await fixtureSnapshot(request)).state.settings.visibleProjectCalendars[FIXTURE_IDS.project]).toBe(false);
});
