import { expect, test } from "@playwright/test";

test("expired access session returns the open app to login", async ({ context, page }) => {
  await context.route("**/api/state/status", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Authentication is required.", code: "AUTH_REQUIRED" }),
    });
  });
  await context.route("**/auth/login?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>SYGMA login fixture</title>",
    });
  });

  await page.goto("/");
  await expect(page).toHaveTitle("SYGMA login fixture");
  const loginUrl = new URL(page.url());
  expect(loginUrl.pathname).toBe("/auth/login");
  expect(loginUrl.searchParams.get("returnTo")).toBe("/");
});
