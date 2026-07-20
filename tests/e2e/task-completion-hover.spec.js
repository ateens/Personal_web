import { expect, test } from "@playwright/test";
import { fixtureSnapshot, resetFixture } from "./helpers.js";

const TASK_IDS = ["fixture-hover-task-a", "fixture-hover-task-b"];

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  const snapshot = await fixtureSnapshot(request);
  const nextState = structuredClone(snapshot.state);
  nextState.tasks.push(...TASK_IDS.map((id, index) => ({
    id,
    title: `Hover completion ${index + 1}`,
    status: "todo",
    boxId: "",
    goalId: "",
    projectId: "",
    resourceId: "",
    dueDate: "",
    completedAt: "",
    googleEventId: "",
    blocks: [],
  })));
  const seeded = await request.put("/api/state", {
    headers: { "If-Match": `"state-${snapshot.serverRevision}"` },
    data: { state: nextState, baseRevision: snapshot.serverRevision, e2eFixtureGeneration: snapshot.resetGeneration },
  });
  expect(seeded.ok()).toBeTruthy();
  await page.goto("/");
  await page.locator('[data-action="toggle-nav"]').click();
  await page.locator('[data-nav-key="tasks"]').click();
});

test("completed tasks wait for hover exit and batch consecutive checks", async ({ page }) => {
  const cards = TASK_IDS.map((id) => page.locator(`[data-task-id="${id}"]`));
  const panelTitle = (card) => card.locator("xpath=ancestor::div[contains(@class,'panel')][1]//h2");

  await cards[0].locator(".check").hover();
  const rest = await cards[0].locator(".check").evaluate((element) => ({
    background: getComputedStyle(element, "::before").backgroundImage,
    short: getComputedStyle(element, "::before").width,
    long: getComputedStyle(element, "::after").width,
    transform: getComputedStyle(element, "::before").transform,
  }));
  expect(rest).toEqual({ background: "none", short: "7px", long: "7px", transform: "none" });

  await cards[0].locator(".check").click();
  await cards[1].locator(".check").click();
  await page.waitForTimeout(650);
  await expect(panelTitle(cards[0])).toHaveText("미계획");
  await expect(panelTitle(cards[1])).toHaveText("미계획");

  const mark = await cards[1].locator(".check").evaluate((element) => ({
    short: getComputedStyle(element, "::before").transform,
    longWidth: getComputedStyle(element, "::after").width,
  }));
  expect(mark.short).not.toBe("none");
  expect(mark.longWidth).toBe("11.5px");

  await page.mouse.move(1400, 980);
  await expect(panelTitle(cards[0])).toHaveText("완료");
  await expect(panelTitle(cards[1])).toHaveText("완료");
});
