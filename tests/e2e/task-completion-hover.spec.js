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
  expect(rest).toEqual({ background: "none", short: "8px", long: "8px", transform: "none" });

  const title = cards[0].locator(".card-title");
  const strikeBefore = await title.evaluate((element) => ({
    transform: getComputedStyle(element, "::after").transform,
    duration: getComputedStyle(element, "::after").transitionDuration,
  }));
  expect(strikeBefore).toEqual({ transform: "matrix(0, 0, 0, 1, 0, 0)", duration: "0.26s" });

  await cards[0].locator(".check").click();
  await page.waitForTimeout(80);
  const strikeMidway = await title.evaluate((element) => getComputedStyle(element, "::after").transform);
  const strikeScale = Number(strikeMidway.match(/^matrix\(([^,]+)/)?.[1]);
  expect(strikeScale).toBeGreaterThan(0);
  expect(strikeScale).toBeLessThan(1);
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
