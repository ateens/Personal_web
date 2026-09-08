import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

test.beforeEach(async ({ request }) => { await resetFixture(request); });

test("a stalled workspace read exits loading and can be retried", async ({ page }) => {
  await page.addInitScript(() => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (milliseconds) => {
      AbortSignal.timeout = timeout;
      window.__workspaceReadTimeout = milliseconds;
      return timeout(80);
    };
  });
  await page.route("**/api/state/status", () => {});
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "offline");
  expect(await page.evaluate(() => window.__workspaceReadTimeout)).toBe(30_000);
  await page.unroute("**/api/state/status");
  await page.locator('[data-action="retry-workspace-authority"]').click();
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
});

test("a malformed successful save response keeps the Resource draft queued", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  let writes = 0;
  await page.route(`**/api/resources/${FIXTURE_IDS.resource}`, async (route) => {
    writes += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"resource":' });
  });
  await page.locator('[data-action="toggle-nav"]').click();
  await page.locator('[data-nav-key="resources"]').click();
  await page.locator(`[data-resource-open="${FIXTURE_IDS.resource}"]`).evaluate((element) => element.click());
  const input = page.locator(`[data-resource-window="${FIXTURE_IDS.resource}"] [data-block-content]`).first();
  await input.fill("Keep this pending draft");
  await expect.poll(() => writes).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => remoteStateSaveInFlight)).toBe(false);
  expect(await page.evaluate(() => localResourcePersistence.operations.some((operation) => operation.entityType === "resource"))).toBe(true);
  await expect(input).toHaveText("Keep this pending draft");
  expect((await fixtureSnapshot(request)).serverRevision).toBe(1);
});

test("first service-worker activation does not reload the initial workspace", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ ...testInfo.project.use, serviceWorkers: "allow" });
  try {
    const page = await context.newPage();
    let navigations = 0;
    page.on("request", (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations += 1; });
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)).catch(() => false)).toBe(true);
    await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
    await page.waitForTimeout(300);
    expect(navigations).toBe(1);
  } finally {
    await context.close();
  }
});

test("a pending finance save keeps the next form safe until its refreshed state is ready", async ({ page, request }) => {
  await page.goto("/finance");
  await page.getByLabel("가계부 비밀번호").fill("finance-e2e-password");
  await page.getByRole("button", { name: "가계부 열기" }).click();
  await page.locator('.finance-tabs [data-finance-tab="accounts"]').click();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/finance/state", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const response = await route.fetch();
    await pending;
    await route.fulfill({ response });
  });
  const account = page.locator('form[data-form="finance-account"]').first();
  await account.locator('[name="name"]').fill("Delayed account");
  await account.getByRole("button", { name: "계좌 저장" }).click();
  await expect.poll(async () => (await fixtureSnapshot(request)).financeState.accounts.length).toBe(1);
  const dashboard = page.locator('[data-finance-screen="dashboard"]');
  await expect(dashboard).toHaveAttribute("aria-busy", "true");
  expect(await dashboard.locator('[data-finance-tab-panel]').evaluate((element) => element.inert)).toBe(true);
  const nextName = page.locator('form[data-form="finance-payment-method"] [name="name"]').first();
  release();
  await expect(dashboard).toHaveAttribute("aria-busy", "false");
  expect(await dashboard.locator('[data-finance-tab-panel]').evaluate((element) => element.inert)).toBe(false);
  await nextName.fill("Do not discard this next draft");
  await expect(nextName).toHaveValue("Do not discard this next draft");
});

test("a failed finance save preserves its form for a successful retry", async ({ page, request }) => {
  await page.goto("/finance");
  await page.getByLabel("가계부 비밀번호").fill("finance-e2e-password");
  await page.getByRole("button", { name: "가계부 열기" }).click();
  await page.locator('.finance-tabs [data-finance-tab="accounts"]').click();
  await page.route("**/api/finance/state", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary storage failure" }) });
  });
  const account = page.locator('form[data-form="finance-account"]').first();
  await account.locator('[name="name"]').fill("Preserved account");
  await account.locator('[name="institution"]').fill("Preserved institution");
  await account.getByRole("button", { name: "계좌 저장" }).click();
  await expect(page.locator('[data-finance-screen="dashboard"]')).toHaveAttribute("aria-busy", "false");
  await expect(page.locator('.finance-mutation-error')).toBeVisible();
  await expect(account.locator('[name="name"]')).toHaveValue("Preserved account");
  await expect(account.locator('[name="institution"]')).toHaveValue("Preserved institution");
  expect((await fixtureSnapshot(request)).financeState?.accounts || []).toHaveLength(0);
  await page.unroute("**/api/finance/state");
  await account.getByRole("button", { name: "계좌 저장" }).click();
  await expect.poll(async () => (await fixtureSnapshot(request)).financeState.accounts[0]?.name).toBe("Preserved account");
});

test("finance can be locked during a pending save without its late response reopening data", async ({ page, request }) => {
  await page.goto("/finance");
  await page.getByLabel("가계부 비밀번호").fill("finance-e2e-password");
  await page.getByRole("button", { name: "가계부 열기" }).click();
  await page.locator('.finance-tabs [data-finance-tab="accounts"]').click();
  await page.evaluate(() => {
    const save = saveFinanceState;
    saveFinanceState = (...args) => {
      window.__pendingFinanceSave = save(...args);
      return window.__pendingFinanceSave;
    };
  });
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/finance/state", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const response = await route.fetch();
    await pending;
    await route.fulfill({ response });
  });
  const account = page.locator('form[data-form="finance-account"]').first();
  await account.locator('[name="name"]').fill("Pending at lock");
  await account.getByRole("button", { name: "계좌 저장" }).click();
  await expect.poll(async () => (await fixtureSnapshot(request)).financeState.accounts.length).toBe(1);
  await expect(page.locator('[data-finance-screen="dashboard"]')).toHaveAttribute("aria-busy", "true");
  await page.getByRole("button", { name: "잠그기", exact: true }).click();
  await expect(page.getByLabel("가계부 비밀번호")).toBeVisible();
  release();
  await page.evaluate(() => window.__pendingFinanceSave);
  await expect.poll(() => page.evaluate(() => ({ status: financeWorkspace.status, state: financeWorkspace.state, saving: financeWorkspace.saving }))).toEqual({ status: "locked", state: null, saving: false });
  await expect(page.getByLabel("가계부 비밀번호")).toBeVisible();
  await expect(page.locator('[data-finance-screen="dashboard"]')).toHaveCount(0);
});
