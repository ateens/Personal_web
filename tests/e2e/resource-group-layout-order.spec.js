import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const ids = [FIXTURE_IDS.resource, FIXTURE_IDS.bodySearchResource, FIXTURE_IDS.titleSearchResource, "fixture-group-four", "fixture-group-five", "fixture-group-six"];
const groups = [{ id: "status-group", propertyId: "status", direction: "asc" }, { id: "checked-group", propertyId: "checked", direction: "asc" }];

async function seed(request, configure = () => {}) {
  await resetFixture(request);
  const snapshot = await fixtureSnapshot(request);
  const state = structuredClone(snapshot.state);
  state.settings.resourceProperties = [
    { id: "status", name: "상태", type: "select", options: [{ id: "d", name: "Aardvark", color: "orange" }, { id: "a", name: "Alpha", color: "blue" }, { id: "b", name: "Beta", color: "green" }, { id: "c", name: "Gamma", color: "purple" }] },
    { id: "checked", name: "확인", type: "checkbox", options: [] },
  ];
  state.settings.resourceViews = [{ id: "grouped", name: "그룹 자료", layout: "list", visibleProperties: [], filter: { id: "filter", op: "and", rules: [] }, sorts: [], groups: structuredClone(groups) }];
  state.settings.activeResourceViewId = "grouped";
  const template = state.resources.find((resource) => resource.id === FIXTURE_IDS.resource);
  state.resources = ids.map((id, index) => ({
    ...structuredClone(template), id, title: `자료 ${index + 1}`, commentThreads: [],
    propertyValues: { status: ["a", "a", "b", "b", "c", "c"][index], checked: Boolean(index % 2) },
    blocks: [{ id: `group-body-${index}`, type: "paragraph", text: `순서와 무관하게 유지할 본문 ${index + 1}`, marks: [], indent: 0, checked: false, collapsed: false }],
  }));
  state.resources.push(...snapshot.state.resources.filter((resource) => !ids.includes(resource.id)).map((resource) => ({ ...resource, trashedAt: "2026-09-01T00:00:00.000Z" })));
  configure(state);
  const response = await request.put("/api/state", { headers: { "If-Match": `"state-${snapshot.serverRevision}"` }, data: { state, baseRevision: snapshot.serverRevision } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return state;
}

async function settle(locator) {
  await locator.evaluate(async (node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))));
}

async function open(page) {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-action="toggle-nav"]').click();
  await page.locator('[data-nav-key="resources"]').click();
  await expect(page.locator("[data-resource-view]")).toBeVisible();
  await settle(page.locator(".resource-groups"));
}

const topGroups = (page) => page.locator(".resource-groups > .resource-custom-group");
const topLabels = (page) => topGroups(page).locator(":scope > summary strong");
const nestedLabels = (group) => group.locator(":scope > .resource-custom-group-body > .resource-custom-group > summary strong");
const direction = (page, id) => page.locator(`[data-resource-view-field="order-direction"][data-key="${id}"]`);
const customRow = (page, id, key) => page.locator(`[data-resource-custom-order="${id}"] [data-resource-custom-key='${JSON.stringify(key)}']`);

async function settings(page) {
  for (const key of ["settings", "groups"]) {
    const details = page.locator(`[data-resource-view-detail="${key}"]`);
    if (!(await details.evaluate((node) => node.open))) await details.locator(":scope > summary").click();
    await settle(details);
  }
}

