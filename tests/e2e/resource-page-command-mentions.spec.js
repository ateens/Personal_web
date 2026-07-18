import { expect, test } from "@playwright/test";
import {
  FIXTURE_IDS,
  fixtureSnapshot,
  resetFixture,
} from "./helpers.js";

const RESOURCE_PATH = `/resources/${encodeURIComponent(FIXTURE_IDS.resource)}`;
const TASK_ID = "fixture-task-page-mention";
const HABIT_ID = "fixture-habit-page-mention";

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto(RESOURCE_PATH);
  await expect(mainResource(page)).toBeVisible();
});

function mainResource(page) {
  return page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
}

function resourceFromSnapshot(snapshot, resourceId = FIXTURE_IDS.resource) {
  return snapshot.state.resources.find((resource) => resource.id === resourceId);
}

async function expectResourceWriteOrder(request, attemptOffset, firstId, secondId) {
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    const resourceIds = snapshot.writeAttempts
      .slice(attemptOffset)
      .filter((attempt) => attempt.resourceId)
      .map((attempt) => attempt.resourceId);
    const firstIndex = resourceIds.indexOf(firstId);
    const secondIndex = resourceIds.findIndex((resourceId, index) => index > firstIndex && resourceId === secondId);
    return firstIndex >= 0 && secondIndex > firstIndex;
  }).toBe(true);
}

test("+ page commands create a real child while create-page stays at workspace root", async ({ page, request }) => {
  const before = await fixtureSnapshot(request);
  const existingIds = new Set(before.state.resources.map((resource) => resource.id));
  const attemptOffset = before.writeAttempts.length;
  const note = mainResource(page);

  const childCommand = note.locator('[data-block-content="fixture-block-paragraph"]');
  await childCommand.fill("+Command child");
  await expect(page.locator('.page-command-menu [data-page-command-index="0"]')).toContainText("Add new sub-page");
  await childCommand.press("Enter");

  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return snapshot.state.resources.some((resource) => !existingIds.has(resource.id) && resource.title === "Command child");
  }).toBe(true);
  const childSnapshot = await fixtureSnapshot(request);
  const child = childSnapshot.state.resources.find((resource) => !existingIds.has(resource.id) && resource.title === "Command child");
  const parentAfterChild = resourceFromSnapshot(childSnapshot);
  expect(child).toMatchObject({ parentId: FIXTURE_IDS.resource, trashedAt: "" });
  expect(parentAfterChild.childOrder).toContain(child.id);
  expect(parentAfterChild.blocks.flatMap((block) => block.marks || [])).toContainEqual(expect.objectContaining({
    type: "mention",
    mentionType: "page",
    targetType: "resources",
    targetId: child.id,
  }));
  await expect(note.locator(`[data-inline-mark="mention"][data-mention-target-id="${child.id}"]`)).toHaveAttribute("data-mention-target-state", "active");
  await expectResourceWriteOrder(request, attemptOffset, child.id, FIXTURE_IDS.resource);

  const beforeRoot = await fixtureSnapshot(request);
  const rootAttemptOffset = beforeRoot.writeAttempts.length;
  const rootCommand = note.locator('[data-block-content="fixture-block-heading-1"]');
  await rootCommand.fill("+Command root");
  await expect(page.locator(".page-command-menu")).toBeVisible();
  await rootCommand.press("ArrowDown");
  await rootCommand.press("Enter");

  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return snapshot.state.resources.some((resource) => resource.title === "Command root");
  }).toBe(true);
  const rootSnapshot = await fixtureSnapshot(request);
  const root = rootSnapshot.state.resources.find((resource) => resource.title === "Command root");
  expect(root.parentId).toBe("");
  expect(resourceFromSnapshot(rootSnapshot).childOrder).not.toContain(root.id);
  await expect(note.locator(`[data-inline-mark="mention"][data-mention-target-id="${root.id}"]`)).toHaveAttribute("data-mention-target-state", "active");
  await expectResourceWriteOrder(request, rootAttemptOffset, root.id, FIXTURE_IDS.resource);
});

