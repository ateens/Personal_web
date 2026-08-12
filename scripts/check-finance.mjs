import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "../finance-model.js";
import {
  createEmptyFinanceState,
  createFinanceSession,
  financePasswordHashConfigured,
  financeSessionSecretConfigured,
  hashFinancePassword,
  validateFinanceState,
  verifyFinancePassword,
  verifyFinanceSession,
} from "../server/finance.js";

const {
  accountBalances,
  dateForMonthDay,
  financeMonthSummary,
  loanSchedule,
  loanPrincipalKrw,
  shiftMonthKey,
  splitKrw,
  upcomingSettlements,
} = globalThis.SYGMAFinanceModel;

const [financeAppSource, financeStylesSource] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);
assert.match(financeAppSource, /data-finance-tab-panel/, "finance tabs need an isolated transition target");
assert.match(financeStylesSource, /\.finance-tab-panel\.is-entering\s*\{[^}]*animation:\s*view-in/s, "finance tab motion must reuse SYGMA view-in");
assert.doesNotMatch(financeAppSource, /비용 기준 월|수입 기준 월|환불을 반영할 월/, "recognition months must not be user-entered");
assert.match(financeAppSource, /recognitionMonth:\s*occurredOn\.slice\(0,\s*7\)/, "entry recognition month must follow its occurrence date");

assert.deepEqual(splitKrw(1_000_001, 3), [333_334, 333_334, 333_333]);
const zeroRateLoanSchedule = loanSchedule({
  openingPrincipalKrw: 12_000_000,
  termMonths: 24,
  graceMonths: 36,
  annualRate: 0,
  openedOn: "2026-01-31",
});
assert.equal(zeroRateLoanSchedule.length, 60);
assert.equal(zeroRateLoanSchedule.slice(0, 36).every((row) => row.amountKrw === 0), true);
assert.equal(zeroRateLoanSchedule.reduce((total, row) => total + row.principalKrw, 0), 12_000_000);
assert.equal(zeroRateLoanSchedule.at(-1).dueOn, "2030-12-31");

const interestLoanSchedule = loanSchedule({
  openingPrincipalKrw: 12_000_000,
  termMonths: 24,
  graceMonths: 6,
  annualRate: 6,
  openedOn: "2026-01-31",
});
assert.equal(interestLoanSchedule.length, 30);
assert.deepEqual(
  interestLoanSchedule[0],
  {
    sequence: 1,
    dueOn: "2026-01-31",
    recognitionMonth: "2026-01",
    phase: "grace",
    principalKrw: 0,
    interestKrw: 60_000,
    amountKrw: 60_000,
  },
);
assert.equal(interestLoanSchedule[6].amountKrw, 531_847);
assert.deepEqual(
  {
    principalKrw: interestLoanSchedule.at(-1).principalKrw,
    interestKrw: interestLoanSchedule.at(-1).interestKrw,
    amountKrw: interestLoanSchedule.at(-1).amountKrw,
  },
  { principalKrw: 529_212, interestKrw: 2_646, amountKrw: 531_858 },
);
assert.equal(interestLoanSchedule.reduce((total, row) => total + row.principalKrw, 0), 12_000_000);
assert.equal(interestLoanSchedule.reduce((total, row) => total + row.interestKrw, 0), 1_124_339);

const password = "correct horse battery staple";
const passwordHash = await hashFinancePassword(password, Buffer.alloc(16, 7));
assert.equal(financePasswordHashConfigured(passwordHash), true);
assert.equal(financePasswordHashConfigured("scrypt-v1$broken"), false);
assert.equal(await verifyFinancePassword(password, passwordHash), true);
assert.equal(await verifyFinancePassword("wrong password", passwordHash), false);

const sessionSecret = Buffer.alloc(32, 9).toString("base64url");
const sessionNow = Date.UTC(2026, 6, 24, 3, 0, 0);
assert.equal(financeSessionSecretConfigured(sessionSecret), true);
assert.equal(financeSessionSecretConfigured("short"), false);
const session = createFinanceSession(sessionSecret, { now: sessionNow, ttlSeconds: 600 });
assert.ok(verifyFinanceSession(session, sessionSecret, { now: sessionNow + 599_000 }));
assert.equal(verifyFinanceSession(session, sessionSecret, { now: sessionNow + 600_000 }), null);
const [sessionPayload, sessionMac] = session.split(".");
const tamperedSession = `${sessionPayload}.${sessionMac.startsWith("x") ? "y" : "x"}${sessionMac.slice(1)}`;
assert.equal(verifyFinanceSession(tamperedSession, sessionSecret, { now: sessionNow }), null);