async function openDockedEditor(page) {
  await page.locator(`[data-resource-open="${ids[0]}"]`).click();
  const window = page.locator(`[data-resource-window="${ids[0]}"]`);
  await settle(window);
  const bar = await window.locator("[data-resource-window-drag]").boundingBox();
  await page.mouse.move(bar.x + 100, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(page.viewportSize().width - 10, 60, { steps: 12 });
  await page.mouse.up();
  await expect(window).toHaveAttribute("data-docked", "true");
  await settle(window);
  const editor = window.locator(".block-editor");
  await editor.evaluate((node) => { window.__groupEditor = node; });
  return editor;
}

async function expectAnimatedToggle(group, click) {
  const before = await group.evaluate((node) => node.getBoundingClientRect().height);
  await click();
  const samples = await group.evaluate(async (node) => {
    const samples = [];
    for (let i = 0; i < 24; i += 1) {
      await new Promise(requestAnimationFrame);
      samples.push(node.getBoundingClientRect().height);
    }
    return samples;
  });
  await settle(group);
  const after = await group.evaluate((node) => node.getBoundingClientRect().height);
  expect(Math.abs(after - before)).toBeGreaterThan(20);
  expect(samples.some((height) => height > Math.min(before, after) + 1 && height < Math.max(before, after) - 1)).toBe(true);
  expect(await group.evaluate((node) => ({ height: node.style.height, overflow: node.style.overflow }))).toEqual({ height: "", overflow: "" });
}

for (const width of [1440, 390]) test(`group cards retain their layout and title controls at ${width}px`, async ({ page, request }, info) => {
  await seed(request);
  await page.setViewportSize({ width, height: 1000 });
  await open(page);
  const cards = topGroups(page);
  await expect(cards).toHaveCount(3);
  const bounds = await cards.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return { x: rect.x, y: rect.y, right: rect.right, width: rect.width, panel: node.classList.contains("panel"), radius: style.borderRadius, shadow: style.boxShadow };
  }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  expect(bounds.every((rect) => rect.x >= 0 && rect.right <= width && rect.panel && rect.radius === "0px" && rect.shadow !== "none")).toBe(true);
  if (width === 1440) {
    expect(Math.max(...bounds.map((rect) => rect.y)) - Math.min(...bounds.map((rect) => rect.y))).toBeLessThan(2);
    expect(bounds[1].x).toBeGreaterThan(bounds[0].right);
    expect(bounds[2].x).toBeGreaterThan(bounds[1].right);
    expect(Math.max(...bounds.map((rect) => rect.width)) - Math.min(...bounds.map((rect) => rect.width))).toBeLessThan(2);
  } else {
    expect(bounds[1].y).toBeGreaterThan(bounds[0].y);
    expect(bounds[2].y).toBeGreaterThan(bounds[1].y);
  }
  const first = cards.first();
  const summary = first.locator(":scope > summary");
  await expect(summary.locator("button")).toHaveCount(0);
  const chevronOpacity = () => summary.evaluate((node) => Number(getComputedStyle(node, "::before").opacity));
  await page.mouse.move(1, 1);
  if (width === 1440) await expect.poll(chevronOpacity).toBe(0);
  await summary.locator("strong").hover();
  await expect.poll(chevronOpacity).toBeGreaterThan(0.4);
  await summary.locator("strong").click();
  await settle(first);
  await expect(first).not.toHaveAttribute("open");
  await summary.focus();
  await page.mouse.move(1, 1);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(summary).toBeFocused();
  await expect.poll(chevronOpacity).toBeGreaterThan(0.4);
  await summary.press("Enter");
  await settle(first);
  await expect(first).toHaveAttribute("open", "");
  const geometry = await page.evaluate(() => {
    const rect = (node) => { const bounds = node.getBoundingClientRect(); return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, right: bounds.right }; };
    const size = (node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, rect: rect(node) });
    return {
      window: { innerWidth, innerHeight, scrollX, scrollY, devicePixelRatio },
      visualViewport: visualViewport && { width: visualViewport.width, height: visualViewport.height, offsetLeft: visualViewport.offsetLeft, pageLeft: visualViewport.pageLeft, scale: visualViewport.scale },
      document: size(document.documentElement), body: size(document.body),
    };
  });
  expect(geometry.body.scrollWidth).toBeLessThanOrEqual(width);
  const capture = await page.screenshot({ path: info.outputPath(`resource-group-cards-${width}.png`), fullPage: true });
  geometry.screenshot = { width: capture.readUInt32BE(16), height: capture.readUInt32BE(20) };
  const geometryPath = info.outputPath(`layout-geometry-${width}.json`);
  await writeFile(geometryPath, JSON.stringify(geometry, null, 2));
  await info.attach(`layout-geometry-${width}`, { path: geometryPath, contentType: "application/json" });
});

test("title clicks animate nested groups independently and preserve resource content", async ({ page, request }) => {
  await seed(request);
  await open(page);
  const original = (await fixtureSnapshot(request)).state.resources;
  const parent = topGroups(page).first();
  const child = parent.locator(":scope > .resource-custom-group-body > .resource-custom-group").first();
  await expectAnimatedToggle(child, () => child.locator(":scope > summary strong").click());
  await expect(child).not.toHaveAttribute("open");
  await expect(parent).toHaveAttribute("open", "");
  await expect(parent.locator(":scope > .resource-custom-group-body > .resource-custom-group").last()).toHaveAttribute("open", "");
  await expectAnimatedToggle(child, () => child.locator(":scope > summary strong").click());
  await expectAnimatedToggle(parent, () => parent.locator(":scope > summary strong").click());
  await expectAnimatedToggle(parent, () => parent.locator(":scope > summary strong").click());
  await expect(child).toHaveAttribute("open", "");
  expect((await fixtureSnapshot(request)).state.resources).toEqual(original);
});

