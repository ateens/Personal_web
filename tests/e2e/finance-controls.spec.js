import { expect, test } from "@playwright/test";
import { fixtureSnapshot, resetFixture } from "./helpers.js";

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/finance");
  await page.getByLabel("가계부 비밀번호").fill("finance-e2e-password");
  await page.getByRole("button", { name: "가계부 열기" }).click();
  await expect(page.locator('[data-finance-screen="dashboard"]')).toBeVisible();
});

async function createAccount(page, request, { name = "생활비 통장", balance = "5000000" } = {}) {
  await page.locator('.finance-tabs [data-finance-tab="accounts"]').click();
  const form = page.locator('form[data-form="finance-account"]').filter({
    has: page.locator('input[name="entityId"][value=""]'),
  });
  await form.locator('[name="name"]').fill(name);
  await form.locator('[name="institution"]').fill("테스트 은행");
  await form.locator('[name="openingBalanceKrw"]').fill(balance);
  await form.getByRole("button", { name: "계좌 저장" }).click();
  await expect.poll(async () => (await fixtureSnapshot(request)).financeState.accounts.some((item) => item.name === name)).toBe(true);
  await expect(page.locator('[data-finance-screen="dashboard"]')).toHaveAttribute("aria-busy", "false");
}

async function createCreditCard(page, request, { name = "생활 신용카드", dueDay = "14" } = {}) {
  const accountId = (await fixtureSnapshot(request)).financeState.accounts[0].id;
  await page.locator('.finance-tabs [data-finance-tab="cards"]').click();
  const form = page.locator('form[data-form="finance-payment-method"]').filter({
    has: page.locator('input[name="entityId"][value=""]'),
  });
  await form.locator('[name="name"]').fill(name);
  await form.locator('select[name="type"]').selectOption("credit_card");
  await form.locator('select[name="paymentAccountId"]').selectOption(accountId);
  await form.locator('[name="dueDay"]').fill(dueDay);
  await form.getByRole("button", { name: "결제수단 저장" }).click();
  await expect.poll(async () => (await fixtureSnapshot(request)).financeState.paymentMethods.some((item) => item.name === name)).toBe(true);
  await expect(page.locator('[data-finance-screen="dashboard"]')).toHaveAttribute("aria-busy", "false");
}

