import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const TITLES = {
  project: "일괄 프로젝트 배치",
  goal: "일괄 목표 배치",
  unassigned: "일괄 미배치",
  deleted: "일괄 삭제",
};

test("Today creates multiple tasks and assigns each exactly once", async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");

  await page.locator('[data-action="new-today-batch"]').evaluate((button) => button.click());
  const input = page.locator("[data-today-batch-input]");
  await expect(input).toBeFocused();
  await input.fill(`${Object.values(TITLES).join("\n")}\n`);
  await page.keyboard.press("Enter");

  await expect(page.locator("[data-today-batch-dialog]")).toBeVisible();
  await expect(page.locator(".layout")).toHaveAttribute("inert", "");
  await expect(page.locator("[data-today-batch-task]")).toHaveCount(4);
  const today = await page.evaluate(() => dateKey(new Date()));
  await expect.poll(async () => {
    const tasks = (await fixtureSnapshot(request)).state.tasks.filter((task) => Object.values(TITLES).includes(task.title));
    return tasks.map(({ title, status, dueDate, boxId, goalId, projectId, resourceId }) => ({
      title,
      status,
      dueDate,
      boxId,
      goalId,
      projectId,
      resourceId,
    }));
  }).toEqual(Object.values(TITLES).map((title) => ({
    title,
    status: "todo",
    dueDate: today,
    boxId: "",
    goalId: "",
    projectId: "",
    resourceId: "",
  })));

  await dragTask(page, TITLES.project, `[data-today-task-action="project:${FIXTURE_IDS.project}"]`);
  await expect(page.locator("[data-today-batch-task]")).toHaveCount(3);
  await expectTaskState(request, TITLES.project, {
    boxId: FIXTURE_IDS.box,
    goalId: FIXTURE_IDS.goal,
    projectId: FIXTURE_IDS.project,
    resourceId: "",
  });

  await dragTask(page, TITLES.goal, `[data-today-task-action="goal:${FIXTURE_IDS.goal}"]`);
  await expect(page.locator("[data-today-batch-task]")).toHaveCount(2);
  await expectTaskState(request, TITLES.goal, {
    boxId: FIXTURE_IDS.box,
    goalId: FIXTURE_IDS.goal,
    projectId: "",
    resourceId: "",
  });

  await dragTask(page, TITLES.unassigned, '[data-today-task-action="unassigned"]');
  await expect(page.locator("[data-today-batch-task]")).toHaveCount(1);
  await expectTaskState(request, TITLES.unassigned, {
    boxId: "",
    goalId: "",
    projectId: "",
    resourceId: "",
  });

  await dragTask(page, TITLES.deleted, '[data-today-task-action="delete"]');
  await expect(page.locator("[data-today-batch-dialog]")).toHaveCount(0);
  await expect(page.locator(".layout")).not.toHaveAttribute("inert", "");
  await expect.poll(async () => (
    (await fixtureSnapshot(request)).state.tasks.some((task) => task.title === TITLES.deleted)
  )).toBe(false);
});

async function dragTask(page, title, targetSelector) {
  const source = page.locator("[data-today-batch-task]", { hasText: title });
  const target = page.locator(targetSelector);
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  const start = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  };
  const end = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 36, start.y, { steps: 3 });
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

async function expectTaskState(request, title, expected) {
  await expect.poll(async () => {
    const task = (await fixtureSnapshot(request)).state.tasks.find((entry) => entry.title === title);
    if (!task) return null;
    return {
      boxId: task.boxId,
      goalId: task.goalId,
      projectId: task.projectId,
      resourceId: task.resourceId,
    };
  }).toEqual(expected);
}
