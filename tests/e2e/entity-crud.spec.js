import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
});

async function openEntityView(page, view, fixtureId) {
  const navToggle = page.locator('[data-action="toggle-nav"]');
  if (await navToggle.isVisible()) await navToggle.click();
  await page.locator(`[data-nav-key="${view}"]`).click();
  const card = page.locator(view === "projects"
    ? `[data-project-item="${fixtureId}"]`
    : `[data-select-type="${view}"][data-select-id="${fixtureId}"]`);
  await expect(card).toBeVisible();
  return card;
}

test("Project cards drag across all four statuses without opening the editor", async ({ page, request }) => {
  const card = await openEntityView(page, "projects", FIXTURE_IDS.project);
  const row = card.locator(`[data-project-toggle="${FIXTURE_IDS.project}"]`);
  const statuses = [
    ["planned", "예정"],
    ["active", "진행"],
    ["completed", "완료"],
    ["paused", "중단"],
  ];

  for (const [status, label] of statuses) {
    await row.scrollIntoViewIfNeeded();
    const start = await row.locator("h3").boundingBox();
    if (!start) throw new Error("Project drag source bounds unavailable");
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x + start.width / 2 + 30, start.y + start.height / 2 + 2, { steps: 4 });

    const stage = page.getByRole("dialog", { name: "프로젝트 이동" });
    await expect(stage).toBeVisible();
    await expect(stage.locator("[data-drag-action] strong")).toHaveText(["예정", "진행", "완료", "중단"]);
    const target = stage.locator(`[data-drag-action="${status}"]`);
    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error(`Project ${status} drop target bounds unavailable`);
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 });
    await expect(target).toHaveClass(/is-drop-target/);
    await page.mouse.up();

    await expect(stage).toHaveCount(0);
    await expect(row.locator(".project-status")).toHaveText(label);
    await expect.poll(async () => {
      const current = await fixtureSnapshot(request);
      return current.state.projects.find((project) => project.id === FIXTURE_IDS.project)?.status;
    }).toBe(status);
  }

  await expect(page.locator(`[data-inline-owner-type="projects"][data-inline-owner-id="${FIXTURE_IDS.project}"]`)).toHaveCount(0);
  await expect(row).toHaveAttribute("aria-expanded", "false");
});

test("Project editor reuses custom pickers and keeps four canonical statuses", async ({ page, request }) => {
  await page.goto("about:blank");
  await resetFixture(request);
  const snapshot = await fixtureSnapshot(request);
  const nextState = structuredClone(snapshot.state);
  nextState.projects.push(...[
    ["legacy-planned", "unplanned"],
    ["legacy-active", "focus"],
    ["legacy-paused", "canceled"],
  ].map(([id, status]) => ({
    id,
    name: id,
    status,
    boxId: "",
    startDate: "",
    endDate: "",
    blocks: [],
  })));
  nextState.settings.viewControls.projects.filters = ["closed"];
  const seeded = await request.put("/api/state", {
    headers: { "If-Match": `"state-${snapshot.serverRevision}"` },
    data: { state: nextState, baseRevision: snapshot.serverRevision, e2eFixtureGeneration: snapshot.resetGeneration },
  });
  expect(seeded.ok()).toBeTruthy();

  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await expect.poll(async () => {
    const current = await fixtureSnapshot(request);
    return {
      statuses: current.state.projects.filter((project) => project.id.startsWith("legacy-")).map((project) => project.status),
      filters: current.state.settings.viewControls.projects.filters,
    };
  }).toEqual({ statuses: ["planned", "active", "paused"], filters: ["completed", "paused"] });

  const navToggle = page.locator('[data-action="toggle-nav"]');
  if (await navToggle.isVisible()) await navToggle.click();
  await page.locator('[data-nav-key="projects"]').click();
  const controls = page.locator('[data-view-controls="projects"]');
  const revealControls = async () => {
    if (!(await controls.isVisible())) await page.locator("details.view-controls-shell > summary").click();
    await expect(controls).toBeVisible();
  };
  await revealControls();
  await controls.locator('[data-view-control-reset="projects"]').click();
  await revealControls();
  await controls.locator('[data-view-control-panel-toggle="projects"][data-control-panel="filter"]').click();
  await revealControls();
  await controls.locator('[data-view-control-choice="projects"][data-control-field="filter"][data-control-value="active"]').click();

  const card = page.locator(`[data-project-item="${FIXTURE_IDS.project}"]`);
  await expect(card).toBeVisible();
  await card.locator(`[data-project-edit="${FIXTURE_IDS.project}"]`).click();
  const editor = page.locator(`[data-inline-owner-type="projects"][data-inline-owner-id="${FIXTURE_IDS.project}"]`);
  await expect(editor).toBeVisible();

  const statusNative = editor.locator('select[data-field="status"]');
  await expect(statusNative.locator("option")).toHaveText(["예정", "진행", "완료", "중단"]);
  const statusPicker = editor.locator('[data-finance-select]:has([data-field="status"])');
  const statusTrigger = statusPicker.locator("[data-finance-select-trigger]");
  expect(await statusTrigger.getAttribute("aria-required")).toBeNull();
  await page.setViewportSize({ width: 390, height: 520 });
  await statusTrigger.evaluate((element) => element.scrollIntoView({ block: "end" }));
  await statusTrigger.click();
  const statusOptions = statusPicker.locator("[data-finance-select-options]");
  await expect(statusPicker.locator("[data-finance-select-option]")).toHaveText(["예정", "진행", "완료", "중단"]);
  const triggerBox = await statusTrigger.boundingBox();
  const optionsBox = await statusOptions.boundingBox();
  if (!triggerBox || !optionsBox) throw new Error("Project status picker bounds unavailable");
  expect(optionsBox.y).toBeGreaterThanOrEqual(8);
  expect(optionsBox.y + optionsBox.height).toBeLessThanOrEqual(512);
  expect(optionsBox.y + optionsBox.height).toBeLessThanOrEqual(triggerBox.y);
  await statusPicker.locator('[data-finance-select-option="active"]').click();
  await expect(editor.locator('[data-finance-select]:has([data-field="status"]) [data-finance-select-trigger]')).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1000 });

  const boxPicker = editor.locator('[data-finance-select]:has([data-field="boxId"])');
  await boxPicker.locator("[data-finance-select-trigger]").click();
  await boxPicker.locator('[data-finance-select-option=""]').click();

  const chooseDate = async (field, label, index) => {
    const picker = editor.locator(`[data-finance-date-picker]:has([data-field="${field}"])`);
    await picker.locator("[data-finance-date-trigger]").click();
    const dialog = page.getByRole("dialog", { name: `${label} 선택` });
    await expect(dialog).toBeVisible();
    const day = dialog.locator(".finance-date-day").nth(index);
    const value = await day.getAttribute("data-finance-date-value");
    await day.click();
    await expect(editor.locator(`[data-finance-date-picker]:has([data-field="${field}"]) [data-finance-date-trigger]`)).toBeFocused();
    return value;
  };
  const startDate = await chooseDate("startDate", "시작일", 9);
  const endDate = await chooseDate("endDate", "종료일", 19);

  await editor.locator('[data-finance-select]:has([data-field="status"]) [data-finance-select-trigger]').click();
  await editor.locator('[data-finance-select]:has([data-field="status"]) [data-finance-select-option="paused"]').click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator("#viewRoot")).toBeFocused();

  await expect.poll(async () => {
    const current = await fixtureSnapshot(request);
    const project = current.state.projects.find((item) => item.id === FIXTURE_IDS.project);
    return { status: project?.status, boxId: project?.boxId, startDate: project?.startDate, endDate: project?.endDate };
  }).toEqual({ status: "paused", boxId: "", startDate, endDate });
});