test("management items edit, fixed costs generate once, and asset-only loans delete", async ({ page, request }) => {
  await createAccount(page, request);
  let snapshot = await fixtureSnapshot(request);
  const accountId = snapshot.financeState.accounts[0].id;

  const accountEdit = page.locator(`[data-finance-edit-account="${accountId}"]`);
  await accountEdit.locator("summary").click();
  await accountEdit.locator('[name="name"]').fill("수정한 생활비 통장");
  await accountEdit.getByRole("button", { name: "계좌 수정 저장" }).click();
  await expect.poll(async () => (await fixtureSnapshot(request)).financeState.accounts[0].name).toBe("수정한 생활비 통장");

  await createCreditCard(page, request);
  snapshot = await fixtureSnapshot(request);
  const cardId = snapshot.financeState.paymentMethods[0].id;
  const cardEdit = page.locator(`[data-finance-edit-payment-method="${cardId}"]`);
  await cardEdit.locator("summary").click();
  await cardEdit.locator('[name="name"]').fill("수정한 생활 신용카드");
  await cardEdit.locator('[name="dueDay"]').fill("17");
  await cardEdit.getByRole("button", { name: "결제수단 수정 저장" }).click();
  await expect.poll(async () => {
    const card = (await fixtureSnapshot(request)).financeState.paymentMethods[0];
    return { id: card.id, name: card.name, dueDay: card.dueDay };
  }).toEqual({ id: cardId, name: "수정한 생활 신용카드", dueDay: 17 });

  await page.locator('.finance-tabs [data-finance-tab="accounts"]').click();
  const loanForm = page.locator('form[data-form="finance-loan"]').filter({
    has: page.locator('input[name="entityId"][value=""]'),
  });
  await expect(loanForm.locator('[name="termMonths"], [name="graceMonths"], [name="annualRate"], [name="paymentAccountId"]')).toHaveCount(0);
  await loanForm.locator('[name="name"]').fill("생활 대출");
  await loanForm.locator('[name="openingPrincipalKrw"]').fill("12000000");
  await loanForm.getByRole("button", { name: "대출 저장" }).click();
  snapshot = await fixtureSnapshot(request);
  const loan = snapshot.financeState.loans[0];
  expect(snapshot.financeState.loanPayments).toHaveLength(0);
  expect(loan).toMatchObject({ name: "생활 대출", openingPrincipalKrw: 12_000_000 });
  expect(Object.hasOwn(loan, "paymentAccountId")).toBe(false);

  const loanEdit = page.locator(`[data-finance-edit-loan="${loan.id}"]`);
  await loanEdit.locator("summary").click();
  await loanEdit.locator('[name="name"]').fill("수정한 생활 대출");
  await loanEdit.getByRole("button", { name: "대출 수정 저장" }).click();
  await expect.poll(async () => (await fixtureSnapshot(request)).financeState.loans[0].name).toBe("수정한 생활 대출");

  const today = await page.evaluate(() => {
    const now = new Date();
    return {
      day: String(now.getDate()),
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    };
  });
  await page.locator('.finance-tabs [data-finance-tab="fixed"]').click();
  const fixedForm = page.locator('form[data-form="finance-recurring-rule"]').filter({
    has: page.locator('input[name="entityId"][value=""]'),
  });
  await fixedForm.locator('[name="name"]').fill("자동 월세");
  await fixedForm.locator('[name="amountEstimateKrw"]').fill("600000");
  await fixedForm.locator('[name="dueDay"]').fill(today.day);
  await fixedForm.locator('select[name="accountId"]').selectOption(accountId);
  const creationControl = fixedForm.locator('select[name="creationMode"]').locator("xpath=..");
  await creationControl.locator("[data-finance-select-trigger]").click();
  await creationControl.getByRole("option", { name: "자동 생성" }).click();
  await fixedForm.getByRole("button", { name: "고정비 저장" }).click();
  await expect.poll(async () => {
    const state = (await fixtureSnapshot(request)).financeState;
    return state.entries.filter((entry) => entry.recurringRuleId).length;
  }).toBe(1);

  const rule = (await fixtureSnapshot(request)).financeState.recurringRules[0];
  const ruleEdit = page.locator(`[data-finance-edit-recurring-rule="${rule.id}"]`);
  await ruleEdit.locator("summary").click();
  await ruleEdit.locator('[name="name"]').fill("수정한 자동 월세");
  await ruleEdit.getByRole("button", { name: "고정비 수정 저장" }).click();
  await page.reload();
  await expect(page.locator('[data-finance-screen="dashboard"]')).toBeVisible();
  await expect.poll(async () => {
    const state = (await fixtureSnapshot(request)).financeState;
    return state.entries.filter((entry) => entry.recurringRuleId === rule.id && entry.periodKey === today.month).length;
  }).toBe(1);

  await page.locator('.finance-tabs [data-finance-tab="fixed"]').click();
  const paymentForm = page.locator('form[data-form="finance-fixed-cost-payment"]').first();
  await paymentForm.locator("xpath=..").locator("summary").click();
  await paymentForm.getByRole("button", { name: "실제 출금 확인" }).click();
  await expect.poll(async () => {
    const state = (await fixtureSnapshot(request)).financeState;
    const settlement = state.settlements.find((item) => item.targetType === "entry" && item.status === "paid");
    const movement = state.movements.find((item) => item.id === settlement?.movementId);
    return movement && { kind: movement.kind, fromAccountId: movement.fromAccountId, amountKrw: movement.amountKrw };
  }).toEqual({ kind: "external", fromAccountId: accountId, amountKrw: 600_000 });

  await page.locator('.finance-tabs [data-finance-tab="accounts"]').click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(`[data-finance-loan="${loan.id}"] [data-finance-delete-loan]`).click();
  await expect.poll(async () => (await fixtureSnapshot(request)).financeState.loans.length).toBe(0);
});