test("page mentions expose target state and navigate by click or keyboard to every supported entity", async ({ page, request }) => {
  await seedMentionTargets(request);
  await page.reload();
  const note = mainResource(page);
  await expect(note).toBeVisible();

  const targetCases = [
    { type: "projects", id: FIXTURE_IDS.project, key: "Enter", selector: `[data-project-toggle="${FIXTURE_IDS.project}"]` },
    { type: "goals", id: FIXTURE_IDS.goal, key: " ", selector: `[data-select-type="goals"][data-select-id="${FIXTURE_IDS.goal}"]` },
    { type: "boxes", id: FIXTURE_IDS.box, key: "Enter", selector: `[data-select-type="boxes"][data-select-id="${FIXTURE_IDS.box}"]` },
    { type: "tasks", id: TASK_ID, key: " ", selector: `[data-task-id="${TASK_ID}"]` },
    { type: "habits", id: HABIT_ID, key: "Enter", selector: `[data-habit-toggle="${HABIT_ID}"]` },
  ];

  for (const targetCase of targetCases) {
    const mention = mainResource(page).locator(
      `[data-inline-mark="mention"][data-mention-target-type="${targetCase.type}"][data-mention-target-id="${targetCase.id}"]`,
    );
    await expect(mention).toHaveAttribute("role", "link");
    await expect(mention).toHaveAttribute("tabindex", "0");
    await expect(mention).toHaveAttribute("data-mention-target-state", "active");
    await mention.focus();
    await mention.press(targetCase.key);
    const destination = page.locator(`#viewRoot ${targetCase.selector}`);
    await expect(destination).toBeVisible();
    await expect(destination).toBeFocused();
    if (targetCase.type === "projects" || targetCase.type === "habits") {
      await expect(destination).toHaveAttribute("aria-expanded", "true");
    }
    await page.goBack();
    await expect(mainResource(page)).toBeVisible();
  }

  const missing = mainResource(page).locator('[data-mention-target-type="projects"][data-mention-target-id="missing-project"]');
  await expect(missing).toHaveAttribute("data-mention-target-state", "missing");
  await expect(missing).toHaveAttribute("aria-label", /찾을 수 없는 Project/);
  await missing.focus();
  await missing.press("Enter");
  await expect(page.locator("#toast")).toContainText("찾을 수 없습니다");
  await expect(mainResource(page)).toBeVisible();

  const resourceMention = mainResource(page).locator(
    `[data-block-id="fixture-page-mention-navigation-block"] [data-mention-target-type="resources"][data-mention-target-id="${FIXTURE_IDS.bodySearchResource}"]`,
  );
  await resourceMention.click();
  await expect(page.locator(`[data-resource-note="${FIXTURE_IDS.bodySearchResource}"]`)).toBeVisible();
});

async function seedMentionTargets(request) {
  const snapshot = await fixtureSnapshot(request);
  const nextState = structuredClone(snapshot.state);
  nextState.tasks.push({
    id: TASK_ID,
    title: "Mention Task",
    status: "todo",
    boxId: FIXTURE_IDS.box,
    goalId: FIXTURE_IDS.goal,
    projectId: FIXTURE_IDS.project,
    resourceId: "",
    dueDate: "",
    completedAt: "",
    googleEventId: "",
    blocks: [{ id: "fixture-task-mention-block", type: "paragraph", text: "", marks: [], checked: false, indent: 0, collapsed: false }],
  });
  nextState.habits.push({
    id: HABIT_ID,
    title: "Mention Habit",
    cadence: "daily",
    target: "Mention target",
    status: "active",
    boxId: FIXTURE_IDS.box,
    projectId: FIXTURE_IDS.project,
    blocks: [{ id: "fixture-habit-mention-block", type: "paragraph", text: "", marks: [], checked: false, indent: 0, collapsed: false }],
  });

  const labels = ["Resource", "Project", "Goal", "Box", "Task", "Habit", "Missing"];
  const text = labels.join(" ");
  const mark = (label, targetType, targetId) => {
    const start = text.indexOf(label);
    return { type: "mention", start, end: start + label.length, mentionType: "page", label, targetType, targetId };
  };
  const resource = resourceFromSnapshot({ state: nextState });
  resource.blocks.push({
    id: "fixture-page-mention-navigation-block",
    type: "paragraph",
    text,
    marks: [
      mark("Resource", "resources", FIXTURE_IDS.bodySearchResource),
      mark("Project", "projects", FIXTURE_IDS.project),
      mark("Goal", "goals", FIXTURE_IDS.goal),
      mark("Box", "boxes", FIXTURE_IDS.box),
      mark("Task", "tasks", TASK_ID),
      mark("Habit", "habits", HABIT_ID),
      mark("Missing", "projects", "missing-project"),
    ],
    checked: false,
    indent: 0,
    collapsed: false,
  });
  resource.updatedAt = new Date().toISOString();
  resource.revision += 1;
  nextState.updatedAt = resource.updatedAt;

  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${snapshot.serverRevision}"` },
    data: { state: nextState, baseRevision: snapshot.serverRevision },
  });
  expect(response.ok()).toBeTruthy();
}