const emptyState = createEmptyFinanceState();
assert.deepEqual(validateFinanceState(emptyState), []);

const validState = {
  ...createEmptyFinanceState(),
  accounts: [
    {
      id: "account-main",
      name: "생활비 통장",
      type: "bank",
      openingBalanceKrw: 1_000_000,
      openingOn: "2026-01-01",
    },
    {
      id: "account-buffer",
      name: "예비 통장",
      type: "bank",
      openingBalanceKrw: 0,
      openingOn: "2026-01-01",
    },
  ],
  paymentMethods: [
    {
      id: "card-main",
      name: "생활 카드",
      type: "credit_card",
      paymentAccountId: "account-main",
    },
  ],
  entries: [
    {
      id: "entry-card-use",
      kind: "expense",
      title: "생활용품",
      amountKrw: 120_000,
      occurredOn: "2026-01-31",
      recognitionMonth: "2026-01",
      paymentMethodId: "card-main",
      status: "confirmed",
    },
  ],
  movements: [
    {
      id: "movement-card-payment",
      kind: "card_payment",
      amountKrw: 120_000,
      postedOn: "2026-03-05",
      fromAccountId: "account-main",
      counterpartyType: "card",
      counterpartyId: "card-main",
      status: "confirmed",
    },
    {
      id: "movement-loan-payment",
      kind: "loan_payment",
      amountKrw: 550_000,
      postedOn: "2026-03-25",
      fromAccountId: "account-main",
      status: "confirmed",
    },
  ],
  cardStatements: [
    {
      id: "statement-card-main",
      paymentMethodId: "card-main",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      statementOn: "2026-02-10",
      scheduledOn: "2026-03-05",
      statementAmountKrw: 120_000,
      status: "paid",
      items: [
        {
          entryId: "entry-card-use",
          amountKrw: 120_000,
          installmentNumber: 1,
          installmentCount: 1,
        },
      ],
    },
  ],
  settlements: [
    {
      id: "settlement-card-main",
      targetType: "card_statement",
      targetId: "statement-card-main",
      expectedAmountKrw: 120_000,
      scheduledOn: "2026-03-05",
      movementId: "movement-card-payment",
      settledAmountKrw: 120_000,
      status: "paid",
    },
    {
      id: "settlement-loan-march",
      targetType: "loan_payment",
      targetId: "loan-payment-march",
      expectedAmountKrw: 550_000,
      scheduledOn: "2026-03-25",
      movementId: "movement-loan-payment",
      settledAmountKrw: 550_000,
      status: "paid",
    },
  ],
  loans: [
    {
      id: "loan-home",
      name: "주택 대출",
      openedOn: "2025-01-25",
      openingPrincipalKrw: 100_000_000,
      termMonths: 360,
      monthlyPaymentKrw: 550_000,
      paymentAccountId: "account-main",
      annualRate: 3.8,
    },
  ],
  loanPayments: [
    {
      id: "loan-payment-march",
      loanId: "loan-home",
      dueOn: "2026-03-25",
      paidOn: "2026-03-25",
      recognitionMonth: "2026-03",
      principalKrw: 500_000,
      interestKrw: 50_000,
      feeKrw: 0,
      status: "paid",
      movementId: "movement-loan-payment",
    },
  ],
  recurringRules: [
    {
      id: "rule-electricity",
      kind: "fixed_expense",
      name: "전기요금",
      amountEstimateKrw: 80_000,
      dueDay: 15,
      accountId: "account-main",
      activeFrom: "2026-01-01",
      status: "active",
    },
  ],
  balanceChecks: [
    {
      id: "balance-check-main",
      accountId: "account-main",
      checkedOn: "2026-03-31",
      calculatedBalanceKrw: 330_000,
      actualBalanceKrw: 330_000,
    },
  ],
};
assert.deepEqual(validateFinanceState(validState), []);

const accountWithLastFour = structuredClone(validState);
accountWithLastFour.accounts[0].lastFour = "1234";
assert.ok(validateFinanceState(accountWithLastFour).some((issue) => issue.path === "state.accounts[0].lastFour" && issue.code === "unsupported_property"));

