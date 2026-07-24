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

  const rest = await cards[0].locator(".check").evaluate((element) => ({
    background: getComputedStyle(element, "::before").backgroundImage,
    short: getComputedStyle(element, "::before").width,
    long: getComputedStyle(element, "::after").width,
    transform: getComputedStyle(element, "::before").transform,
  }));
  expect(rest).toEqual({ background: "none", short: "10.5px", long: "10.5px", transform: "none" });

  const firstCheck = cards[0].locator(".check");
  await firstCheck.hover();
  await expect.poll(() => firstCheck.evaluate((element) => ({
    before: {
      color: getComputedStyle(element, "::before").backgroundColor,
      left: getComputedStyle(element, "::before").left,
      top: getComputedStyle(element, "::before").top,
      width: getComputedStyle(element, "::before").width,
      height: getComputedStyle(element, "::before").height,
    },
    after: {
      color: getComputedStyle(element, "::after").backgroundColor,
      left: getComputedStyle(element, "::after").left,
      top: getComputedStyle(element, "::after").top,
      width: getComputedStyle(element, "::after").width,
      height: getComputedStyle(element, "::after").height,
    },
  }))).toEqual({
    before: { color: "rgb(23, 32, 47)", left: "10.75px", top: "20.875px", width: "11.25px", height: "2.25px" },
    after: { color: "rgb(23, 32, 47)", left: "22px", top: "20.875px", width: "11.25px", height: "2.25px" },
  });

  const title = cards[0].locator(".card-title");
  const strikeBefore = await title.evaluate((element) => ({
    transform: getComputedStyle(element, "::after").transform,
    duration: getComputedStyle(element, "::after").transitionDuration,
  }));
  expect(strikeBefore).toEqual({ transform: "matrix(0, 0, 0, 1, 0, 0)", duration: "0.26s" });

  await cards[0].locator(".check").click();
  await page.waitForTimeout(80);
  const strikeMidway = await title.evaluate((element) => getComputedStyle(element, "::after").transform);
  const checkMorph = await firstCheck.evaluate((element) => ({
    beforeAnimation: getComputedStyle(element, "::before").animationName,
    afterAnimation: getComputedStyle(element, "::after").animationName,
  }));
  expect(checkMorph).toEqual({ beforeAnimation: "none", afterAnimation: "none" });
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
  expect(mark.longWidth).toBe("13.5px");

  await page.mouse.move(1400, 980);
  await expect(panelTitle(cards[0])).toHaveText("완료");
  await expect(panelTitle(cards[1])).toHaveText("완료");

  const completedCheck = cards[0].locator(".check");
  await completedCheck.hover();
  await completedCheck.click();
  await expect(cards[0]).not.toHaveClass(/is-updating/);
  await page.waitForTimeout(650);
  await expect(panelTitle(cards[0])).toHaveText("완료");
  await expect(cards[0]).not.toHaveClass(/is-reordering/);

  await page.mouse.move(1400, 980);
  await expect(panelTitle(cards[0])).toHaveText("미계획");
  await expect(cards[0]).not.toHaveClass(/is-reordering/);
});

test("unchecking a Today task does not replay the card refresh animation", async ({ page }) => {
  await page.locator('[data-nav-key="today"]').evaluate((button) => button.click());
  await expect(page.locator("#viewRoot .view h1")).toContainText("대시보드");
  const taskId = await page.evaluate(() => {
    const task = window.createTask("Today refresh guard", {
      deferCreate: true,
      initial: { dueDate: window.dateKey(new Date()) },
    });
    window.saveState();
    window.renderView({ soft: true });
    return task.id;
  });

  const card = page.locator(`[data-today-task-id="${taskId}"]`);
  await expect(card).toBeVisible();
  const controls = await card.evaluate((element) => {
    const check = element.querySelector(".check").getBoundingClientRect();
    const chevron = element.querySelector(".task-toggle-hitarea").getBoundingClientRect();
    return {
      checkWidth: check.width,
      checkHeight: check.height,
      centerDelta: Math.abs((check.top + check.height / 2) - (chevron.top + chevron.height / 2)),
    };
  });
  expect(controls).toEqual({ checkWidth: 44, checkHeight: 44, centerDelta: 0 });
  await card.locator(".check").click();
  await page.mouse.move(1400, 980);
  await expect(card).toHaveClass(/today-done/);

  await card.locator(".check").hover();
  await page.evaluate((id) => {
    window.__taskCompletionCard = document.querySelector(`[data-today-task-id="${id}"]`);
  }, taskId);
  await card.locator(".check").click();
  await expect(card).not.toHaveClass(/is-updating/);
  await page.waitForTimeout(650);
  expect(await page.evaluate((id) => (
    window.__taskCompletionCard === document.querySelector(`[data-today-task-id="${id}"]`)
  ), taskId)).toBe(true);

  await page.mouse.move(1400, 980);
  await expect.poll(() => page.evaluate((id) => (
    window.__taskCompletionCard !== document.querySelector(`[data-today-task-id="${id}"]`)
  ), taskId)).toBe(true);
  await expect(card).not.toHaveClass(/is-reordering/);
});

test("checking a collapsed Today task ignores hidden editor drag handles", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1000 });
  const taskIds = await page.evaluate(() => {
    const dueDate = window.dateKey(new Date());
    const ids = Array.from({ length: 3 }, (_, index) => (
      window.createTask(`Hidden editor guard ${index + 1}`, {
        deferCreate: true,
        initial: { dueDate, boxId: "" },
      }).id
    ));
    window.saveState();
    window.setView("today");
    return ids;
  });

  const target = page.locator(`[data-today-task-id="${taskIds[2]}"]`);
  await expect(target.locator('.task-detail-shell[aria-hidden="true"] [data-block-drag]')).toHaveCount(1);
  await target.locator(".check").click();

  await expect.poll(() => page.evaluate((taskId) => window.itemById("tasks", taskId)?.status, taskIds[2])).toBe("done");
  await expect(page.locator(".slash-menu.is-selection-menu")).toHaveCount(0);
});