test("custom group and nested boolean order persist without changing resources or the open editor", async ({ page, request }) => {
  await seed(request);
  await open(page);
  const original = (await fixtureSnapshot(request)).state.resources;
  const editor = await openDockedEditor(page);
  await settings(page);
  await direction(page, "status-group").selectOption("custom");
  for (let step = 0; step < 2; step += 1) await customRow(page, "status-group", "c").locator('[data-direction="-1"]').click();
  await expect(topLabels(page)).toHaveText(["Gamma", "Alpha", "Beta"]);
  await direction(page, "checked-group").selectOption("custom");
  await customRow(page, "checked-group", true).locator('[data-direction="-1"]').click();
  for (const group of await topGroups(page).all()) await expect(nestedLabels(group)).toHaveText(["선택됨", "선택 안 됨"]);
  await expect.poll(async () => (await fixtureSnapshot(request)).state.settings.resourceViews[0].groups).toEqual([
    { ...groups[0], direction: "custom", customOrder: ["c", "a", "b"] },
    { ...groups[1], direction: "custom", customOrder: [true, false] },
  ]);
  expect(await editor.evaluate((node) => node === window.__groupEditor)).toBe(true);
  expect((await fixtureSnapshot(request)).state.resources).toEqual(original);
  await direction(page, "status-group").selectOption("desc");
  await expect(topLabels(page)).toHaveText(["Gamma", "Beta", "Alpha"]);
  await direction(page, "status-group").selectOption("asc");
  await expect(topLabels(page)).toHaveText(["Alpha", "Beta", "Gamma"]);
  await direction(page, "status-group").selectOption("custom");
  await expect(topLabels(page)).toHaveText(["Gamma", "Alpha", "Beta"]);
  await expect.poll(async () => (await fixtureSnapshot(request)).state.settings.resourceViews[0].groups[0].direction).toBe("custom");
  await page.reload();
  await expect(topLabels(page)).toHaveText(["Gamma", "Alpha", "Beta"]);
  for (const group of await topGroups(page).all()) await expect(nestedLabels(group)).toHaveText(["선택됨", "선택 안 됨"]);
  expect((await fixtureSnapshot(request)).state.resources).toEqual(original);
  await settings(page);
  await page.locator('[data-resource-view-field="order-property"][data-key="checked-group"]').selectOption("boxId");
  await expect(direction(page, "checked-group")).toHaveValue("asc");
  await expect(page.locator('[data-resource-custom-order="checked-group"]')).toHaveCount(0);
  await expect.poll(async () => {
    const rule = (await fixtureSnapshot(request)).state.settings.resourceViews[0].groups.find((rule) => rule.id === "checked-group");
    return { propertyId: rule.propertyId, direction: rule.direction, customOrder: rule.customOrder || [] };
  }).toEqual({ propertyId: "boxId", direction: "asc", customOrder: [] });
});

test("new group values append to the saved custom order even when their normal rank comes first", async ({ page, request }) => {
  await seed(request, (state) => { state.settings.resourceViews[0].groups[0] = { ...groups[0], direction: "custom", customOrder: ["c", "a", "b"] }; });
  await open(page);
  await expect(topLabels(page)).toHaveText(["Gamma", "Alpha", "Beta"]);
  const editor = await openDockedEditor(page);
  const original = (await fixtureSnapshot(request)).state.resources;
  const picker = page.locator(`[data-resource-document="${ids[0]}"] [data-resource-property-picker="status"]`);
  await picker.locator("summary").click();
  await picker.locator('[data-resource-property-action="choose"][data-option-id="d"]').click();
  await expect(topLabels(page)).toHaveText(["Gamma", "Alpha", "Beta", "Aardvark"]);
  await expect.poll(async () => (await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === ids[0]).propertyValues.status).toBe("d");
  expect(await editor.evaluate((node) => node === window.__groupEditor)).toBe(true);
  const updated = (await fixtureSnapshot(request)).state.resources;
  expect(updated.map((resource) => resource.id)).toEqual(original.map((resource) => resource.id));
  expect(updated.map((resource) => resource.blocks)).toEqual(original.map((resource) => resource.blocks));
  await page.reload();
  await expect(topLabels(page)).toHaveText(["Gamma", "Alpha", "Beta", "Aardvark"]);
});
