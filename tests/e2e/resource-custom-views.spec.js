import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const OPTIONS = [{ id: "a", name: "검토", color: "blue" }, { id: "b", name: "완료", color: "green" }];
const PROPERTIES = [
  { id: "note", name: "메모", type: "text", options: [] },
  { id: "score", name: "점수", type: "number", options: [], numberFormat: "number" },
  { id: "done", name: "확인", type: "checkbox", options: [] },
  { id: "due", name: "기한", type: "date", options: [] },
  { id: "status", name: "상태", type: "select", options: OPTIONS },
  { id: "tags", name: "태그", type: "multi_select", options: OPTIONS },
];
const RESOURCE_IDS = [FIXTURE_IDS.resource, FIXTURE_IDS.bodySearchResource, FIXTURE_IDS.titleSearchResource];
const freshView = (id = "all") => ({ id, name: "전체 자료", filter: { id: `${id}-filter`, op: "and", rules: [] }, sorts: [], groups: [], visibleProperties: [], layout: "list" });

async function seed(request, configure = () => {}) {
  await resetFixture(request);
  const before = await fixtureSnapshot(request);
  const state = structuredClone(before.state);
  state.settings.resourceProperties = structuredClone(PROPERTIES);
  state.settings.resourceViews = [freshView()];
  state.settings.activeResourceViewId = "all";
  state.resources = RESOURCE_IDS.map((id, index) => ({
    ...state.resources.find((resource) => resource.id === id),
    title: ["자료 Alpha", "자료 Beta", "자료 Gamma"][index],
    propertyValues: [
      { note: "연구 초안", score: 30, done: false, due: { start: "2026-09-11", end: "", includeTime: false }, status: "a", tags: ["a", "b"] },
      { note: "연구 완료", score: 20, done: true, due: { start: "2026-09-12", end: "", includeTime: false }, status: "b", tags: ["b"] },
      { note: "문서 초안", score: 10, done: false, due: { start: "2026-09-13", end: "", includeTime: false }, status: "a", tags: [] },
    ][index],
  }));
  state.resources.push(...before.state.resources.filter((resource) => !RESOURCE_IDS.includes(resource.id)).map((resource) => ({ ...resource, trashedAt: "2026-09-01T00:00:00.000Z" })));
  configure(state);
  const result = await request.put("/api/state", { headers: { "If-Match": `"state-${before.serverRevision}"` }, data: { state, baseRevision: before.serverRevision } });
  expect(result.ok(), await result.text()).toBeTruthy();
  return state;
}

async function open(page) {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-action="toggle-nav"]').click();
  await page.locator('[data-nav-key="resources"]').click();
  await expect(page.locator("[data-resource-view]")).toBeVisible();
}
const items = (page) => page.locator(".resource-groups [data-resource-open]");
async function panel(page, name) {
  for (const key of ["settings", name].filter((key, index, all) => all.indexOf(key) === index)) {
    const node = page.locator(`[data-resource-view-detail="${key}"]`);
    if (!(await node.evaluate((element) => element.open))) await node.locator(":scope > summary").click();
  }
  return page.locator(`[data-resource-view-detail="${name}"]`);
}
async function addRule(page, group, property, operator, value) {
  await group.locator(':scope > .resource-filter-add [data-resource-view-action="add-rule"]').click();
  const rule = group.locator(':scope > [data-resource-filter-rule]').last();
  const id = await rule.getAttribute("data-resource-filter-rule");
  const stable = page.locator(`[data-resource-filter-rule="${id}"]`);
  await stable.locator('[data-resource-view-field="filter-property"]').selectOption(property);
  await stable.locator('[data-resource-view-field="filter-operator"]').selectOption(operator);
  if (value !== undefined) {
    const input = stable.locator('[data-resource-view-field="filter-value"]');
    if ((await input.evaluate((element) => element.tagName)) === "SELECT") await input.selectOption(String(value));
    else { await input.fill(String(value)); await input.press("Tab"); }
  }
  return stable;
}
async function saved(request, predicate) {
  await expect.poll(async () => predicate((await fixtureSnapshot(request)).state)).toBe(true);
}

