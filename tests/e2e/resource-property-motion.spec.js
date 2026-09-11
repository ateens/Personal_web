import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const resourceId = FIXTURE_IDS.bodySearchResource;
const ids = [FIXTURE_IDS.resource, resourceId, FIXTURE_IDS.titleSearchResource];
const properties = [
  { id: "motion-text", name: "설명", type: "text", options: [] },
  { id: "motion-number", name: "점수", type: "number", options: [] },
  { id: "motion-bool", name: "확인", type: "checkbox", options: [] },
  { id: "motion-select", name: "상태", type: "select", options: [{ id: "a", name: "진행 중", color: "blue" }, { id: "b", name: "검토 완료", color: "green" }] },
  { id: "motion-multi", name: "태그", type: "multi_select", options: [{ id: "a", name: "연구 자료", color: "purple" }] },
  { id: "motion-date", name: "날짜", type: "date", options: [] },
];

async function seed(request) {
  await resetFixture(request);
  const snapshot = await fixtureSnapshot(request);
  const state = structuredClone(snapshot.state);
  state.settings.resourceProperties = structuredClone(properties);
  state.settings.resourceViews = ["all", "sorted"].map((id) => ({
    id, name: id === "all" ? "전체" : "점수순", layout: "list", visibleProperties: [], groups: [],
    filter: { id: `${id}-filter`, op: "and", rules: [] },
    sorts: id === "sorted" ? [{ id: "score-sort", propertyId: "motion-number", direction: "asc" }] : [],
  }));
  state.settings.activeResourceViewId = "all";
  state.resources = ids.map((id, index) => ({
    ...state.resources.find((resource) => resource.id === id), title: ["자료 Alpha", "자료 Beta", "자료 Gamma"][index], commentThreads: [],
    propertyValues: { "motion-number": [30, 20, 10][index], "motion-select": "a", "motion-text": "여유 있는 속성 편집" },
    blocks: [{ id: `body-${index}`, type: "paragraph", text: "전환 중에도 보존할 본문", marks: [], indent: 0, checked: false, collapsed: false }],
  }));
  state.resources.push(...snapshot.state.resources.filter((resource) => !ids.includes(resource.id)).map((resource) => ({ ...resource, trashedAt: "2026-09-01T00:00:00.000Z" })));
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${snapshot.serverRevision}"` }, data: { state, baseRevision: snapshot.serverRevision },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function openList(page) {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-nav-key="resources"]').evaluate((button) => button.click());
  await expect(page.locator("[data-resource-view]")).toBeVisible();
}

async function openDocument(page) {
  await page.locator(`[data-resource-open="${resourceId}"]`).click();
  const document = page.locator(`[data-resource-document="${resourceId}"]`);
  await expect(document).toBeVisible();
  await settle(page.locator(`[data-resource-window="${resourceId}"]`));
  return document;
}

async function dockDocument(page) {
  const window = page.locator(`[data-resource-window="${resourceId}"]`);
  const bar = await window.locator("[data-resource-window-drag]").boundingBox();
  await page.mouse.move(bar.x + 100, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(page.viewportSize().width - 10, 60, { steps: 12 });
  await page.mouse.up();
  await expect(window).toHaveAttribute("data-docked", "true");
  await settle(window);
}

async function settle(element) {
  await element.evaluate(async (node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))));
}

async function openPanel(page, key) {
  for (const name of ["settings", key].filter((name, index, names) => names.indexOf(name) === index)) {
    const details = page.locator(`[data-resource-view-detail="${name}"]`);
    if (!(await details.evaluate((node) => node.open))) await details.locator(":scope > summary").click();
    await settle(details);
  }
  return page.locator(`[data-resource-view-detail="${key}"]`);
}

async function recordMotion(page) {
  await page.evaluate(() => {
    window.__resourceMotion = [];
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = original.apply(this, args);
      const target = this.matches("[data-resource-property-manager]") ? "manager"
        : this.matches(".resource-groups") ? "groups"
          : this.matches(".resource-property-popover") ? "picker" : "other";
      window.__resourceMotion.push({ target, duration: animation.effect.getTiming().duration, frames: animation.effect.getKeyframes() });
      return animation;
    };
  });
}

async function countMotion(page, target) {
  return page.evaluate((target) => window.__resourceMotion.filter((entry) => entry.target === target && entry.duration > 0).length, target);
}

