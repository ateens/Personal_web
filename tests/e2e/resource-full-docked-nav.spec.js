import { expect, test } from "@playwright/test";
import {
  FIXTURE_IDS,
  openResources,
  resetFixture,
} from "./helpers.js";

const RESOURCE_PATH = `/resources/${encodeURIComponent(FIXTURE_IDS.resource)}`;

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

function fullPage(page) {
  return page.locator(
    `[data-resource-note="${FIXTURE_IDS.resource}"][data-resource-shell="full"]`,
  );
}

async function expectPath(page, pathname) {
  await expect.poll(() => new URL(page.url()).pathname).toBe(pathname);
}

async function configureFullPage(page) {
  await page.goto("/");
  await openResources(page);
  await page.locator('select[data-resource-open-pages-in="library"]').selectOption("full");
}

async function dockNavigation(page) {
  await page.locator("#viewRoot").focus();
  await page.keyboard.press("Alt+e");
  await expect(page.locator(".app")).toHaveClass(/has-docked-nav/);
}

async function openConfiguredFullPage(page) {
  const opener = page.locator(`#viewRoot [data-open-resource="${FIXTURE_IDS.resource}"]`).first();
  await expect(opener).toBeVisible();
  await opener.click();
  await expectPath(page, RESOURCE_PATH);
  await expect(fullPage(page)).toBeVisible();
  return { full: fullPage(page), opener };
}

async function openDockedFullPage(page) {
  await configureFullPage(page);
  await dockNavigation(page);
  return openConfiguredFullPage(page);
}

async function chromeGeometry(page) {
  return page.evaluate(() => {
    const full = document.querySelector('[data-resource-page-mode="full"]');
    const sidebar = document.querySelector("[data-sidebar]");
    const fullRect = full?.getBoundingClientRect();
    const sidebarRect = sidebar?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      full: fullRect
        ? {
            left: Math.round(fullRect.left),
            right: Math.round(fullRect.right),
            width: Math.round(fullRect.width),
          }
        : null,
      sidebar: sidebarRect
        ? {
            left: Math.round(sidebarRect.left),
            right: Math.round(sidebarRect.right),
            width: Math.round(sidebarRect.width),
          }
        : null,
    };
  });
}

async function expectInert(locator, expected) {
  await expect.poll(() => locator.evaluate((element) => element.inert)).toBe(expected);
}

async function expectExcludedFromSequentialFocus(locator) {
  await expect.poll(() => locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return Boolean(
      element.inert
      || element.disabled
      || element.hidden
      || element.tabIndex < 0
      || style.display === "none"
      || style.visibility === "hidden"
    );
  })).toBe(true);
}

async function expectDockedDesktopChrome(page) {
  const geometry = await chromeGeometry(page);
  expect(geometry.full).not.toBeNull();
  expect(geometry.sidebar).not.toBeNull();
  expect(geometry.sidebar.width).toBeGreaterThan(0);
  expect(geometry.full.left).toBeGreaterThanOrEqual(geometry.sidebar.right - 1);
  expect(geometry.full.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(Math.abs(geometry.full.width + geometry.sidebar.width - geometry.viewportWidth)).toBeLessThanOrEqual(1);

  const main = page.locator(".main");
  const fab = page.locator(".fab");
  const sidebar = page.locator("[data-sidebar]");
  await expectInert(main, true);
  await expectInert(fab, true);
  await expectInert(sidebar, false);
  await expect(sidebar.locator('[data-nav-key="resources"]')).toBeVisible();
  await expect(sidebar.locator('[data-nav-key="resources"]')).toBeEnabled();
  await expectExcludedFromSequentialFocus(page.locator('[data-action="toggle-nav"]'));
}

test("768px fine-pointer Full preserves a docked sidebar without toolbar overflow", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 964 });
  const { full } = await openDockedFullPage(page);

  await expectDockedDesktopChrome(page);
  await expect(full.locator(`[data-resource-close="${FIXTURE_IDS.resource}"]`)).toBeFocused();

  const toolbarFit = await full.evaluate((shell) => {
    const shellRect = shell.getBoundingClientRect();
    const toolbar = shell.querySelector(".resource-page-toolbar");
    const toolbarRect = toolbar?.getBoundingClientRect();
    const outside = toolbar
      ? [...toolbar.querySelectorAll("button, a[href], [role='button']")]
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              label: element.getAttribute("aria-label") || element.textContent?.trim() || "control",
              left: Math.round(rect.left),
              right: Math.round(rect.right),
            };
          })
          .filter((entry) => entry.left < shellRect.left - 1 || entry.right > shellRect.right + 1)
      : ["toolbar missing"];
    return {
      toolbarInsideShell: Boolean(
        toolbarRect
        && toolbarRect.left >= shellRect.left - 1
        && toolbarRect.right <= shellRect.right + 1
      ),
      overflow: toolbar ? toolbar.scrollWidth - toolbar.clientWidth : Number.POSITIVE_INFINITY,
      outside,
    };
  });

  expect(toolbarFit.toolbarInsideShell).toBe(true);
  expect(toolbarFit.overflow).toBeLessThanOrEqual(1);
  expect(toolbarFit.outside).toEqual([]);
  await expect(full.getByRole("status")).toHaveCount(1);
});

