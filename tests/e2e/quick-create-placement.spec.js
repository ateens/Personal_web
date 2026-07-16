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

async function expectFloatingOverlay(page, activePhase, viewport) {
  const placement = page.locator(QUICK_PLACEMENT);
  const backdrop = page.locator("[data-placement-backdrop], .quick-placement-backdrop").first();
  const darkSurface = await backdrop.count() ? backdrop : placement;

  await expectInsideViewport(activePhase, viewport);
  const rootStyle = await placement.evaluate((element) => {
    const style = getComputedStyle(element);
    return { position: style.position, zIndex: Number(style.zIndex) || 0 };
  });
  expect(rootStyle.position).toBe("fixed");
  expect(rootStyle.zIndex).toBeGreaterThan(0);

  const backdropStyle = await darkSurface.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      position: style.position,
    };
  });
  expect(backdropStyle.position).toBe("fixed");
  expect(colorAlpha(backdropStyle.backgroundColor)).toBeGreaterThan(0);
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
