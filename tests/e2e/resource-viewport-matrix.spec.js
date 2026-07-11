import { expect, test } from "@playwright/test";
import {
  FIXTURE_IDS,
  openResources,
  resetFixture,
  selectResourceMode,
} from "./helpers.js";

const VIEWPORTS = [
  { width: 1440, height: 1000 },
  { width: 1280, height: 900 },
  { width: 1024, height: 768 },
  { width: 900, height: 760 },
  { width: 768, height: 720 },
  { width: 390, height: 844 },
  { width: 375, height: 812 },
  { width: 360, height: 800 },
  { width: 320, height: 720 },
];

const MODES = ["center", "side", "full"];

test("Center, Side, and Full Resource shells fit every required viewport", async ({ browser, request }, testInfo) => {
  test.setTimeout(180_000);

  for (const viewport of VIEWPORTS) {
    for (const mode of MODES) {
      await resetFixture(request);
      const context = await browser.newContext({
        viewport,
        locale: "ko-KR",
        timezoneId: "Asia/Seoul",
        reducedMotion: "reduce",
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      await page.goto("/");
      await openResources(page);
      if (mode === "side") await selectResourceMode(page, "list");
      if (mode === "full") await page.locator('select[data-resource-open-pages-in="library"]').selectOption("full");
      await page.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`).first().evaluate((element) => element.click());

      const shell = page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"][data-resource-shell="${mode}"]`);
      await expect(shell, `${mode} ${viewport.width}`).toBeVisible();
      const geometry = await shell.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const scroll = element.querySelector(".resource-note-scroll");
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          shellOverflow: element.scrollWidth - element.clientWidth,
          scrollOverflow: scroll ? scroll.scrollWidth - scroll.clientWidth : 0,
        };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(-1);
      expect(geometry.top).toBeGreaterThanOrEqual(-1);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
      expect(geometry.shellOverflow).toBeLessThanOrEqual(1);
      expect(geometry.scrollOverflow).toBeLessThanOrEqual(1);

      await testInfo.attach(`${mode}-${viewport.width}x${viewport.height}.png`, {
        body: await page.screenshot({ animations: "disabled" }),
        contentType: "image/png",
      });
      await context.close();
    }
  }
});