test("nested AND/OR filters combine independent conditions and persist", async ({ page, request }) => {
  await seed(request);
  await open(page);
  await panel(page, "filters");
  const root = page.locator('[data-resource-filter-group="all-filter"]');
  await addRule(page, root, "score", "gte", 20);
  await root.locator(':scope > .resource-filter-add [data-resource-view-action="add-group"]').click();
  const nested = root.locator(':scope > [data-resource-filter-group]');
  await addRule(page, nested, "note", "ends_with", "초안");
  await addRule(page, nested, "status", "equals", "b");
  await expect(items(page)).toHaveText(["자료 Alpha", "자료 Beta"]);
  await nested.locator(':scope > .resource-filter-group-header [data-resource-view-field="filter-op"]').selectOption("and");
  await expect(items(page)).toHaveCount(0);
  await nested.locator(':scope > .resource-filter-group-header [data-resource-view-field="filter-op"]').selectOption("or");
  await saved(request, (state) => state.settings.resourceViews[0].filter.rules[1]?.rules?.length === 2 && state.settings.resourceViews[0].filter.rules[1].op === "or");
  await page.reload();
  await expect(items(page)).toHaveText(["자료 Alpha", "자료 Beta"]);
  await panel(page, "filters");
  await page.locator('[data-resource-filter-group="all-filter"] > [data-resource-filter-group] > .resource-filter-group-header [data-resource-view-action="remove-filter"]').click();
  await expect(items(page)).toHaveText(["자료 Alpha", "자료 Beta"]);
});

test("type-specific filters support numeric ranges, booleans, dates and option sets", async ({ page, request }) => {
  await seed(request);
  await open(page);
  await panel(page, "filters");
  const root = page.locator('[data-resource-filter-group="all-filter"]');
  const cases = [
    ["done", "equals", "true", ["자료 Beta"]],
    ["status", "not_equals", "b", ["자료 Alpha", "자료 Gamma"]],
    ["due", "before", "2026-09-13", ["자료 Alpha", "자료 Beta"]],
    ["tags", "is_empty", undefined, ["자료 Gamma"]],
  ];
  for (const [property, operator, value, expected] of cases) {
    const rule = await addRule(page, root, property, operator, value);
    await expect(items(page)).toHaveText(expected);
    await rule.locator('[data-resource-view-action="remove-filter"]').click();
  }
  const range = await addRule(page, root, "score", "between");
  await range.locator('[data-part="start"]').fill("15");
  await range.locator('[data-part="start"]').press("Tab");
  await range.locator('[data-part="end"]').fill("25");
  await range.locator('[data-part="end"]').press("Tab");
  await expect(items(page)).toHaveText(["자료 Beta"]);
  await range.locator('[data-resource-view-action="remove-filter"]').click();
  const tags = await addRule(page, root, "tags", "contains_all");
  await tags.locator("summary").click();
  await tags.locator('[data-option-id="a"]').check();
  await tags.locator('[data-option-id="b"]').check();
  await expect(items(page)).toHaveText(["자료 Alpha"]);
  await tags.locator('[data-resource-view-field="filter-operator"]').selectOption("contains_any");
  // The native details remains open while its selected values are replaced.
  await tags.locator('[data-option-id="b"]').check();
  await expect(items(page)).toHaveText(["자료 Alpha", "자료 Beta"]);
  await tags.locator('[data-resource-view-action="remove-filter"]').click();
  const relative = await addRule(page, root, "due", "relative");
  await relative.locator('[data-part="period"]').selectOption("past_days");
  await relative.locator('[data-part="days"]').fill("10");
  await relative.locator('[data-part="days"]').press("Tab");
  await saved(request, (state) => state.settings.resourceViews[0].filter.rules[0]?.value?.days === 10);
});

