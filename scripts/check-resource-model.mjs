import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import "../resource-model.js";
import { normalizeAppStateForStorage, SUPPORTED_MARK_TYPES } from "../server/storage.js";
import { createFixtureState } from "../tests/fixtures/state.mjs";

const model = globalThis.SYGMAResourceModel;
const option = (id, color = "blue") => ({ id, name: id.toUpperCase(), color });
const properties = [
  { id: "summary", name: "설명", type: "text", options: [] },
  { id: "score", name: "점수", type: "number", options: [], numberFormat: "number" },
  { id: "done", name: "완료", type: "checkbox", options: [] },
  { id: "due", name: "날짜", type: "date", options: [] },
  { id: "status", name: "단계", type: "select", options: [option("a"), option("b")] },
  { id: "tags", name: "태그", type: "multi_select", options: [option("x"), option("y", "green")] },
];
const state = {
  settings: model.normalizeSettings({ resourceProperties: properties, unrelatedPreference: true }),
  boxes: [{ id: "box", name: "연구" }], projects: [],
  resources: [
    { id: "one", title: "자료 2", boxId: "box", createdAt: "2026-09-11T01:00:00Z", propertyValues: { summary: "Alpha beta", score: 0, done: false, status: "a", tags: ["x", "y"], due: { start: "2026-09-11T10:30", end: "2026-09-12T11:30", includeTime: true } } },
    { id: "two", title: "자료 10", propertyValues: { summary: "Gamma", score: -1, done: true, status: "b", tags: ["x"], due: { start: "2026-08-31", end: "", includeTime: false } } },
    { id: "empty", title: "자료 1", propertyValues: {} },
    { id: "tie", title: "자료 2", propertyValues: { score: 0 } },
  ],
};
const rule = (propertyId, operator, value) => ({ id: "rule", propertyId, operator, value });
const matches = (property, operator, value, resource = state.resources[0]) => model.matchesFilter(resource, rule(property, operator, value), state, "2026-09-11");
assert.deepEqual(model.validateState(state), []);
assert.equal(state.settings.unrelatedPreference, true);
assert.equal(state.settings.activeResourceViewId, "all");
assert.deepEqual(model.normalizeSettings(state.settings), state.settings, "valid settings remain unchanged after normalization");
assert.deepEqual(model.normalizeSettings({ resourceProperties: [{ id: "p", name: "P", type: "text" }] }).resourceProperties[0].options, []);
for (const malformed of [[null], [{ id: "v", filter: null, groups: null }], [{ id: "v", filter: { id: "f", rules: null } }]]) {
  const normalizedView = model.normalizeSettings({ resourceViews: malformed }).resourceViews[0];
  assert(Array.isArray(normalizedView.groups) && Array.isArray(normalizedView.filter.rules));
}
const wrappedFilter = model.normalizeSettings({ resourceViews: [{ id: "v", filter: rule("score", "equals", 0) }] }).resourceViews[0].filter;
assert.deepEqual(wrappedFilter.rules, [rule("score", "equals", 0)], "normalization must preserve a root condition inside a group");

for (const [property, operator, value, expected] of [
  ["summary", "contains", "ALPHA", true], ["summary", "not_contains", "Beta", false],
  ["summary", "equals", "alpha beta", true], ["summary", "not_equals", "alpha beta", false],
  ["summary", "starts_with", "alpha", true], ["summary", "ends_with", "beta", true],
  ["summary", "is_empty", "", false], ["summary", "is_not_empty", "", true],
  ["score", "equals", 0, true], ["score", "not_equals", 0, false],
  ["score", "gt", -1, true], ["score", "gte", 0, true], ["score", "lt", 0, false], ["score", "lte", 0, true],
  ["score", "between", { start: 0, end: 10 }, true], ["score", "is_empty", "", false],
  ["done", "equals", false, true], ["done", "not_equals", true, true],
  ["status", "equals", "a", true], ["status", "not_equals", "b", true],
  ["status", "is_any_of", ["b", "a"], true], ["status", "is_none_of", ["a"], false],
  ["tags", "contains", "x", true], ["tags", "does_not_contain", "y", false],
  ["tags", "contains_all", ["x", "y"], true], ["tags", "contains_any", ["absent", "y"], true],
  ["tags", "contains_none", ["absent"], true], ["tags", "is_empty", "", false],
  ["due", "on", "2026-09-11", true], ["due", "on", "2026-09-11T10:30", true],
  ["due", "before", "2026-09-11", false], ["due", "after", "2026-09-10", true],
  ["due", "on_or_before", "2026-09-11", true], ["due", "on_or_after", "2026-09-11", true],
  ["due", "between", { start: "2026-09-10", end: "2026-09-11" }, true],
  ["due", "relative", { period: "today" }, true], ["due", "relative", { period: "yesterday" }, false],
  ["due", "relative", { period: "this_week" }, true], ["due", "relative", { period: "last_week" }, false],
  ["due", "relative", { period: "this_month" }, true], ["due", "relative", { period: "next_month" }, false],
  ["due", "relative", { period: "past_days", days: 3 }, true], ["due", "relative", { period: "next_days", days: 3 }, true],
]) assert.equal(matches(property, operator, value), expected, `${property}: ${operator} ${JSON.stringify(value)}`);

