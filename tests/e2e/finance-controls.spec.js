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
  await expect(form.locator('[name="openingBalanceKrw"]')).toHaveValue(Number(balance).toLocaleString("ko-KR"));
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
  await expect(accountEdit.locator("summary")).toHaveAttribute("aria-label", "생활비 통장 수정");
  await expect(accountEdit.locator(".finance-edit-icon")).toHaveText("✎");
  await accountEdit.locator("summary").click();
  await accountEdit.locator('[name="name"]').fill("수정한 생활비 통장");
  await accountEdit.getByRole("button", { name: "계좌 수정 저장" }).click();
  await expect.poll(async () => (await fixtureSnapshot(request)).financeState.accounts[0].name).toBe("수정한 생활비 통장");

  await createCreditCard(page, request);
  snapshot = await fixtureSnapshot(request);
  const cardId = snapshot.financeState.paymentMethods[0].id;
  const cardEdit = page.locator(`[data-finance-edit-payment-method="${cardId}"]`);
  await expect(cardEdit.locator("summary")).toHaveAttribute("aria-label", "생활 신용카드 수정");
  await expect(cardEdit.locator(".finance-edit-icon")).toHaveText("✎");
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
  await paymentForm.getByRole("button", { name: "납부", exact: true }).click();
  await expect.poll(async () => {
    const state = (await fixtureSnapshot(request)).financeState;
    const settlement = state.settlements.find((item) => item.targetType === "entry" && item.status === "paid");
    const movement = state.movements.find((item) => item.id === settlement?.movementId);
    return movement && { kind: movement.kind, fromAccountId: movement.fromAccountId, amountKrw: movement.amountKrw };
  }).toEqual({ kind: "external", fromAccountId: accountId, amountKrw: 600_000 });

  const beforeArchive = await fixtureSnapshot(request);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "보관", exact: true }).click();
  await expect.poll(async () => (await fixtureSnapshot(request)).financeState.recurringRules[0].status).toBe("archived");
  const archived = page.locator("[data-finance-recurring-archive]");
  await expect(archived.locator("summary")).toHaveText("보관 내역 (1)");
  await archived.locator("summary").click();
  await expect(archived).toContainText("기존 납부 기록을 유지");
  await expect(archived).toContainText("수정한 자동 월세");
  const restoreButton = archived.locator('[data-finance-recurring-status="active"]');
  await expect(restoreButton).toHaveText("보관 취소");
  await restoreButton.click();
  await expect.poll(async () => (await fixtureSnapshot(request)).financeState.recurringRules[0].status).toBe("active");
  await expect.poll(async () => (await fixtureSnapshot(request)).financeState.recurringRules[0].activeFrom).toBe(`${today.month}-${today.day.padStart(2, "0")}`);
  await expect(archived.locator("summary")).toHaveText("보관 내역 (0)");
  await expect.poll(async () => {
    const state = (await fixtureSnapshot(request)).financeState;
    return { entries: state.entries.length, settlements: state.settlements.length };
  }).toEqual({ entries: beforeArchive.financeState.entries.length, settlements: beforeArchive.financeState.settlements.length });

  await page.locator('.finance-tabs [data-finance-tab="accounts"]').click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(`[data-finance-loan="${loan.id}"] [data-finance-delete-loan]`).click();
  await expect.poll(async () => (await fixtureSnapshot(request)).financeState.loans.length).toBe(0);
});