const paymentMethodWithLastFour = structuredClone(validState);
paymentMethodWithLastFour.paymentMethods[0].lastFour = "5678";
assert.ok(validateFinanceState(paymentMethodWithLastFour).some((issue) => issue.path === "state.paymentMethods[0].lastFour" && issue.code === "unsupported_property"));

const recurringRuleWithRecognitionOffset = structuredClone(validState);
recurringRuleWithRecognitionOffset.recurringRules[0].recognitionMonthOffset = -1;
assert.ok(validateFinanceState(recurringRuleWithRecognitionOffset).some((issue) => issue.path === "state.recurringRules[0].recognitionMonthOffset" && issue.code === "unsupported_property"));

const invalidLoanTerm = structuredClone(validState);
invalidLoanTerm.loans[0].termMonths = 0;
assert.ok(validateFinanceState(invalidLoanTerm).some((issue) => issue.path === "state.loans[0].termMonths" && issue.code === "bounded_integer_required"));

const invalidMonthlyPayment = structuredClone(validState);
invalidMonthlyPayment.loans[0].monthlyPaymentKrw = 0;
assert.ok(validateFinanceState(invalidMonthlyPayment).some((issue) => issue.path === "state.loans[0].monthlyPaymentKrw" && issue.code === "positive_money_required"));

const generatedLoanState = structuredClone(validState);
generatedLoanState.loans[0].scheduleMode = "auto";
generatedLoanState.loans[0].graceMonths = 6;
delete generatedLoanState.loans[0].monthlyPaymentKrw;
assert.deepEqual(validateFinanceState(generatedLoanState), []);

const invalidGeneratedLoanMode = structuredClone(generatedLoanState);
invalidGeneratedLoanMode.loans[0].scheduleMode = "variable";
assert.ok(validateFinanceState(invalidGeneratedLoanMode).some((issue) => issue.path === "state.loans[0].scheduleMode" && issue.code === "invalid_value"));

const invalidGeneratedLoanTerm = structuredClone(generatedLoanState);
invalidGeneratedLoanTerm.loans[0].graceMonths = 900;
assert.ok(validateFinanceState(invalidGeneratedLoanTerm).some((issue) => issue.path === "state.loans[0].graceMonths" && issue.code === "combined_term_too_long"));

const missingGeneratedLoanRate = structuredClone(generatedLoanState);
delete missingGeneratedLoanRate.loans[0].annualRate;
assert.ok(validateFinanceState(missingGeneratedLoanRate).some((issue) => issue.path === "state.loans[0].annualRate" && issue.code === "rate_required"));

const generatedLoanSettlementMismatch = structuredClone(generatedLoanState);
generatedLoanSettlementMismatch.settlements.find((item) => item.targetType === "loan_payment").expectedAmountKrw -= 1;
assert.ok(validateFinanceState(generatedLoanSettlementMismatch).some((issue) => issue.code === "loan_settlement_mismatch"));

const settlementMismatch = structuredClone(validState);
settlementMismatch.settlements[0].settledAmountKrw = 119_999;
assert.ok(validateFinanceState(settlementMismatch).some((issue) => issue.code === "settlement_total_mismatch"));

const paidWithoutMovement = structuredClone(validState);
paidWithoutMovement.settlements[0].movementId = "";
assert.ok(validateFinanceState(paidWithoutMovement).some((issue) => issue.code === "movement_required"));

const selfTransfer = structuredClone(validState);
selfTransfer.movements.push({
  id: "movement-self",
  kind: "transfer",
  amountKrw: 10_000,
  postedOn: "2026-07-24",
  fromAccountId: "account-main",
  toAccountId: "account-main",
  status: "confirmed",
});
assert.ok(validateFinanceState(selfTransfer).some((issue) => issue.code === "self_transfer"));

const duplicateId = structuredClone(validState);
duplicateId.accounts[1].id = "account-main";
assert.ok(validateFinanceState(duplicateId).some((issue) => issue.code === "duplicate_id"));

const invalidDate = structuredClone(validState);
invalidDate.entries[0].occurredOn = "2026-02-30";
assert.ok(validateFinanceState(invalidDate).some((issue) => issue.code === "invalid_date"));

const unsafeMoney = structuredClone(validState);
unsafeMoney.entries[0].amountKrw = Number.MAX_SAFE_INTEGER + 1;
assert.ok(validateFinanceState(unsafeMoney).some((issue) => issue.code === "positive_money_required"));

