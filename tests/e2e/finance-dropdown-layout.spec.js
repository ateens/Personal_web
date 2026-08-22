import { expect, test } from "@playwright/test";
import { fixtureSnapshot, resetFixture } from "./helpers.js";

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.setViewportSize({ width: 560, height: 820 });
  await page.goto("/finance");
  await page.getByLabel("가계부 비밀번호").fill("finance-e2e-password");
  await page.getByRole("button", { name: "가계부 열기" }).click();
  await expect(page.locator('[data-finance-screen="dashboard"]')).toBeVisible();
});

async function assertUnclippedPopover(list) {
  await expect(list).toBeVisible();
  const geometry = await list.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportRight = viewportLeft + (viewport?.width || document.documentElement.clientWidth);
    const viewportBottom = viewportTop + (viewport?.height || document.documentElement.clientHeight);
    const sampleX = Math.min(viewportRight - 1, Math.max(viewportLeft, rect.left + rect.width / 2));
    const sampleY = Math.min(viewportBottom - 1, Math.max(viewportTop, rect.bottom - 3));
    const hit = document.elementFromPoint(sampleX, sampleY);
    return {
      popoverOpen: element.matches(":popover-open"),
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportLeft,
      viewportTop,
      viewportRight,
      viewportBottom,
      hitInside: Boolean(hit && element.contains(hit)),
    };
  });
  expect(geometry.popoverOpen).toBe(true);
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.viewportLeft);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportRight);
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.viewportTop);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportBottom);
  expect(geometry.hitInside).toBe(true);
}

test("finance selects escape overflow clips and edit stays beside delete", async ({ page, request }) => {
  await page.locator('.finance-tabs [data-finance-tab="accounts"]').click();
  const accountForm = page.locator('form[data-form="finance-account"]').filter({
    has: page.locator('input[name="entityId"][value=""]'),
  });
  await accountForm.locator('[name="name"]').fill("레이아웃 통장");
  await accountForm.locator('[name="institution"]').fill("테스트 은행");
  await accountForm.locator('[name="openingBalanceKrw"]').fill("1000000");
  await accountForm.getByRole("button", { name: "계좌 저장" }).click();
  await expect.poll(async () => (await fixtureSnapshot(request)).financeState.accounts.length).toBe(1);

  const accountId = (await fixtureSnapshot(request)).financeState.accounts[0].id;
  const paymentForm = page.locator('form[data-form="finance-payment-method"]').filter({
    has: page.locator('input[name="entityId"][value=""]'),
  });
  const typeControl = paymentForm.locator('select[name="type"]').locator("xpath=..");
  await typeControl.locator("[data-finance-select-trigger]").click();
  await assertUnclippedPopover(typeControl.locator("[data-finance-select-options]"));
  await expect(typeControl.getByRole("option")).toHaveCount(4);
  await typeControl.getByRole("option", { name: "체크카드" }).click();

  await paymentForm.locator('[name="name"]').fill("레이아웃 체크카드");
  await paymentForm.locator('select[name="linkedAccountId"]').selectOption(accountId);
  await paymentForm.getByRole("button", { name: "결제수단 저장" }).click();
  await expect.poll(async () => (await fixtureSnapshot(request)).financeState.paymentMethods.length).toBe(1);

  const methodId = (await fixtureSnapshot(request)).financeState.paymentMethods[0].id;
  const record = page.locator(`[data-finance-payment-method-record="${methodId}"]`);
  const edit = record.getByRole("button", { name: "레이아웃 체크카드 수정" });
  const remove = record.getByRole("button", { name: "삭제", exact: true });
  await expect(edit).toBeVisible();
  await expect(remove).toBeVisible();
  const actionGeometry = await record.evaluate((element) => {
    const editButton = element.querySelector("[data-finance-edit-target]");
    const deleteButton = element.querySelector("[data-finance-delete-payment-method]");
    const recordRect = element.getBoundingClientRect();
    const editRect = editButton.getBoundingClientRect();
    const deleteRect = deleteButton.getBoundingClientRect();
    return {
      sameRow: Math.abs(editRect.top - deleteRect.top) < 2,
      ordered: editRect.right <= deleteRect.left,
      visible: editRect.width > 0 && editRect.height > 0 && deleteRect.width > 0 && deleteRect.height > 0,
      insideRecord: editRect.left >= recordRect.left && deleteRect.right <= recordRect.right,
    };
  });
  expect(actionGeometry).toEqual({ sameRow: true, ordered: true, visible: true, insideRecord: true });

  await edit.click();
  const details = page.locator(`[data-finance-edit-payment-method="${methodId}"]`);
  await expect(details).toHaveAttribute("open", "");
  await expect(edit).toHaveAttribute("aria-expanded", "true");

  const editTypeControl = details.locator('select[name="type"]').locator("xpath=..");
  await editTypeControl.locator("[data-finance-select-trigger]").click();
  await assertUnclippedPopover(editTypeControl.locator("[data-finance-select-options]"));

  const allFinanceMenusUseTopLayer = await page.locator("[data-finance-select-options]").evaluateAll((menus) => (
    menus.length > 0 && menus.every((menu) => menu.getAttribute("popover") === "manual")
  ));
  expect(allFinanceMenusUseTopLayer).toBe(true);

  await edit.click();
  await expect(details).not.toHaveAttribute("open", "");
  await expect(details).not.toBeVisible();
  await expect(edit).toHaveAttribute("aria-expanded", "false");
  await expect(edit).toBeFocused();
});
