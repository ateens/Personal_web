import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const TOPBAR = "[data-capture-zone]";
const QUICK_PLACEMENT = "[data-quick-placement]";
const PLACEMENT_PHASES = ["boxId", "goalId", "projectId", "resourceId"];
const IPAD_VIEWPORT = { width: 1024, height: 1366 };

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("topbar Task uses the entered title, keeps the current view, and completes click placement", async ({ page, request }) => {
  const title = "상단에서 만든 배치 Task";
  await page.goto("/");
  await waitForFixtureWorkspace(page);
  const startingUrl = page.url();
  const startingHeading = await currentViewHeading(page);
  const today = await localDateKey(page);

  await startTopbarCreate(page, "new-task", title);

  await expectCurrentView(page, startingUrl, startingHeading);
  await expect(topbarTitle(page)).toHaveValue("");
  const scheduler = page.getByRole("dialog", { name: "Task 날짜 배치" });
  await expect(scheduler).toBeVisible();
  await expect(scheduler).toContainText(title);
  await scheduler.locator('[data-scheduler-lane="today"]').click();

  await expectCurrentView(page, startingUrl, startingHeading);
  await selectPlacementChoice(page, "boxId", FIXTURE_IDS.box);
  await selectPlacementChoice(page, "goalId", FIXTURE_IDS.goal);
  await selectPlacementChoice(page, "projectId", FIXTURE_IDS.project);
  await selectPlacementChoice(page, "resourceId", FIXTURE_IDS.resource);

  await expect(page.locator(QUICK_PLACEMENT)).toBeHidden();
  await expectCurrentView(page, startingUrl, startingHeading);
  await expect.poll(async () => taskByTitle(await fixtureSnapshot(request), title)).toMatchObject({
    title,
    status: "scheduled",
    dueDate: today,
    boxId: FIXTURE_IDS.box,
    goalId: FIXTURE_IDS.goal,
    projectId: FIXTURE_IDS.project,
    resourceId: FIXTURE_IDS.resource,
  });
});

test("first-phase cancel removes the provisional Task without leaving the current view", async ({ page, request }) => {
  const title = "첫 단계에서 취소할 Task";
  const before = await fixtureSnapshot(request);
  await page.goto("/");
  await waitForFixtureWorkspace(page);
  const startingUrl = page.url();
  const startingHeading = await currentViewHeading(page);

  await startTopbarCreate(page, "new-task", title);
  const scheduler = page.getByRole("dialog", { name: "Task 날짜 배치" });
  await expect(scheduler).toBeVisible();
  await expect.poll(async () => Boolean(taskByTitle(await fixtureSnapshot(request), title))).toBe(true);

  await scheduler.locator("[data-placement-create-cancel]").click();

  await expect(scheduler).toBeHidden();
  await expect(page.locator(QUICK_PLACEMENT)).toBeHidden();
  await expectPlacementScrollUnlocked(page);
  await expectCurrentView(page, startingUrl, startingHeading);
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return {
      count: snapshot.state.tasks.length,
      task: taskByTitle(snapshot, title),
    };
  }).toEqual({ count: before.state.tasks.length, task: null });
});

test("create now keeps one completely unplaced Task and closes the first phase", async ({ page, request }) => {
  const title = "선택 없이 바로 만들 Task";
  const before = await fixtureSnapshot(request);
  await page.goto("/");
  await waitForFixtureWorkspace(page);
  const startingUrl = page.url();
  const startingHeading = await currentViewHeading(page);

  await startTopbarCreate(page, "new-task", title);
  const scheduler = page.getByRole("dialog", { name: "Task 날짜 배치" });
  await expect(scheduler).toBeVisible();
  await scheduler.locator("[data-placement-create-now]").click();

  await expect(scheduler).toBeHidden();
  await expect(page.locator(QUICK_PLACEMENT)).toBeHidden();
  await expectPlacementScrollUnlocked(page);
  await expectCurrentView(page, startingUrl, startingHeading);
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    const task = taskByTitle(snapshot, title);
    return {
      count: snapshot.state.tasks.length,
      task: task && {
        title: task.title,
        status: task.status,
        dueDate: task.dueDate,
        scheduledStart: task.scheduledStart,
        scheduledEnd: task.scheduledEnd,
        completedAt: task.completedAt,
        boxId: task.boxId,
        goalId: task.goalId,
        projectId: task.projectId,
        resourceId: task.resourceId,
      },
    };
  }).toEqual({
    count: before.state.tasks.length + 1,
    task: {
      title,
      status: "todo",
      dueDate: "",
      scheduledStart: "",
      scheduledEnd: "",
      completedAt: "",
      boxId: "",
      goalId: "",
      projectId: "",
      resourceId: "",
    },
  });
});