const loanPaidByTransfer = structuredClone(validState);
loanPaidByTransfer.movements.find((movement) => movement.id === "movement-loan-payment").kind = "transfer";
assert.ok(validateFinanceState(loanPaidByTransfer).some((issue) => issue.code === "movement_kind_mismatch"));

const nonCreditStatement = structuredClone(validState);
nonCreditStatement.paymentMethods[0].type = "debit_card";
assert.ok(validateFinanceState(nonCreditStatement).some((issue) => issue.code === "credit_card_required"));

const selfRefund = structuredClone(validState);
selfRefund.entries.push({
  id: "entry-self-refund",
  kind: "refund",
  title: "잘못된 자기 참조 환불",
  amountKrw: 1_000,
  occurredOn: "2026-02-01",
  recognitionMonth: "2026-02",
  paymentMethodId: "card-main",
  originalEntryId: "entry-self-refund",
  status: "confirmed",
});
assert.ok(validateFinanceState(selfRefund).some((issue) => issue.code === "self_reference"));

const canceledWithMovement = structuredClone(validState);
canceledWithMovement.settlements[0].status = "canceled";
assert.ok(validateFinanceState(canceledWithMovement).some((issue) => issue.code === "movement_not_allowed"));

const duplicateInstallment = structuredClone(validState);
duplicateInstallment.cardStatements[0].items.push(structuredClone(duplicateInstallment.cardStatements[0].items[0]));
assert.ok(validateFinanceState(duplicateInstallment).some((issue) => issue.code === "duplicate_installment"));

const phaseOneState = {
  ...createEmptyFinanceState(),
  accounts: [
    {
      id: "account-a",
      name: "생활비 통장",
      type: "bank",
      openingBalanceKrw: 1_000_000,
      openingOn: "2026-01-01",
    },
    {
      id: "account-b",
      name: "예비 통장",
      type: "bank",
      openingBalanceKrw: 200_000,
      openingOn: "2026-01-01",
    },
  ],
  paymentMethods: [
    {
      id: "debit-a",
      name: "생활 체크카드",
      type: "debit_card",
      linkedAccountId: "account-a",
    },
    {
      id: "credit-a",
      name: "생활 신용카드",
      type: "credit_card",
      paymentAccountId: "account-a",
      cycleEndDay: 31,
      dueDay: 5,
      dueMonthOffset: 1,
    },
  ],
  entries: [
    {
      id: "entry-debit",
      kind: "expense",
      title: "장보기",
      amountKrw: 100_000,
      occurredOn: "2026-01-10",
      recognitionMonth: "2026-01",
      paymentMethodId: "debit-a",
      status: "confirmed",
    },
    {
      id: "entry-credit",
      kind: "expense",
      title: "생활용품",
      amountKrw: 200_000,
      occurredOn: "2026-01-20",
      recognitionMonth: "2026-01",
      paymentMethodId: "credit-a",
      status: "confirmed",
    },
    {
      id: "entry-refund",
      kind: "refund",
      title: "생활용품 환불",
      amountKrw: 30_000,
      occurredOn: "2026-01-25",
      recognitionMonth: "2026-01",
      paymentMethodId: "credit-a",
      originalEntryId: "entry-credit",
      status: "confirmed",
    },
    {
      id: "entry-income",
      kind: "income",
      title: "급여",
      amountKrw: 500_000,
      occurredOn: "2026-01-15",
      recognitionMonth: "2026-01",
      status: "confirmed",
    },
  ],
  movements: [
    {
      id: "movement-debit",
      kind: "external",
      amountKrw: 100_000,
      postedOn: "2026-01-10",
      fromAccountId: "account-a",
      status: "confirmed",
    },
    {
      id: "movement-income",
      kind: "external",
      amountKrw: 500_000,
      postedOn: "2026-01-15",
      toAccountId: "account-a",
      status: "confirmed",
    },
    {
      id: "movement-transfer",
      kind: "transfer",
      amountKrw: 300_000,
      postedOn: "2026-01-30",
      fromAccountId: "account-a",
      toAccountId: "account-b",
      status: "confirmed",
    },
  ],
  settlements: [
    {
      id: "settlement-debit",
      targetType: "entry",
      targetId: "entry-debit",
      expectedAmountKrw: 100_000,
      scheduledOn: "2026-01-10",
      movementId: "movement-debit",
      settledAmountKrw: 100_000,
      status: "paid",
    },
    {
      id: "settlement-income",
      targetType: "entry",
      targetId: "entry-income",
      expectedAmountKrw: 500_000,
      scheduledOn: "2026-01-15",
      movementId: "movement-income",
      settledAmountKrw: 500_000,
      status: "paid",
    },
    {
      id: "settlement-credit",
      targetType: "entry",
      targetId: "entry-credit",
      expectedAmountKrw: 200_000,
      scheduledOn: "2026-02-05",
      status: "confirmed",
    },
    {
      id: "settlement-refund",
      targetType: "entry",
      targetId: "entry-refund",
      expectedAmountKrw: 30_000,
      scheduledOn: "2026-02-05",
      status: "confirmed",
    },
  ],
};
assert.deepEqual(validateFinanceState(phaseOneState), []);
assert.deepEqual(financeMonthSummary(phaseOneState, "2026-01"), {
  expenseKrw: 300_000,
  refundKrw: 30_000,
  incomeKrw: 500_000,
  loanCostKrw: 0,
  spentKrw: 270_000,
  cashOutKrw: 100_000,
  cashInKrw: 500_000,
  netCashKrw: 400_000,
  pendingKrw: 0,
});
assert.deepEqual(
  accountBalances(phaseOneState, "2026-01-31").map(({ account, balanceKrw }) => [account.id, balanceKrw]),
  [["account-a", 1_100_000], ["account-b", 500_000]],
);
assert.equal(financeMonthSummary(phaseOneState, "2026-02").pendingKrw, 170_000);
assert.equal(
  upcomingSettlements(phaseOneState, "2026-02-01", "2026-02-28")
    .reduce((total, item) => total + item.amountKrw, 0),
  170_000,
);