test("saved views create, rename, duplicate, reorder, delete and retain table columns", async ({ page, request }) => {
  await seed(request);
  await open(page);
  await page.locator('[data-resource-view-action="add"]').click();
  const name = page.locator('[data-resource-view-field="name"]');
  await name.fill("검토 표");
  await name.press("Tab");
  await page.locator('[data-resource-view-field="layout"]').selectOption("table");
  const properties = await panel(page, "properties");
  await properties.locator('[data-key="score"][data-resource-view-field="visible-property"]').check();
  await properties.locator('[data-key="status"][data-resource-view-field="visible-property"]').check();
  await properties.locator('[data-kind="visibleProperties"][data-key="status"][data-direction="-1"]').click();
  await expect(page.locator(".resource-view-table th")).toHaveText(["제목", "상태", "점수"]);
  await page.locator('[data-resource-view-action="duplicate"]').click();
  await expect(page.locator('[data-resource-view-action="select"]')).toHaveText(["전체 자료", "검토 표", "검토 표 복사본"]);
  await page.locator('[data-kind="views"][data-direction="-1"]').click();
  await expect(page.locator('[data-resource-view-action="select"]')).toHaveText(["전체 자료", "검토 표 복사본", "검토 표"]);
  await page.locator('[data-resource-view-action="delete"]').click();
  await expect(page.locator('[data-resource-view-action="select"]')).toHaveText(["전체 자료", "검토 표"]);
  await page.locator('[data-resource-view-action="select"]').filter({ hasText: /^검토 표$/ }).click();
  await saved(request, (state) => state.settings.resourceViews.length === 2 && state.settings.resourceViews.find((view) => view.id === state.settings.activeResourceViewId)?.name === "검토 표");
  await page.reload();
  await expect(page.locator(".resource-view-table th")).toHaveText(["제목", "상태", "점수"]);
  await expect(page.locator('.resource-view-table [data-resource-cell="status"]').first()).toContainText("검토");
  await expect(page.locator('.resource-view-table [data-resource-cell="score"]').first()).toContainText("30");
});

test("prioritized sorts and nested groups reorder without changing stored resource order", async ({ page, request }) => {
  const initial = await seed(request);
  await open(page);
  const sorts = await panel(page, "sorts");
  await sorts.locator('[data-resource-view-action="add-order"]').click();
  await sorts.locator('[data-resource-view-field="order-property"]').selectOption("status");
  await sorts.locator('[data-resource-view-action="add-order"]').click();
  await sorts.locator('[data-resource-view-field="order-property"]').last().selectOption("score");
  await expect(items(page)).toHaveText(["자료 Gamma", "자료 Alpha", "자료 Beta"]);
  await sorts.locator('[data-direction="-1"]').last().click();
  await expect(items(page)).toHaveText(["자료 Gamma", "자료 Beta", "자료 Alpha"]);
  await sorts.locator('[data-resource-view-field="order-direction"]').first().selectOption("desc");
  await expect(items(page)).toHaveText(["자료 Alpha", "자료 Beta", "자료 Gamma"]);
  const groups = await panel(page, "groups");
  await groups.locator('[data-resource-view-action="add-order"]').click();
  await groups.locator('[data-resource-view-field="order-property"]').selectOption("status");
  await groups.locator('[data-resource-view-action="add-order"]').click();
  await groups.locator('[data-resource-view-field="order-property"]').last().selectOption("done");
  const topGroups = page.locator(".resource-groups > .resource-custom-group");
  await expect(topGroups).toHaveCount(2);
  await expect(topGroups.first().locator(":scope > summary")).toContainText("검토");
  await expect(topGroups.first().locator(".resource-custom-group")).toHaveCount(1);
  await topGroups.first().locator(":scope > summary").click();
  await expect(topGroups.first()).not.toHaveAttribute("open");
  await groups.locator('[data-resource-view-field="order-direction"]').first().selectOption("desc");
  await expect(topGroups.first().locator(":scope > summary")).toContainText("완료");
  await groups.locator('[data-direction="-1"]').last().click();
  await expect(topGroups.first().locator(":scope > summary")).toContainText("확인");
  await saved(request, (state) => state.settings.resourceViews[0].groups[0]?.propertyId === "done");
  expect((await fixtureSnapshot(request)).state.resources.map((resource) => resource.id)).toEqual(initial.resources.map((resource) => resource.id));
  await page.reload();
  await expect(page.locator(".resource-groups > .resource-custom-group").first().locator(":scope > summary")).toContainText("확인");
});

