import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const PASSWORD_HASH_PREFIX = "scrypt-v1";
const SESSION_AUDIENCE = "sygma-finance";
const SESSION_SIGNATURE_PREFIX = "sygma-finance-session-v1.";
const SESSION_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const ROOT_COLLECTIONS = [
  "accounts",
  "paymentMethods",
  "entries",
  "movements",
  "settlements",
  "cardStatements",
  "loans",
  "loanPayments",
  "recurringRules",
  "balanceChecks",
];
const ROOT_KEYS = new Set(["schemaVersion", "currency", ...ROOT_COLLECTIONS]);
const MAX_COLLECTION_ITEMS = 20_000;
const MAX_TOTAL_ITEMS = 50_000;
const MAX_TEXT_LENGTH = 20_000;
const MAX_VALIDATION_ISSUES = 32;

export function createEmptyFinanceState() {
  return {
    schemaVersion: 1,
    currency: "KRW",
    accounts: [],
    paymentMethods: [],
    entries: [],
    movements: [],
    settlements: [],
    cardStatements: [],
    loans: [],
    loanPayments: [],
    recurringRules: [],
    balanceChecks: [],
  };
}

export function financePasswordHashConfigured(value) {
  return parsePasswordHash(value) !== null;
}

export function financeSessionSecretConfigured(value) {
  return SESSION_SECRET_PATTERN.test(String(value || ""));
}

export async function hashFinancePassword(password, salt = randomBytes(16)) {
  const normalizedPassword = normalizedPasswordInput(password);
  if (!normalizedPassword) throw new Error("Finance password must contain 8 to 256 characters.");
  const normalizedSalt = Buffer.isBuffer(salt) ? salt : Buffer.from(salt);
  if (normalizedSalt.length !== 16) throw new Error("Finance password salt must be 16 bytes.");
  const digest = await scrypt(normalizedPassword, normalizedSalt, 32, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `${PASSWORD_HASH_PREFIX}$${normalizedSalt.toString("base64url")}$${Buffer.from(digest).toString("base64url")}`;
}

export async function verifyFinancePassword(password, encodedHash) {
  const parsed = parsePasswordHash(encodedHash);
  const normalizedPassword = normalizedPasswordInput(password);
  if (!parsed || !normalizedPassword) return false;
  const actual = await scrypt(normalizedPassword, parsed.salt, parsed.digest.length, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return actual.length === parsed.digest.length && timingSafeEqual(Buffer.from(actual), parsed.digest);
}

export function createFinanceSession(secret, options = {}) {
  if (!financeSessionSecretConfigured(secret)) throw new Error("Finance session secret is invalid.");
  const nowSeconds = seconds(options.now ?? Date.now());
  const ttlSeconds = boundedInteger(options.ttlSeconds, 300, 86_400, 43_200);
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    aud: SESSION_AUDIENCE,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    nonce: randomBytes(18).toString("base64url"),
  })).toString("base64url");
  return `${payload}.${sessionSignature(payload, secret)}`;
}