async function roomyControls(root) {
  const invalid = await root.locator('button, summary, select, input:not([type="checkbox"]):not([type="radio"]), textarea, .resource-property-check').evaluateAll((controls) => controls
    .filter((control) => control.getClientRects().length && getComputedStyle(control).visibility !== "hidden" && control.getAttribute("aria-hidden") !== "true")
    .map((control) => ({ tag: control.tagName, text: control.getAttribute("aria-label") || control.textContent.trim().slice(0, 32), height: control.getBoundingClientRect().height }))
    .filter((control) => control.height < 43.5));
  expect(invalid).toEqual([]);
}

async function assertSmoothHeight(details) {
  const before = await details.evaluate((node) => node.getBoundingClientRect().height);
  await details.locator(":scope > summary").click();
  const samples = await details.evaluate(async (node) => {
    const heights = [];
    for (let frame = 0; frame < 24; frame += 1) {
      await new Promise(requestAnimationFrame);
      heights.push(node.getBoundingClientRect().height);
    }
    return heights;
  });
  await settle(details);
  const after = await details.evaluate((node) => node.getBoundingClientRect().height);
  expect(Math.abs(after - before)).toBeGreaterThan(10);
  expect(samples.some((height) => height > Math.min(before, after) + 1 && height < Math.max(before, after) - 1)).toBe(true);
  expect(await details.evaluate((node) => ({ height: node.style.height, overflow: node.style.overflow }))).toEqual({ height: "", overflow: "" });
}