test("first phase matches the six-lane calendar and two-action reference composition", async ({ page }) => {
  await page.goto("/");
  await waitForFixtureWorkspace(page);
  const startingUrl = page.url();
  const startingHeading = await currentViewHeading(page);
  await startTopbarCreate(page, "new-task", "날짜 배치 구성 확인 Task");

  const scheduler = page.getByRole("dialog", { name: "Task 날짜 배치" });
  await expect(scheduler).toBeVisible();
  const lanes = scheduler.locator("[data-scheduler-lane]");
  await expect(lanes).toHaveCount(6);
  await expect(lanes.locator("strong")).toHaveText(["미계획", "오늘", "내일", "예정", "지연", "완료"]);
  for (let index = 0; index < 6; index += 1) await expect(lanes.nth(index)).toBeVisible();

  const weekdays = scheduler.locator(".task-scheduler-weekdays > span");
  const days = scheduler.locator(".task-scheduler-grid > [data-scheduler-date]");
  await expect(weekdays).toHaveCount(7);
  await expect(days).toHaveCount(42);
  await expect(weekdays).toHaveText(["월", "화", "수", "목", "금", "토", "일"]);

  const actionGroup = scheduler.locator(".quick-placement-first-actions");
  const actions = actionGroup.locator(":scope > [data-placement-create-cancel], :scope > [data-placement-create-now]");
  await expect(actions).toHaveCount(2);
  await expect(actions.locator("strong")).toHaveText(["취소", "바로 만들기"]);
  await expect(actions.nth(0)).toBeVisible();
  await expect(actions.nth(1)).toBeVisible();

  await page.setViewportSize({ width: 1194, height: 834 });
  await expectInsideViewport(actionGroup, { width: 1194, height: 834 });
  const calendarBox = await scheduler.locator(".task-scheduler").boundingBox();
  const actionBox = await actionGroup.boundingBox();
  expect(calendarBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  const overlapWidth = Math.max(0, Math.min(calendarBox.x + calendarBox.width, actionBox.x + actionBox.width) - Math.max(calendarBox.x, actionBox.x));
  const overlapHeight = Math.max(0, Math.min(calendarBox.y + calendarBox.height, actionBox.y + actionBox.height) - Math.max(calendarBox.y, actionBox.y));
  expect(overlapWidth * overlapHeight).toBe(0);

  await page.keyboard.press("Control+k");
  await page.keyboard.press("Alt+7");
  await expect(page.locator(".command-menu")).toHaveCount(0);
  await expect(scheduler).toBeVisible();
  await expectCurrentView(page, startingUrl, startingHeading);
});

test("done lane advances through Box and preserves completion after every relation phase", async ({ page, request }) => {
  const title = "완료 상태로 관계를 배치할 Task";
  await page.goto("/");
  await waitForFixtureWorkspace(page);
  await startTopbarCreate(page, "new-task", title);

  const scheduler = page.getByRole("dialog", { name: "Task 날짜 배치" });
  await scheduler.locator('[data-scheduler-lane="done"]').click();
  await expectOnlyPlacementPhase(page, "boxId");
  await selectPlacementChoice(page, "boxId", "");
  await selectPlacementChoice(page, "goalId", "");
  await selectPlacementChoice(page, "projectId", "");
  await selectPlacementChoice(page, "resourceId", "");

  await expect(page.locator(QUICK_PLACEMENT)).toBeHidden();
  await expectPlacementScrollUnlocked(page);
  await expect.poll(async () => {
    const task = taskByTitle(await fixtureSnapshot(request), title);
    return task && {
      status: task.status,
      hasCompletedAt: Boolean(task.completedAt),
      boxId: task.boxId,
      goalId: task.goalId,
      projectId: task.projectId,
      resourceId: task.resourceId,
    };
  }).toEqual({
    status: "done",
    hasCompletedAt: true,
    boxId: "",
    goalId: "",
    projectId: "",
    resourceId: "",
  });
});

test("choice hover stays still and the persistent backdrop never restarts or fades between phases", async ({ page }) => {
  await page.goto("/");
  await waitForFixtureWorkspace(page);
  await startTopbarCreate(page, "new-task", "깜빡임 없이 전환할 Task");

  const scheduler = page.getByRole("dialog", { name: "Task 날짜 배치" });
  await expect(scheduler).toBeVisible();
  await page.waitForTimeout(260);
  await clickWithoutBackdropFlash(scheduler.locator('[data-scheduler-lane="today"]'));

  const choices = [
    ["boxId", FIXTURE_IDS.box],
    ["goalId", FIXTURE_IDS.goal],
    ["projectId", FIXTURE_IDS.project],
    ["resourceId", FIXTURE_IDS.resource],
  ];
  for (let index = 0; index < choices.length; index += 1) {
    const [phase, value] = choices[index];
    const activePhase = await expectOnlyPlacementPhase(page, phase);
    const choice = activePhase.locator(`[data-placement-choice][data-placement-value="${value}"]`);
    await expectChoiceDoesNotMoveOnHover(page, choice);
    if (index < choices.length - 1) await clickWithoutBackdropFlash(choice);
  }
});

test("date placement survives an in-flight create save response", async ({ page, request }) => {
  const title = "저장 응답 중에도 날짜를 지키는 Task";
  let heldInitialSave = false;
  let releaseInitialSave = null;

  await page.route("**/api/state", async (route) => {
    if (!heldInitialSave && route.request().method() === "PUT") {
      const response = await route.fetch();
      heldInitialSave = true;
      await new Promise((resolve) => {
        releaseInitialSave = resolve;
      });
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });

  try {
    await page.goto("/");
    await waitForFixtureWorkspace(page);
    const today = await localDateKey(page);
    await startTopbarCreate(page, "new-task", title);
    const scheduler = page.getByRole("dialog", { name: "Task 날짜 배치" });
    await expect(scheduler).toBeVisible();
    await expect.poll(() => heldInitialSave).toBe(true);

    await scheduler.locator('[data-scheduler-lane="today"]').click();
    releaseInitialSave?.();
    releaseInitialSave = null;

    await selectPlacementChoice(page, "boxId", "");
    await selectPlacementChoice(page, "goalId", "");
    await selectPlacementChoice(page, "projectId", "");
    await selectPlacementChoice(page, "resourceId", "");

    await expect.poll(async () => taskByTitle(await fixtureSnapshot(request), title)).toMatchObject({
      title,
      status: "scheduled",
      dueDate: today,
    });
  } finally {
    releaseInitialSave?.();
    await page.unroute("**/api/state");
  }
});

test("Project choices stay inside the selected Goal when a Box has multiple Goals", async ({ page, request }) => {
  const alternateGoalId = "fixture-goal-alternate";
  const alternateProjectId = "fixture-project-alternate";
  const before = await fixtureSnapshot(request);
  const nextState = structuredClone(before.state);
  nextState.goals.push({
    id: alternateGoalId,
    boxId: FIXTURE_IDS.box,
    name: "Alternate Fixture Goal",
    status: "active",
    targetDate: "",
    year: "2026",
    quarter: "3Q",
    blocks: [],
  });
  nextState.projects.push({
    id: alternateProjectId,
    boxId: FIXTURE_IDS.box,
    goalId: alternateGoalId,
    name: "Alternate Fixture Project",
    status: "active",
    startDate: "",
    endDate: "",
    blocks: [],
  });
  const seeded = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: {
      state: nextState,
      baseRevision: before.serverRevision,
      e2eFixtureGeneration: before.resetGeneration,
    },
  });
  expect(seeded.ok()).toBeTruthy();

  const title = "Goal에 맞는 Project만 고르는 Task";
  await page.goto("/");
  await waitForFixtureWorkspace(page);
  await startTopbarCreate(page, "new-task", title);
  await page.getByRole("dialog", { name: "Task 날짜 배치" }).locator('[data-scheduler-lane="unplanned"]').click();
  await selectPlacementChoice(page, "boxId", FIXTURE_IDS.box);
  await selectPlacementChoice(page, "goalId", FIXTURE_IDS.goal);

  const projectPhase = await expectOnlyPlacementPhase(page, "projectId");
  await expect(projectPhase.locator(`[data-placement-value="${FIXTURE_IDS.project}"]`)).toBeVisible();
  await expect(projectPhase.locator(`[data-placement-value="${alternateProjectId}"]`)).toHaveCount(0);
  await projectPhase.locator(`[data-placement-value="${FIXTURE_IDS.project}"]`).click();
  await selectPlacementChoice(page, "resourceId", FIXTURE_IDS.resource);

  await expect.poll(async () => taskByTitle(await fixtureSnapshot(request), title)).toMatchObject({
    boxId: FIXTURE_IDS.box,
    goalId: FIXTURE_IDS.goal,
    projectId: FIXTURE_IDS.project,
    resourceId: FIXTURE_IDS.resource,
  });
});

