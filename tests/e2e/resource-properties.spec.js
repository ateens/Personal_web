import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const rid = FIXTURE_IDS.bodySearchResource;
const definitions = [
  { id: "prop-text", name: "설명", type: "text", options: [] },
  { id: "prop-number", name: "점수", type: "number", options: [], numberFormat: "number" },
  { id: "prop-checkbox", name: "완료", type: "checkbox", options: [] },
  { id: "prop-select", name: "상태", type: "select", options: [{ id: "todo", name: "준비", color: "blue" }, { id: "done", name: "완료", color: "green" }] },
  { id: "prop-multi_select", name: "태그", type: "multi_select", options: [{ id: "a", name: "연구", color: "purple" }, { id: "b", name: "강의", color: "yellow" }] },
  { id: "prop-date", name: "기간", type: "date", options: [] },
];
const value = (page, type) => page.locator(`[data-resource-property-value="prop-${type}"][data-resource-id="${rid}"]`);
const picker = (page, type) => page.locator(`[data-resource-property-picker="prop-${type}"][data-resource-id="${rid}"]`);
const stored = async (request) => (await fixtureSnapshot(request)).state;
async function seed(request, patch = {}) {
  const before = await fixtureSnapshot(request);
  const state = structuredClone(before.state);
  state.settings.resourceProperties = structuredClone(definitions);
  Object.assign(state.resources.find((r) => r.id === rid), patch);
  expect((await request.put("/api/state", { headers: { "If-Match": `"state-${before.serverRevision}"` }, data: { state, baseRevision: before.serverRevision } })).ok()).toBeTruthy();
}
async function open(page) {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-action="toggle-nav"]').click();
  await page.locator('[data-nav-key="resources"]').click();
  await page.locator(`[data-resource-open="${rid}"]`).first().click();
  return page.locator(`[data-resource-properties="${rid}"]`);
}
test.use({ reducedMotion: "reduce" });
test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.addInitScript(() => {
    window.nativeConfirmCalls = 0;
    // WKWebView without a JavaScript confirm-panel delegate declines native confirms.
    window.confirm = () => { window.nativeConfirmCalls += 1; return false; };
  });
});

test("property deletion uses an in-app confirmation and clears all saved references", async ({ page, request }, info) => {
  await seed(request, { propertyValues: { "prop-multi_select": ["a", "b"] } });
  const before = await fixtureSnapshot(request);
  const state = structuredClone(before.state);
  state.resources.find((resource) => resource.id !== rid).propertyValues = { "prop-multi_select": ["a"] };
  state.settings.resourceViews = [{ id: "custom", name: "맞춤", filter: { id: "root", op: "and", rules: [{ id: "nested", op: "or", rules: [{ id: "tag-filter", propertyId: "prop-multi_select", operator: "contains", value: "a" }] }] }, sorts: [{ id: "sort", propertyId: "prop-multi_select", direction: "asc" }], groups: [{ id: "group", propertyId: "prop-multi_select", direction: "asc" }], visibleProperties: ["prop-multi_select"], layout: "table" }];
  state.settings.activeResourceViewId = "custom";
  expect((await request.put("/api/state", { headers: { "If-Match": `"state-${before.serverRevision}"` }, data: { state, baseRevision: before.serverRevision } })).ok()).toBeTruthy();
  await open(page);
  await page.locator(`.block-editor[data-owner-id="${rid}"] [data-block-content]`).first().focus();
  await page.locator('[data-property-id="prop-multi_select"]').click();
  const manager = page.locator("[data-resource-property-manager]");
  const definition = manager.locator('[data-property-definition="prop-multi_select"]');
  await definition.locator('[data-resource-property-action="delete"]').click();
  const confirmation = page.locator("[data-resource-property-confirm]");
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "취소", exact: true })).toBeFocused();
  await page.keyboard.press("Meta+Alt+t");
  await page.keyboard.press("Tab");
  await expect(confirmation.getByRole("button", { name: "삭제", exact: true })).toBeFocused();
  expect(await page.evaluate((id) => state.resources.find((resource) => resource.id === id).blocks, rid)).toEqual(state.resources.find((resource) => resource.id === rid).blocks);
  await page.keyboard.press("Shift+Tab");
  await confirmation.screenshot({ path: info.outputPath("resource-property-delete-confirmation.png") });
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(definition).toBeVisible();
  expect((await stored(request)).settings.resourceProperties.some((property) => property.id === "prop-multi_select")).toBe(true);
  await definition.locator('[data-resource-property-action="delete"]').click();
  await confirmation.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect.poll(async () => (await stored(request)).settings.resourceProperties.some((property) => property.id === "prop-multi_select")).toBe(false);
  const saved = await stored(request);
  expect(saved.resources.every((resource) => !Object.hasOwn(resource.propertyValues || {}, "prop-multi_select"))).toBe(true);
  expect(saved.settings.resourceViews[0]).toMatchObject({ filter: { rules: [{ rules: [] }] }, sorts: [], groups: [], visibleProperties: [] });
  expect(await page.evaluate(() => window.nativeConfirmCalls)).toBe(0);
  await manager.locator('[data-resource-property-action="close"]').click();
  await open(page);
  await expect(page.locator('[data-property-id="prop-multi_select"]')).toHaveCount(0);
});