test("Resource controls have room on desktop and 390px screens without horizontal overflow", async ({ page, request }, info) => {
  await seed(request);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await openList(page);
    await openPanel(page, "filters");
    await page.locator('[data-resource-view-action="add-rule"]').first().click();
    await settle(page.locator(".resource-custom-toolbar"));
    await roomyControls(page.locator(".resource-custom-toolbar"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const document = await openDocument(page);
    await settle(document);
    await roomyControls(document.locator("[data-resource-properties]"));
    expect(await document.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await document.locator('[data-property-id="motion-select"]').click();
    const manager = page.locator("[data-resource-property-manager]");
    await settle(manager);
    await roomyControls(manager);
    expect(await manager.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await manager.screenshot({ path: info.outputPath(`property-manager-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(manager).toHaveCount(0);
  }
});

test("property details and manager open and close smoothly and tolerate rapid reversal", async ({ page, request }) => {
  await seed(request);
  await openList(page);
  const document = await openDocument(page);
  await settle(document);
  await recordMotion(page);
  const original = (await fixtureSnapshot(request)).state.resources;
  const editor = document.locator(".block-editor");
  await editor.evaluate((node) => { window.__motionEditor = node; });
  const properties = document.locator("[data-resource-properties]");
  await assertSmoothHeight(properties);
  await assertSmoothHeight(properties);
  const summary = await properties.locator(":scope > summary").boundingBox();
  await page.mouse.click(summary.x + 20, summary.y + summary.height / 2);
  await page.waitForTimeout(40);
  await page.mouse.click(summary.x + 20, summary.y + summary.height / 2);
  await settle(properties);
  await expect(properties).toHaveAttribute("open", "");
  const picker = document.locator('[data-resource-property-picker="motion-select"]');
  await picker.locator("summary").click();
  await settle(picker);
  expect(await countMotion(page, "picker")).toBeGreaterThan(0);
  await picker.locator("summary").press("Escape");
  await settle(picker);
  await expect(picker).not.toHaveAttribute("open", "");
  await document.locator('[data-property-id="motion-select"]').click();
  const manager = page.locator("[data-resource-property-manager]");
  await settle(manager);
  expect(await countMotion(page, "manager")).toBeGreaterThan(0);
  const definition = manager.locator('[data-property-definition="motion-select"]');
  await assertSmoothHeight(definition);
  await assertSmoothHeight(definition);
  const beforeClose = await countMotion(page, "manager");
  await manager.locator('[data-resource-property-action="close"]').click();
  await expect(manager).toHaveCount(0);
  expect(await countMotion(page, "manager")).toBeGreaterThan(beforeClose);
  expect(await editor.evaluate((node) => node === window.__motionEditor)).toBe(true);
  expect((await fixtureSnapshot(request)).state.resources).toEqual(original);
});

test("saved view, filter and sort changes animate the results while preserving the open editor", async ({ page, request }) => {
  await seed(request);
  await openList(page);
  const document = await openDocument(page);
  await dockDocument(page);
  const editor = document.locator(".block-editor");
  await editor.evaluate((node) => { window.__motionEditor = node; });
  const original = (await fixtureSnapshot(request)).state.resources.map((resource) => resource.blocks);
  await recordMotion(page);
  await page.locator('[data-resource-view-action="select"][data-key="sorted"]').click();
  const items = page.locator(".resource-groups [data-resource-open]");
  await expect(items).toHaveText(["자료 Gamma", "자료 Beta", "자료 Alpha"]);
  expect(await countMotion(page, "groups")).toBeGreaterThan(0);
  const filters = await openPanel(page, "filters");
  await filters.locator('[data-resource-view-action="add-rule"]').click();
  const rule = filters.locator("[data-resource-filter-rule]").last();
  await rule.locator('[data-resource-view-field="filter-property"]').selectOption("motion-number");
  await rule.locator('[data-resource-view-field="filter-operator"]').selectOption("gte");
  let count = await countMotion(page, "groups");
  await rule.locator('[data-resource-view-field="filter-value"]').fill("20");
  await rule.locator('[data-resource-view-field="filter-value"]').press("Tab");
  await expect(items).toHaveText(["자료 Beta", "자료 Alpha"]);
  expect(await countMotion(page, "groups")).toBeGreaterThan(count);
  const sorts = await openPanel(page, "sorts");
  count = await countMotion(page, "groups");
  await sorts.locator('[data-resource-view-field="order-direction"]').selectOption("desc");
  await expect(items).toHaveText(["자료 Alpha", "자료 Beta"]);
  expect(await countMotion(page, "groups")).toBeGreaterThan(count);
  expect(await editor.evaluate((node) => node === window.__motionEditor)).toBe(true);
  expect((await fixtureSnapshot(request)).state.resources.map((resource) => resource.blocks)).toEqual(original);
});

test("date range changes animate the open picker and preserve its state on narrow screens", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await seed(request);
  await openList(page);
  const document = await openDocument(page);
  const editor = document.locator(".block-editor");
  await editor.evaluate((node) => { window.__motionEditor = node; });
  const original = (await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === resourceId).blocks;
  const picker = document.locator('[data-resource-property-picker="motion-date"]');
  await picker.locator("summary").click();
  await settle(picker);
  const popup = picker.locator(".resource-property-popover");
  await roomyControls(popup);
  const before = await popup.evaluate((node) => node.getBoundingClientRect().height);
  await recordMotion(page);
  await picker.locator('[data-resource-date-part="range"]').check();
  await expect(picker).toHaveAttribute("open", "");
  await expect(picker.locator('[data-resource-date-part="end"]')).toBeVisible();
  await settle(picker);
  const after = await popup.evaluate((node) => node.getBoundingClientRect().height);
  expect(after).toBeGreaterThan(before + 40);
  expect(await page.evaluate(() => window.__resourceMotion.some((entry) => entry.target === "picker" && entry.frames[0]?.height && entry.frames.at(-1)?.height !== entry.frames[0].height))).toBe(true);
  expect(await popup.evaluate((node) => ({ height: node.style.height, overflow: node.style.overflow, extraWidth: node.scrollWidth - node.clientWidth }))).toEqual({ height: "", overflow: "", extraWidth: 0 });
  await picker.locator('[data-resource-date-part="includeTime"]').check();
  await settle(picker);
  await expect(picker.locator('[data-resource-date-part="start"]')).toHaveAttribute("type", "datetime-local");
  await expect(picker.locator('[data-resource-date-part="end"]')).toHaveAttribute("type", "datetime-local");
  await roomyControls(popup);
  await picker.locator('[data-resource-date-part="range"]').uncheck();
  await settle(picker);
  await expect(picker.locator('[data-resource-date-part="end"]')).toHaveCount(0);
  await picker.locator("summary").press("Escape");
  await settle(picker);
  await expect(picker).not.toHaveAttribute("open", "");
  expect(await editor.evaluate((node) => node === window.__motionEditor)).toBe(true);
  expect((await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === resourceId).blocks).toEqual(original);
});

test("reduced motion changes property details, dialogs and saved views immediately", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seed(request);
  await openList(page);
  await recordMotion(page);
  await page.locator('[data-resource-view-action="select"][data-key="sorted"]').click();
  await expect(page.locator(".resource-groups [data-resource-open]")).toHaveText(["자료 Gamma", "자료 Beta", "자료 Alpha"]);
  const document = await openDocument(page);
  const properties = document.locator("[data-resource-properties]");
  await properties.locator(":scope > summary").click();
  await expect(properties).not.toHaveAttribute("open", "");
  await properties.locator(":scope > summary").click();
  await expect(properties).toHaveAttribute("open", "");
  expect(await properties.evaluate((node) => node.getAnimations().length)).toBe(0);
  await document.locator('[data-property-id="motion-select"]').click();
  const manager = page.locator("[data-resource-property-manager]");
  await expect(manager).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(manager).toHaveCount(0);
  expect(await countMotion(page, "manager")).toBe(0);
  expect(await countMotion(page, "groups")).toBe(0);
});
