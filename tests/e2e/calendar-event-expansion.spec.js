import { expect, test } from "@playwright/test";
import { resetFixture } from "./helpers.js";

test("calendar events expand in place without a hover title", async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  const title = "Calendar expansion check with a deliberately long full title that needs several lines inside the original event bar";
  const taskId = await page.evaluate(() => {
    const task = window.createTask("Calendar expansion check with a deliberately long full title that needs several lines inside the original event bar", {
      deferCreate: true,
      initial: { dueDate: window.dateKey(new Date()) },
    });
    window.saveState();
    return task.id;
  });
  await page.locator('[data-nav-key="calendar"]').evaluate((button) => button.click());

  const event = page.locator(`.calendar-span-event[data-select-type="tasks"][data-select-id="${taskId}"]`).first();
  const toggle = event.locator("[data-calendar-event-toggle]");
  await expect(event).toBeVisible();
  const collapsed = await event.boundingBox();

  await toggle.click();
  await expect(event).toHaveClass(/is-expanded/);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(event.locator(".calendar-span-detail")).toBeVisible();
  await expect(event.locator("strong")).toHaveText(title);
  await expect.poll(async () => (await event.boundingBox())?.height || 0).toBeGreaterThan((collapsed?.height || 0) + 20);
  await expect.poll(() => event.evaluate((element) => {
    const eventBounds = element.getBoundingClientRect();
    const titleBounds = element.querySelector("strong").getBoundingClientRect();
    const detailBounds = element.querySelector(".calendar-span-detail").getBoundingClientRect();
    return Math.max(titleBounds.bottom, detailBounds.bottom) <= eventBounds.bottom + 0.5;
  })).toBe(true);

  await event.hover();
  expect(await event.evaluate((element) => ({
    tooltip: getComputedStyle(element, "::after").content,
    hasHoverTitle: element.hasAttribute("data-event-title"),
  }))).toEqual({ tooltip: "none", hasHoverTitle: false });

  await page.locator(".calendar-month-date").first().click();
  await expect(event).not.toHaveClass(/is-expanded/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await page.setViewportSize({ width: 390, height: 844 });
  await event.scrollIntoViewIfNeeded();
  await toggle.click();
  await expect(event).toHaveClass(/is-expanded/);
  await expect.poll(() => event.evaluate((element) => {
    const eventBounds = element.getBoundingClientRect();
    const viewportBounds = element.closest(".calendar-combined-panel").getBoundingClientRect();
    return eventBounds.left >= viewportBounds.left - 0.5 && eventBounds.right <= viewportBounds.right + 0.5;
  })).toBe(true);
});