test("docked Full sidebar navigation pushes a root destination and Back/Forward restores both entries", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 964 });
  const { full } = await openDockedFullPage(page);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  await expect(full.locator(`[data-resource-close="${FIXTURE_IDS.resource}"]`)).toBeFocused();
  await expect(page.locator("#appAnnouncements")).not.toHaveText("링크된 블록을 찾지 못해 Resource 페이지로 이동했습니다.");

  const todayNav = page.locator('[data-nav-key="today"]');
  await todayNav.click({ timeout: 8_000 });
  await expectPath(page, "/");
  await expect(fullPage(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "대시보드" })).toBeVisible();
  await expect(todayNav).toHaveAttribute("aria-current", "page");
  await expectInert(page.locator(".main"), false);
  await expectInert(page.locator(".fab"), false);

  await page.goBack();
  await expectPath(page, RESOURCE_PATH);
  const restoredFull = fullPage(page);
  await expect(restoredFull).toBeVisible();
  await expectDockedDesktopChrome(page);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  await expect(restoredFull.locator(`[data-resource-close="${FIXTURE_IDS.resource}"]`)).toBeFocused();
  await expect(page.locator("#appAnnouncements")).not.toHaveText("링크된 블록을 찾지 못해 Resource 페이지로 이동했습니다.");

  await page.goForward();
  await expectPath(page, "/");
  await expect(fullPage(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "대시보드" })).toBeVisible();
  await expect(todayNav).toHaveAttribute("aria-current", "page");
  await expect.poll(() => page.evaluate(() => {
    const active = document.activeElement;
    const viewRoot = document.querySelector("#viewRoot");
    const today = document.querySelector('[data-nav-key="today"]');
    return active === today || active === viewRoot || Boolean(viewRoot?.contains(active));
  })).toBe(true);
});

test("non-docked Full exits through Option navigation and preserves Back/Forward focus", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 964 });
  await configureFullPage(page);
  await expect(page.locator(".app")).not.toHaveClass(/has-docked-nav/);
  await openConfiguredFullPage(page);

  await page.keyboard.press("Alt+1");
  await expectPath(page, "/");
  await expect(fullPage(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "대시보드" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement === document.querySelector("#viewRoot"))).toBe(true);

  await page.goBack();
  await expectPath(page, RESOURCE_PATH);
  await expect(fullPage(page)).toBeVisible();
  await expect(fullPage(page).locator(`[data-resource-close="${FIXTURE_IDS.resource}"]`)).toBeFocused();

  await page.goForward();
  await expectPath(page, "/");
  await expect(page.getByRole("heading", { name: "대시보드" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement === document.querySelector("#viewRoot"))).toBe(true);
});