test("incompatible property type changes cancel or explicitly clear values without native confirms", async ({ page, request }) => {
  await seed(request, { propertyValues: { "prop-number": 0 } });
  const before = await fixtureSnapshot(request);
  const state = structuredClone(before.state);
  state.settings.resourceViews = [{ id: "number-view", name: "점수 그룹", layout: "list", filter: { id: "number-filter", op: "and", rules: [] }, sorts: [], groups: [{ id: "number-group", propertyId: "prop-number", direction: "custom", customOrder: [0, null] }], visibleProperties: [] }];
  state.settings.activeResourceViewId = "number-view";
  expect((await request.put("/api/state", { headers: { "If-Match": `"state-${before.serverRevision}"` }, data: { state, baseRevision: before.serverRevision } })).ok()).toBeTruthy();
  await open(page);
  await page.locator('[data-property-id="prop-number"]').click();
  const definition = page.locator('[data-property-definition="prop-number"]');
  const type = definition.locator('[data-resource-property-config="type"]');
  const confirmation = page.locator("[data-resource-property-confirm]");
  await type.selectOption("text");
  await expect(type).toHaveValue("number");
  await confirmation.getByRole("button", { name: "취소", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  expect((await stored(request)).resources.find((resource) => resource.id === rid).propertyValues["prop-number"]).toBe(0);
  expect((await stored(request)).settings.resourceViews[0].groups[0].customOrder).toEqual([0, null]);
  await type.selectOption("text");
  await confirmation.getByRole("button", { name: "변경", exact: true }).click();
  await expect.poll(async () => (await stored(request)).settings.resourceProperties.find((property) => property.id === "prop-number").type).toBe("text");
  expect(Object.hasOwn((await stored(request)).resources.find((resource) => resource.id === rid).propertyValues, "prop-number")).toBe(false);
  expect((await stored(request)).settings.resourceViews[0].groups[0]).toEqual({ id: "number-group", propertyId: "prop-number", direction: "asc" });
  expect(await page.evaluate(() => window.nativeConfirmCalls)).toBe(0);
});

test("all six property types can be created through settings and survive reload", async ({ page, request }) => {
  const section = await open(page);
  await section.locator('[data-resource-property-action="manage"]').click();
  const dialog = page.locator("[data-resource-property-manager]");
  for (const property of definitions) {
    await dialog.locator('[data-resource-property-action="add"]').click();
    let row = dialog.locator("[data-property-definition][open]");
    await row.locator('[data-resource-property-config="name"]').fill(property.name);
    await row.locator('[data-resource-property-config="name"]').press("Tab");
    await row.locator('[data-resource-property-config="type"]').selectOption(property.type);
  }
  await dialog.locator('[data-resource-property-action="close"]').click();
  await expect.poll(async () => (await stored(request)).settings.resourceProperties?.map(({ name, type }) => ({ name, type }))).toEqual(definitions.map(({ name, type }) => ({ name, type })));
  await open(page);
  await expect(page.locator(".resource-property-row")).toHaveCount(6);
});

test("six value editors, option creation, dates and persistence work on mobile", async ({ page, request }, info) => {
  await seed(request);
  await page.setViewportSize({ width: 390, height: 1000 });
  await open(page);
  await value(page, "text").fill("한글 설명\n두 번째 줄");
  await value(page, "number").fill("0");
  await value(page, "number").press("Tab");
  await value(page, "checkbox").check();
  await picker(page, "select").locator("summary").click();
  await picker(page, "select").locator('[data-option-id="done"]').click();
  await picker(page, "multi_select").locator("summary").click();
  await picker(page, "multi_select").locator('[data-option-id="a"]').click();
  await picker(page, "multi_select").locator('[data-option-id="b"]').click();
  await picker(page, "multi_select").locator("[data-resource-option-search]").fill("새 태그");
  await picker(page, "multi_select").locator("[data-resource-option-search]").press("Enter");
  await picker(page, "multi_select").locator("summary").click();
  await picker(page, "date").locator("summary").click();
  await picker(page, "date").locator('[data-resource-date-part="includeTime"]').check();
  await picker(page, "date").locator('[data-resource-date-part="start"]').fill("2026-09-11T09:30");
  await picker(page, "date").locator('[data-resource-date-part="range"]').check();
  await picker(page, "date").locator('[data-resource-date-part="end"]').fill("2026-09-12T18:00");
  await picker(page, "date").locator("summary").click();
  await expect.poll(async () => (await stored(request)).resources.find((r) => r.id === rid).propertyValues?.["prop-date"]).toEqual({ start: "2026-09-11T09:30", end: "2026-09-12T18:00", includeTime: true });
  const persisted = (await stored(request)).resources.find((r) => r.id === rid).propertyValues;
  expect(persisted).toMatchObject({ "prop-text": "한글 설명\n두 번째 줄", "prop-number": 0, "prop-checkbox": true, "prop-select": "done" });
  expect(persisted["prop-multi_select"]).toHaveLength(3);
  await open(page);
  await expect(value(page, "text")).toHaveValue("한글 설명\n두 번째 줄");
  await expect(picker(page, "multi_select").locator("summary .resource-property-tag")).toHaveText(["연구", "강의", "새 태그"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.locator(`[data-resource-document="${rid}"]`).screenshot({ path: info.outputPath("resource-properties-mobile.png") });
});

test("options support names, colors, order, removal and single to multi conversion", async ({ page, request }) => {
  await seed(request, { propertyValues: { "prop-select": "done", "prop-multi_select": ["a", "b"] } });
  await open(page);
  await page.locator('[data-property-id="prop-select"]').click();
  const dialog = page.locator("[data-resource-property-manager]");
  const definition = dialog.locator('[data-property-definition="prop-select"]');
  const option = definition.locator('[data-option-id="done"]');
  await option.locator('[data-resource-option-config="name"]').fill("게시 완료");
  await option.locator('[data-resource-option-config="name"]').press("Tab");
  await option.locator('[data-resource-option-config="color"]').selectOption("pink");
  await option.locator('[data-resource-property-action="option-up"]').click();
  await definition.locator('[data-resource-property-config="type"]').selectOption("multi_select");
  await expect.poll(async () => (await stored(request)).resources.find((r) => r.id === rid).propertyValues["prop-select"]).toEqual(["done"]);
  const property = (await stored(request)).settings.resourceProperties.find((p) => p.id === "prop-select");
  expect(property.options[0]).toEqual({ id: "done", name: "게시 완료", color: "pink" });
  await definition.locator('[data-option-id="done"] [data-resource-property-action="option-delete"]').click();
  await page.locator('[data-resource-property-confirm] [data-resource-confirm="accept"]').click();
  await expect.poll(async () => (await stored(request)).resources.find((r) => r.id === rid).propertyValues["prop-select"]).toEqual([]);
  expect(await page.evaluate(() => window.nativeConfirmCalls)).toBe(0);
});

test("property collapse persists during editor changes, and locked values cannot be edited", async ({ page, request }) => {
  await seed(request);
  const section = await open(page);
  await section.locator(":scope > summary").click();
  const content = page.locator(`.block-editor[data-owner-id="${rid}"] [data-block-content]`).first();
  await content.fill("편집 중에도 속성은 닫힘");
  await expect(section).not.toHaveAttribute("open", "");
  await expect.poll(async () => (await stored(request)).resources.find((r) => r.id === rid).blocks[0].text).toBe("편집 중에도 속성은 닫힘");
  await page.goto("about:blank");
  await seed(request, { locked: true, propertyValues: { "prop-text": "잠긴 값" } });
  await open(page);
  await expect(value(page, "text")).toBeDisabled();
  await expect(value(page, "checkbox")).toBeDisabled();
  expect((await stored(request)).resources.find((r) => r.id === rid).propertyValues["prop-text"]).toBe("잠긴 값");
});

test("duplicate, type changes and delete preserve or explicitly clear values and view references", async ({ page, request }, info) => {
  await seed(request, { propertyValues: { "prop-number": 0.25, "prop-multi_select": ["a", "b"] } });
  await open(page);
  await page.locator('[data-property-id="prop-number"]').click();
  const dialog = page.locator("[data-resource-property-manager]");
  let definition = dialog.locator('[data-property-definition="prop-number"]');
  await definition.locator('[data-resource-property-config="numberFormat"]').selectOption("percent");
  await definition.locator('[data-resource-property-action="duplicate"]').click();
  await expect.poll(async () => (await stored(request)).settings.resourceProperties.length).toBe(7);
  const duplicated = (await stored(request)).settings.resourceProperties.find((property) => property.name === "점수 복사");
  expect((await stored(request)).resources.find((resource) => resource.id === rid).propertyValues[duplicated.id]).toBe(0.25);
  await dialog.locator('[data-resource-property-action="close"]').click();
  await page.locator('[data-property-id="prop-multi_select"]').click();
  definition = dialog.locator('[data-property-definition="prop-multi_select"]');
  await definition.locator('[data-resource-property-config="type"]').selectOption("select");
  await page.locator('[data-resource-property-confirm] [data-resource-confirm="cancel"]').click();
  await expect(page.locator("[data-resource-property-confirm]")).toHaveCount(0);
  await expect(definition.locator('[data-resource-property-config="type"]')).toHaveValue("multi_select");
  await definition.locator('[data-resource-property-config="type"]').selectOption("select");
  await page.locator('[data-resource-property-confirm] [data-resource-confirm="accept"]').click();
  await expect.poll(async () => (await stored(request)).resources.find((resource) => resource.id === rid).propertyValues["prop-multi_select"]).toBe("a");
  await definition.locator('[data-resource-property-action="property-up"]').click();
  await dialog.screenshot({ path: info.outputPath("resource-property-settings.png") });
  await definition.locator('[data-resource-property-action="delete"]').click();
  await page.locator('[data-resource-property-confirm] [data-resource-confirm="accept"]').click();
  await expect.poll(async () => (await stored(request)).settings.resourceProperties.some((property) => property.id === "prop-multi_select")).toBe(false);
  expect((await stored(request)).resources.every((resource) => !Object.hasOwn(resource.propertyValues || {}, "prop-multi_select"))).toBe(true);
  expect(await page.evaluate(() => window.nativeConfirmCalls)).toBe(0);
});

test("property keyboard focus isolates pending editor Tab and toggle shortcuts", async ({ page, request }) => {
  const blocks = [
    { id: "keyboard-toggle", type: "toggle", text: "열린 토글", marks: [], indent: 0, checked: false, collapsed: false },
    { id: "keyboard-child", type: "paragraph", text: "보존할 토글 내용", marks: [], indent: 1, checked: false, collapsed: false },
    { id: "keyboard-body", type: "paragraph", text: "본문", marks: [], indent: 0, checked: false, collapsed: false },
  ];
  await seed(request, { blocks });
  const section = await open(page);
  const editor = page.locator(`.block-editor[data-owner-id="${rid}"]`);
  const body = editor.locator('[data-block-content="keyboard-body"]');
  const toggle = editor.locator('[data-block-id="keyboard-toggle"]');

  await body.click();
  await body.press("Meta+ArrowRight");
  await body.press("Enter");
  const pending = await page.evaluate(() => ({ ...ui.pendingMarkdownTextTarget }));
  expect(pending.blockId).toBeTruthy();
  expect(pending.expiresAt).toBeGreaterThan(Date.now());
  const summary = section.locator(":scope > summary");
  await summary.click();
  await summary.press("Tab");
  await expect(editor.locator(`[data-block-id="${pending.blockId}"]`)).toHaveAttribute("data-indent", "0");
  await expect(editor.locator(`[data-block-content="${pending.blockId}"]`)).not.toBeFocused();
  await summary.click();

  // Programmatic/native focus restores retain recent editor context; property keys must still stay local.
  await body.focus();
  await value(page, "text").focus();
  await value(page, "text").press("Meta+Alt+t");
  await expect(value(page, "text")).toBeFocused();
  await expect(toggle).toHaveAttribute("data-toggle-collapsed", "false");

  await body.focus();
  await page.evaluate(() => openResourcePropertyManager("prop-text"));
  const dialog = page.locator("[data-resource-property-manager]");
  const name = dialog.locator('[data-property-definition="prop-text"] [data-resource-property-config="name"]');
  await expect(name).toBeFocused();
  await name.press("Meta+Alt+t");
  await expect(name).toBeFocused();
  await expect(toggle).toHaveAttribute("data-toggle-collapsed", "false");
  await name.press("Tab");
  await expect(dialog.locator('[data-property-definition="prop-text"] [data-resource-property-config="type"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await stored(request)).resources.find((resource) => resource.id === rid).blocks)
    .toEqual([...blocks, { id: pending.blockId, type: "paragraph", text: "", marks: [], indent: 0, checked: false, collapsed: false }]);
});