const paidCardState = structuredClone(phaseOneState);
paidCardState.settlements.find((item) => item.id === "settlement-credit").status = "canceled";
paidCardState.settlements.find((item) => item.id === "settlement-refund").status = "canceled";
paidCardState.movements.push({
  id: "movement-card",
  kind: "card_payment",
  amountKrw: 170_000,
  postedOn: "2026-02-05",
  fromAccountId: "account-a",
  status: "confirmed",
});
paidCardState.cardStatements.push({
  id: "statement-credit",
  paymentMethodId: "credit-a",
  periodStart: "2026-01-01",
  periodEnd: "2026-01-31",
  statementOn: "2026-02-01",
  scheduledOn: "2026-02-05",
  statementAmountKrw: 170_000,
  status: "paid",
  items: [
    { entryId: "entry-credit", amountKrw: 200_000, installmentNumber: 1, installmentCount: 1 },
    { entryId: "entry-refund", amountKrw: 30_000, installmentNumber: 1, installmentCount: 1 },
  ],
});
paidCardState.settlements.push({
  id: "settlement-card",
  targetType: "card_statement",
  targetId: "statement-credit",
  expectedAmountKrw: 170_000,
  scheduledOn: "2026-02-05",
  movementId: "movement-card",
  settledAmountKrw: 170_000,
  status: "paid",
});
assert.deepEqual(validateFinanceState(paidCardState), []);
assert.equal(paidCardState.entries.length, phaseOneState.entries.length, "paying a card must not create another expense entry");
assert.deepEqual(financeMonthSummary(paidCardState, "2026-02"), {
  expenseKrw: 0,
  refundKrw: 0,
  incomeKrw: 0,
  loanCostKrw: 0,
  spentKrw: 0,
  cashOutKrw: 170_000,
  cashInKrw: 0,
  netCashKrw: -170_000,
  pendingKrw: 0,
});
assert.deepEqual(
  accountBalances(paidCardState, "2026-02-05").map(({ account, balanceKrw }) => [account.id, balanceKrw]),
  [["account-a", 930_000], ["account-b", 500_000]],
);

const ambiguousExternalMovement = structuredClone(phaseOneState);
ambiguousExternalMovement.movements[0].toAccountId = "account-b";
assert.ok(validateFinanceState(ambiguousExternalMovement).some((issue) => issue.code === "single_direction_required"));

const debitWithoutAccount = structuredClone(phaseOneState);
delete debitWithoutAccount.paymentMethods[0].linkedAccountId;
assert.ok(validateFinanceState(debitWithoutAccount).some((issue) => issue.code === "reference_required"));

const wrongDebitAccount = structuredClone(phaseOneState);
wrongDebitAccount.movements[0].fromAccountId = "account-b";
assert.ok(validateFinanceState(wrongDebitAccount).some((issue) => issue.code === "payment_account_mismatch"));

