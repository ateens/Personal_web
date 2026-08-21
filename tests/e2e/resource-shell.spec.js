import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

async function openResourceList(page) {
  await page.locator('[data-nav-key="resources"]').evaluate((button) => button.click());
  await expect(page.locator("[data-resource-view]")).toBeVisible();
}

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
});

test("자료 목록 위에 문서 dialog를 열고 닫아도 목록과 opener를 유지하며 열기만 해서는 저장하지 않는다", async ({ page, request }) => {
  await openResourceList(page);
  const before = await fixtureSnapshot(request);
  const list = page.locator('[aria-labelledby="resource-list-title"]');
  const opener = page.locator(`[data-resource-open="${FIXTURE_IDS.resource}"]`);

  await opener.click();

  const document = page.locator(`[data-resource-document="${FIXTURE_IDS.resource}"]`);
  const title = document.locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`);
  await expect(list).toBeVisible();
  await expect(opener).toBeVisible();
  await expect(document).toBeVisible();
  await expect(document).toHaveAttribute("role", "dialog");
  await expect(document).toHaveAttribute("aria-modal", "true");
  await expect(title).toHaveValue("E2E Notion Parity Resource");
  await expect(title).toBeFocused();
  await expect(document.locator(":scope > .resource-document-title + .resource-document-divider + .resource-document-body")).toHaveCount(1);
  await expect(document.locator('.block-editor[data-owner-type="resources"]')).toHaveAttribute("data-owner-id", FIXTURE_IDS.resource);
  await expect(document.locator("[data-block-drag], [data-block-add]")).toHaveCount(0);

  const leftEdgeDifference = await document.evaluate((dialog) => {
    const titleElement = dialog.querySelector("[data-resource-title]");
    const firstParagraph = dialog.querySelector('.block[data-type="paragraph"] [data-block-content]');
    return Math.abs(titleElement.getBoundingClientRect().left - firstParagraph.getBoundingClientRect().left);
  });
  expect(leftEdgeDifference).toBeLessThanOrEqual(1);

  await page.waitForTimeout(650);
  const afterOpen = await fixtureSnapshot(request);
  expect(afterOpen.serverRevision).toBe(before.serverRevision);
  expect(afterOpen.state.resources).toEqual(before.state.resources);
  expect(afterOpen.writes).toEqual(before.writes);

  await page.keyboard.press("Escape");
  await expect(document).toHaveCount(0);
  await expect(opener).toBeFocused();

  await opener.click();
  await expect(document).toBeVisible();
  await document.locator(".resource-document-close").click();
  await expect(document).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("새 자료 버튼은 빈 문서를 만들고 제목에서 Enter를 누르면 본문으로 이동한다", async ({ page }) => {
  await openResourceList(page);
  await page.locator('[data-resource-view] [data-action="new-resource"]').click();

  const document = page.locator("[data-resource-document]");
  const title = document.locator("[data-resource-title]");
  await expect(title).toHaveValue("새 자료");
  await expect(title).toBeFocused();

  await title.press("Enter");
  await expect(document.locator('[data-block-content]').first()).toBeFocused();
});

test("Resource 일반 링크는 새 창으로 열리고 명시적 링크 도구의 focus는 dialog 안에서 순환한다", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openResourceList(page);
  const opener = page.locator(`[data-resource-open="${FIXTURE_IDS.resource}"]`);
  await opener.click();

  const document = page.locator(`[data-resource-document="${FIXTURE_IDS.resource}"]`);
  const link = document.locator('a[data-inline-mark="link"][href="https://example.com/e2e"]');
  await page.context().route("https://example.com/e2e", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>External fixture</title>",
  }));
  const popupPromise = page.waitForEvent("popup");
  await link.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL("https://example.com/e2e");
  await expect(page.locator("#overlayRoot [data-inline-link-popover]")).toHaveCount(0);
  await popup.close();

  await link.focus();
  const keyboardPopupPromise = page.waitForEvent("popup");
  await link.press("Enter");
  const keyboardPopup = await keyboardPopupPromise;
  await expect(keyboardPopup).toHaveURL("https://example.com/e2e");
  await keyboardPopup.close();

  await link.focus();
  const spacePopupPromise = page.waitForEvent("popup");
  await link.press("Space");
  const spacePopup = await spacePopupPromise;
  await expect(spacePopup).toHaveURL("https://example.com/e2e");
  await spacePopup.close();

  const content = link.locator("xpath=ancestor::*[@data-block-content][1]");
  await content.evaluate((element) => {
    const anchor = element.querySelector('a[data-inline-mark="link"]');
    const range = document.createRange();
    range.selectNodeContents(anchor);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.locator('[data-inline-mark-toggle="link"]').click();
  const popover = page.locator("#overlayRoot [data-inline-link-popover]");
  await expect(popover).toBeVisible();

  const lastButton = popover.locator("button").last();
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await lastButton.focus();
  await expect(lastButton).toBeFocused();
  await page.keyboard.press("Tab");

  await expect(document.locator(".resource-document-close")).toBeFocused();
  await expect(page.getByRole("link", { name: "본문으로 건너뛰기" })).not.toBeFocused();

  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(document).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(document).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(pageErrors).toEqual([]);
});