assert.equal(matches("score", "equals", 0, state.resources[2]), false, "unset must differ from zero");
assert.equal(matches("done", "equals", false, state.resources[2]), true, "unset checkbox is unchecked");
assert.equal(matches("due", "relative", { period: "last_month" }, state.resources[1]), true);
for (const [period, date, expected] of [["past_days", "2026-09-09", true], ["past_days", "2026-09-08", false], ["next_days", "2026-09-13", true], ["next_days", "2026-09-14", false]]) {
  assert.equal(matches("due", "relative", { period, days: 3 }, { propertyValues: { due: { start: date, end: "", includeTime: false } } }), expected, "N days include today exactly once");
}
for (const [period, date, expected] of [
  ["this_week", "2026-09-07", true], ["this_week", "2026-09-13", true], ["this_week", "2026-09-14", false],
  ["last_week", "2026-09-06", true], ["next_week", "2026-09-20", true],
  ["last_month", "2026-08-31", true], ["next_month", "2026-10-01", true],
  ["yesterday", "2026-09-10", true], ["tomorrow", "2026-09-12", true],
]) assert.equal(matches("due", "relative", { period }, { propertyValues: { due: { start: date, end: "", includeTime: false } } }), expected);

const nested = { id: "root", op: "and", rules: [
  { ...rule("score", "gte", 0), id: "number" },
  { id: "child", op: "or", rules: [{ ...rule("status", "equals", "b"), id: "status" }, { ...rule("tags", "contains_all", ["x", "y"]), id: "tags" }] },
] };
assert.deepEqual(model.applyView(state.resources, { filter: nested }, state).map((resource) => resource.id), ["one"]);
assert.deepEqual(model.applyView(state.resources, { sorts: [{ propertyId: "score", direction: "desc" }, { propertyId: "title", direction: "desc" }] }, state).map((resource) => resource.id), ["one", "tie", "two", "empty"]);
assert.deepEqual(model.applyView(state.resources, { sorts: [{ propertyId: "title", direction: "asc" }] }, state).map((resource) => resource.id), ["empty", "one", "tie", "two"]);
const customOptionOrder = structuredClone(state);
customOptionOrder.settings.resourceProperties.find((property) => property.id === "status").options.reverse();
assert.deepEqual(model.applyView(customOptionOrder.resources, { sorts: [{ propertyId: "status", direction: "asc" }] }, customOptionOrder).map((resource) => resource.id), ["two", "one", "empty", "tie"], "choice sort must follow configured option order instead of labels");
assert.equal(model.compareValues(["y", "x"], ["x", "y"], properties[5]), 0, "same tags retain stable ordering regardless of selection click order");
assert(model.compareValues(["x"], ["y"], properties[5]) < 0);
assert.deepEqual(model.groupValueKeys(state.resources[0], "tags"), ["x", "y"]);
assert.deepEqual(model.groupValueKeys(state.resources[2], "score"), [null]);
assert.deepEqual(model.groupValueKeys(state.resources[0], "score"), [0]);
assert.deepEqual(model.groupValueKeys(state.resources[2], "done", state), [false]);
assert.deepEqual(model.groupValueKeys(state.resources[0], "due"), ["2026-09-11"]);
assert.equal(model.displayValue("box", model.getProperties(state).find((property) => property.id === "boxId")), "연구");
assert.equal(model.displayValue(["x", "y"], properties[5]), "X, Y");
assert.match(model.displayValue(0.25, { type: "number", numberFormat: "percent" }), /25/);
assert.equal(model.displayValue("2026-09-11", { type: "date" }), "2026-09-11");