const wrongCardPaymentTotal = structuredClone(paidCardState);
wrongCardPaymentTotal.cardStatements[0].statementAmountKrw = 169_000;
assert.ok(validateFinanceState(wrongCardPaymentTotal).some((issue) => issue.code === "card_payment_total_mismatch"));

const wrongCardPaymentAccount = structuredClone(paidCardState);
wrongCardPaymentAccount.movements.find((movement) => movement.id === "movement-card").fromAccountId = "account-b";
assert.ok(validateFinanceState(wrongCardPaymentAccount).some((issue) => issue.code === "payment_account_mismatch"));

const phaseTwoState = structuredClone(paidCardState);
phaseTwoState.loans.push({
  id: "loan-phase-two",
  name: "생활 대출",
  openedOn: "2026-01-25",
  openingPrincipalKrw: 10_000_000,
  termMonths: 24,
  monthlyPaymentKrw: 550_000,
  paymentAccountId: "account-a",
  annualRate: 4.25,
});
phaseTwoState.recurringRules.push({
  id: "rule-fixed-phase-two",
  kind: "fixed_expense",
  name: "전기요금",
  amountEstimateKrw: 80_000,
  dueDay: 15,
  accountId: "account-a",
  activeFrom: "2026-01-01",
  status: "active",
});
phaseTwoState.entries.push({
  id: "entry-fixed-april",
  kind: "expense",
  title: "전기요금",
  amountKrw: 80_000,
  occurredOn: "2026-04-15",
  recognitionMonth: "2026-04",
  category: "고정비",
  recurringRuleId: "rule-fixed-phase-two",
  periodKey: "2026-04",
  status: "confirmed",
});
phaseTwoState.loanPayments.push({
  id: "loan-payment-april",
  loanId: "loan-phase-two",
  dueOn: "2026-04-25",
  recognitionMonth: "2026-03",
  principalKrw: 500_000,
  interestKrw: 50_000,
  feeKrw: 0,
  status: "confirmed",
});
phaseTwoState.settlements.push(
  {
    id: "settlement-fixed-april",
    targetType: "entry",
    targetId: "entry-fixed-april",
    expectedAmountKrw: 80_000,
    scheduledOn: "2026-04-15",
    status: "confirmed",
  },
  {
    id: "settlement-loan-april",
    targetType: "loan_payment",
    targetId: "loan-payment-april",
    expectedAmountKrw: 550_000,
    scheduledOn: "2026-04-25",
    status: "confirmed",
  },
);
assert.deepEqual(validateFinanceState(phaseTwoState), []);
assert.equal(dateForMonthDay("2026-02", 31), "2026-02-28");
assert.equal(shiftMonthKey("2026-01", -1), "2025-12");
assert.deepEqual(financeMonthSummary(phaseTwoState, "2026-03"), {
  expenseKrw: 0,
  refundKrw: 0,
  incomeKrw: 0,
  loanCostKrw: 50_000,
  spentKrw: 50_000,
  cashOutKrw: 0,
  cashInKrw: 0,
  netCashKrw: 0,
  pendingKrw: 0,
});
assert.equal(financeMonthSummary(phaseTwoState, "2026-04").spentKrw, 80_000);
assert.equal(financeMonthSummary(phaseTwoState, "2026-04").pendingKrw, 630_000);
assert.equal(loanPrincipalKrw(phaseTwoState, phaseTwoState.loans.at(-1), "2026-04-30"), 10_000_000);

