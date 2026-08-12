(function installFinanceModel(scope) {
  function active(item) {
    return item?.status === "confirmed" || item?.status === "paid";
  }

  function accountBalanceKrw(state, account, throughOn = "9999-12-31") {
    let balance = Number(account?.openingBalanceKrw || 0);
    for (const movement of state?.movements || []) {
      if (
        movement.status !== "confirmed"
        || movement.postedOn < account.openingOn
        || movement.postedOn > throughOn
      ) {
        continue;
      }
      if (movement.toAccountId === account.id) balance += movement.amountKrw;
      if (movement.fromAccountId === account.id) balance -= movement.amountKrw;
    }
    return balance;
  }

  function accountBalances(state, throughOn = "9999-12-31") {
    return (state?.accounts || []).map((account) => ({
      account,
      balanceKrw: accountBalanceKrw(state, account, throughOn),
    }));
  }

  function settlementDirection(state, settlement) {
    if (settlement.targetType !== "entry") return 1;
    const entry = (state?.entries || []).find((item) => item.id === settlement.targetId);
    return entry?.kind === "refund" ? -1 : 1;
  }

  function financeMonthSummary(state, month) {
    let expenseKrw = 0;
    let refundKrw = 0;
    let incomeKrw = 0;
    let loanCostKrw = 0;
    let cashOutKrw = 0;
    let cashInKrw = 0;
    let pendingKrw = 0;

    for (const entry of state?.entries || []) {
      if (entry.status !== "confirmed" || entry.recognitionMonth !== month) continue;
      if (entry.kind === "expense") expenseKrw += entry.amountKrw;
      if (entry.kind === "refund") refundKrw += entry.amountKrw;
      if (entry.kind === "income") incomeKrw += entry.amountKrw;
    }

    for (const payment of state?.loanPayments || []) {
      if (!active(payment) || payment.recognitionMonth !== month) continue;
      loanCostKrw += Number(payment.interestKrw || 0) + Number(payment.feeKrw || 0);
    }

    for (const movement of state?.movements || []) {
      if (movement.status !== "confirmed" || movement.postedOn.slice(0, 7) !== month) continue;
      if (movement.kind === "transfer" || movement.kind === "adjustment") continue;
      if (movement.fromAccountId && !movement.toAccountId) cashOutKrw += movement.amountKrw;
      if (movement.toAccountId && !movement.fromAccountId) cashInKrw += movement.amountKrw;
    }

    for (const settlement of state?.settlements || []) {
      if (
        !["estimated", "confirmed"].includes(settlement.status)
        || settlement.scheduledOn.slice(0, 7) !== month
      ) {
        continue;
      }
      pendingKrw += settlement.expectedAmountKrw * settlementDirection(state, settlement);
    }

    const spentKrw = expenseKrw - refundKrw + loanCostKrw;
    return {
      expenseKrw,
      refundKrw,
      incomeKrw,
      loanCostKrw,
      spentKrw,
      cashOutKrw,
      cashInKrw,
      netCashKrw: cashInKrw - cashOutKrw,
      pendingKrw: Math.max(0, pendingKrw),
    };
  }

  function upcomingSettlements(state, fromOn, throughOn) {
    return (state?.settlements || [])
      .filter((settlement) => (
        ["estimated", "confirmed"].includes(settlement.status)
        && settlement.scheduledOn >= fromOn
        && settlement.scheduledOn <= throughOn
      ))
      .map((settlement) => ({
        settlement,
        amountKrw: settlement.expectedAmountKrw * settlementDirection(state, settlement),
      }))
      .sort((left, right) => (
        left.settlement.scheduledOn.localeCompare(right.settlement.scheduledOn)
        || left.settlement.id.localeCompare(right.settlement.id)
      ));
  }

  function loanPrincipalKrw(state, loan, throughOn = "9999-12-31") {
    let principal = Number(loan?.openingPrincipalKrw || 0);
    for (const payment of state?.loanPayments || []) {
      if (
        payment.loanId !== loan?.id
        || payment.status !== "paid"
        || !payment.paidOn
        || payment.paidOn > throughOn
      ) {
        continue;
      }
      principal -= Number(payment.principalKrw || 0);
    }
    return Math.max(0, principal);
  }

  function splitKrw(totalKrw, count) {
    if (!Number.isSafeInteger(totalKrw) || totalKrw < 0 || !Number.isInteger(count) || count < 1) return [];
    const base = Math.floor(totalKrw / count);
    const remainder = totalKrw - base * count;
    return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
  }

  function loanSchedule({
    openingPrincipalKrw,
    termMonths,
    graceMonths = 0,
    annualRate = 0,
    openedOn,
  } = {}) {
    const startMonth = String(openedOn || "").slice(0, 7);
    const dueDay = Number(String(openedOn || "").slice(8, 10));
    if (
      !Number.isSafeInteger(openingPrincipalKrw)
      || openingPrincipalKrw <= 0
      || !Number.isInteger(termMonths)
      || termMonths < 1
      || !Number.isInteger(graceMonths)
      || graceMonths < 0
      || termMonths + graceMonths > 1_200
      || !Number.isFinite(annualRate)
      || annualRate < 0
      || annualRate > 100
      || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(startMonth)
      || !Number.isInteger(dueDay)
      || dueDay < 1
      || dueDay > 31
    ) {
      return [];
    }

    const monthlyRate = annualRate / 1_200;
    const rows = [];
    const pushRow = (principalKrw, interestKrw, phase) => {
      const index = rows.length;
      const recognitionMonth = shiftMonthKey(startMonth, index);
      const amountKrw = principalKrw + interestKrw;
      if (
        !Number.isSafeInteger(principalKrw)
        || principalKrw < 0
        || !Number.isSafeInteger(interestKrw)
        || interestKrw < 0
        || !Number.isSafeInteger(amountKrw)
      ) {
        return false;
      }
      rows.push({
        sequence: index + 1,
        dueOn: dateForMonthDay(recognitionMonth, dueDay),
        recognitionMonth,
        phase,
        principalKrw,
        interestKrw,
        amountKrw,
      });
      return true;
    };

    const graceInterestKrw = Math.round(openingPrincipalKrw * monthlyRate);
    for (let index = 0; index < graceMonths; index += 1) {
      if (!pushRow(0, graceInterestKrw, "grace")) return [];
    }

    if (monthlyRate === 0) {
      for (const principalKrw of splitKrw(openingPrincipalKrw, termMonths)) {
        if (!pushRow(principalKrw, 0, "repayment")) return [];
      }
      return rows;
    }

    const growthMinusOne = Math.expm1(termMonths * Math.log1p(monthlyRate));
    const regularAmountKrw = Math.round(
      openingPrincipalKrw * monthlyRate * (growthMinusOne + 1) / growthMinusOne,
    );
    let remainingPrincipalKrw = openingPrincipalKrw;
    for (let index = 0; index < termMonths; index += 1) {
      const interestKrw = Math.round(remainingPrincipalKrw * monthlyRate);
      const principalKrw = index === termMonths - 1
        ? remainingPrincipalKrw
        : Math.min(remainingPrincipalKrw, Math.max(0, regularAmountKrw - interestKrw));
      remainingPrincipalKrw -= principalKrw;
      if (!pushRow(principalKrw, interestKrw, "repayment")) return [];
    }
    return remainingPrincipalKrw === 0 ? rows : [];
  }

  function shiftMonthKey(month, offset) {
    const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) return "";
    const monthIndex = Number(match[1]) * 12 + Number(match[2]) - 1 + Number(offset || 0);
    if (!Number.isInteger(monthIndex) || monthIndex < 0) return "";
    const year = Math.floor(monthIndex / 12);
    const monthNumber = monthIndex % 12 + 1;
    return `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`;
  }

  function dateForMonthDay(month, day) {
    const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) return "";
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    if (monthIndex < 0 || monthIndex > 11) return "";
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    return `${month}-${String(Math.min(boundedDay(day, lastDay), lastDay)).padStart(2, "0")}`;
  }

  function scheduledCardPaymentOn(method, occurredOn) {
    const match = String(occurredOn || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "";
    const usedYear = Number(match[1]);
    const usedMonth = Number(match[2]);
    const usedDay = Number(match[3]);
    const cycleEndDay = boundedDay(method?.cycleEndDay, 31);
    const dueDay = boundedDay(method?.dueDay, 1);
    const dueMonthOffset = boundedInteger(method?.dueMonthOffset, 0, 3, 1);
    const cycleMonthIndex = usedYear * 12 + usedMonth - 1 + (usedDay > cycleEndDay ? 1 : 0);
    const dueMonthIndex = cycleMonthIndex + dueMonthOffset;
    const year = Math.floor(dueMonthIndex / 12);
    const monthIndex = dueMonthIndex % 12;
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const scheduledOn = `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}-${String(Math.min(dueDay, lastDay)).padStart(2, "0")}`;
    return scheduledOn > occurredOn ? scheduledOn : dateForMonthDay(shiftMonthKey(scheduledOn.slice(0, 7), 1), dueDay);
  }

  function boundedDay(value, fallback) {
    return boundedInteger(value, 1, 31, fallback);
  }

  function boundedInteger(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
  }

  scope.SYGMAFinanceModel = Object.freeze({
    accountBalanceKrw,
    accountBalances,
    dateForMonthDay,
    financeMonthSummary,
    loanSchedule,
    loanPrincipalKrw,
    scheduledCardPaymentOn,
    shiftMonthKey,
    splitKrw,
    upcomingSettlements,
  });
})(globalThis);