test("credit-card workspace shows current debt and pays a confirmed statement once", async ({ page, request }) => {
  const accountId = "account-card";
  const cardId = "card-hyundai";
  const planId = "plan-notebook";
  const pastMovementId = "movement-card-july";
  const existingStatement = {
    id: "statement-august-existing",
    paymentMethodId: cardId,
    paymentAccountId: accountId,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    statementOn: "2026-08-01",
    scheduledOn: "2026-08-12",
    statementAmountKrw: 60_000,
    status: "confirmed",
    items: [{
      entryId: "entry-july-existing",
      amountKrw: 60_000,
      installmentNumber: 1,
      installmentCount: 1,
    }],
  };
  const installments = [
    ["statement-installment-1", "2026-07-12", "paid", 1],
    ["statement-installment-2", "2026-08-12", "confirmed", 2],
    ["statement-installment-3", "2026-09-12", "confirmed", 3],
  ].map(([id, scheduledOn, status, installmentNumber]) => ({
    id,
    paymentMethodId: cardId,
    paymentAccountId: accountId,
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    statementOn: "2026-05-31",
    scheduledOn,
    statementAmountKrw: 200_000,
    status,
    source: "opening_installment",
    planId,
    label: "노트북",
    installmentNumber,
    installmentCount: 3,
    items: [],
  }));
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
      id: accountId,
      name: "생활비 통장",
      type: "bank",
      openingBalanceKrw: 5_000_000,
      openingOn: "2026-01-01",
    }],
    paymentMethods: [{
      id: cardId,
      name: "현대신용",
      type: "credit_card",
      paymentAccountId: accountId,
      cycleEndDay: 31,
      dueDay: 12,
      dueMonthOffset: 1,
    }],
    entries: [
      {
        id: "entry-july-existing",
        kind: "expense",
        title: "7월 기존 확정분",
        amountKrw: 60_000,
        occurredOn: "2026-07-05",
        recognitionMonth: "2026-07",
        category: "생활",
        paymentMethodId: cardId,
        status: "confirmed",
      },
      {
        id: "entry-july-expense",
        kind: "expense",
        title: "7월 일시불",
        amountKrw: 100_000,
        occurredOn: "2026-07-10",
        recognitionMonth: "2026-07",
        category: "생활",
        paymentMethodId: cardId,
        status: "confirmed",
      },
      {
        id: "entry-july-refund",
        kind: "refund",
        title: "7월 환불",
        amountKrw: 10_000,
        occurredOn: "2026-07-15",
        recognitionMonth: "2026-07",
        originalEntryId: "entry-july-expense",
        paymentMethodId: cardId,
        status: "confirmed",
      },
      {
        id: "entry-august-expense",
        kind: "expense",
        title: "8월 사용",
        amountKrw: 80_000,
        occurredOn: "2026-08-05",
        recognitionMonth: "2026-08",
        category: "생활",
        paymentMethodId: cardId,
        status: "confirmed",
      },
    ],
    movements: [{
      id: pastMovementId,
      kind: "card_payment",
      amountKrw: 200_000,
      postedOn: "2026-07-12",
      fromAccountId: accountId,
      counterpartyType: "card",
      counterpartyId: cardId,
      status: "confirmed",
    }],
    settlements: [
      {
        id: "settlement-july-existing",
        targetType: "entry",
        targetId: "entry-july-existing",
        expectedAmountKrw: 60_000,
        scheduledOn: "2026-08-12",
        status: "canceled",
      },
      {
        id: "settlement-august-existing",
        targetType: "card_statement",
        targetId: existingStatement.id,
        expectedAmountKrw: existingStatement.statementAmountKrw,
        scheduledOn: existingStatement.scheduledOn,
        status: "confirmed",
      },
      {
        id: "settlement-july-expense",
        targetType: "entry",
        targetId: "entry-july-expense",
        expectedAmountKrw: 100_000,
        scheduledOn: "2026-08-12",
        status: "estimated",
      },
      {
        id: "settlement-july-refund",
        targetType: "entry",
        targetId: "entry-july-refund",
        expectedAmountKrw: 10_000,
        scheduledOn: "2026-08-12",
        status: "estimated",
      },
      {
        id: "settlement-august-expense",
        targetType: "entry",
        targetId: "entry-august-expense",
        expectedAmountKrw: 80_000,
        scheduledOn: "2026-09-12",
        status: "estimated",
      },
      ...installments.map((statement) => ({
        id: `settlement-${statement.id}`,
        targetType: "card_statement",
        targetId: statement.id,
        expectedAmountKrw: statement.statementAmountKrw,
        scheduledOn: statement.scheduledOn,
        status: statement.status,
        ...(statement.status === "paid" ? {
          movementId: pastMovementId,
          settledAmountKrw: statement.statementAmountKrw,
        } : {}),
      })),
    ],
    cardStatements: [...installments, existingStatement],
    loans: [],
    loanPayments: [],
    recurringRules: [],
    balanceChecks: [],
  });
  expect(seeded, JSON.stringify(seeded.body)).toMatchObject({ ok: true, status: 200 });

  await page.reload();
  await expect(page.locator('[data-finance-screen="dashboard"]')).toBeVisible();
  const monthPicker = page.locator(".finance-month-control [data-finance-select]");
  await monthPicker.locator("[data-finance-select-trigger]").click();
  await monthPicker.locator('[data-finance-select-option="2026-08"]').click();
  await page.locator('.finance-tabs [data-finance-tab="cards"]').click();

  const card = page.locator(`[data-finance-card="${cardId}"]`);
  await expect(card.locator(".finance-metric .metric-label")).toHaveText(["이번달 현황", "총 사용액"]);
  await expect(card.locator(".finance-metric").filter({ hasText: "이번달 현황" }).locator(".metric-value")).toHaveText("₩80,000");
  await expect(card.locator(".finance-metric").filter({ hasText: "총 사용액" }).locator(".metric-value")).toHaveText("₩630,000");
  await expect(card.locator('form[data-form="finance-card-usage-total"], form[data-form="finance-card-installment"], form[data-form="finance-card-payment"]')).toHaveCount(0);
  await expect(card).not.toContainText(/이전 달|시작 사용액|기존 할부 일정 등록|실제 출금 확인/);

  const plan = card.locator(`[data-finance-installment-plan="${planId}"]`);
  await expect(plan).toHaveCount(1);
  await expect(plan).not.toHaveAttribute("open", "");
  await plan.locator("[data-finance-installment-toggle]").click();
  await expect(plan).toHaveAttribute("open", "");
  const installmentVisual = await plan.evaluate((element) => ({
    listBackground: getComputedStyle(element.parentElement).backgroundColor,
    planBackground: getComputedStyle(element).backgroundColor,
    rowDividers: [...element.querySelectorAll(".finance-installment-months > div")].map((row) => getComputedStyle(row).backgroundImage),
  }));
  expect(installmentVisual.listBackground).toBe("rgba(0, 0, 0, 0)");
  expect(installmentVisual.planBackground).toBe("rgba(0, 0, 0, 0)");
  expect(installmentVisual.rowDividers.slice(0, -1).every((background) => background !== "none")).toBe(true);
  expect(installmentVisual.rowDividers.at(-1)).toBe("none");
  await expect(plan.getByText("총 금액", { exact: true })).toBeVisible();
  await expect(plan).toContainText("₩600,000");
  await expect(plan.getByText("남은 금액", { exact: true })).toBeVisible();
  await expect(plan).toContainText("₩400,000");
  await expect(plan).toContainText(/1\/3[\s\S]*2026-07-12[\s\S]*₩200,000/);
  await expect(plan).toContainText(/2\/3[\s\S]*2026-08-12[\s\S]*₩200,000/);
  await expect(plan).toContainText(/3\/3[\s\S]*2026-09-12[\s\S]*₩200,000/);

  const statementForm = card.locator('form[data-form="finance-card-statement"]');
  const [workspaceBox, statementBox] = await Promise.all([
    card.locator(".finance-card-workspace-body").boundingBox(),
    statementForm.locator("xpath=..").boundingBox(),
  ]);
  expect(Math.abs(statementBox.x - workspaceBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(statementBox.width - workspaceBox.width)).toBeLessThanOrEqual(1);
  await statementForm.locator("xpath=..").locator(":scope > summary").click();
  await expect(card.locator('input[type="number"]')).toHaveCount(0);
  await expect(statementForm.locator(".finance-form-fact").filter({ hasText: "7월 일시불 이용액" }).locator("strong")).toHaveText("₩150,000");
  await expect(statementForm.locator(".finance-form-fact").filter({ hasText: "할부 총합" }).locator("strong")).toHaveText("₩200,000");
  await statementForm.locator("[data-finance-statement-adjustment-amount]").fill("10000");
  await expect(statementForm.locator("[data-finance-statement-adjustment-amount]")).toHaveValue("10,000");
  await expect(statementForm.locator(".finance-form-fact").filter({ hasText: "총 납부액" }).locator("strong")).toHaveText("₩360,000");

  const beforePay = await fixtureSnapshot(request);
  await statementForm.getByRole("button", { name: /명세서 확정/ }).click();
  await expect.poll(async () => {
    const state = (await fixtureSnapshot(request)).financeState;
    const movement = state.movements.find((item) => item.id !== pastMovementId && item.kind === "card_payment");
    const ordinaryStatements = state.cardStatements.filter((item) => (
      item.paymentMethodId === cardId
      && item.source !== "opening_installment"
      && item.scheduledOn === "2026-08-12"
    ));
    const ordinaryStatement = ordinaryStatements[0];
    const currentInstallment = state.cardStatements.find((item) => item.id === "statement-installment-2");
    const futureInstallment = state.cardStatements.find((item) => item.id === "statement-installment-3");
    const paidStatementIds = new Set([ordinaryStatement?.id, currentInstallment?.id].filter(Boolean));
    const paidSettlements = state.settlements.filter((item) => paidStatementIds.has(item.targetId));
    const directStatuses = state.settlements
      .filter((item) => ["entry-july-existing", "entry-july-expense", "entry-july-refund"].includes(item.targetId))
      .map((item) => item.status)
      .sort();
    return {
      entries: state.entries.length,
      movements: state.movements.length,
      movement: movement && {
        amountKrw: movement.amountKrw,
        postedOn: movement.postedOn,
        fromAccountId: movement.fromAccountId,
      },
      ordinaryStatement: ordinaryStatement && {
        reused: ordinaryStatement.id === existingStatement.id,
        amountKrw: ordinaryStatement.statementAmountKrw,
        status: ordinaryStatement.status,
        itemIds: ordinaryStatement.items.map((item) => item.entryId).sort(),
      },
      ordinaryStatementCount: ordinaryStatements.length,
      currentInstallmentStatus: currentInstallment?.status,
      futureInstallmentStatus: futureInstallment?.status,
      paidSettlements: paidSettlements.length,
      allPaid: paidSettlements.every((item) => item.status === "paid"),
      sameMovement: paidSettlements.every((item) => item.movementId === movement?.id),
      settledAmountKrw: paidSettlements.reduce((total, item) => total + Number(item.settledAmountKrw || 0), 0),
      directStatuses,
    };
  }).toEqual({
    entries: beforePay.financeState.entries.length,
    movements: beforePay.financeState.movements.length + 1,
    movement: { amountKrw: 360_000, postedOn: "2026-08-12", fromAccountId: accountId },
    ordinaryStatement: {
      reused: true,
      amountKrw: 160_000,
      status: "paid",
      itemIds: ["entry-july-existing", "entry-july-expense", "entry-july-refund"],
    },
    ordinaryStatementCount: 1,
    currentInstallmentStatus: "paid",
    futureInstallmentStatus: "confirmed",
    paidSettlements: 2,
    allPaid: true,
    sameMovement: true,
    settledAmountKrw: 360_000,
    directStatuses: ["canceled", "canceled", "canceled"],
  });
});

