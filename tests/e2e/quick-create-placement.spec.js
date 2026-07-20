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
        hasTimeFields: ["scheduledStart", "scheduledEnd", "estimatedMinutes", "actualMinutes"].some((field) => Object.hasOwn(task, field)),
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
      hasTimeFields: false,
      completedAt: "",
      boxId: "",
      goalId: "",
      projectId: "",
      resourceId: "",
    },
  });
});

test("scheduled lane sets the scheduled state without inventing a date", async ({ page, request }) => {
  const title = "날짜 없는 예정 Task";
  await page.goto("/");
  await waitForFixtureWorkspace(page);
  await startTopbarCreate(page, "new-task", title);

  const scheduler = page.getByRole("dialog", { name: "Task 날짜 배치" });
  await scheduler.locator('[data-scheduler-lane="scheduled"]').click();
  await expectOnlyPlacementPhase(page, "boxId");
  await expect.poll(async () => {
    const task = taskByTitle(await fixtureSnapshot(request), title);
    return task && {
      dueDate: task.dueDate,
      hasTimeFields: ["scheduledStart", "scheduledEnd", "estimatedMinutes", "actualMinutes"].some((field) => Object.hasOwn(task, field)),
      status: task.status,
    };
  }).toEqual({
    dueDate: "",
    hasTimeFields: false,
    status: "scheduled",
  });
});

test("Task date choices do not disguise two days later as scheduled", async ({ page }) => {
  await page.goto("/");
  await waitForFixtureWorkspace(page);

  const labels = await page.evaluate(() => {
    const template = document.createElement("template");
    template.innerHTML = renderTaskDatePropertyChoices({ id: "date-choice-test", dueDate: "" }, "dueDate");
    return Array.from(template.content.querySelectorAll("[data-task-property-value] > span"), (label) => label.textContent);
  });

  expect(labels).toEqual(["오늘", "내일", "다음 주", "날짜 없음"]);
});

test("legacy Task dates normalize to YYYY-MM-DD and drop every time field", async ({ page }) => {
  await page.goto("/");
  await waitForFixtureWorkspace(page);

  const migrated = await page.evaluate(() => {
    const legacyTask = {
      id: "legacy-timed-task",
      title: "Legacy timed Task",
      status: "scheduled",
      boxId: "",
      goalId: "",
      projectId: "",
      resourceId: "",
      dueDate: "",
      scheduledStart: "2031-04-12T09:00:00.000Z",
      scheduledEnd: "2031-04-12T10:00:00.000Z",
      estimatedMinutes: 60,
      actualMinutes: 15,
      completedAt: "",
      googleEventId: "",
      blocks: [],
    };
    const dateTimeDueTask = {
      ...legacyTask,
      id: "legacy-datetime-due-task",
      dueDate: "2032-05-06T23:59:00.000Z",
      scheduledStart: "",
      scheduledEnd: "",
    };
    const legacyBlankSomedayTask = {
      ...legacyTask,
      id: "legacy-blank-someday-task",
      status: "someday",
      dueDate: "",
      scheduledStart: "2033-06-08T09:00:00.000Z",
    };
    const legacyDatedSomedayTask = {
      ...legacyTask,
      id: "legacy-dated-someday-task",
      status: "someday",
      dueDate: "2033-06-07",
      scheduledStart: "2033-06-08T09:00:00.000Z",
    };
    return normalizeState({ ...state, tasks: [legacyTask, dateTimeDueTask, legacyBlankSomedayTask, legacyDatedSomedayTask] }).tasks;
  });

  expect(migrated).toHaveLength(4);
  expect(migrated[0]).toMatchObject({ dueDate: "2031-04-12", status: "scheduled" });
  expect(migrated[1]).toMatchObject({ dueDate: "2032-05-06", status: "scheduled" });
  expect(migrated[2]).toMatchObject({ dueDate: "", status: "scheduled" });
  expect(migrated[3]).toMatchObject({ dueDate: "2033-06-07", status: "scheduled" });
  for (const task of migrated) {
    for (const field of ["scheduledStart", "scheduledEnd", "estimatedMinutes", "actualMinutes"]) {
      expect(task).not.toHaveProperty(field);
    }
  }
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
  await expect(weekdays).toHaveText(["일", "월", "화", "수", "목", "금", "토"]);

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

test("choice hover stays still and large phase surfaces fade and slide without a backdrop flash", async ({ page }) => {
  await page.goto("/");
  await waitForFixtureWorkspace(page);
  await startTopbarCreate(page, "new-task", "깜빡임 없이 전환할 Task");

  const scheduler = page.getByRole("dialog", { name: "Task 날짜 배치" });
  await expect(scheduler).toBeVisible();
  await page.waitForTimeout(260);
  await clickWithPlacementMotion(scheduler.locator('[data-scheduler-lane="today"]'));

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
    if (index < choices.length - 1) await clickWithPlacementMotion(choice);
  }
});

test("reduced motion changes placement phases immediately without transition ghosts", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await waitForFixtureWorkspace(page);
  await startTopbarCreate(page, "new-task", "모션 감소 배치 Task");

  await page.getByRole("dialog", { name: "Task 날짜 배치" }).locator('[data-scheduler-lane="today"]').click();
  const placement = await expectOnlyPlacementPhase(page, "boxId");
  const motion = await placement.evaluate((surface) => {
    const style = getComputedStyle(surface);
    return {
      ghosts: document.querySelectorAll("[data-placement-transition-ghost]").length,
      running: surface.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length,
      settled: Number.parseFloat(style.opacity) >= 0.99
        && style.clipPath === "none"
        && ["none", "0px", "0px 0px"].includes(style.translate),
    };
  });
  expect(motion).toEqual({ ghosts: 0, running: 0, settled: true });
});

