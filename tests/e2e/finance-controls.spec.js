import { expect, test } from "@playwright/test";
import { fixtureSnapshot, resetFixture } from "./helpers.js";

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/finance");
  await page.getByLabel("가계부 비밀번호").fill("finance-e2e-password");
  await page.getByRole("button", { name: "가계부 열기" }).click();
  await expect(page.locator('[data-finance-screen="dashboard"]')).toBeVisible();
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('.finance-tabs [data-finance-tab="manage"]').click();
});

test("finance setup uses custom controls and stores loan schedules and fixed-cost contracts", async ({ page, request }) => {
  await page.locator('.finance-tabs [data-finance-tab="entries"]').click();
  await expect(page.locator('.finance-native-form [name="recognitionMonth"]')).toHaveCount(0);
  await expect(page.getByText(/비용 기준 월|수입 기준 월|환불을 반영할 월/)).toHaveCount(0);
  await page.locator('.finance-tabs [data-finance-tab="manage"]').click();

  const accountForm = page.locator('form[data-form="finance-account"]');
  await expect(accountForm.locator('[name="lastFour"], [name="openingOn"]')).toHaveCount(0);
  await expect(page.locator(".finance-native-form select:not(.finance-select-native)")).toHaveCount(0);
  await expect(page.locator('.finance-native-form input[type="date"]:not(.finance-date-native)')).toHaveCount(0);

  await accountForm.locator('[name="name"]').fill("생활비 통장");
  await accountForm.locator('[name="institution"]').fill("테스트 은행");
  await accountForm.locator('[name="openingBalanceKrw"]').fill("1000000");
  await expect(accountForm.locator("[data-finance-select-options]")).toBeHidden();
  await accountForm.locator("[data-finance-select-trigger]").press("ArrowDown");
  await expect(accountForm.locator("[data-finance-select-options]")).toBeVisible();
  await expect(accountForm.getByRole("option", { name: "은행 계좌" })).toBeFocused();
  await accountForm.getByRole("option", { name: "은행 계좌" }).press("Enter");
  await expect(accountForm.locator("[data-finance-select-options]")).toBeHidden();
  await accountForm.getByRole("button", { name: "계좌 저장" }).click();

  const expectedOpeningOn = await page.evaluate(() => {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
  });
  await expect.poll(async () => {
    const account = (await fixtureSnapshot(request)).financeState?.accounts?.[0];
    return account && {
      name: account.name,
      openingBalanceKrw: account.openingBalanceKrw,
      openingOn: account.openingOn,
      hasLastFour: Object.hasOwn(account, "lastFour"),
    };
  }).toEqual({
    name: "생활비 통장",
    openingBalanceKrw: 1_000_000,
    openingOn: expectedOpeningOn,
    hasLastFour: false,
  });
  await expect(accountForm.locator('button[type="submit"]')).toBeEnabled();

  const methodForm = page.locator('form[data-form="finance-payment-method"]');
  await expect(methodForm.locator('[name="lastFour"]')).toHaveCount(0);
  await methodForm.locator('[name="name"]').fill("생활 신용카드");
  await methodForm.locator("[data-finance-select-trigger]").first().click();
  await methodForm.getByRole("option", { name: "신용카드" }).click();
  await expect(methodForm.locator("[data-finance-linked-fields]")).toBeHidden();
  await expect(methodForm.locator("[data-finance-credit-fields]")).toBeVisible();
  await methodForm.locator("[data-finance-credit-fields] [data-finance-select-trigger]").click();
  await methodForm.getByRole("option", { name: "생활비 통장" }).click();
  await methodForm.getByRole("button", { name: "결제수단 저장" }).click();
  await expect.poll(async () => {
    const method = (await fixtureSnapshot(request)).financeState?.paymentMethods?.[0];
    return method && {
      name: method.name,
      type: method.type,
      hasLastFour: Object.hasOwn(method, "lastFour"),
    };
  }).toEqual({
    name: "생활 신용카드",
    type: "credit_card",
    hasLastFour: false,
  });
  await expect(methodForm.locator('button[type="submit"]')).toBeEnabled();

  const loanForm = page.locator('form[data-form="finance-loan"]');
  await loanForm.locator('[name="name"]').fill("생활 대출");
  await expect(loanForm.locator('[name="name"]')).toHaveValue("생활 대출");
  await loanForm.locator('[name="openingPrincipalKrw"]').fill("12000000");
  await loanForm.locator('[name="termMonths"]').fill("24");
  await loanForm.locator('[name="graceMonths"]').fill("6");
  await loanForm.locator('[name="annualRate"]').fill("6");
  await expect(loanForm.locator('[name="monthlyPaymentKrw"]')).toHaveCount(0);
  const automaticSchedule = loanForm.locator("[data-finance-loan-schedule]");
  await expect(automaticSchedule).toHaveAttribute("aria-hidden", "false");
  await expect(automaticSchedule.locator("[data-finance-loan-schedule-row]")).toHaveCount(30);
  await expect(automaticSchedule.locator("[data-finance-loan-schedule-row]").first()).toContainText("₩60,000");
  await expect(automaticSchedule.locator("[data-finance-loan-schedule-row]").nth(6)).toContainText("₩531,847");
  await loanForm.locator("[data-finance-select-trigger]").click();
  await loanForm.getByRole("option", { name: "생활비 통장" }).click();
  await expect(loanForm.locator('[name="name"]')).toHaveValue("생활 대출");
  expect(await loanForm.evaluate((form) => ({
    valid: form.checkValidity(),
    invalid: [...form.elements].filter((element) => !element.checkValidity()).map((element) => element.name),
  }))).toEqual({ valid: true, invalid: [] });
  await loanForm.getByRole("button", { name: "대출 저장" }).click();
  await expect.poll(async () => {
    const financeState = (await fixtureSnapshot(request)).financeState;
    const loan = financeState?.loans?.[0];
    const payments = financeState?.loanPayments?.filter((payment) => payment.loanId === loan?.id);
    return loan && {
      name: loan.name,
      termMonths: loan.termMonths,
      graceMonths: loan.graceMonths,
      scheduleMode: loan.scheduleMode,
      hasMonthlyPaymentKrw: Object.hasOwn(loan, "monthlyPaymentKrw"),
      paymentCount: payments.length,
      firstPayment: payments[0] && {
        principalKrw: payments[0].principalKrw,
        interestKrw: payments[0].interestKrw,
      },
      firstRepayment: payments[6] && {
        principalKrw: payments[6].principalKrw,
        interestKrw: payments[6].interestKrw,
      },
    };
  }).toEqual({
    name: "생활 대출",
    termMonths: 24,
    graceMonths: 6,
    scheduleMode: "auto",
    hasMonthlyPaymentKrw: false,
    paymentCount: 30,
    firstPayment: { principalKrw: 0, interestKrw: 60_000 },
    firstRepayment: { principalKrw: 471_847, interestKrw: 60_000 },
  });
  await expect(page.locator('[data-finance-loan]').filter({ hasText: "생활 대출" })).toBeVisible();

  await page.locator(".finance-manage-details").filter({ has: loanForm }).locator("summary").click();
  await loanForm.locator('[name="name"]').fill("수동 대출");
  await loanForm.locator('[name="openingPrincipalKrw"]').fill("1000001");
  await loanForm.locator('[name="termMonths"]').fill("3");
  await loanForm.getByText("수동 입력", { exact: true }).click();
  const manualSchedule = loanForm.locator("[data-finance-loan-schedule]");
  await expect(manualSchedule.locator("[data-finance-loan-schedule-row]")).toHaveCount(3);
  await loanForm.getByRole("button", { name: "원금 자동분할" }).click();
  expect(await manualSchedule.locator('[name="schedulePrincipalKrw"]').evaluateAll((inputs) => inputs.map((input) => input.value))).toEqual(["333334", "333334", "333333"]);
  await manualSchedule.locator('[name="scheduleInterestKrw"]').nth(1).fill("100");
  await loanForm.locator("[data-finance-select-trigger]").click();
  await loanForm.getByRole("option", { name: "생활비 통장" }).click();
  await loanForm.getByRole("button", { name: "대출 저장" }).click();
  await expect.poll(async () => {
    const financeState = (await fixtureSnapshot(request)).financeState;
    const loan = financeState?.loans?.find((item) => item.name === "수동 대출");
    const payments = financeState?.loanPayments?.filter((payment) => payment.loanId === loan?.id);
    return loan && {
      scheduleMode: loan.scheduleMode,
      graceMonths: loan.graceMonths,
      hasAnnualRate: Object.hasOwn(loan, "annualRate"),
      payments: payments.map((payment) => ({
        principalKrw: payment.principalKrw,
        interestKrw: payment.interestKrw,
      })),
    };
  }).toEqual({
    scheduleMode: "manual",
    graceMonths: 0,
    hasAnnualRate: false,
    payments: [
      { principalKrw: 333_334, interestKrw: 0 },
      { principalKrw: 333_334, interestKrw: 100 },
      { principalKrw: 333_333, interestKrw: 0 },
    ],
  });

  const recurringForm = page.locator('form[data-form="finance-recurring-rule"]');
  await expect(recurringForm.locator('[name="recognitionMonthOffset"]')).toHaveCount(0);
  await recurringForm.locator('[name="name"]').fill("전기요금");
  await recurringForm.locator('[name="amountEstimateKrw"]').fill("80000");
  await recurringForm.locator("[data-finance-select-trigger]").click();
  await recurringForm.getByRole("option", { name: "생활비 통장" }).click();
  const activeMonth = expectedOpeningOn.slice(0, 7);
  await recurringForm.locator("[data-finance-date-trigger]").click();
  await recurringForm.locator(`[data-finance-date-value="${activeMonth}-01"]`).click();
  await recurringForm.getByRole("button", { name: "고정비 저장" }).click();
  await expect.poll(async () => {
    const rule = (await fixtureSnapshot(request)).financeState?.recurringRules?.[0];
    return rule && {
      name: rule.name,
      hasRecognitionMonthOffset: Object.hasOwn(rule, "recognitionMonthOffset"),
    };
  }).toEqual({
    name: "전기요금",
    hasRecognitionMonthOffset: false,
  });
  await page.getByRole("button", { name: `${activeMonth} 일정 만들기` }).click();
  await expect.poll(async () => {
    const entry = (await fixtureSnapshot(request)).financeState?.entries?.find((item) => item.recurringRuleId);
    return entry?.recognitionMonth;
  }).toBe(activeMonth);

  await page.getByText("실제 잔액과 맞추기", { exact: true }).click();
  const balanceForm = page.locator('form[data-form="finance-balance-check"]');
  await balanceForm.locator("[data-finance-select-trigger]").click();
  await balanceForm.getByRole("option", { name: "생활비 통장" }).click();

  const checkedOn = await balanceForm.locator('[name="checkedOn"]').inputValue();
  await balanceForm.locator("[data-finance-date-trigger]").click();
  const dateDialog = balanceForm.locator("[data-finance-date-dialog]");
  await expect(dateDialog).toBeVisible();
  await expect(dateDialog.locator(".finance-date-weekdays")).toContainText("월");
  const previousDate = await page.evaluate((value) => {
    const date = new Date(`${value}T12:00:00`);
    date.setDate(date.getDate() - 1);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  }, checkedOn);
  await dateDialog.locator(`[data-finance-date-value="${checkedOn}"]`).first().press("ArrowLeft");
  await expect(dateDialog.locator(`[data-finance-date-value="${previousDate}"]`)).toBeFocused();
  await dateDialog.locator(`[data-finance-date-value="${checkedOn}"]`).first().click();
  await expect(dateDialog).toBeHidden();

  await balanceForm.locator('[name="actualBalanceKrw"]').fill("1050000");
  await balanceForm.getByRole("button", { name: "잔액 확인 저장" }).click();
  await expect.poll(async () => {
    const financeState = (await fixtureSnapshot(request)).financeState;
    const check = financeState?.balanceChecks?.[0];
    const movement = financeState?.movements?.find((item) => item.id === check?.adjustmentMovementId);
    return check && {
      checkedOn: check.checkedOn,
      actualBalanceKrw: check.actualBalanceKrw,
      movementOn: movement?.postedOn,
    };
  }).toEqual({
    checkedOn,
    actualBalanceKrw: 1_050_000,
    movementOn: checkedOn,
  });

  await page.locator('.finance-tabs [data-finance-tab="entries"]').click();
  await page.getByText("썼어요", { exact: true }).click();
  const expenseForm = page.locator('form[data-form="finance-expense"]');
  await expect(expenseForm.locator('input[type="date"]:not(.finance-date-native)')).toHaveCount(0);
  const optionalDate = expenseForm.locator('[name="scheduledOn"]');
  await expect(optionalDate).toHaveValue("");
  await optionalDate.locator("xpath=..").locator("[data-finance-date-trigger]").click();
  await optionalDate.locator("xpath=..").getByRole("button", { name: "오늘" }).click();
  await expect(optionalDate).not.toHaveValue("");
  await optionalDate.locator("xpath=..").locator("[data-finance-date-trigger]").click();
  await optionalDate.locator("xpath=..").getByRole("button", { name: "선택 안 함" }).click();
  await expect(optionalDate).toHaveValue("");
});