test("topbar Resource uses the entered title without changing view, URL, or opening a page", async ({ page, request }) => {
  const title = "현재 화면에 남는 새 자료";
  await page.goto("/");
  await waitForFixtureWorkspace(page);
  const startingUrl = page.url();
  const startingHeading = await currentViewHeading(page);
  const before = await fixtureSnapshot(request);

  await startTopbarCreate(page, "new-resource", title);

  await expectCurrentView(page, startingUrl, startingHeading);
  await expect(topbarTitle(page)).toHaveValue("");
  await expect(page.locator("[data-resource-note]")).toHaveCount(0);
  await expect(page.locator(QUICK_PLACEMENT)).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Task 날짜 배치" })).toBeHidden();
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return {
      count: snapshot.state.resources.length,
      resource: snapshot.state.resources.find((resource) => resource.title === title) || null,
    };
  }).toMatchObject({
    count: before.state.resources.length + 1,
    resource: { title },
  });
});

test("the Resources view create button keeps its existing editor-opening behavior", async ({ page }) => {
  await page.goto("/");
  await waitForFixtureWorkspace(page);
  const navToggle = page.locator('[data-action="toggle-nav"]');
  if (await navToggle.isVisible()) await navToggle.click();
  await page.locator('[data-nav-key="resources"]').click();
  await page.locator('#viewRoot [data-action="new-resource"]').click();

  await expect(page.locator("[data-resource-note]")).toBeVisible();
  await expect(page).toHaveURL(/\/resources\//);
});

test("iPad touch completes every placement phase inside a bounded floating overlay", async ({ browser, request }, testInfo) => {
  const context = await newIpadContext(browser, testInfo);
  const page = await context.newPage();
  const title = "아이패드 터치 배치 Task";

  try {
    await page.goto("/");
    await waitForFixtureWorkspace(page);
    const startingUrl = page.url();
    const startingHeading = await currentViewHeading(page);
    const today = await localDateKey(page);

    await topbarTitle(page).fill(title);
    await topbarAction(page, "new-task").tap();
    await expect(topbarTitle(page)).toHaveValue("");

    const scheduler = page.getByRole("dialog", { name: "Task 날짜 배치" });
    await expect(scheduler).toBeVisible();
    await expectInsideViewport(scheduler, IPAD_VIEWPORT);
    await expectPlacementScrollLocked(page);
    await scheduler.locator('[data-scheduler-lane="today"]').tap();

    const choices = [
      ["boxId", FIXTURE_IDS.box],
      ["goalId", FIXTURE_IDS.goal],
      ["projectId", FIXTURE_IDS.project],
      ["resourceId", FIXTURE_IDS.resource],
    ];
    for (const [phase, value] of choices) {
      const activePhase = await expectOnlyPlacementPhase(page, phase);
      await expectFloatingOverlay(page, activePhase, IPAD_VIEWPORT);
      await activePhase.locator(`[data-placement-choice][data-placement-value="${value}"]`).tap();
    }

    await expect(page.locator(QUICK_PLACEMENT)).toBeHidden();
    await expectPlacementScrollUnlocked(page);
    await expectCurrentView(page, startingUrl, startingHeading);
    await expect.poll(async () => taskByTitle(await fixtureSnapshot(request), title)).toMatchObject({
      title,
      status: "scheduled",
      dueDate: today,
      boxId: FIXTURE_IDS.box,
      goalId: FIXTURE_IDS.goal,
      projectId: FIXTURE_IDS.project,
      resourceId: FIXTURE_IDS.resource,
    });
  } finally {
    await context.close();
  }
});

test("placement supports back, empty choices, and cancel without navigating", async ({ page, request }) => {
  const title = "건너뛰고 취소하는 Task";
  await page.goto("/");
  await waitForFixtureWorkspace(page);
  const startingUrl = page.url();
  const startingHeading = await currentViewHeading(page);

  await startTopbarCreate(page, "new-task", title);
  await page.getByRole("dialog", { name: "Task 날짜 배치" }).locator('[data-scheduler-lane="today"]').click();
  await selectPlacementChoice(page, "boxId", FIXTURE_IDS.box);
  await expectOnlyPlacementPhase(page, "goalId");

  await page.locator(`${QUICK_PLACEMENT} [data-placement-back]`).click();
  await expectOnlyPlacementPhase(page, "boxId");
  await selectPlacementChoice(page, "boxId", "");
  await selectPlacementChoice(page, "goalId", "");
  await expectOnlyPlacementPhase(page, "projectId");
  await page.locator(`${QUICK_PLACEMENT} [data-placement-cancel]`).click();

  await expect(page.locator(QUICK_PLACEMENT)).toBeHidden();
  await expectCurrentView(page, startingUrl, startingHeading);
  await expect.poll(async () => taskByTitle(await fixtureSnapshot(request), title)).toMatchObject({
    title,
    boxId: "",
    goalId: "",
    projectId: "",
    resourceId: "",
  });
});

function topbarTitle(page) {
  return page.locator(`${TOPBAR} [data-form="quick-capture"] [name="title"]`);
}

async function waitForFixtureWorkspace(page) {
  await expect(page.locator(`[data-select-id="${FIXTURE_IDS.resource}"]`).first()).toBeVisible();
}

function topbarAction(page, action) {
  return page.locator(`${TOPBAR} [data-action="${action}"]`);
}

async function startTopbarCreate(page, action, title) {
  await topbarTitle(page).fill(title);
  await topbarAction(page, action).click();
}

async function currentViewHeading(page) {
  const heading = page.locator("#viewRoot .view h1").first();
  await expect(heading).toBeVisible();
  return heading.innerText();
}

async function expectCurrentView(page, url, heading) {
  expect(page.url()).toBe(url);
  await expect(page.locator("#viewRoot .view h1").first()).toHaveText(heading);
}

async function expectOnlyPlacementPhase(page, phase) {
  const placement = page.locator(QUICK_PLACEMENT);
  await expect(placement).toBeVisible();
  const activePhase = page.locator(
    `${QUICK_PLACEMENT}[data-placement-phase="${phase}"], ${QUICK_PLACEMENT} [data-placement-phase="${phase}"]`,
  ).first();
  await expect(activePhase).toBeVisible();
  await expect(page.locator(`${QUICK_PLACEMENT}[data-placement-phase]:visible, ${QUICK_PLACEMENT} [data-placement-phase]:visible`)).toHaveCount(1);
  for (const otherPhase of PLACEMENT_PHASES.filter((candidate) => candidate !== phase)) {
    await expect(page.locator(
      `${QUICK_PLACEMENT}[data-placement-phase="${otherPhase}"]:visible, ${QUICK_PLACEMENT} [data-placement-phase="${otherPhase}"]:visible`,
    )).toHaveCount(0);
  }
  return activePhase;
}

async function selectPlacementChoice(page, phase, value) {
  const activePhase = await expectOnlyPlacementPhase(page, phase);
  await activePhase.locator(`[data-placement-choice][data-placement-value="${value}"]`).click();
}

async function expectChoiceDoesNotMoveOnHover(page, choice) {
  await expect(choice).toBeVisible();
  await choice.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  await page.waitForTimeout(80);
  const before = await choice.boundingBox();
  expect(before).not.toBeNull();

  await choice.hover();
  await page.waitForTimeout(200);
  const after = await choice.boundingBox();
  expect(after).not.toBeNull();
  for (const key of ["x", "y", "width", "height"]) {
    expect(Math.abs(after[key] - before[key]), `${key} changed while hovering`).toBeLessThanOrEqual(0.25);
  }
}

async function clickWithoutBackdropFlash(control) {
  const probe = await control.evaluate(async (button) => {
    const root = document.querySelector("#overlayRoot");
    if (!root) throw new Error("#overlayRoot is required for the placement backdrop probe");
    const alpha = (color) => {
      if (!color || color === "transparent") return 0;
      const match = String(color).match(/^rgba?\(([^)]+)\)$/i);
      if (!match) return 1;
      const parts = match[1].split(/[,/]/).map((part) => Number.parseFloat(part.trim()));
      return parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
    };
    const darkness = () => {
      const style = getComputedStyle(root, "::before");
      const opacity = Number.parseFloat(style.opacity);
      return alpha(style.backgroundColor) * (Number.isFinite(opacity) ? opacity : 1);
    };
    const baselineDarkness = darkness();
    const samples = [];
    let animationStarts = 0;
    const onAnimationStart = (event) => {
      if (event.target !== root) return;
      if (event.pseudoElement && event.pseudoElement !== "::before") return;
      animationStarts += 1;
    };
    root.addEventListener("animationstart", onAnimationStart);
    button.click();
    for (let frame = 0; frame < 24; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const stage = document.querySelector(".task-scheduler-stage.is-quick-placement, [data-quick-placement]");
      samples.push({ darkness: darkness(), stageOpacity: Number.parseFloat(getComputedStyle(stage).opacity) });
    }
    root.removeEventListener("animationstart", onAnimationStart);
    return {
      animationStarts,
      baselineDarkness,
      minimumDarkness: Math.min(...samples.map((sample) => sample.darkness)),
      minimumStageOpacity: Math.min(...samples.map((sample) => sample.stageOpacity)),
      sameRoot: root === document.querySelector("#overlayRoot"),
    };
  });

  expect(probe.sameRoot).toBe(true);
  expect(probe.animationStarts).toBe(0);
  expect(probe.minimumDarkness).toBeGreaterThanOrEqual(probe.baselineDarkness - 0.02);
  expect(probe.minimumStageOpacity).toBeGreaterThanOrEqual(0.99);
}