test("credit-card workspace stores starting totals and installments, then pays without another expense", async ({ page, request }) => {
  await createAccount(page, request);
  await createCreditCard(page, request, { dueDay: "14" });
  const initial = await fixtureSnapshot(request);
  const accountId = initial.financeState.accounts[0].id;

  await page.locator('.finance-tabs [data-finance-tab="cards"]').click();
  const card = page.locator("[data-finance-card]").first();
  await expect(card).toContainText("매월 14일 납부");
  const totalForm = card.locator('form[data-form="finance-card-usage-total"]');
  await totalForm.locator("xpath=..").locator("summary").click();
  await totalForm.locator('[name="amountKrw"]').fill("2000000");
  await totalForm.getByRole("button", { name: "시작 사용액 저장" }).click();

  await page.locator('.finance-tabs [data-finance-tab="entries"]').click();
  await page.getByText("지출", { exact: true }).click();
  const expenseForm = page.locator('form[data-form="finance-expense"]');
  const cardId = (await fixtureSnapshot(request)).financeState.paymentMethods[0].id;
  await expenseForm.locator('[name="title"]').fill("추가 생활비");
  await expenseForm.locator('[name="amountKrw"]').fill("100000");
  await expenseForm.locator('select[name="paymentMethodId"]').selectOption(cardId);
  await expenseForm.getByRole("button", { name: "쓴 기록 저장" }).click();

  await page.locator('.finance-tabs [data-finance-tab="cards"]').click();
  await expect(page.locator("[data-finance-card]").first()).toContainText("₩2,100,000");
  const installmentForm = page.locator('form[data-form="finance-card-installment"]');
  await installmentForm.locator("xpath=..").locator("summary").click();
  await installmentForm.locator('[name="label"]').fill("기존 노트북");
  await installmentForm.locator('[name="totalAmountKrw"]').fill("600000");
  await installmentForm.locator('[name="installmentCount"]').fill("3");
  await installmentForm.getByRole("button", { name: "할부 일정 저장" }).click();

  await expect.poll(async () => {
    const state = (await fixtureSnapshot(request)).financeState;
    return {
      entries: state.entries.length,
      installments: state.cardStatements.filter((item) => item.source === "opening_installment").map((item) => item.statementAmountKrw),
    };
  }).toEqual({ entries: 2, installments: [200_000, 200_000, 200_000] });

  const beforePay = await fixtureSnapshot(request);
  const entriesBefore = beforePay.financeState.entries.length;
  const movementsBefore = beforePay.financeState.movements.length;
  const cardPaymentForm = page.locator('form[data-form="finance-card-payment"]').first();
  await cardPaymentForm.locator("xpath=..").locator("summary").click();
  await cardPaymentForm.getByRole("button", { name: "전액 출금 확인" }).click();
  await expect.poll(async () => {
    const state = (await fixtureSnapshot(request)).financeState;
    const movement = state.movements.find((item) => item.kind === "card_payment");
    return {
      entries: state.entries.length,
      movements: state.movements.length,
      amountKrw: movement?.amountKrw,
      fromAccountId: movement?.fromAccountId,
    };
  }).toEqual({
    entries: entriesBefore,
    movements: movementsBefore + 1,
    amountKrw: 200_000,
    fromAccountId: accountId,
  });
});

