import { expect, test } from "@playwright/test";
import { fixtureSnapshot, resetFixture } from "./helpers.js";

const IPAD_VIEWPORT = { width: 1024, height: 1366 };
const TASK_TITLE = "Dashboard drag action parity";

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("Today mouse drag moves a task to the date-free scheduled state", async ({ page, request }) => {
  await page.goto("/");
  const task = await createTodayTask(page, request);

  await beginMouseDrag(page, task.card);
  await expectSharedActionStage(page);

  const scheduledTarget = page.locator(".today-drag-stage .task-scheduler-lane");
  const target = await locatorCenter(scheduledTarget);
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await expect(scheduledTarget).toHaveClass(/is-over/);
  await page.mouse.up();

  await expectTaskScheduled(page, request, task.id);
});

test("Today iPad touch drag does not scroll and uses the shared delete action UI", async ({ browser, request }, testInfo) => {
  const context = await browser.newContext({
    baseURL: String(testInfo.project.use.baseURL),
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: IPAD_VIEWPORT,
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();

  try {
    await page.goto("/");
    const task = await createTodayTask(page, request);
    await task.card.scrollIntoViewIfNeeded();
    const scrollY = await page.evaluate(() => window.scrollY);
    const session = await context.newCDPSession(page);

    try {
      const start = await locatorCenter(task.card.locator(".card-title"));
      await dispatchTouch(session, "touchStart", start);
      await dispatchTouch(session, "touchMove", { x: start.x + 2, y: start.y + 30 });

      await expectSharedActionStage(page);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY);

      const deleteTarget = page.locator(".today-drag-stage .today-delete-drop");
      await dispatchTouch(session, "touchMove", await locatorCenter(deleteTarget));
      await expect(deleteTarget).toHaveClass(/is-over/);
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } finally {
      await session.detach();
    }

    await expectTaskDeleted(page, request, task.id);
  } finally {
    await context.close();
  }
});

async function createTodayTask(page, request) {
  await expect(page.locator("#viewRoot .view h1")).toContainText("대시보드");
  await expect(page.locator(".today-drag-stage")).toHaveCount(0);
  const id = await page.evaluate((title) => {
    const task = window.createTask(title, {
      deferCreate: true,
      initial: { dueDate: window.dateKey(new Date()) },
    });
    window.saveState();
    window.renderView({ soft: true });
    return task.id;
  }, TASK_TITLE);
  const card = page.locator(`[data-today-task-id="${id}"]`);
  await expect(card).toBeVisible();
  await expect.poll(async () => (
    (await fixtureSnapshot(request)).state.tasks.some((task) => task.id === id)
  )).toBe(true);
  return { id, card };
}

async function beginMouseDrag(page, card) {
  const start = await locatorCenter(card.locator(".card-title"));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 30, start.y + 2, { steps: 4 });
}

async function expectSharedActionStage(page) {
  const stage = page.locator(".today-drag-stage.delete-drag-stage.is-multi-action");
  const scheduled = stage.locator(".task-scheduler-lane.today-floating-drop");
  const deleteTarget = stage.locator(".task-scheduler-delete-zone.today-delete-drop");
  await expect(stage).toBeVisible();
  await expect(scheduled).toContainText("예정날짜 미정");
  await expect(deleteTarget).toContainText("삭제");
  await expect(page.locator(".today-drag-ghost")).toBeVisible();
  await expect(page.locator(".app")).toHaveClass(/is-today-task-dragging/);

  await stage.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
  });
  const styles = await page.evaluate(() => {
    const stage = document.querySelector(".today-drag-stage");
    const scheduled = stage.querySelector(".task-scheduler-lane");
    const deleteTarget = stage.querySelector(".task-scheduler-delete-zone");
    const ghost = document.querySelector(".today-drag-ghost");
    return {
      deletePosition: getComputedStyle(deleteTarget).position,
      deleteRadius: getComputedStyle(deleteTarget).borderRadius,
      ghostZ: Number(getComputedStyle(ghost).zIndex),
      scheduledPosition: getComputedStyle(scheduled).position,
      scheduledRadius: getComputedStyle(scheduled).borderRadius,
      stageDisplay: getComputedStyle(stage).display,
      stagePosition: getComputedStyle(stage).position,
      stageRight: getComputedStyle(stage).right,
      stageZ: Number(getComputedStyle(stage).zIndex),
    };
  });
  expect(styles).toMatchObject({
    deletePosition: "static",
    deleteRadius: "0px",
    scheduledPosition: "static",
    scheduledRadius: "0px",
    stageDisplay: "grid",
    stagePosition: "fixed",
    stageRight: "54px",
  });
  expect(styles.ghostZ).toBeGreaterThan(styles.stageZ);
}

async function expectTaskScheduled(page, request, taskId) {
  await expect(page.locator(".today-drag-stage")).toHaveCount(0);
  await expect(page.locator(".today-drag-ghost")).toHaveCount(0);
  await expect(page.locator(".app")).not.toHaveClass(/is-today-task-dragging/);
  await expect(page.locator(`[data-today-task-id="${taskId}"]`)).toHaveCount(0);
  await expect.poll(async () => {
    const task = (await fixtureSnapshot(request)).state.tasks.find((entry) => entry.id === taskId);
    return task && {
      dueDate: task.dueDate,
      scheduledEnd: task.scheduledEnd,
      scheduledStart: task.scheduledStart,
      status: task.status,
    };
  }).toEqual({
    dueDate: "",
    scheduledEnd: "",
    scheduledStart: "",
    status: "scheduled",
  });
  expect(await page.evaluate((id) => {
    const today = dateKey(new Date());
    const tomorrow = dateKey(addDays(new Date(), 1));
    const buckets = taskBoardBuckets(state.tasks, today, tomorrow);
    return {
      scheduled: buckets.scheduled.some((task) => task.id === id),
      unplanned: buckets.unplannedOnly.some((task) => task.id === id),
    };
  }, taskId)).toEqual({ scheduled: true, unplanned: false });
}

async function expectTaskDeleted(page, request, taskId) {
  await expect(page.locator(".today-drag-stage")).toHaveCount(0);
  await expect(page.locator(".today-drag-ghost")).toHaveCount(0);
  await expect(page.locator(".app")).not.toHaveClass(/is-today-task-dragging/);
  await expect.poll(async () => (
    (await fixtureSnapshot(request)).state.tasks.some((task) => task.id === taskId)
  )).toBe(false);
}

async function dispatchTouch(session, type, point) {
  await session.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: [{
      id: 1,
      x: point.x,
      y: point.y,
      radiusX: 1,
      radiusY: 1,
      force: 1,
    }],
  });
}

async function locatorCenter(locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}