test("Escape during phase motion removes the visual ghost without losing the selected date", async ({ page, request }) => {
  const title = "전환 중 닫아도 저장되는 Task";
  await page.goto("/");
  await waitForFixtureWorkspace(page);
  const today = await localDateKey(page);
  await startTopbarCreate(page, "new-task", title);

  const motion = await page.getByRole("dialog", { name: "Task 날짜 배치" })
    .locator('[data-scheduler-lane="today"]')
    .evaluate((button) => {
      button.click();
      const ghostsBeforeEscape = document.querySelectorAll("[data-placement-transition-ghost]").length;
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      return {
        ghostsAfterEscape: document.querySelectorAll("[data-placement-transition-ghost]").length,
        ghostsBeforeEscape,
      };
    });

  expect(motion).toEqual({ ghostsAfterEscape: 0, ghostsBeforeEscape: 1 });
  await expect(page.locator(QUICK_PLACEMENT)).toBeHidden();
  await expectPlacementScrollUnlocked(page);
  await expect.poll(async () => taskByTitle(await fixtureSnapshot(request), title)?.dueDate).toBe(today);
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
    await expect.poll(() => page.locator("[data-placement-transition-ghost]").count()).toBe(0);

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
      await expect.poll(() => page.locator("[data-placement-transition-ghost]").count()).toBe(0);
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

  await clickWithPlacementMotion(page.locator(`${QUICK_PLACEMENT} [data-placement-back]`), -1);
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

async function clickWithPlacementMotion(control, direction = 1) {
  await expect.poll(() => control.evaluate((element) => !element.closest("[inert]"))).toBe(true);
  await expect.poll(() => control.evaluate((element) => (
    !element.closest(".task-scheduler-stage.is-quick-placement, [data-quick-placement]")
      ?.getAnimations()
      .some((animation) => animation.playState === "running")
  ))).toBe(true);
  const probe = await control.evaluate(async (button) => {
    const root = document.querySelector("#overlayRoot");
    if (!root) throw new Error("#overlayRoot is required for the placement backdrop probe");
    const selector = ".task-scheduler-stage.is-quick-placement, [data-quick-placement]";
    const startingStage = button.closest(selector);
    if (!startingStage) throw new Error("A placement stage is required for the motion probe");
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
    const startingCenter = (() => {
      const rect = startingStage.getBoundingClientRect();
      return rect.left + rect.width / 2;
    })();
    const samples = [];
    let animationStarts = 0;
    const onAnimationStart = (event) => {
      if (event.target !== root) return;
      if (event.pseudoElement && event.pseudoElement !== "::before") return;
      animationStarts += 1;
    };
    root.addEventListener("animationstart", onAnimationStart);
    button.click();
    const startedAt = performance.now();
    while (performance.now() - startedAt < 700) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const stage = root.querySelector(selector);
      const stageRect = stage?.getBoundingClientRect();
      const ghostRect = startingStage.isConnected ? startingStage.getBoundingClientRect() : null;
      const stageStyle = stage ? getComputedStyle(stage) : null;
      const ghostStyle = startingStage.isConnected ? getComputedStyle(startingStage) : null;
      samples.push({
        activeCount: root.querySelectorAll(selector).length,
        darkness: darkness(),
        ghostClipPath: ghostStyle?.clipPath || "none",
        ghostCenter: ghostRect ? ghostRect.left + ghostRect.width / 2 : null,
        ghostCount: document.querySelectorAll("[data-placement-transition-ghost]").length,
        ghostIdCount: document.querySelectorAll("[data-placement-transition-ghost] [id]").length,
        ghostHeight: ghostRect?.height || null,
        ghostOpacity: ghostStyle ? Number.parseFloat(ghostStyle.opacity) : null,
        ghostWidth: ghostRect?.width || null,
        incomingClipPath: stageStyle?.clipPath || "none",
        incomingCenter: stageRect ? stageRect.left + stageRect.width / 2 : null,
        incomingHeight: stageRect?.height || null,
        incomingOpacity: stageStyle ? Number.parseFloat(stageStyle.opacity) : null,
        incomingWidth: stageRect?.width || null,
        titleCount: document.querySelectorAll("#quick-placement-title").length,
      });
      const incomingRunning = stage?.getAnimations().some((animation) => animation.playState === "running");
      if (!startingStage.isConnected && stage && !incomingRunning && performance.now() - startedAt > 250) break;
    }
    root.removeEventListener("animationstart", onAnimationStart);
    const ghostCenters = samples.map((sample) => sample.ghostCenter).filter(Number.isFinite);
    const incomingCenters = samples.map((sample) => sample.incomingCenter).filter(Number.isFinite);
    const ghostHeights = samples.map((sample) => sample.ghostHeight).filter(Number.isFinite);
    const ghostOpacities = samples.map((sample) => sample.ghostOpacity).filter(Number.isFinite);
    const ghostWidths = samples.map((sample) => sample.ghostWidth).filter(Number.isFinite);
    const incomingHeights = samples.map((sample) => sample.incomingHeight).filter(Number.isFinite);
    const incomingOpacities = samples.map((sample) => sample.incomingOpacity).filter(Number.isFinite);
    const incomingWidths = samples.map((sample) => sample.incomingWidth).filter(Number.isFinite);
    return {
      animationStarts,
      baselineDarkness,
      distinctGhostCenters: new Set(ghostCenters.map((value) => value.toFixed(1))).size,
      distinctGhostOpacities: new Set(ghostOpacities.map((value) => value.toFixed(2))).size,
      distinctIncomingCenters: new Set(incomingCenters.map((value) => value.toFixed(1))).size,
      distinctIncomingOpacities: new Set(incomingOpacities.map((value) => value.toFixed(2))).size,
      finalCenter: incomingCenters.at(-1),
      finalDarkness: darkness(),
      finalIncomingOpacity: incomingOpacities.at(-1),
      ghostsAfter: document.querySelectorAll("[data-placement-transition-ghost]").length,
      ghostHeightDelta: Math.max(...ghostHeights) - Math.min(...ghostHeights),
      ghostWidthDelta: Math.max(...ghostWidths) - Math.min(...ghostWidths),
      maximumActiveCount: Math.max(...samples.map((sample) => sample.activeCount)),
      maximumDarkness: Math.max(...samples.map((sample) => sample.darkness)),
      maximumGhostCenter: Math.max(...ghostCenters),
      maximumGhostCount: Math.max(...samples.map((sample) => sample.ghostCount)),
      maximumGhostIdCount: Math.max(...samples.map((sample) => sample.ghostIdCount)),
      maximumGhostOpacity: Math.max(...ghostOpacities),
      maximumIncomingCenter: Math.max(...incomingCenters),
      maximumIncomingOpacity: Math.max(...incomingOpacities),
      minimumDarkness: Math.min(...samples.map((sample) => sample.darkness)),
      minimumGhostCenter: Math.min(...ghostCenters),
      minimumGhostOpacity: Math.min(...ghostOpacities),
      minimumIncomingCenter: Math.min(...incomingCenters),
      minimumIncomingOpacity: Math.min(...incomingOpacities),
      incomingHeightDelta: Math.max(...incomingHeights) - Math.min(...incomingHeights),
      incomingWidthDelta: Math.max(...incomingWidths) - Math.min(...incomingWidths),
      maximumTitleCount: Math.max(...samples.map((sample) => sample.titleCount)),
      sameRoot: root === document.querySelector("#overlayRoot"),
      startingCenter,
      usesClipPath: samples.some((sample) => sample.ghostClipPath !== "none" || sample.incomingClipPath !== "none"),
    };
  });

  expect(probe.sameRoot).toBe(true);
  expect(probe.animationStarts).toBe(0);
  expect(probe.minimumDarkness).toBeGreaterThanOrEqual(probe.baselineDarkness - 0.02);
  expect(probe.maximumDarkness).toBeLessThanOrEqual(Math.max(probe.baselineDarkness, probe.finalDarkness) + 0.02);
  expect(probe.minimumGhostOpacity).toBeLessThanOrEqual(0.2);
  expect(probe.maximumGhostOpacity).toBeGreaterThanOrEqual(0.75);
  expect(probe.minimumIncomingOpacity).toBeLessThanOrEqual(0.1);
  expect(probe.maximumIncomingOpacity).toBeGreaterThanOrEqual(0.99);
  expect(probe.finalIncomingOpacity).toBeGreaterThanOrEqual(0.99);
  expect(probe.distinctGhostOpacities).toBeGreaterThanOrEqual(4);
  expect(probe.distinctIncomingOpacities).toBeGreaterThanOrEqual(4);
  expect(probe.ghostWidthDelta).toBeLessThanOrEqual(0.5);
  expect(probe.ghostHeightDelta).toBeLessThanOrEqual(0.5);
  expect(probe.incomingWidthDelta).toBeLessThanOrEqual(0.5);
  expect(probe.incomingHeightDelta).toBeLessThanOrEqual(0.5);
  expect(probe.usesClipPath).toBe(false);
  expect(probe.maximumActiveCount).toBe(1);
  expect(probe.maximumGhostCount).toBe(1);
  expect(probe.maximumGhostIdCount).toBe(0);
  expect(probe.maximumTitleCount).toBeLessThanOrEqual(1);
  expect(probe.ghostsAfter).toBe(0);
  expect(probe.distinctGhostCenters).toBeGreaterThanOrEqual(4);
  expect(probe.distinctIncomingCenters).toBeGreaterThanOrEqual(4);
  expect(Math.abs(probe.finalCenter - probe.startingCenter)).toBeLessThanOrEqual(1);
  if (direction >= 0) {
    expect(probe.minimumGhostCenter).toBeLessThanOrEqual(probe.startingCenter - 24);
    expect(probe.maximumIncomingCenter).toBeGreaterThanOrEqual(probe.finalCenter + 24);
  } else {
    expect(probe.maximumGhostCenter).toBeGreaterThanOrEqual(probe.startingCenter + 24);
    expect(probe.minimumIncomingCenter).toBeLessThanOrEqual(probe.finalCenter - 24);
  }
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