test("statistics calendar follows occurrence dates and keeps finance headings concise", async ({ page }) => {
  const seeded = await page.evaluate(async (state) => {
    const currentResponse = await fetch("/api/finance/state");
    const current = await currentResponse.json();
    const response = await fetch("/api/finance/state", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": `"finance-state-${current.revision}"`,
      },
      body: JSON.stringify({ state, baseRevision: current.revision }),
    });
    return { ok: response.ok, status: response.status, body: await response.json() };
  }, {
    schemaVersion: 1,
    currency: "KRW",
    accounts: [{
      id: "account-calendar",
      name: "달력 계좌",
      type: "bank",
      openingBalanceKrw: 1_000_000,
      openingOn: "2026-01-01",
    }],
    paymentMethods: [{
      id: "card-calendar",
      name: "달력 카드",
      type: "credit_card",
      paymentAccountId: "account-calendar",
      cycleEndDay: 31,
      dueDay: 14,
      dueMonthOffset: 1,
    }],
    entries: [
      {
        id: "entry-expense-calendar",
        kind: "expense",
        title: "식비",
        amountKrw: 12_000,
        occurredOn: "2026-07-04",
        recognitionMonth: "2026-07",
        category: "식비",
        status: "confirmed",
      },
      {
        id: "entry-refund-calendar",
        kind: "refund",
        title: "환불",
        amountKrw: 2_000,
        occurredOn: "2026-07-05",
        recognitionMonth: "2026-07",
        originalEntryId: "entry-fixed-calendar",
        status: "confirmed",
      },
      {
        id: "entry-income-calendar",
        kind: "income",
        title: "수입",
        amountKrw: 100_000,
        occurredOn: "2026-07-06",
        recognitionMonth: "2026-07",
        status: "confirmed",
      },
      {
        id: "entry-draft-calendar",
        kind: "expense",
        title: "미확정 소비",
        amountKrw: 7_000,
        occurredOn: "2026-07-06",
        recognitionMonth: "2026-07",
        status: "draft",
      },
      {
        id: "entry-fixed-calendar",
        kind: "expense",
        title: "월세",
        amountKrw: 600_000,
        occurredOn: "2026-07-07",
        recognitionMonth: "2026-07",
        category: "고정비",
        recurringRuleId: "rule-fixed-calendar",
        periodKey: "2026-07",
        status: "confirmed",
      },
      {
        id: "entry-boundary-calendar",
        kind: "expense",
        title: "경계 소비",
        amountKrw: 3_000,
        occurredOn: "2026-07-31",
        recognitionMonth: "2026-08",
        status: "confirmed",
      },
      {
        id: "entry-short-calendar",
        kind: "expense",
        title: "물",
        amountKrw: 1_000,
        occurredOn: "2026-08-01",
        recognitionMonth: "2026-08",
        status: "confirmed",
      },
    ],
    movements: [
      {
        id: "movement-card-calendar",
        kind: "card_payment",
        amountKrw: 99_000,
        postedOn: "2026-07-08",
        fromAccountId: "account-calendar",
        counterpartyType: "card",
        counterpartyId: "card-calendar",
        status: "confirmed",
      },
      {
        id: "movement-external-calendar",
        kind: "external",
        amountKrw: 8_000,
        postedOn: "2026-07-09",
        fromAccountId: "account-calendar",
        status: "confirmed",
      },
    ],
    settlements: [],
    cardStatements: [],
    loans: [],
    loanPayments: [],
    recurringRules: [{
      id: "rule-fixed-calendar",
      kind: "fixed_expense",
      name: "월세",
      amountEstimateKrw: 600_000,
      creationMode: "manual",
      dueDay: 7,
      accountId: "account-calendar",
      activeFrom: "2026-01-01",
      status: "active",
    }],
    balanceChecks: [],
  });
  expect(seeded, JSON.stringify(seeded.body)).toMatchObject({ ok: true, status: 200 });

  await page.reload();
  await expect(page.locator('[data-finance-screen="dashboard"]')).toBeVisible();
  const monthPicker = page.locator(".finance-month-control [data-finance-select]");
  const monthLabel = monthPicker.locator("[data-finance-select-value]");
  await monthPicker.locator("[data-finance-select-trigger]").click();
  await monthPicker.locator('[data-finance-select-option="2026-07"]').click();
  await expect(monthLabel).toHaveText("2026년 7월");

  const tabContract = [
    ["overview", "대시보드"],
    ["entries", "수입 지출 관리"],
    ["accounts", "계좌"],
    ["cards", "신용카드"],
    ["fixed", "고정비"],
    ["stats", "통계"],
  ];
  const tabs = page.locator(".finance-tabs [data-finance-tab]");
  await expect(tabs).toHaveCount(6);
  await expect(tabs).toHaveText(tabContract.map(([, label]) => label));
  expect(await tabs.evaluateAll((items) => items.map((item) => item.dataset.financeTab))).toEqual(tabContract.map(([key]) => key));
  await expect(page.locator('.finance-tabs [data-finance-tab="schedule"], .finance-tabs [data-finance-tab="manage"]')).toHaveCount(0);

  for (const [tab] of tabContract) {
    await page.locator(`.finance-tabs [data-finance-tab="${tab}"]`).click();
    await expect(page.locator("[data-finance-tab-panel]")).toHaveAttribute("data-finance-tab-panel", tab);
  }
  await expect(page.locator("[data-finance-tab-panel]")).not.toHaveClass(/is-entering/);

  const calendar = page.locator("[data-finance-consumption-calendar]");
  const basisGrid = page.locator(".finance-basis-grid");
  const [calendarBox, basisGridBox] = await Promise.all([calendar.boundingBox(), basisGrid.boundingBox()]);
  expect(calendarBox).not.toBeNull();
  expect(basisGridBox).not.toBeNull();
  expect(calendarBox.x).toBeLessThan(basisGridBox.x);
  expect(calendarBox.x + calendarBox.width).toBeGreaterThan(basisGridBox.x + basisGridBox.width);

  await calendar.hover();
  await page.waitForTimeout(300);
  const calendarHoverBox = await calendar.boundingBox();
  expect(calendarHoverBox).not.toBeNull();
  expect(Math.abs(calendarHoverBox.x - calendarBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(calendarHoverBox.width - calendarBox.width)).toBeLessThanOrEqual(1);

  const basisCard = page.locator(".finance-basis-card").first();
  await basisCard.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  await page.waitForTimeout(300);
  const basisCardBox = await basisCard.boundingBox();
  expect(basisCardBox).not.toBeNull();
  await basisCard.hover();
  await expect.poll(async () => {
    const hovered = await basisCard.boundingBox();
    return hovered && {
      expandsLeft: hovered.x < basisCardBox.x - 1,
      expandsRight: hovered.x + hovered.width > basisCardBox.x + basisCardBox.width + 1,
    };
  }).toEqual({ expandsLeft: true, expandsRight: true });

  await expect(calendar.locator('[data-finance-consumption-date="2026-07-04"] [data-finance-consumption-entry="entry-expense-calendar"]')).toContainText("식비");
  const refundEntry = calendar.locator('[data-finance-consumption-date="2026-07-05"] [data-finance-consumption-entry="entry-refund-calendar"]');
  await expect(refundEntry).toContainText("환불");
  await expect(refundEntry).toContainText(/[−-]₩2,000/);
  await expect(refundEntry).toHaveClass(/is-fixed/);
  await expect(calendar.locator('[data-finance-consumption-entry="entry-income-calendar"]')).toHaveCount(0);
  await expect(calendar.locator('[data-finance-consumption-entry="entry-draft-calendar"]')).toHaveCount(0);
  await expect(calendar.locator('[data-finance-consumption-entry="entry-fixed-calendar"]')).toHaveClass(/is-fixed/);
  await expect(calendar.locator('[data-finance-consumption-date="2026-07-31"] [data-finance-consumption-entry="entry-boundary-calendar"]')).toContainText("경계 소비");
  await expect(calendar.locator('[data-finance-consumption-entry="movement-card-calendar"]')).toHaveCount(0);
  await expect(calendar.locator('[data-finance-consumption-entry="movement-external-calendar"]')).toHaveCount(0);
  await expect(calendar).not.toContainText("카드대금 출금");
  await expect(calendar.locator("[data-finance-consumption-entry]")).toHaveCount(4);

  await calendar.locator('[data-finance-month-shift="1"]').click();
  await expect(monthLabel).toHaveText("2026년 8월");
  const augustCalendar = page.locator("[data-finance-consumption-calendar]");
  await expect(augustCalendar.locator('[data-finance-consumption-entry="entry-boundary-calendar"]')).toHaveCount(0);
  const shortDay = augustCalendar.locator('[data-finance-consumption-date="2026-08-01"]');
  await expect(shortDay.locator("[data-finance-consumption-entry]")).toHaveCount(1);
  await expect(shortDay.locator('[data-finance-consumption-entry="entry-short-calendar"]')).toContainText("물");

  await augustCalendar.locator('[data-finance-month-shift="-1"]').click();
  await expect(monthLabel).toHaveText("2026년 7월");
  await expect(page.locator('[data-finance-consumption-entry="entry-expense-calendar"]')).toContainText("식비");
});