export function verifyFinanceSession(token, secret, options = {}) {
  if (!financeSessionSecretConfigured(secret)) return null;
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  const expected = Buffer.from(sessionSignature(parts[0], secret), "base64url");
  let supplied;
  try {
    supplied = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const nowSeconds = seconds(options.now ?? Date.now());
  if (
    !isPlainObject(payload)
    || payload.v !== 1
    || payload.aud !== SESSION_AUDIENCE
    || !Number.isSafeInteger(payload.iat)
    || !Number.isSafeInteger(payload.exp)
    || payload.iat > nowSeconds + 5
    || payload.exp <= nowSeconds
    || payload.exp <= payload.iat
    || payload.exp - payload.iat > 86_400
    || !/^[A-Za-z0-9_-]{24}$/.test(String(payload.nonce || ""))
  ) {
    return null;
  }
  return payload;
}

export function validateFinanceState(state) {
  const issues = [];
  if (!isPlainObject(state)) {
    return [{ path: "state", code: "invalid_root", message: "Finance state must be an object." }];
  }
  for (const key of Object.keys(state)) {
    if (!ROOT_KEYS.has(key)) addIssue(issues, `state.${key}`, "unknown_root_key", "Unknown finance state property.");
  }
  if (state.schemaVersion !== 1) addIssue(issues, "state.schemaVersion", "unsupported_schema", "schemaVersion must be 1.");
  if (state.currency !== "KRW") addIssue(issues, "state.currency", "unsupported_currency", "currency must be KRW.");

  let totalItems = 0;
  for (const key of ROOT_COLLECTIONS) {
    if (!Array.isArray(state[key])) {
      addIssue(issues, `state.${key}`, "invalid_collection", `${key} must be an array.`);
      continue;
    }
    totalItems += state[key].length;
    if (state[key].length > MAX_COLLECTION_ITEMS) {
      addIssue(issues, `state.${key}`, "collection_too_large", `${key} exceeds ${MAX_COLLECTION_ITEMS} items.`);
    }
  }
  if (totalItems > MAX_TOTAL_ITEMS) addIssue(issues, "state", "state_too_large", `Finance state exceeds ${MAX_TOTAL_ITEMS} items.`);
  if (issues.length) return issues;

  const ids = new Set();
  for (const key of ROOT_COLLECTIONS) {
    state[key].forEach((item, index) => validateEntityShell(item, key, index, ids, issues));
  }
  if (issues.length) return issues;

  const accountIds = collectionIdSet(state.accounts);
  const paymentMethodIds = collectionIdSet(state.paymentMethods);
  const entryIds = collectionIdSet(state.entries);
  const movementIds = collectionIdSet(state.movements);
  const loanIds = collectionIdSet(state.loans);
  const recurringRuleIds = collectionIdSet(state.recurringRules);

  validateAccounts(state.accounts, issues);
  validatePaymentMethods(state.paymentMethods, accountIds, issues);
  validateEntries(state.entries, entryIds, state.paymentMethods, recurringRuleIds, issues);
  validateMovements(state.movements, accountIds, issues);
  validateSettlements(
    state.settlements,
    state.entries,
    state.cardStatements,
    state.loanPayments,
    state.paymentMethods,
    state.loans,
    accountIds,
    movementIds,
    state.movements,
    issues,
  );
  validateCardStatements(state.cardStatements, state.paymentMethods, state.entries, state.settlements, accountIds, issues);
  validateLoans(state.loans, accountIds, issues);
  validateLoanPayments(
    state.loanPayments,
    state.loans,
    recurringRuleIds,
    movementIds,
    state.movements,
    state.settlements,
    issues,
  );
  validateRecurringRules(state.recurringRules, paymentMethodIds, accountIds, loanIds, issues);
  validateRecurringLinks(state.entries, state.loanPayments, state.recurringRules, issues);
  validateBalanceChecks(state.balanceChecks, accountIds, movementIds, state.movements, issues);
  return issues;
}

function parsePasswordHash(value) {
  const parts = String(value || "").split("$");
  if (parts.length !== 3 || parts[0] !== PASSWORD_HASH_PREFIX) return null;
  if (!/^[A-Za-z0-9_-]{22}$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return null;
  try {
    const salt = Buffer.from(parts[1], "base64url");
    const digest = Buffer.from(parts[2], "base64url");
    return salt.length === 16 && digest.length === 32 ? { salt, digest } : null;
  } catch {
    return null;
  }
}

function normalizedPasswordInput(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 256 || Buffer.byteLength(value, "utf8") > 1_024) return "";
  return value;
}

function sessionSignature(payload, secret) {
  return createHmac("sha256", Buffer.from(secret, "base64url"))
    .update(`${SESSION_SIGNATURE_PREFIX}${payload}`, "utf8")
    .digest("base64url");
}

function seconds(value) {
  return Math.floor(Number(value) / 1_000);
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addIssue(issues, path, code, message) {
  if (issues.length < MAX_VALIDATION_ISSUES) issues.push({ path, code, message });
}

function validateEntityShell(item, collection, index, ids, issues) {
  const path = `state.${collection}[${index}]`;
  if (!isPlainObject(item)) {
    addIssue(issues, path, "invalid_entity", "Finance collection items must be objects.");
    return;
  }
  if ((collection === "accounts" || collection === "paymentMethods") && Object.hasOwn(item, "lastFour")) {
    addIssue(issues, `${path}.lastFour`, "unsupported_property", "Card and account number fragments are not stored.");
  }
  if (collection === "recurringRules" && Object.hasOwn(item, "recognitionMonthOffset")) {
    addIssue(issues, `${path}.recognitionMonthOffset`, "unsupported_property", "Fixed costs are recognized in their scheduled month.");
  }
  if (!ID_PATTERN.test(String(item.id || ""))) {
    addIssue(issues, `${path}.id`, "invalid_id", "Entity ID is invalid.");
  } else if (ids.has(item.id)) {
    addIssue(issues, `${path}.id`, "duplicate_id", "Entity IDs must be globally unique.");
  } else {
    ids.add(item.id);
  }
  validateTextTree(item, path, issues);
}

function validateTextTree(value, path, issues, depth = 0) {
  if (issues.length >= MAX_VALIDATION_ISSUES || depth > 8) return;
  if (typeof value === "string") {
    if (value.length > MAX_TEXT_LENGTH) addIssue(issues, path, "text_too_long", `Text exceeds ${MAX_TEXT_LENGTH} characters.`);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) validateTextTree(child, `${path}.${key}`, issues, depth + 1);
}

function collectionIdSet(collection) {
  return new Set(collection.map((item) => item.id));
}

function validateAccounts(accounts, issues) {
  accounts.forEach((account, index) => {
    const path = `state.accounts[${index}]`;
    requireText(account.name, `${path}.name`, issues);
    requireEnum(account.type, ["bank", "cash", "e_money"], `${path}.type`, issues);
    requireInteger(account.openingBalanceKrw, `${path}.openingBalanceKrw`, issues);
    requireDate(account.openingOn, `${path}.openingOn`, issues);
  });
}

function validatePaymentMethods(methods, accountIds, issues) {
  methods.forEach((method, index) => {
    const path = `state.paymentMethods[${index}]`;
    requireText(method.name, `${path}.name`, issues);
    requireEnum(method.type, ["debit_card", "credit_card", "cash", "bank_transfer", "other"], `${path}.type`, issues);
    optionalReference(method.linkedAccountId, accountIds, `${path}.linkedAccountId`, issues);
    optionalReference(method.paymentAccountId, accountIds, `${path}.paymentAccountId`, issues);
    if (method.type === "credit_card" && !method.paymentAccountId) {
      addIssue(issues, `${path}.paymentAccountId`, "reference_required", "Credit cards require a payment account.");
    }
    if (method.type !== "credit_card" && !method.linkedAccountId) {
      addIssue(issues, `${path}.linkedAccountId`, "reference_required", "Immediate payment methods require a linked account.");
    }
    if (method.type === "credit_card") {
      optionalBoundedInteger(method.cycleEndDay, 1, 31, `${path}.cycleEndDay`, issues);
      optionalBoundedInteger(method.dueDay, 1, 31, `${path}.dueDay`, issues);
      optionalBoundedInteger(method.dueMonthOffset, 0, 3, `${path}.dueMonthOffset`, issues);
    }
  });
}

function validateEntries(entries, entryIds, paymentMethods, recurringRuleIds, issues) {
  const paymentMethodIds = collectionIdSet(paymentMethods);
  const paymentMethodById = new Map(paymentMethods.map((method) => [method.id, method]));
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const refundTotals = new Map();
  const cardMonthTotals = new Set();
  entries.forEach((entry, index) => {
    const path = `state.entries[${index}]`;
    requireEnum(entry.kind, ["expense", "income", "refund"], `${path}.kind`, issues);
    requireText(entry.title, `${path}.title`, issues);
    requirePositiveMoney(entry.amountKrw, `${path}.amountKrw`, issues);
    requireDate(entry.occurredOn, `${path}.occurredOn`, issues);
    requireMonth(entry.recognitionMonth, `${path}.recognitionMonth`, issues);
    requireEnum(entry.status, ["draft", "confirmed", "void"], `${path}.status`, issues);
    optionalReference(entry.paymentMethodId, paymentMethodIds, `${path}.paymentMethodId`, issues);
    optionalReference(entry.originalEntryId, entryIds, `${path}.originalEntryId`, issues);
    optionalReference(entry.recurringRuleId, recurringRuleIds, `${path}.recurringRuleId`, issues);
    if (entry.source !== undefined) requireEnum(entry.source, ["card_month_total"], `${path}.source`, issues);
    if (entry.source === "card_month_total") {
      if (entry.kind !== "expense" || entry.status !== "confirmed" || paymentMethodById.get(entry.paymentMethodId)?.type !== "credit_card") {
        addIssue(issues, path, "invalid_card_month_total", "Card starting totals must be confirmed credit-card expenses.");
      }
      const key = `${entry.paymentMethodId}:${entry.recognitionMonth}`;
      if (cardMonthTotals.has(key)) addIssue(issues, path, "duplicate_card_month_total", "A card may have only one starting total per month.");
      cardMonthTotals.add(key);
    }
    if (entry.kind === "refund") {
      const original = entryById.get(entry.originalEntryId);
      if (!entry.originalEntryId) {
        addIssue(issues, `${path}.originalEntryId`, "reference_required", "Refunds require an original entry.");
      } else if (entry.originalEntryId === entry.id) {
        addIssue(issues, `${path}.originalEntryId`, "self_reference", "A refund cannot reference itself.");
      } else if (original && original.kind !== "expense") {
        addIssue(issues, `${path}.originalEntryId`, "invalid_refund_source", "Refunds must reference an expense.");
      }
      if (original?.kind === "expense" && entry.status !== "void") {
        refundTotals.set(original.id, (refundTotals.get(original.id) || 0) + Number(entry.amountKrw || 0));
      }
    } else if (entry.originalEntryId) {
      addIssue(issues, `${path}.originalEntryId`, "refund_reference_not_allowed", "Only refunds may reference an original entry.");
    }
    if (entry.recurringRuleId) {
      requireMonth(entry.periodKey, `${path}.periodKey`, issues);
    } else if (entry.periodKey) {
      addIssue(issues, `${path}.periodKey`, "recurring_rule_required", "periodKey requires a recurring rule.");
    }
  });
  for (const [originalId, total] of refundTotals) {
    const original = entryById.get(originalId);
    if (Number.isSafeInteger(total) && total > Number(original?.amountKrw || 0)) {
      addIssue(issues, "state.entries", "refund_total_exceeds_original", "Refund totals cannot exceed the original expense.");
    }
  }
}

function validateMovements(movements, accountIds, issues) {
  movements.forEach((movement, index) => {
    const path = `state.movements[${index}]`;
    requireEnum(movement.kind, ["external", "transfer", "card_payment", "loan_payment", "adjustment"], `${path}.kind`, issues);
    requirePositiveMoney(movement.amountKrw, `${path}.amountKrw`, issues);
    requireDate(movement.postedOn, `${path}.postedOn`, issues);
    requireEnum(movement.status, ["confirmed", "void"], `${path}.status`, issues);
    optionalReference(movement.fromAccountId, accountIds, `${path}.fromAccountId`, issues);
    optionalReference(movement.toAccountId, accountIds, `${path}.toAccountId`, issues);
    if (!movement.fromAccountId && !movement.toAccountId) {
      addIssue(issues, path, "account_required", "A movement requires a source or destination account.");
    }
    if (movement.fromAccountId && movement.fromAccountId === movement.toAccountId) {
      addIssue(issues, path, "self_transfer", "A movement cannot transfer to the same account.");
    }
    const hasSource = Boolean(movement.fromAccountId);
    const hasDestination = Boolean(movement.toAccountId);
    if (movement.kind === "transfer" && (!hasSource || !hasDestination)) {
      addIssue(issues, path, "transfer_accounts_required", "Transfers require source and destination accounts.");
    }
    if (movement.kind !== "transfer" && hasSource === hasDestination) {
      addIssue(issues, path, "single_direction_required", "Non-transfer movements require exactly one source or destination account.");
    }
    if (["card_payment", "loan_payment"].includes(movement.kind) && (!hasSource || hasDestination)) {
      addIssue(issues, path, "outgoing_movement_required", "Card and loan payments must leave exactly one account.");
    }
  });
}

function validateSettlements(settlements, entries, statements, loanPayments, paymentMethods, loans, accountIds, movementIds, movements, issues) {
  const entryIds = collectionIdSet(entries);
  const statementIds = collectionIdSet(statements);
  const loanPaymentIds = collectionIdSet(loanPayments);
  const targetSets = {
    entry: entryIds,
    card_statement: statementIds,
    loan_payment: loanPaymentIds,
  };
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const statementById = new Map(statements.map((statement) => [statement.id, statement]));
  const loanPaymentById = new Map(loanPayments.map((payment) => [payment.id, payment]));
  const paymentMethodById = new Map(paymentMethods.map((method) => [method.id, method]));
  const loanById = new Map(loans.map((loan) => [loan.id, loan]));
  const movementById = new Map(movements.map((movement) => [movement.id, movement]));
  const settledByMovement = new Map();
  const settledByStatement = new Map();
  const paidStatementIds = new Set();
  settlements.forEach((settlement, index) => {
    const path = `state.settlements[${index}]`;
    requireEnum(settlement.targetType, Object.keys(targetSets), `${path}.targetType`, issues);
    const targets = targetSets[settlement.targetType];
    if (targets) requireReference(settlement.targetId, targets, `${path}.targetId`, issues);
    requirePositiveMoney(settlement.expectedAmountKrw, `${path}.expectedAmountKrw`, issues);
    requireDate(settlement.scheduledOn, `${path}.scheduledOn`, issues);
    requireEnum(settlement.status, ["estimated", "confirmed", "paid", "canceled"], `${path}.status`, issues);
    optionalReference(settlement.accountId, accountIds, `${path}.accountId`, issues);
    if (settlement.accountId && settlement.targetType !== "entry") {
      addIssue(issues, `${path}.accountId`, "account_snapshot_not_allowed", "Only direct entry settlements may store an account snapshot.");
    }
    optionalReference(settlement.movementId, movementIds, `${path}.movementId`, issues);
    if (settlement.status !== "paid") {
      if (settlement.movementId) addIssue(issues, `${path}.movementId`, "movement_not_allowed", "Only paid settlements may reference a movement.");
      if (settlement.settledAmountKrw !== undefined && settlement.settledAmountKrw !== null && settlement.settledAmountKrw !== "") {
        addIssue(issues, `${path}.settledAmountKrw`, "settled_amount_not_allowed", "Only paid settlements may contain a settled amount.");
      }
      return;
    }
    if (!settlement.movementId) {
      addIssue(issues, `${path}.movementId`, "movement_required", "Paid settlements require a movement.");
      return;
    }
    const movement = movementById.get(settlement.movementId);
    requirePositiveMoney(settlement.settledAmountKrw, `${path}.settledAmountKrw`, issues);
    if (movement?.status !== "confirmed") {
      addIssue(issues, `${path}.movementId`, "confirmed_movement_required", "Paid settlements require a confirmed movement.");
    }
    const expectedMovementKind = {
      entry: "external",
      card_statement: "card_payment",
      loan_payment: "loan_payment",
    }[settlement.targetType];
    if (movement && expectedMovementKind && movement.kind !== expectedMovementKind) {
      addIssue(issues, `${path}.movementId`, "movement_kind_mismatch", `Settlement requires a ${expectedMovementKind} movement.`);
    }
    if (settlement.targetType === "entry") {
      const entry = entryById.get(settlement.targetId);
      const method = paymentMethodById.get(entry?.paymentMethodId);
      if (movement && entry?.kind === "expense" && !movement.fromAccountId) {
        addIssue(issues, `${path}.movementId`, "movement_direction_mismatch", "Expense settlements require money to leave an account.");
      }
      if (movement && (entry?.kind === "income" || entry?.kind === "refund") && !movement.toAccountId) {
        addIssue(issues, `${path}.movementId`, "movement_direction_mismatch", "Income and refund settlements require money to enter an account.");
      }
      if (movement && method?.type === "credit_card") {
        addIssue(issues, `${path}.targetId`, "card_statement_required", "Credit-card entries must be paid through a card statement.");
      }
      if (movement && settlement.accountId && entry?.kind === "expense" && movement.fromAccountId !== settlement.accountId) {
        addIssue(issues, `${path}.movementId`, "payment_account_mismatch", "Expense payment must leave the stored payment account.");
      }
      if (
        movement
        && method?.type !== "credit_card"
        && method?.linkedAccountId
        && entry?.kind === "expense"
        && movement.fromAccountId !== method.linkedAccountId
      ) {
        addIssue(issues, `${path}.movementId`, "payment_account_mismatch", "Expense payment must leave the payment method's linked account.");
      }
      if (
        movement
        && method?.type !== "credit_card"
        && method?.linkedAccountId
        && entry?.kind === "refund"
        && movement.toAccountId !== method.linkedAccountId
      ) {
        addIssue(issues, `${path}.movementId`, "payment_account_mismatch", "Refund payment must enter the payment method's linked account.");
      }
    }
    if (settlement.targetType === "card_statement") {
      const statement = statementById.get(settlement.targetId);
      const method = paymentMethodById.get(statement?.paymentMethodId);
      const paymentAccountId = statement?.paymentAccountId || method?.paymentAccountId;
      if (statement?.status !== "paid") {
        addIssue(issues, `${path}.targetId`, "target_status_mismatch", "A paid card settlement requires a paid statement.");
      }
      if (movement && paymentAccountId && movement.fromAccountId !== paymentAccountId) {
        addIssue(issues, `${path}.movementId`, "payment_account_mismatch", "Card payment must leave the configured payment account.");
      }
      paidStatementIds.add(settlement.targetId);
      settledByStatement.set(
        settlement.targetId,
        (settledByStatement.get(settlement.targetId) || 0) + Number(settlement.settledAmountKrw || 0),
      );
    }
    if (settlement.targetType === "loan_payment") {
      const loanPayment = loanPaymentById.get(settlement.targetId);
      const loan = loanById.get(loanPayment?.loanId);
      if (loanPayment?.status !== "paid") {
        addIssue(issues, `${path}.targetId`, "target_status_mismatch", "A paid loan settlement requires a paid loan payment.");
      }
      if (movement && loan?.paymentAccountId && movement.fromAccountId !== loan.paymentAccountId) {
        addIssue(issues, `${path}.movementId`, "payment_account_mismatch", "Loan payment must leave the configured payment account.");
      }
    }
    if (movement) {
      settledByMovement.set(
        settlement.movementId,
        (settledByMovement.get(settlement.movementId) || 0) + Number(settlement.settledAmountKrw || 0),
      );
    }
  });
  for (const [movementId, total] of settledByMovement) {
    const movement = movementById.get(movementId);
    if (movement && total !== movement.amountKrw) {
      addIssue(issues, "state.settlements", "settlement_total_mismatch", "Settlement totals must equal the linked movement amount.");
    }
  }
  for (let index = 0; index < statements.length; index += 1) {
    if (statements[index].status === "paid" && !paidStatementIds.has(statements[index].id)) {
      addIssue(issues, `state.cardStatements[${index}]`, "paid_settlement_required", "Paid card statements require a paid settlement.");
    }
    if (
      statements[index].status === "paid"
      && paidStatementIds.has(statements[index].id)
      && settledByStatement.get(statements[index].id) !== statements[index].statementAmountKrw
    ) {
      addIssue(issues, `state.cardStatements[${index}]`, "card_payment_total_mismatch", "Paid card settlements must equal the statement amount.");
    }
  }
}

function validateCardStatements(statements, paymentMethods, entries, settlements, accountIds, issues) {
  const paymentMethodIds = collectionIdSet(paymentMethods);
  const entryIds = collectionIdSet(entries);
  const paymentMethodById = new Map(paymentMethods.map((method) => [method.id, method]));
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const installmentAllocations = new Map();
  const activeSettlementsByStatement = new Map();
  const uncanceledSettlementsByStatement = new Map();
  const directSettlementsByEntry = new Map();
  settlements.forEach((settlement) => {
    if (settlement.targetType === "card_statement" && settlement.status !== "canceled") {
      appendToMapList(uncanceledSettlementsByStatement, settlement.targetId, settlement);
    }
    if (
      settlement.targetType === "card_statement"
      && ["confirmed", "paid"].includes(settlement.status)
    ) {
      appendToMapList(activeSettlementsByStatement, settlement.targetId, settlement);
    }
    if (settlement.targetType === "entry" && settlement.status !== "canceled") {
      appendToMapList(directSettlementsByEntry, settlement.targetId, settlement);
    }
  });
  statements.forEach((statement, index) => {
    const path = `state.cardStatements[${index}]`;
    requireReference(statement.paymentMethodId, paymentMethodIds, `${path}.paymentMethodId`, issues);
    optionalReference(statement.paymentAccountId, accountIds, `${path}.paymentAccountId`, issues);
    if (paymentMethodById.get(statement.paymentMethodId)?.type !== "credit_card") {
      addIssue(issues, `${path}.paymentMethodId`, "credit_card_required", "Card statements require a credit-card payment method.");
    }
    if (statement.source !== undefined) requireEnum(statement.source, ["opening_installment"], `${path}.source`, issues);
    if (statement.source === "opening_installment") {
      requireText(statement.planId, `${path}.planId`, issues);
      requireText(statement.label, `${path}.label`, issues);
      requirePositiveInteger(statement.installmentNumber, `${path}.installmentNumber`, issues);
      requirePositiveInteger(statement.installmentCount, `${path}.installmentCount`, issues);
      if (Number.isSafeInteger(statement.installmentCount) && statement.installmentCount > 120) {
        addIssue(issues, `${path}.installmentCount`, "installment_count_too_large", "Installment count must not exceed 120.");
      }
      if (
        Number.isSafeInteger(statement.installmentNumber)
        && Number.isSafeInteger(statement.installmentCount)
        && statement.installmentNumber > statement.installmentCount
      ) {
        addIssue(issues, path, "invalid_installment", "Installment number cannot exceed installment count.");
      }
    }
    requireDate(statement.periodStart, `${path}.periodStart`, issues);
    requireDate(statement.periodEnd, `${path}.periodEnd`, issues);
    if (validDate(statement.periodStart) && validDate(statement.periodEnd) && statement.periodStart > statement.periodEnd) {
      addIssue(issues, `${path}.periodEnd`, "invalid_statement_period", "Statement period end must not be before its start.");
    }
    requireDate(statement.statementOn, `${path}.statementOn`, issues);
    requireDate(statement.scheduledOn, `${path}.scheduledOn`, issues);
    requirePositiveMoney(statement.statementAmountKrw, `${path}.statementAmountKrw`, issues);
    requireEnum(statement.status, ["estimated", "confirmed", "paid", "historical_paid"], `${path}.status`, issues);
    if (statement.status === "historical_paid" && statement.source !== "opening_installment") {
      addIssue(issues, `${path}.status`, "opening_installment_required", "Historical card payments are allowed only for opening installments.");
    }
    if (statement.status === "historical_paid" && uncanceledSettlementsByStatement.has(statement.id)) {
      addIssue(issues, path, "historical_settlement_not_allowed", "Historical card installments must not affect current settlements or balances.");
    }
    if (["confirmed", "paid"].includes(statement.status)) {
      const activeSettlements = activeSettlementsByStatement.get(statement.id) || [];
      if (activeSettlements.length !== 1) {
        addIssue(issues, path, "single_active_settlement_required", "Confirmed card statements require exactly one active settlement.");
      } else {
        const settlement = activeSettlements[0];
        if (
          settlement.expectedAmountKrw !== statement.statementAmountKrw
          || settlement.scheduledOn !== statement.scheduledOn
        ) {
          addIssue(issues, path, "card_settlement_mismatch", "Card settlement amount and date must match the statement.");
        }
      }
    }
    if (!Array.isArray(statement.items)) {
      addIssue(issues, `${path}.items`, "invalid_collection", "Card statement items must be an array.");
      return;
    }
    if (statement.source === "opening_installment" && statement.items.length) {
      addIssue(issues, `${path}.items`, "opening_installment_items_not_allowed", "Opening installment schedules do not link new expense entries.");
    }
    const adjustments = statement.adjustments ?? [];
    if (!Array.isArray(adjustments)) {
      addIssue(issues, `${path}.adjustments`, "invalid_collection", "Card statement adjustments must be an array.");
    } else {
      if (statement.source === "opening_installment" && adjustments.length) {
        addIssue(issues, `${path}.adjustments`, "opening_installment_adjustments_not_allowed", "Opening installments cannot contain statement adjustments.");
      }
      adjustments.forEach((adjustment, adjustmentIndex) => {
        const adjustmentPath = `${path}.adjustments[${adjustmentIndex}]`;
        if (!isPlainObject(adjustment)) {
          addIssue(issues, adjustmentPath, "invalid_entity", "Card statement adjustments must be objects.");
          return;
        }
        requireText(adjustment.label, `${adjustmentPath}.label`, issues);
        requirePositiveMoney(adjustment.amountKrw, `${adjustmentPath}.amountKrw`, issues);
      });
    }
    statement.items.forEach((item, itemIndex) => {
      const itemPath = `${path}.items[${itemIndex}]`;
      if (!isPlainObject(item)) {
        addIssue(issues, itemPath, "invalid_entity", "Card statement items must be objects.");
        return;
      }
      requireReference(item.entryId, entryIds, `${itemPath}.entryId`, issues);
      const entry = entryById.get(item.entryId);
      if (entry && !["expense", "refund"].includes(entry.kind)) {
        addIssue(issues, `${itemPath}.entryId`, "invalid_statement_entry", "Card statements may contain only expenses and refunds.");
      }
      if (entry && entry.status !== "confirmed") {
        addIssue(issues, `${itemPath}.entryId`, "confirmed_entry_required", "Card statement items must reference confirmed entries.");
      }
      if (entry && entry.paymentMethodId !== statement.paymentMethodId) {
        addIssue(issues, `${itemPath}.entryId`, "card_entry_method_mismatch", "Statement items must belong to the same credit card.");
      }
      if (entry && directSettlementsByEntry.has(entry.id)) {
        addIssue(issues, `${itemPath}.entryId`, "direct_settlement_not_canceled", "Statement entries must have their prior direct settlements canceled.");
      }
      requirePositiveMoney(item.amountKrw, `${itemPath}.amountKrw`, issues);
      requirePositiveInteger(item.installmentNumber, `${itemPath}.installmentNumber`, issues);
      requirePositiveInteger(item.installmentCount, `${itemPath}.installmentCount`, issues);
      if (Number.isSafeInteger(item.installmentNumber) && Number.isSafeInteger(item.installmentCount) && item.installmentNumber > item.installmentCount) {
        addIssue(issues, itemPath, "invalid_installment", "Installment number cannot exceed installment count.");
      }
      if (
        entry
        && Number.isSafeInteger(item.amountKrw)
        && item.amountKrw > 0
        && Number.isSafeInteger(item.installmentNumber)
        && item.installmentNumber > 0
        && Number.isSafeInteger(item.installmentCount)
        && item.installmentCount > 0
        && item.installmentNumber <= item.installmentCount
      ) {
        const allocation = installmentAllocations.get(item.entryId) || {
          count: item.installmentCount,
          numbers: new Set(),
          total: 0,
        };
        if (allocation.count !== item.installmentCount) {
          addIssue(issues, `${itemPath}.installmentCount`, "installment_count_mismatch", "Installment counts must remain consistent for an entry.");
        }
        if (allocation.numbers.has(item.installmentNumber)) {
          addIssue(issues, `${itemPath}.installmentNumber`, "duplicate_installment", "An installment number may appear only once for an entry.");
        }
        allocation.numbers.add(item.installmentNumber);
        allocation.total += item.amountKrw;
        installmentAllocations.set(item.entryId, allocation);
      }
    });
    if (statement.adjustments !== undefined && Array.isArray(adjustments) && statement.source !== "opening_installment") {
      const itemTotal = statement.items.reduce((total, item) => {
        const entry = entryById.get(item.entryId);
        return total + (entry?.kind === "refund" ? -Number(item.amountKrw || 0) : Number(item.amountKrw || 0));
      }, 0);
      const adjustmentTotal = adjustments.reduce((total, item) => total + Number(item?.amountKrw || 0), 0);
      if (itemTotal + adjustmentTotal !== statement.statementAmountKrw) {
        addIssue(issues, `${path}.statementAmountKrw`, "statement_component_mismatch", "Statement items and adjustments must equal the statement amount.");
      }
    }
  });
  for (const [entryId, allocation] of installmentAllocations) {
    const entry = entryById.get(entryId);
    if (allocation.numbers.size !== allocation.count) {
      addIssue(issues, "state.cardStatements", "incomplete_installments", "Every installment must be allocated exactly once.");
    }
    if (!Number.isSafeInteger(allocation.total) || allocation.total !== entry?.amountKrw) {
      addIssue(issues, "state.cardStatements", "installment_total_mismatch", "Installment amounts must equal the linked entry amount.");
    }
  }
}

function validateLoans(loans, accountIds, issues) {
  loans.forEach((loan, index) => {
    const path = `state.loans[${index}]`;
    requireText(loan.name, `${path}.name`, issues);
    requireDate(loan.openedOn, `${path}.openedOn`, issues);
    requirePositiveMoney(loan.openingPrincipalKrw, `${path}.openingPrincipalKrw`, issues);
    const generatedSchedule = loan.scheduleMode !== undefined;
    if (generatedSchedule) {
      requireEnum(loan.scheduleMode, ["auto", "manual"], `${path}.scheduleMode`, issues);
      if (!Number.isSafeInteger(loan.termMonths) || loan.termMonths < 1 || loan.termMonths > 1_200) {
        addIssue(issues, `${path}.termMonths`, "bounded_integer_required", "Loan term must be between 1 and 1200 months.");
      }
      requireReference(loan.paymentAccountId, accountIds, `${path}.paymentAccountId`, issues);
      if (!Number.isSafeInteger(loan.graceMonths) || loan.graceMonths < 0 || loan.graceMonths > 1_200) {
        addIssue(issues, `${path}.graceMonths`, "bounded_integer_required", "Loan grace period must be between 0 and 1200 months.");
      } else if (
        Number.isSafeInteger(loan.termMonths)
        && loan.termMonths + loan.graceMonths > 1_200
      ) {
        addIssue(issues, `${path}.graceMonths`, "combined_term_too_long", "Loan repayment and grace periods must total no more than 1200 months.");
      }
      if (loan.monthlyPaymentKrw !== undefined) {
        requirePositiveMoney(loan.monthlyPaymentKrw, `${path}.monthlyPaymentKrw`, issues);
      }
      if (loan.scheduleMode === "auto" && loan.annualRate === undefined) {
        addIssue(issues, `${path}.annualRate`, "rate_required", "Automatically calculated loans require an annual rate.");
      }
    } else if (
      loan.termMonths !== undefined
      || loan.monthlyPaymentKrw !== undefined
      || loan.paymentAccountId !== undefined
      || loan.annualRate !== undefined
      || loan.graceMonths !== undefined
    ) {
      if (!Number.isSafeInteger(loan.termMonths) || loan.termMonths < 1 || loan.termMonths > 1_200) {
        addIssue(issues, `${path}.termMonths`, "bounded_integer_required", "Loan term must be between 1 and 1200 months.");
      }
      requireReference(loan.paymentAccountId, accountIds, `${path}.paymentAccountId`, issues);
      requirePositiveMoney(loan.monthlyPaymentKrw, `${path}.monthlyPaymentKrw`, issues);
    }
    if (loan.annualRate !== undefined && (!Number.isFinite(loan.annualRate) || loan.annualRate < 0 || loan.annualRate > 100)) {
      addIssue(issues, `${path}.annualRate`, "invalid_rate", "Annual rate must be between 0 and 100.");
    }
  });
}

function validateLoanPayments(payments, loans, recurringRuleIds, movementIds, movements, settlements, issues) {
  const loanIds = collectionIdSet(loans);
  const loanById = new Map(loans.map((loan) => [loan.id, loan]));
  const movementById = new Map(movements.map((movement) => [movement.id, movement]));
  const paidSettlementsByPayment = new Map();
  const activeSettlementsByPayment = new Map();
  const activeLoanMonths = new Set();
  const paymentByMovement = new Map();
  const paidPrincipalByLoan = new Map();
  settlements.forEach((settlement) => {
    if (settlement.targetType === "loan_payment" && settlement.status !== "canceled") {
      appendToMapList(activeSettlementsByPayment, settlement.targetId, settlement);
    }
    if (settlement.targetType === "loan_payment" && settlement.status === "paid") {
      appendToMapList(paidSettlementsByPayment, settlement.targetId, settlement);
    }
  });
  payments.forEach((payment, index) => {
    const path = `state.loanPayments[${index}]`;
    requireReference(payment.loanId, loanIds, `${path}.loanId`, issues);
    requireDate(payment.dueOn, `${path}.dueOn`, issues);
    optionalDate(payment.paidOn, `${path}.paidOn`, issues);
    requireMonth(payment.recognitionMonth, `${path}.recognitionMonth`, issues);
    requireNonNegativeMoney(payment.principalKrw, `${path}.principalKrw`, issues);
    requireNonNegativeMoney(payment.interestKrw, `${path}.interestKrw`, issues);
    requireNonNegativeMoney(payment.feeKrw, `${path}.feeKrw`, issues);
    requireEnum(payment.status, ["estimated", "confirmed", "paid", "canceled"], `${path}.status`, issues);
    optionalReference(payment.recurringRuleId, recurringRuleIds, `${path}.recurringRuleId`, issues);
    if (payment.recurringRuleId) {
      requireMonth(payment.periodKey, `${path}.periodKey`, issues);
    } else if (payment.periodKey) {
      addIssue(issues, `${path}.periodKey`, "recurring_rule_required", "periodKey requires a recurring rule.");
    }
    optionalReference(payment.movementId, movementIds, `${path}.movementId`, issues);
    const total = Number(payment.principalKrw || 0) + Number(payment.interestKrw || 0) + Number(payment.feeKrw || 0);
    if (!Number.isSafeInteger(total) || total <= 0) addIssue(issues, path, "invalid_payment_total", "Loan payment total must be positive.");
    const loan = loanById.get(payment.loanId);
    if (loan?.scheduleMode && payment.status !== "canceled") {
      const month = String(payment.dueOn || "").slice(0, 7);
      const monthKey = `${payment.loanId}:${month}`;
      if (activeLoanMonths.has(monthKey)) {
        addIssue(issues, `${path}.dueOn`, "duplicate_loan_month", "A generated loan schedule may contain only one payment per month.");
      } else {
        activeLoanMonths.add(monthKey);
      }
      if (payment.recognitionMonth !== month) {
        addIssue(issues, `${path}.recognitionMonth`, "loan_recognition_month_mismatch", "Generated loan costs must use the scheduled payment month.");
      }
      const activeSettlements = activeSettlementsByPayment.get(payment.id) || [];
      if (activeSettlements.length !== 1) {
        addIssue(issues, path, "single_active_settlement_required", "Generated loan payments require exactly one active settlement.");
      } else if (
        activeSettlements[0].expectedAmountKrw !== total
        || activeSettlements[0].scheduledOn !== payment.dueOn
        || activeSettlements[0].status !== payment.status
      ) {
        addIssue(issues, path, "loan_settlement_mismatch", "Loan settlement amount, date, and status must match the generated payment.");
      }
    }
    if (payment.status !== "paid") {
      if (payment.movementId) addIssue(issues, `${path}.movementId`, "movement_not_allowed", "Only paid loan payments may reference a movement.");
      if (payment.paidOn) addIssue(issues, `${path}.paidOn`, "paid_date_not_allowed", "Only paid loan payments may contain a paid date.");
      return;
    }
    if (!payment.paidOn) addIssue(issues, `${path}.paidOn`, "paid_date_required", "Paid loan payments require an actual paid date.");
    if (!payment.movementId) {
      addIssue(issues, `${path}.movementId`, "movement_required", "Paid loan payments require a movement.");
      return;
    }
    const movement = movementById.get(payment.movementId);
    if (paymentByMovement.has(payment.movementId)) {
      addIssue(issues, `${path}.movementId`, "movement_reused", "A movement may pay only one loan payment.");
    } else {
      paymentByMovement.set(payment.movementId, payment.id);
    }
    if (movement?.status !== "confirmed") {
      addIssue(issues, `${path}.movementId`, "confirmed_movement_required", "Paid loan payments require a confirmed movement.");
    }
    if (movement && movement.kind !== "loan_payment") {
      addIssue(issues, `${path}.movementId`, "movement_kind_mismatch", "Loan payments require a loan_payment movement.");
    }
    if (movement && loan?.paymentAccountId && movement.fromAccountId !== loan.paymentAccountId) {
      addIssue(issues, `${path}.movementId`, "payment_account_mismatch", "Loan payment must leave the configured payment account.");
    }
    if (movement && movement.amountKrw !== total) {
      addIssue(issues, path, "loan_payment_total_mismatch", "Loan principal, interest, and fees must equal the linked movement.");
    }
    if (movement && payment.paidOn !== movement.postedOn) {
      addIssue(issues, `${path}.paidOn`, "loan_payment_date_mismatch", "Loan paid date must match the linked movement date.");
    }
    const paidSettlements = paidSettlementsByPayment.get(payment.id) || [];
    if (paidSettlements.length !== 1) {
      addIssue(issues, path, "single_paid_settlement_required", "Paid loan payments require exactly one paid settlement.");
    } else {
      const settlement = paidSettlements[0];
      if (
        settlement.expectedAmountKrw !== total
        || settlement.settledAmountKrw !== total
        || settlement.scheduledOn !== payment.dueOn
        || settlement.movementId !== payment.movementId
      ) {
        addIssue(issues, path, "loan_settlement_mismatch", "Loan settlement amount, due date, and movement must match the loan payment.");
      }
    }
    const paidPrincipal = (paidPrincipalByLoan.get(payment.loanId) || 0) + Number(payment.principalKrw || 0);
    paidPrincipalByLoan.set(payment.loanId, paidPrincipal);
  });
  for (const [loanId, paidPrincipal] of paidPrincipalByLoan) {
    if (!Number.isSafeInteger(paidPrincipal) || paidPrincipal > Number(loanById.get(loanId)?.openingPrincipalKrw || 0)) {
      addIssue(issues, "state.loanPayments", "principal_exceeds_opening", "Cumulative paid principal cannot exceed the loan's opening principal.");
    }
  }
}

function validateRecurringRules(rules, paymentMethodIds, accountIds, loanIds, issues) {
  rules.forEach((rule, index) => {
    const path = `state.recurringRules[${index}]`;
    requireEnum(rule.kind, ["fixed_expense", "fixed_income", "loan_payment"], `${path}.kind`, issues);
    requireText(rule.name, `${path}.name`, issues);
    requirePositiveMoney(rule.amountEstimateKrw, `${path}.amountEstimateKrw`, issues);
    if (rule.creationMode !== undefined) requireEnum(rule.creationMode, ["auto", "manual"], `${path}.creationMode`, issues);
    if (!Number.isInteger(rule.dueDay) || rule.dueDay < 1 || rule.dueDay > 31) {
      addIssue(issues, `${path}.dueDay`, "invalid_due_day", "Due day must be between 1 and 31.");
    }
    optionalReference(rule.paymentMethodId, paymentMethodIds, `${path}.paymentMethodId`, issues);
    optionalReference(rule.accountId, accountIds, `${path}.accountId`, issues);
    optionalReference(rule.loanId, loanIds, `${path}.loanId`, issues);
    requireDate(rule.activeFrom, `${path}.activeFrom`, issues);
    optionalDate(rule.activeUntil, `${path}.activeUntil`, issues);
    if (validDate(rule.activeFrom) && validDate(rule.activeUntil) && rule.activeUntil < rule.activeFrom) {
      addIssue(issues, `${path}.activeUntil`, "invalid_active_period", "Recurring rule end date must not be before its start.");
    }
    requireEnum(rule.status, ["active", "paused", "archived"], `${path}.status`, issues);
    const fundingReferenceCount = Number(Boolean(rule.accountId)) + Number(Boolean(rule.paymentMethodId));
    if (rule.kind === "loan_payment") {
      if (!rule.loanId) addIssue(issues, `${path}.loanId`, "reference_required", "Loan payment rules require a loan.");
      if (fundingReferenceCount) {
        addIssue(issues, path, "funding_reference_not_allowed", "Loan payment rules use the loan's configured payment account.");
      }
    } else {
      if (fundingReferenceCount !== 1) {
        addIssue(issues, path, "single_funding_reference_required", "Fixed rules require exactly one account or payment method.");
      }
      if (rule.loanId) addIssue(issues, `${path}.loanId`, "loan_reference_not_allowed", "Fixed rules cannot reference a loan.");
    }
  });
}

function validateRecurringLinks(entries, loanPayments, rules, issues) {
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const generatedPeriods = new Set();
  entries.forEach((entry, index) => {
    if (!entry.recurringRuleId) return;
    const path = `state.entries[${index}]`;
    const rule = ruleById.get(entry.recurringRuleId);
    const expectedKind = {
      fixed_expense: "expense",
      fixed_income: "income",
    }[rule?.kind];
    if (!expectedKind || entry.kind !== expectedKind) {
      addIssue(issues, path, "recurring_kind_mismatch", "Entry kind must match its recurring rule.");
    }
    registerRecurringPeriod(generatedPeriods, entry, path, issues);
  });
  loanPayments.forEach((payment, index) => {
    if (!payment.recurringRuleId) return;
    const path = `state.loanPayments[${index}]`;
    const rule = ruleById.get(payment.recurringRuleId);
    if (rule?.kind !== "loan_payment" || rule.loanId !== payment.loanId) {
      addIssue(issues, path, "recurring_loan_mismatch", "Loan payment must match its loan recurring rule.");
    }
    registerRecurringPeriod(generatedPeriods, payment, path, issues);
  });
}

function registerRecurringPeriod(periods, item, path, issues) {
  if (!ID_PATTERN.test(String(item.recurringRuleId || "")) || !validMonth(item.periodKey)) return;
  const key = `${item.recurringRuleId}:${item.periodKey}`;
  if (periods.has(key)) {
    addIssue(issues, path, "duplicate_recurring_period", "A recurring rule can create only one record per period.");
  } else {
    periods.add(key);
  }
}

function appendToMapList(map, key, value) {
  const items = map.get(key) || [];
  items.push(value);
  map.set(key, items);
}

function validateBalanceChecks(checks, accountIds, movementIds, movements, issues) {
  const movementById = new Map(movements.map((movement) => [movement.id, movement]));
  const usedAdjustmentIds = new Set();
  checks.forEach((check, index) => {
    const path = `state.balanceChecks[${index}]`;
    requireReference(check.accountId, accountIds, `${path}.accountId`, issues);
    requireDate(check.checkedOn, `${path}.checkedOn`, issues);
    requireInteger(check.calculatedBalanceKrw, `${path}.calculatedBalanceKrw`, issues);
    requireInteger(check.actualBalanceKrw, `${path}.actualBalanceKrw`, issues);
    optionalReference(check.adjustmentMovementId, movementIds, `${path}.adjustmentMovementId`, issues);
    if (!Number.isSafeInteger(check.calculatedBalanceKrw) || !Number.isSafeInteger(check.actualBalanceKrw)) return;
    const difference = check.actualBalanceKrw - check.calculatedBalanceKrw;
    if (!Number.isSafeInteger(difference)) {
      addIssue(issues, path, "unsafe_balance_difference", "Balance difference must be a safe whole-won amount.");
      return;
    }
    if (difference === 0) {
      if (check.adjustmentMovementId) {
        addIssue(issues, `${path}.adjustmentMovementId`, "adjustment_not_allowed", "Matching balances must not create an adjustment movement.");
      }
      return;
    }
    if (!check.adjustmentMovementId) {
      addIssue(issues, `${path}.adjustmentMovementId`, "adjustment_required", "A balance difference requires an adjustment movement.");
      return;
    }
    if (usedAdjustmentIds.has(check.adjustmentMovementId)) {
      addIssue(issues, `${path}.adjustmentMovementId`, "adjustment_reused", "An adjustment movement may reconcile only one balance check.");
    } else {
      usedAdjustmentIds.add(check.adjustmentMovementId);
    }
    const movement = movementById.get(check.adjustmentMovementId);
    if (!movement) return;
    if (movement.status !== "confirmed" || movement.kind !== "adjustment") {
      addIssue(issues, `${path}.adjustmentMovementId`, "confirmed_adjustment_required", "Balance checks require a confirmed adjustment movement.");
    }
    if (movement.postedOn !== check.checkedOn) {
      addIssue(issues, `${path}.adjustmentMovementId`, "adjustment_date_mismatch", "Adjustment date must match the balance check date.");
    }
    if (movement.amountKrw !== Math.abs(difference)) {
      addIssue(issues, `${path}.adjustmentMovementId`, "adjustment_amount_mismatch", "Adjustment amount must equal the balance difference.");
    }
    const directionMatches = difference > 0
      ? movement.toAccountId === check.accountId && !movement.fromAccountId
      : movement.fromAccountId === check.accountId && !movement.toAccountId;
    if (!directionMatches) {
      addIssue(issues, `${path}.adjustmentMovementId`, "adjustment_direction_mismatch", "Adjustment direction must reconcile the checked account.");
    }
  });
}

function requireText(value, path, issues) {
  if (typeof value !== "string" || !value.trim()) addIssue(issues, path, "text_required", "A non-empty value is required.");
}

function requireEnum(value, values, path, issues) {
  if (!values.includes(value)) addIssue(issues, path, "invalid_value", `Value must be one of: ${values.join(", ")}.`);
}

function requirePositiveInteger(value, path, issues) {
  if (!Number.isSafeInteger(value) || value <= 0) addIssue(issues, path, "positive_integer_required", "A positive integer is required.");
}

function requireInteger(value, path, issues) {
  if (!Number.isSafeInteger(value)) addIssue(issues, path, "integer_required", "A safe integer is required.");
}

function optionalBoundedInteger(value, minimum, maximum, path, issues) {
  if (value === undefined || value === null || value === "") return;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    addIssue(issues, path, "bounded_integer_required", `Value must be an integer between ${minimum} and ${maximum}.`);
  }
}

function requirePositiveMoney(value, path, issues) {
  if (!Number.isSafeInteger(value) || value <= 0) addIssue(issues, path, "positive_money_required", "A positive whole-won amount is required.");
}

function requireNonNegativeMoney(value, path, issues) {
  if (!Number.isSafeInteger(value) || value < 0) addIssue(issues, path, "non_negative_money_required", "A non-negative whole-won amount is required.");
}

function requireDate(value, path, issues) {
  if (!validDate(value)) addIssue(issues, path, "invalid_date", "Date must be a valid YYYY-MM-DD value.");
}

function optionalDate(value, path, issues) {
  if (value !== undefined && value !== null && value !== "" && !validDate(value)) addIssue(issues, path, "invalid_date", "Date must be a valid YYYY-MM-DD value.");
}

function requireMonth(value, path, issues) {
  if (!validMonth(value)) addIssue(issues, path, "invalid_month", "Month must be a valid YYYY-MM value.");
}

function requireReference(value, ids, path, issues) {
  if (!ID_PATTERN.test(String(value || "")) || !ids.has(value)) addIssue(issues, path, "missing_reference", "Referenced finance entity does not exist.");
}

function optionalReference(value, ids, path, issues) {
  if (value !== undefined && value !== null && value !== "") requireReference(value, ids, path, issues);
}

function validDate(value) {
  const match = String(value || "").match(DATE_PATTERN);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validMonth(value) {
  const match = String(value || "").match(MONTH_PATTERN);
  return Boolean(match && Number(match[2]) >= 1 && Number(match[2]) <= 12);
}
