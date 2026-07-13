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
  const card = page.locator(`[data-select-type="${view}"][data-select-id="${fixtureId}"]`);
  await expect(card).toBeVisible();
  return card;
}

test("Goal can be edited and deleted without deleting linked entities", async ({ page, request }) => {
  let card = await openEntityView(page, "goals", FIXTURE_IDS.goal);
  await card.locator(`[data-goal-edit="${FIXTURE_IDS.goal}"]`).click();

  let editor = page.locator(`[data-inline-owner-type="goals"][data-inline-owner-id="${FIXTURE_IDS.goal}"]`);
  await expect(editor).toBeVisible();
  await expect(editor.locator('[data-field="name"]')).toHaveValue("Fixture Goal");
  await editor.locator('[data-field="name"]').fill("Edited Fixture Goal");
  await editor.locator('[data-field="name"]').press("Tab");

  card = page.locator(`[data-select-type="goals"][data-select-id="${FIXTURE_IDS.goal}"]`);
  await expect(card.locator(".card-title")).toHaveText("Edited Fixture Goal");
  editor = page.locator(`[data-inline-owner-type="goals"][data-inline-owner-id="${FIXTURE_IDS.goal}"]`);
  await editor.locator('[data-field="status"]').selectOption("completed");
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    const goal = snapshot.state.goals.find((item) => item.id === FIXTURE_IDS.goal);
    return { name: goal?.name, status: goal?.status };
  }).toEqual({ name: "Edited Fixture Goal", status: "completed" });

  await card.locator(`[data-goal-delete="${FIXTURE_IDS.goal}"]`).click();
  const dialog = page.getByRole("dialog", { name: "목표 삭제 확인" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("프로젝트");
  await dialog.locator("[data-goal-delete-cancel]").click();
  await expect(dialog).toBeHidden();
  await expect(card).toBeVisible();

  await card.locator(`[data-goal-delete="${FIXTURE_IDS.goal}"]`).click();
  await dialog.locator(`[data-goal-delete-confirm="${FIXTURE_IDS.goal}"]`).click();
  await expect(card).toHaveCount(0);
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return {
      goalExists: snapshot.state.goals.some((item) => item.id === FIXTURE_IDS.goal),
      projectGoalId: snapshot.state.projects.find((item) => item.id === FIXTURE_IDS.project)?.goalId,
      resourceCount: snapshot.state.resources.length,
      resourceGoalIds: [...new Set(snapshot.state.resources.map((item) => item.goalId))],
    };
  }).toEqual({
    goalExists: false,
    projectGoalId: "",
    resourceCount: 5,
    resourceGoalIds: [""],
  });
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
  await expect(dialog).toContainText("목표");
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
      goalBoxId: snapshot.state.goals.find((item) => item.id === FIXTURE_IDS.goal)?.boxId,
      projectBoxId: snapshot.state.projects.find((item) => item.id === FIXTURE_IDS.project)?.boxId,
      resourceCount: snapshot.state.resources.length,
      resourceBoxIds: [...new Set(snapshot.state.resources.map((item) => item.boxId))],
      mainResourceRevision: snapshot.state.resources.find((item) => item.id === FIXTURE_IDS.resource)?.revision,
      readOnlyResourceRevision: snapshot.state.resources.find((item) => item.id === FIXTURE_IDS.readOnlyResource)?.revision,
    };
  }).toEqual({
    boxExists: false,
    goalBoxId: "",
    projectBoxId: "",
    resourceCount: 5,
    resourceBoxIds: [""],
    mainResourceRevision: 8,
    readOnlyResourceRevision: 7,
  });
});