async function expectFloatingOverlay(page, activePhase, viewport) {
  const placement = page.locator(QUICK_PLACEMENT);
  const backdropRoot = page.locator("#overlayRoot");

  await expectInsideViewport(activePhase, viewport);
  const rootStyle = await placement.evaluate((element) => {
    const style = getComputedStyle(element);
    return { position: style.position, zIndex: Number(style.zIndex) || 0 };
  });
  expect(rootStyle.position).toBe("fixed");
  expect(rootStyle.zIndex).toBeGreaterThan(0);

  const backdropStyle = await backdropRoot.evaluate((element) => {
    const style = getComputedStyle(element, "::before");
    return {
      backgroundColor: style.backgroundColor,
      opacity: Number.parseFloat(style.opacity) || 0,
      position: style.position,
    };
  });
  expect(backdropStyle.position).toBe("fixed");
  expect(colorAlpha(backdropStyle.backgroundColor) * backdropStyle.opacity).toBeGreaterThan(0.2);
  await expectPlacementScrollLocked(page);
}

async function expectPlacementScrollLocked(page) {
  const state = await page.evaluate(() => ({
    bodyOverflow: getComputedStyle(document.body).overflow,
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
    layoutInert: document.querySelector(".layout")?.inert || false,
  }));
  expect(state.bodyOverflow).toBe("hidden");
  expect(state.htmlOverflow).toBe("hidden");
  expect(state.layoutInert).toBe(true);
}

async function expectPlacementScrollUnlocked(page) {
  await expect.poll(async () => page.evaluate(() => ({
    bodyLocked: document.body.classList.contains("is-task-placement-open"),
    htmlLocked: document.documentElement.classList.contains("is-task-placement-open"),
    layoutInert: document.querySelector(".layout")?.inert || false,
  }))).toEqual({ bodyLocked: false, htmlLocked: false, layoutInert: false });
}

async function expectInsideViewport(locator, viewport) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function localDateKey(page) {
  return page.evaluate(() => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });
}

function taskByTitle(snapshot, title) {
  return snapshot.state.tasks.find((task) => task.title === title) || null;
}

function colorAlpha(color) {
  const match = String(color || "").match(/^rgba?\(([^)]+)\)$/i);
  if (!match) return color === "transparent" ? 0 : 1;
  const parts = match[1].split(",").map((part) => Number(part.trim()));
  return parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
}

async function newIpadContext(browser, testInfo) {
  return browser.newContext({
    baseURL: String(testInfo.project.use.baseURL),
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: IPAD_VIEWPORT,
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "block",
  });
}