test("card usage dates drive direct and installment payment schedules", async ({ page, request }) => {
  await createAccount(page, request);
  await createCreditCard(page, request, { name: "현대신용", dueDay: "12" });
  const cardId = (await fixtureSnapshot(request)).financeState.paymentMethods[0].id;

  await page.locator('.finance-tabs [data-finance-tab="entries"]').click();
  const saveExpense = async ({ title, amount, paymentType }) => {
    const form = page.locator('form[data-form="finance-expense"]');
    await form.locator("xpath=..").locator(":scope > summary").click();
    await form.locator('[name="title"]').fill(title);
    await form.locator('[name="amountKrw"]').fill(amount);
    await form.locator('[name="occurredOn"]').evaluate((input) => {
      input.value = "2026-07-01";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await form.locator('select[name="paymentMethodId"]').selectOption(cardId);
    await expect(form.locator("[data-finance-expense-card-fields]")).not.toHaveAttribute("disabled", "");
    await form.locator('select[name="cardPaymentType"]').selectOption(paymentType);
    await form.getByRole("button", { name: "쓴 기록 저장" }).click();
    await expect.poll(async () => (await fixtureSnapshot(request)).financeState.entries.find((entry) => entry.title === title)?.id).toBeTruthy();
    return (await fixtureSnapshot(request)).financeState.entries.find((entry) => entry.title === title);
  };

  const singleEntry = await saveExpense({ title: "7월 일시불", amount: "50000", paymentType: "single" });
  let state = (await fixtureSnapshot(request)).financeState;
  expect(singleEntry).toMatchObject({
    occurredOn: "2026-07-01",
    recognitionMonth: "2026-07",
    cardPaymentType: "single",
  });
  expect(state.settlements.filter((item) => item.targetType === "entry" && item.targetId === singleEntry.id)).toEqual([
    expect.objectContaining({ expectedAmountKrw: 50_000, scheduledOn: "2026-08-12", status: "estimated" }),
  ]);

  const installmentEntry = await saveExpense({ title: "7월 할부", amount: "100000", paymentType: "installment" });
  state = (await fixtureSnapshot(request)).financeState;
  expect(installmentEntry).toMatchObject({
    amountKrw: 100_000,
    occurredOn: "2026-07-01",
    recognitionMonth: "2026-07",
    cardPaymentType: "installment",
  });
  expect(state.settlements.filter((item) => item.targetType === "entry" && item.targetId === installmentEntry.id)).toHaveLength(0);

  await page.locator('.finance-tabs [data-finance-tab="cards"]').click();
  const setupForm = page.locator(`[data-finance-card="${cardId}"] form[data-form="finance-card-installment-setup"]`);
  await setupForm.locator("xpath=..").locator(":scope > summary").click();
  await expect(setupForm.locator('[name="entryId"]')).toHaveValue(installmentEntry.id);
  await setupForm.locator('[name="installmentCount"]').fill("3");
  const paymentAmounts = setupForm.locator('[name="paymentAmountKrw"]');
  await expect(paymentAmounts).toHaveCount(3);
  for (const [index, [amount, formatted]] of [["41000", "41,000"], ["35500", "35,500"], ["25000", "25,000"]].entries()) {
    await paymentAmounts.nth(index).fill(amount);
    await expect(paymentAmounts.nth(index)).toHaveValue(formatted);
  }
  await expect(setupForm.locator("[data-finance-installment-principal]")).toHaveText("₩100,000");
  await expect(setupForm.locator("[data-finance-installment-fee]")).toHaveText("₩1,500");
  await expect(setupForm.locator("[data-finance-installment-total]")).toHaveText("₩101,500");
  await setupForm.getByRole("button", { name: "할부 일정 저장" }).click();

  await expect.poll(async () => {
    const current = (await fixtureSnapshot(request)).financeState;
    const statements = current.cardStatements
      .filter((item) => item.source === "opening_installment" && item.purchaseEntryId === installmentEntry.id)
      .sort((left, right) => left.installmentNumber - right.installmentNumber);
    const statementSettlements = statements.map((statement) => current.settlements.find((item) => (
      item.targetType === "card_statement" && item.targetId === statement.id
    )));
    return {
      directSettlements: current.settlements.filter((item) => item.targetType === "entry" && item.targetId === installmentEntry.id).length,
      planCount: new Set(statements.map((item) => item.planId)).size,
      rows: statements.map((item) => ({
        installmentNumber: item.installmentNumber,
        installmentCount: item.installmentCount,
        scheduledOn: item.scheduledOn,
        statementAmountKrw: item.statementAmountKrw,
        purchaseEntryId: item.purchaseEntryId,
      })),
      totalKrw: statements.reduce((total, item) => total + item.statementAmountKrw, 0),
      principals: statements.filter((item) => Object.hasOwn(item, "planPrincipalKrw")).map((item) => item.planPrincipalKrw),
      settlementCount: statementSettlements.filter(Boolean).length,
      settlementsMatch: statementSettlements.every((settlement, index) => (
        settlement?.status === "confirmed"
        && settlement.scheduledOn === statements[index].scheduledOn
        && settlement.expectedAmountKrw === statements[index].statementAmountKrw
      )),
    };
  }).toEqual({
    directSettlements: 0,
    planCount: 1,
    rows: [
      { installmentNumber: 1, installmentCount: 3, scheduledOn: "2026-08-12", statementAmountKrw: 41_000, purchaseEntryId: installmentEntry.id },
      { installmentNumber: 2, installmentCount: 3, scheduledOn: "2026-09-12", statementAmountKrw: 35_500, purchaseEntryId: installmentEntry.id },
      { installmentNumber: 3, installmentCount: 3, scheduledOn: "2026-10-12", statementAmountKrw: 25_000, purchaseEntryId: installmentEntry.id },
    ],
    totalKrw: 101_500,
    principals: [100_000],
    settlementCount: 3,
    settlementsMatch: true,
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
  }).toEqual({ expandsLeft: false, expandsRight: false });

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