test("Box can be edited and deleted without deleting linked entities", async ({ page, request }) => {
  let card = await openEntityView(page, "boxes", FIXTURE_IDS.box);
  await card.locator(`[data-box-edit="${FIXTURE_IDS.box}"]`).click();

  let editor = page.locator(`[data-inline-owner-type="boxes"][data-inline-owner-id="${FIXTURE_IDS.box}"]`);
  await expect(editor).toBeVisible();
  await expect(editor.locator('[data-field="name"]')).toHaveValue("Fixture Box");
  await editor.locator('[data-field="name"]').fill("Edited Fixture Box");
  await editor.locator('[data-field="name"]').press("Tab");

  card = page.locator(`[data-select-type="boxes"][data-select-id="${FIXTURE_IDS.box}"]`);
  await expect(card.locator(".card-title")).toHaveText("Edited Fixture Box");
  editor = page.locator(`[data-inline-owner-type="boxes"][data-inline-owner-id="${FIXTURE_IDS.box}"]`);
  await editor.locator('[data-field="visibility"]').selectOption("archived");
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    const box = snapshot.state.boxes.find((item) => item.id === FIXTURE_IDS.box);
    return { name: box?.name, visibility: box?.visibility };
  }).toEqual({ name: "Edited Fixture Box", visibility: "archived" });

  card = page.locator(`[data-select-type="boxes"][data-select-id="${FIXTURE_IDS.box}"]`);
  await card.locator(`[data-box-delete="${FIXTURE_IDS.box}"]`).click();
  const dialog = page.getByRole("dialog", { name: "박스 삭제 확인" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("프로젝트");
  await dialog.locator("[data-box-delete-cancel]").click();
  await expect(dialog).toBeHidden();
  await expect(card).toBeVisible();

  await card.locator(`[data-box-delete="${FIXTURE_IDS.box}"]`).click();
  await dialog.locator(`[data-box-delete-confirm="${FIXTURE_IDS.box}"]`).click();
  await expect(card).toHaveCount(0);
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return {
      boxExists: snapshot.state.boxes.some((item) => item.id === FIXTURE_IDS.box),
      projectBoxId: snapshot.state.projects.find((item) => item.id === FIXTURE_IDS.project)?.boxId,
      resourceCount: snapshot.state.resources.length,
      resourceBoxIds: [...new Set(snapshot.state.resources.map((item) => item.boxId))],
      mainResourceRevision: snapshot.state.resources.find((item) => item.id === FIXTURE_IDS.resource)?.revision,
      readOnlyResourceRevision: snapshot.state.resources.find((item) => item.id === FIXTURE_IDS.readOnlyResource)?.revision,
    };
  }).toEqual({
    boxExists: false,
    projectBoxId: "",
    resourceCount: 5,
    resourceBoxIds: [""],
    mainResourceRevision: 8,
    readOnlyResourceRevision: 7,
  });
});