const paidPhaseTwoState = structuredClone(phaseTwoState);
paidPhaseTwoState.movements.push(
  {
    id: "movement-fixed-april",
    kind: "external",
    amountKrw: 80_000,
    postedOn: "2026-04-16",
    fromAccountId: "account-a",
    status: "confirmed",
  },
  {
    id: "movement-loan-april",
    kind: "loan_payment",
    amountKrw: 550_000,
    postedOn: "2026-04-26",
    fromAccountId: "account-a",
    status: "confirmed",
  },
);
Object.assign(
  paidPhaseTwoState.loanPayments.find((payment) => payment.id === "loan-payment-april"),
  {
    paidOn: "2026-04-26",
    movementId: "movement-loan-april",
    status: "paid",
  },
);
Object.assign(
  paidPhaseTwoState.settlements.find((settlement) => settlement.id === "settlement-fixed-april"),
  {
    movementId: "movement-fixed-april",
    settledAmountKrw: 80_000,
    status: "paid",
  },
);
Object.assign(
  paidPhaseTwoState.settlements.find((settlement) => settlement.id === "settlement-loan-april"),
  {
    movementId: "movement-loan-april",
    settledAmountKrw: 550_000,
    status: "paid",
  },
);
assert.deepEqual(validateFinanceState(paidPhaseTwoState), []);
assert.deepEqual(financeMonthSummary(paidPhaseTwoState, "2026-03"), {
  expenseKrw: 0,
  refundKrw: 0,
  incomeKrw: 0,
  loanCostKrw: 50_000,
  spentKrw: 50_000,
  cashOutKrw: 0,
  cashInKrw: 0,
  netCashKrw: 0,
  pendingKrw: 0,
});
assert.equal(financeMonthSummary(paidPhaseTwoState, "2026-04").spentKrw, 80_000);
assert.equal(financeMonthSummary(paidPhaseTwoState, "2026-04").cashOutKrw, 630_000);
assert.equal(financeMonthSummary(paidPhaseTwoState, "2026-04").pendingKrw, 0);
assert.equal(loanPrincipalKrw(paidPhaseTwoState, paidPhaseTwoState.loans.at(-1), "2026-04-30"), 9_500_000);

const reconciledState = structuredClone(paidPhaseTwoState);
reconciledState.movements.push({
  id: "movement-balance-adjustment",
  kind: "adjustment",
  amountKrw: 10_000,
  postedOn: "2026-05-01",
  toAccountId: "account-a",
  status: "confirmed",
});
reconciledState.balanceChecks.push({
  id: "balance-check-reconciled",
  accountId: "account-a",
  checkedOn: "2026-05-01",
  calculatedBalanceKrw: 300_000,
  actualBalanceKrw: 310_000,
  adjustmentMovementId: "movement-balance-adjustment",
});
assert.deepEqual(validateFinanceState(reconciledState), []);
assert.equal(accountBalances(reconciledState, "2026-05-01")[0].balanceKrw, 310_000);
assert.equal(financeMonthSummary(reconciledState, "2026-05").cashInKrw, 0);
assert.equal(financeMonthSummary(reconciledState, "2026-05").cashOutKrw, 0);

const wrongAdjustmentDirection = structuredClone(reconciledState);
const wrongAdjustment = wrongAdjustmentDirection.movements.find((movement) => movement.id === "movement-balance-adjustment");
delete wrongAdjustment.toAccountId;
wrongAdjustment.fromAccountId = "account-a";
assert.ok(validateFinanceState(wrongAdjustmentDirection).some((issue) => issue.code === "adjustment_direction_mismatch"));

const invalidStatementPeriod = structuredClone(paidCardState);
invalidStatementPeriod.cardStatements[0].periodStart = "2026-02-01";
assert.ok(validateFinanceState(invalidStatementPeriod).some((issue) => issue.code === "invalid_statement_period"));

const unconfirmedStatementEntry = structuredClone(paidCardState);
unconfirmedStatementEntry.entries.find((entry) => entry.id === "entry-credit").status = "draft";
assert.ok(validateFinanceState(unconfirmedStatementEntry).some((issue) => issue.code === "confirmed_entry_required"));

const uncanceledDirectCardSettlement = structuredClone(paidCardState);
uncanceledDirectCardSettlement.settlements.find((settlement) => settlement.id === "settlement-credit").status = "confirmed";
assert.ok(validateFinanceState(uncanceledDirectCardSettlement).some((issue) => issue.code === "direct_settlement_not_canceled"));

const loanDateMismatch = structuredClone(paidPhaseTwoState);
loanDateMismatch.loanPayments.find((payment) => payment.id === "loan-payment-april").paidOn = "2026-04-25";
assert.ok(validateFinanceState(loanDateMismatch).some((issue) => issue.code === "loan_payment_date_mismatch"));

const recurringKindMismatch = structuredClone(phaseTwoState);
recurringKindMismatch.entries.find((entry) => entry.id === "entry-fixed-april").kind = "income";
assert.ok(validateFinanceState(recurringKindMismatch).some((issue) => issue.code === "recurring_kind_mismatch"));

const invalidRecurringPeriod = structuredClone(phaseTwoState);
invalidRecurringPeriod.recurringRules.find((rule) => rule.id === "rule-fixed-phase-two").activeUntil = "2025-12-31";
assert.ok(validateFinanceState(invalidRecurringPeriod).some((issue) => issue.code === "invalid_active_period"));