for (const width of [1440, 390]) test(`view controls, nested filters and wide property tables stay within ${width}px`, async ({ page, request }, testInfo) => {
  await seed(request, (state) => {
    const view = state.settings.resourceViews[0];
    view.layout = "table";
    view.visibleProperties = PROPERTIES.map((property) => property.id);
    view.groups = [{ id: "tags-group", propertyId: "tags", direction: "asc" }, { id: "status-group", propertyId: "status", direction: "desc" }];
    view.filter.rules.push({ id: "nested", op: "or", rules: [{ id: "nested-again", op: "and", rules: [{ id: "text-rule", propertyId: "note", operator: "contains", value: "" }] }] });
  });
  await page.setViewportSize({ width, height: 1000 });
  await open(page);
  await panel(page, "filters");
  await expect(page.locator('[data-resource-filter-rule="text-rule"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  const scroller = page.locator(".resource-view-table-scroll").first();
  await scroller.scrollIntoViewIfNeeded();
  const geometry = await scroller.evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
    return { x: node.getBoundingClientRect().x, right: node.getBoundingClientRect().right, scrollLeft: node.scrollLeft, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth };
  });
  expect(geometry.x).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(width);
  if (width === 390) {
    expect(geometry.scrollLeft).toBeGreaterThan(0);
    expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth);
  }
  await expect(page.locator('[data-resource-view-field="layout"]')).toHaveValue("table");
  expect(await page.locator('[data-resource-view-field="layout"]').evaluate((node) => node.selectedOptions[0].textContent)).toBe("표");
  await page.evaluate(() => {
    document.activeElement?.blur();
    document.querySelectorAll(".resource-view-table-scroll").forEach((node) => { node.scrollLeft = 0; });
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: testInfo.outputPath(`resource-custom-view-${width}.png`), fullPage: true });
  await saved(request, (state) => state.settings.resourceViews[0].visibleProperties.length === 6);
});

test("invalid ranges stay unsaved and view settings persist beside a pending document edit", async ({ page, request }) => {
  await seed(request);
  await open(page);
  await panel(page, "filters");
  const rule = await addRule(page, page.locator('[data-resource-filter-group="all-filter"]'), "score", "between");
  await rule.locator('[data-part="start"]').fill("15");
  await rule.locator('[data-part="start"]').press("Tab");
  await rule.locator('[data-part="end"]').fill("25");
  await rule.locator('[data-part="end"]').press("Tab");
  await saved(request, (state) => state.settings.resourceViews[0].filter.rules[0]?.value?.end === 25);
  await rule.locator('[data-part="start"]').fill("50");
  await rule.locator('[data-part="start"]').press("Tab");
  await expect(rule.locator('[data-part="start"]')).toHaveValue("15");
  await expect(items(page)).toHaveText(["자료 Beta"]);
  await expect(page.locator("#toast")).toContainText("필터 값과 범위");
  await rule.locator('[data-resource-view-action="remove-filter"]').click();
  await page.locator('[data-resource-view-detail="settings"] > summary').click();
  await items(page).first().click();
  await page.locator(`[data-resource-title="${RESOURCE_IDS[0]}"]`).fill("자료 편집과 보기 저장");
  await page.locator('[data-resource-view-action="add"]').evaluate((button) => button.click());
  await page.locator('[data-resource-view-field="name"]').fill("동시에 저장한 보기");
  await page.locator('[data-resource-view-field="name"]').press("Tab");
  await saved(request, (state) => state.resources.find((resource) => resource.id === RESOURCE_IDS[0]).title === "자료 편집과 보기 저장" && state.settings.resourceViews.some((view) => view.name === "동시에 저장한 보기"));
  await page.reload();
  await expect(page.locator('[data-resource-view-action="select"].is-active')).toHaveText("동시에 저장한 보기");
  await expect(items(page).first()).toHaveText("자료 편집과 보기 저장");
});
