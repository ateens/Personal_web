import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  FIXTURE_IDS,
  openResources,
  resetFixture,
  selectResourceMode,
} from "./helpers.js";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await openResources(page);
});

async function expectNoWcagViolations(page, testInfo, stateLabel) {
  await page.evaluate(async () => {
    const waitForTwoFrames = () => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    const animations = document.getAnimations().filter(
      (animation) => animation.playState === "pending" || animation.playState === "running",
    );
    await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
    await waitForTwoFrames();
  });
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .analyze();
  await testInfo.attach(`axe-${stateLabel}.json`, {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });
  expect(
    results.violations,
    results.violations.map((violation) => (
      `${violation.id} (${violation.impact || "unknown"}): ${violation.help}\n`
      + violation.nodes.map((node) => `  ${node.target.join(" ")}: ${node.failureSummary || ""}`).join("\n")
    )).join("\n\n"),
  ).toEqual([]);
}

function resourceOpener(page) {
  return page.locator(`#viewRoot [data-open-resource="${FIXTURE_IDS.resource}"]`).first();
}

test("Resources Library passes WCAG A/AA automated rules", async ({ page }, testInfo) => {
  await expect(resourceOpener(page)).toBeVisible();
  await expectNoWcagViolations(page, testInfo, "library");
});

test("Center page and its Page menu pass WCAG A/AA automated rules", async ({ page }, testInfo) => {
  await resourceOpener(page).click();
  const center = page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"][data-resource-shell="center"]`);
  await expect(center).toBeVisible();
  await expectNoWcagViolations(page, testInfo, "center");

  await center.locator(`[data-resource-page-menu="${FIXTURE_IDS.resource}"]`).click();
  await expect(center.locator(`[data-resource-page-menu-panel="${FIXTURE_IDS.resource}"]`)).toBeVisible();
  await expectNoWcagViolations(page, testInfo, "center-page-menu");
});

test("block selection changes are announced through the application live region", async ({ page }) => {
  await resourceOpener(page).click();
  const center = page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"][data-resource-shell="center"]`);
  const paragraph = center.locator('[data-block-content="fixture-block-paragraph"]');
  const announcements = page.locator("#appAnnouncements");

  await paragraph.focus();
  await paragraph.press("Escape");
  await expect(announcements).toHaveText("1개 블록 선택됨");

  await page.keyboard.press("Meta+a");
  await expect(announcements).toHaveText(/\d+개 블록 선택됨/);

  await page.keyboard.press("Escape");
  await expect(announcements).toHaveText("블록 선택 해제됨");
});

test("desktop Side page passes WCAG A/AA automated rules without making the database inert", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await selectResourceMode(page, "list");
  await resourceOpener(page).click();
  const side = page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"][data-resource-shell="side"]`);
  await expect(side).toBeVisible();
  await expect(side).toHaveAttribute("aria-modal", "false");
  await expect(page.locator("#viewRoot")).not.toHaveAttribute("inert", "");
  await expectNoWcagViolations(page, testInfo, "desktop-side");
});

test("mobile full-screen Resource page passes WCAG A/AA automated rules", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-resource-open-pages-in="library"]').selectOption("full");
  await resourceOpener(page).click();
  const full = page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"][data-resource-shell="full"]`);
  await expect(full).toBeVisible();
  await expect(full.locator(`[data-resource-mobile-toolbar="${FIXTURE_IDS.resource}"]`)).toBeVisible();
  await expectNoWcagViolations(page, testInfo, "mobile-full");
});