test("ordinary setView exits a non-docked Full route and keeps the Resource history entry", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 964 });
  await configureFullPage(page);
  await openConfiguredFullPage(page);

  await page.evaluate(() => window.setView("tasks"));
  await expectPath(page, "/");
  await expect(fullPage(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "확인과 날짜 배치" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement === document.querySelector("#viewRoot"))).toBe(true);

  await page.goBack();
  await expectPath(page, RESOURCE_PATH);
  await expect(fullPage(page)).toBeVisible();
  await page.goForward();
  await expectPath(page, "/");
  await expect(page.getByRole("heading", { name: "확인과 날짜 배치" })).toBeVisible();
});

test("docked Full switches to compact viewport chrome and restores desktop chrome across resize", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 964 });
  const { full } = await openDockedFullPage(page);
  await expectDockedDesktopChrome(page);

  await page.setViewportSize({ width: 590, height: 844 });
  await expect.poll(async () => chromeGeometry(page)).toMatchObject({
    viewportWidth: 590,
    full: { left: 0, right: 590, width: 590 },
  });
  await expectInert(page.locator(".main"), true);
  await expectInert(page.locator(".fab"), true);
  await expectInert(page.locator("[data-sidebar]"), true);
  await expectExcludedFromSequentialFocus(page.locator('[data-action="toggle-nav"]'));
  await expect(full.locator(`[data-resource-mobile-toolbar="${FIXTURE_IDS.resource}"]`)).toBeVisible();
  await expect.poll(() => full.evaluate((shell) => shell.contains(document.activeElement))).toBe(true);

  await page.setViewportSize({ width: 768, height: 964 });
  await expect.poll(async () => {
    const geometry = await chromeGeometry(page);
    return {
      startsAfterSidebar: Math.abs((geometry.full?.left || 0) - (geometry.sidebar?.right || 0)) <= 1,
      reachesViewportEdge: Math.abs((geometry.full?.right || 0) - geometry.viewportWidth) <= 1,
      fillsRemainingWidth:
        Math.abs((geometry.full?.width || 0) + (geometry.sidebar?.width || 0) - geometry.viewportWidth) <= 1,
    };
  }).toEqual({ startsAfterSidebar: true, reachesViewportEdge: true, fillsRemainingWidth: true });
  await expectInert(page.locator("[data-sidebar]"), false);
  await expectInert(page.locator(".main"), true);
  await expectInert(page.locator(".fab"), true);
  await expect(full.locator(`[data-resource-mobile-toolbar="${FIXTURE_IDS.resource}"]`)).toBeHidden();
  await expect.poll(() => full.evaluate((shell) => shell.contains(document.activeElement))).toBe(true);
});

test.describe("compact Full workspace chrome", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("Full retargets the skip link to its focusable Resource surface", async ({ page }) => {
    await configureFullPage(page);
    const { full } = await openConfiguredFullPage(page);
    const skip = page.locator("[data-skip-link]");
    await expect(skip).toHaveAttribute("href", "#resource-page-surface");
    await skip.focus();
    await page.keyboard.press("Enter");
    await expect(full).toBeFocused();

    await full.locator(`[data-resource-close="${FIXTURE_IDS.resource}"]`).click();
    await expect(full).toHaveCount(0);
    await expect(skip).toHaveAttribute("href", "#viewRoot");
  });

  test("a docked nav remains covered and inert while Full owns the compact viewport", async ({ page }) => {
    await configureFullPage(page);
    const { full } = await openConfiguredFullPage(page);
    await full.locator(`[data-resource-close="${FIXTURE_IDS.resource}"]`).focus();
    await page.keyboard.press("Alt+e");
    await expect(page.locator(".app")).toHaveClass(/has-docked-nav/);

    await expect.poll(async () => chromeGeometry(page)).toMatchObject({
      viewportWidth: 390,
      full: { left: 0, right: 390, width: 390 },
    });
    await expectInert(page.locator(".main"), true);
    await expectInert(page.locator(".fab"), true);
    await expectInert(page.locator("[data-sidebar]"), true);
    await expectExcludedFromSequentialFocus(page.locator('[data-action="toggle-nav"]'));
    await expect(full.locator(`[data-resource-mobile-toolbar="${FIXTURE_IDS.resource}"]`)).toBeVisible();
    await expect.poll(() => full.evaluate((shell) => shell.contains(document.activeElement))).toBe(true);
  });
});