for (const corrupt of [
  (draft) => { draft.settings.resourceProperties[0].id = "title"; },
  (draft) => { draft.settings.resourceProperties[4].options.push(option("a")); },
  (draft) => { draft.settings.resourceProperties[0].type = "script"; },
  (draft) => { draft.settings.resourceProperties[0].options = {}; },
  (draft) => { draft.resources[0].propertyValues.score = "0"; },
  (draft) => { draft.resources[0].propertyValues.score = Infinity; },
  (draft) => { draft.resources[0].propertyValues.done = "false"; },
  (draft) => { draft.resources[0].propertyValues.status = "missing"; },
  (draft) => { draft.resources[0].propertyValues.tags = ["x", "x"]; },
  (draft) => { draft.resources[0].propertyValues.due.start = "2026-02-30"; },
  (draft) => { draft.resources[0].propertyValues.due.end = "2026-09-10"; },
  (draft) => { draft.resources[0].propertyValues.due.start = "2026-09-11T25:00"; },
  (draft) => { draft.settings.activeResourceViewId = "absent"; },
  (draft) => { draft.settings.resourceViews[0].filter = rule("score", "contains", 0); },
  (draft) => { draft.settings.resourceViews[0].filter = rule("due", "relative", { period: "past_days", days: -1 }); },
  (draft) => { draft.settings.resourceViews[0].filter = rule("due", "between", { start: "2026-09-12", end: "2026-09-11" }); },
  (draft) => { draft.settings.resourceViews[0].sorts = [{ id: "s", propertyId: "missing", direction: "asc" }]; },
]) {
  const draft = structuredClone(state);
  corrupt(draft);
  assert(model.validateState(draft).length > 0, corrupt.toString());
}
const deepState = structuredClone(state);
deepState.settings.resourceViews[0].filter = nested;
assert.deepEqual(model.validateState(deepState), []);
for (let depth = 0; depth < 20; depth += 1) deepState.settings.resourceViews[0].filter = { id: `depth-${depth}`, op: "and", rules: [deepState.settings.resourceViews[0].filter] };
assert(model.validateState(deepState).some((issue) => issue.message.includes("16 levels")));
const normalized = normalizeAppStateForStorage(structuredClone({ ...state, version: 4, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })).state;
assert.deepEqual(normalized.settings.resourceProperties, state.settings.resourceProperties, "storage normalization must preserve property definitions");
assert.deepEqual(normalized.resources[0].propertyValues, state.resources[0].propertyValues, "storage normalization must preserve typed property values");
assert.deepEqual(normalized.settings.resourceViews, state.settings.resourceViews, "storage normalization must preserve saved views");
const server = await readFile(new URL("../server.js", import.meta.url), "utf8");
assert.match(server, /import "\.\/resource-model\.js";/);
assert.match(server, /SYGMAResourceModel\.validateState\(state\)/, "production writes must use the same Resource validation");
const constants = server.slice(server.indexOf("const STATE_VERSION ="), server.indexOf("async function loadLocalEnv"));
const declarations = [...server.matchAll(/^(?:async )?function \w+\([^]*?^}/gm)].map(([source]) => source).join("\n");
const validateIncomingState = vm.runInNewContext(`${constants}\n${declarations}\nvalidateIncomingState`, { URL, Buffer, SUPPORTED_MARK_TYPES, SYGMAResourceModel: model });
const completeState = createFixtureState();
completeState.settings = state.settings;
completeState.resources[0].propertyValues = state.resources[0].propertyValues;
assert.doesNotThrow(() => validateIncomingState(completeState), "production validator must accept typed property state");
let deepestAllowedFilter = rule("score", "equals", 0);
for (let depth = 0; depth < model.MAX_FILTER_DEPTH; depth += 1) deepestAllowedFilter = { id: `allowed-${depth}`, op: "and", rules: [deepestAllowedFilter] };
completeState.settings = structuredClone(state.settings);
completeState.settings.resourceViews[0].filter = deepestAllowedFilter;
assert.doesNotThrow(() => validateIncomingState(completeState), "production JSON depth guard must allow all supported filter levels");
completeState.resources[0].propertyValues = { score: "not a number" };
assert.throws(() => validateIncomingState(completeState), (error) => error.status === 422 && error.details.issues.some((issue) => issue.path.endsWith("propertyValues.score")), "production validator must reject invalid typed values before writes");
for (const inheritedType of ["__proto__", "constructor"]) {
  assert.deepEqual(model.filterOperators(inheritedType), []);
  const maliciousState = createFixtureState();
  maliciousState.settings = structuredClone(state.settings);
  maliciousState.settings.resourceProperties[0].type = inheritedType;
  maliciousState.settings.resourceViews[0].filter.rules.push(rule("summary", "contains", "x"));
  assert.throws(() => validateIncomingState(maliciousState), (error) => error.status === 422 && error.details.issues.some((issue) => issue.path.endsWith("resourceProperties[0].type")), "inherited object names must return validation issues, not crash the server");
}
console.log("Resource model checks passed: typed properties, filter operators, nested groups, relative dates, sorting, validation, and storage preservation.");
