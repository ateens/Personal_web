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

test("자료 목록에서 문서를 열면 제목, 구분선, 본문 순서로 표시되고 열기만 해서는 저장하지 않는다", async ({ page, request }) => {
  await openResourceList(page);
  const before = await fixtureSnapshot(request);
  const opener = page.locator(`[data-resource-open="${FIXTURE_IDS.resource}"]`);

  await opener.click();

  const document = page.locator(`[data-resource-document="${FIXTURE_IDS.resource}"]`);
  const title = document.locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`);
  await expect(document).toBeVisible();
  await expect(title).toHaveValue("E2E Notion Parity Resource");
  await expect(title).toBeFocused();
  await expect(document.locator(":scope > .resource-document-title + .resource-document-divider + .resource-document-body")).toHaveCount(1);
  await expect(document.locator('.block-editor[data-owner-type="resources"]')).toHaveAttribute("data-owner-id", FIXTURE_IDS.resource);

  await page.waitForTimeout(650);
  const afterOpen = await fixtureSnapshot(request);
  expect(afterOpen.serverRevision).toBe(before.serverRevision);
  expect(afterOpen.state.resources).toEqual(before.state.resources);
  expect(afterOpen.writes).toEqual(before.writes);

  await document.locator("[data-resource-back]").click();
  await expect(page.locator(`[data-resource-open="${FIXTURE_IDS.resource}"]`)).toBeFocused();
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
