import { expect, test } from "@playwright/test";
import { resetFixture } from "./helpers.js";

test("Google Calendar login opens a popup and reports completion to the calendar", async ({ context, page, request }) => {
  await resetFixture(request);
  let connected = false;
  let authStartUrl = "";

  await context.route("**/api/google/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ configured: true, connected, tokenStore: "memory" }),
    });
  });
  await context.route("**/api/google/auth/start**", async (route) => {
    authStartUrl = route.request().url();
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Google OAuth test</title><p>Google account chooser placeholder</p>",
    });
  });

  await page.goto("/");
  await page.locator('[data-nav-key="calendar"]').evaluate((button) => button.click());
  const loginButton = page.locator('[data-action="connect-google"]');
  await expect(loginButton).toBeEnabled();

  const popupPromise = page.waitForEvent("popup");
  await loginButton.click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");

  expect(new URL(authStartUrl).pathname).toBe("/api/google/auth/start");
  const returnTo = new URL(authStartUrl).searchParams.get("returnTo");
  expect(returnTo).toContain("googlePopup=1");
  expect(returnTo).not.toContain("google=connected");
  await expect(popup).toHaveTitle("Google OAuth test");

  connected = true;
  await popup.evaluate(() => window.location.assign("/?google=connected&view=calendar&googlePopup=1"));
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(page.locator(".calendar-connect-panel")).toHaveCount(0);
  await expect(page.locator("#toast")).toContainText("Google Calendar 연결 완료");
});