const simpleManagementState = {
  ...createEmptyFinanceState(),
  accounts: [{
    id: "account-simple",
    name: "주 계좌",
    type: "bank",
    openingBalanceKrw: 5_000_000,
    openingOn: "2026-08-01",
  }],
  paymentMethods: [{
    id: "card-simple",
    name: "시작 카드",
    type: "credit_card",
    paymentAccountId: "account-simple",
    cycleEndDay: 31,
    dueDay: 14,
    dueMonthOffset: 1,
  }],
  entries: [{
    id: "entry-card-total",
    kind: "expense",
    title: "시작 카드 시작 사용액",
    amountKrw: 2_000_000,
    occurredOn: "2026-08-31",
    recognitionMonth: "2026-08",
    paymentMethodId: "card-simple",
    source: "card_month_total",
    status: "confirmed",
  }],
  settlements: [
    {
      id: "settlement-card-total",
      targetType: "entry",
      targetId: "entry-card-total",
      expectedAmountKrw: 2_000_000,
      scheduledOn: "2026-09-14",
      status: "estimated",
    },
    {
      id: "settlement-opening-installment",
      targetType: "card_statement",
      targetId: "statement-opening-installment",
      expectedAmountKrw: 500_000,
      scheduledOn: "2026-08-14",
      status: "confirmed",
    },
  ],
  cardStatements: [{
    id: "statement-opening-installment",
    paymentMethodId: "card-simple",
    paymentAccountId: "account-simple",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    statementOn: "2026-08-01",
    scheduledOn: "2026-08-14",
    statementAmountKrw: 500_000,
    status: "confirmed",
    source: "opening_installment",
    planId: "installment-plan-simple",
    label: "기존 노트북",
    installmentNumber: 1,
    installmentCount: 4,
    items: [],
  }],
  loans: [{
    id: "loan-simple",
    name: "자산 확인용 대출",
    openedOn: "2026-08-01",
    openingPrincipalKrw: 12_000_000,
  }],
  recurringRules: [
    {
      id: "rule-auto",
      kind: "fixed_expense",
      name: "자동 월세",
      amountEstimateKrw: 600_000,
      dueDay: 1,
      accountId: "account-simple",
      creationMode: "auto",
      activeFrom: "2026-08-01",
      status: "active",
    },
    {
      id: "rule-manual",
      kind: "fixed_expense",
      name: "수동 회비",
      amountEstimateKrw: 30_000,
      dueDay: 20,
      accountId: "account-simple",
      creationMode: "manual",
      activeFrom: "2026-08-01",
      status: "active",
    },
  ],
};
assert.deepEqual(validateFinanceState(simpleManagementState), []);

const invalidCreationMode = structuredClone(simpleManagementState);
invalidCreationMode.recurringRules[0].creationMode = "sometimes";
assert.ok(validateFinanceState(invalidCreationMode).some((issue) => issue.path.endsWith("creationMode")));

const duplicateCardTotal = structuredClone(simpleManagementState);
duplicateCardTotal.entries.push({ ...structuredClone(duplicateCardTotal.entries[0]), id: "entry-card-total-duplicate" });
assert.ok(validateFinanceState(duplicateCardTotal).some((issue) => issue.code === "duplicate_card_month_total"));

const excessiveInstallments = structuredClone(simpleManagementState);
excessiveInstallments.cardStatements[0].installmentCount = 121;
assert.ok(validateFinanceState(excessiveInstallments).some((issue) => issue.code === "installment_count_too_large"));

const historicalInstallment = structuredClone(simpleManagementState);
historicalInstallment.cardStatements[0].status = "historical_paid";
assert.ok(validateFinanceState(historicalInstallment).some((issue) => issue.code === "historical_settlement_not_allowed"));
historicalInstallment.settlements = historicalInstallment.settlements.filter((item) => item.targetType !== "card_statement");
assert.deepEqual(validateFinanceState(historicalInstallment), []);

const mismatchedStatementAdjustment = structuredClone(validState);
mismatchedStatementAdjustment.cardStatements[0].adjustments = [{ label: "수수료", amountKrw: 1_000 }];
assert.ok(validateFinanceState(mismatchedStatementAdjustment).some((issue) => issue.code === "statement_component_mismatch"));

console.log("Finance auth, validation, balances, card, loan, fixed-cost, and month-boundary checks passed.");
