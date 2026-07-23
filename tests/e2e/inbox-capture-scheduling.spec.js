import { expect, test } from "@playwright/test";
import { fixtureSnapshot, resetFixture } from "./helpers.js";

test("Inbox dates persist and Task drag placement commits immediately", async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  const dates = await page.evaluate(() => ({
    task: dateKey(addDays(new Date(), 1)),
    rangeStartClick: dateKey(addDays(new Date(), 3)),
    rangeEndClick: dateKey(new Date()),
  }));

  await page.evaluate(() => {
    const capturedAt = new Date().toISOString();
    state.captures.push(
      { id: "capture-task-date", title: "날짜를 고를 Inbox Task", url: "", status: "inbox", convertedTo: "", convertedId: "", createdAt: capturedAt, processedAt: "" },
      { id: "capture-project-range", title: "기간을 고를 Inbox Project", url: "", status: "inbox", convertedTo: "", convertedId: "", createdAt: capturedAt, processedAt: "" },
    );
    saveState();
  });
  await page.locator('[data-nav-key="inbox"]').evaluate((button) => button.click());

  const taskCapture = page.locator('[data-select-id="capture-task-date"]');
  await taskCapture.locator('[data-convert="tasks"]').click();
  await completeCaptureRelations(taskCapture, 4);
  await expect(taskCapture.locator('[data-capture-date-picker="capture-task-date"]')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileDay = taskCapture.locator(".task-scheduler-day:not(.is-outside)").first();
  await expect.poll(async () => (await mobileDay.boundingBox())?.width || 0).toBeGreaterThanOrEqual(42);
  await expect.poll(async () => (await mobileDay.boundingBox())?.height || 0).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 1440, height: 1000 });

  const nextMonth = taskCapture.locator('[data-capture-calendar-nav="next"]');
  await nextMonth.focus();
  await nextMonth.press("Enter");
  await expect(taskCapture.locator('[data-capture-calendar-nav="next"]')).toBeFocused();
  await taskCapture.locator('[data-capture-calendar-nav="today"]').click();
  await taskCapture.locator(`[data-capture-calendar-date="${dates.task}"]`).click();
  await taskCapture.locator("[data-capture-calendar-clear]").click();
  await expect(taskCapture.locator("[data-capture-calendar-clear]")).toBeFocused();
  await taskCapture.locator(`[data-capture-calendar-date="${dates.task}"]`).click();
  await taskCapture.locator('[data-task-flow-save="capture-task-date"]').click();

  const projectCapture = page.locator('[data-select-id="capture-project-range"]');
  await projectCapture.locator('[data-convert="projects"]').click();
  await completeCaptureRelations(projectCapture, 2);
  await expect(projectCapture.locator('[data-capture-date-picker="capture-project-range"]')).toBeVisible();
  await projectCapture.locator(`[data-capture-calendar-date="${dates.rangeStartClick}"]`).click();
  await expect(projectCapture.locator('[data-task-flow-save="capture-project-range"]')).toBeDisabled();
  await projectCapture.locator(`[data-capture-calendar-date="${dates.rangeEndClick}"]`).click();
  await expect(projectCapture.locator('[data-task-flow-save="capture-project-range"]')).toBeEnabled();
  await projectCapture.locator('[data-task-flow-save="capture-project-range"]').click();

  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    const taskCaptureState = snapshot.state.captures.find((capture) => capture.id === "capture-task-date");
    const projectCaptureState = snapshot.state.captures.find((capture) => capture.id === "capture-project-range");
    const task = snapshot.state.tasks.find((entry) => entry.id === taskCaptureState?.convertedId);
    const project = snapshot.state.projects.find((entry) => entry.id === projectCaptureState?.convertedId);
    return {
      task: task && { dueDate: task.dueDate },
      project: project && { startDate: project.startDate, endDate: project.endDate },
    };
  }).toEqual({
    task: { dueDate: dates.task },
    project: { startDate: dates.rangeEndClick, endDate: dates.rangeStartClick },
  });

  const placement = await page.evaluate(() => {
    const task = createTask("즉시 사라질 미계획 Task", {
      deferCreate: true,
      initial: { boxId: "", goalId: "", projectId: "", resourceId: "", dueDate: "", status: "todo" },
    });
    saveState();
    return { id: task.id, today: dateKey(new Date()) };
  });
  await page.locator('[data-nav-key="tasks"]').evaluate((button) => button.click());

  const source = page.locator(`[data-schedule-hold="${placement.id}"]`);
  const start = await center(source);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 32, start.y + 2, { steps: 3 });
  const target = page.locator('[data-scheduler-lane="today"]');
  const end = await center(target);
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await expect(target).toHaveClass(/is-drop-target/);
  await page.mouse.up();

  const immediate = await page.evaluate(({ id, today }) => {
    const task = itemById("tasks", id);
    const card = document.querySelector(`[data-task-id="${id}"]`);
    return {
      dueDate: task?.dueDate,
      schedulerCount: document.querySelectorAll(".task-scheduler-stage").length,
      column: card?.closest(".panel")?.querySelector(".panel-title")?.textContent || "",
      reordering: card?.classList.contains("is-reordering") || false,
      transitionDuration: card ? getComputedStyle(card).transitionDuration : "",
      today,
    };
  }, placement);
  expect(immediate).toMatchObject({
    dueDate: placement.today,
    schedulerCount: 0,
    column: "오늘",
    reordering: true,
    today: placement.today,
  });
  expect(immediate.transitionDuration).toContain("0.19s");
  await expect(page.locator(`[data-task-id="${placement.id}"]`)).not.toHaveClass(/is-reordering/, { timeout: 300 });
});

async function completeCaptureRelations(card, count) {
  for (let index = 0; index < count; index += 1) {
    const choice = card.locator('.capture-flow-row.is-active [data-task-flow-choice][data-flow-value=""]').first();
    await expect(choice).toBeVisible();
    await choice.click();
    await expect.poll(() => card.locator(".capture-flow-row.is-complete").count()).toBe(index + 1);
  }
}

async function center(locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
