import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const SOURCE_PATH = `/resources/${encodeURIComponent(FIXTURE_IDS.resource)}`;
const LOCKED_RESOURCE_ID = "fixture-resource-locked-move-target";
const TRASHED_RESOURCE_ID = "fixture-resource-trashed-move-target";
const COLLISION_RESOURCE_ID = "fixture-resource-collision-move-target";
const SOURCE_REPLY_ID = "fixture-source-move-reply";
const TARGET_THREAD_ID = "fixture-target-move-thread";
const TARGET_REPLY_ID = "fixture-target-move-reply";

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await seedMoveTargets(request);
  await page.goto(SOURCE_PATH);
  await expect(sourceNote(page)).toBeVisible();
});

function sourceNote(page) {
  return page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
}

function sourceBlock(page, blockId) {
  return sourceNote(page).locator(`[data-block-id="${blockId}"]`);
}

function sourceContent(page, blockId) {
  return sourceNote(page).locator(`[data-block-content="${blockId}"]`);
}

async function selectBlock(page, blockId) {
  const content = sourceContent(page, blockId);
  await content.focus();
  await content.press("Escape");
  await expect(sourceBlock(page, blockId)).toHaveClass(/is-selected/);
}

async function openMoveMenu(page, blockId) {
  await selectBlock(page, blockId);
  await page.keyboard.press("Meta+/");
  const actions = page.locator(".slash-menu.is-selection-menu:not(.is-selection-move-menu)");
  await expect(actions).toBeVisible();
  await actions.locator('[data-selected-block-action="move-to"]').click();
  const moveMenu = page.locator(".is-selection-move-menu");
  await expect(moveMenu).toBeVisible();
  await expect(moveMenu.locator("[data-selected-block-move-query]")).toBeFocused();
  return moveMenu;
}

async function chooseDestination(page, resourceTitle, options = {}) {
  const moveMenu = page.locator(".is-selection-move-menu");
  const search = moveMenu.locator("[data-selected-block-move-query]");
  await search.fill(resourceTitle);
  await expect(moveMenu.locator("[data-selected-block-move-target]")).toHaveCount(1);
  await search.press("Home");
  await search.press("End");
  await search.press("Enter");
  if (options.expectClosed !== false) await expect(moveMenu).toHaveCount(0);
}

async function seedMoveTargets(request) {
  const response = await request.get("/api/state");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  const baseRevision = Number(response.headers()["x-state-revision"] || payload.revision);
  const template = payload.state.resources.find((resource) => resource.id === FIXTURE_IDS.bodySearchResource);
  const makeTarget = (id, title, overrides = {}) => ({
    ...structuredClone(template),
    id,
    title,
    parentId: "",
    childOrder: [],
    updatedAt: "2026-07-11T00:00:01.000Z",
    revision: 8,
    blocks: [{
      id: `${id}-paragraph`,
      type: "paragraph",
      text: `${title} body`,
      marks: [],
      checked: false,
      indent: 0,
      collapsed: false,
    }],
    commentThreads: [],
    readOnly: false,
    locked: false,
    trashedAt: "",
    ...overrides,
  });
  const source = payload.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource);
  source.commentThreads[0].replies.push({
    id: SOURCE_REPLY_ID,
    body: "Source reply used to validate the global ID namespace",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    deletedAt: "",
  });
  payload.state.resources.push(
    makeTarget(LOCKED_RESOURCE_ID, "Locked Move Target", { locked: true }),
    makeTarget(TRASHED_RESOURCE_ID, "Trashed Move Target", { trashedAt: "2026-07-11T00:00:02.000Z" }),
    makeTarget(COLLISION_RESOURCE_ID, "Collision Move Target", {
      commentThreads: [{
        id: TARGET_THREAD_ID,
        scope: "page",
        anchor: null,
        body: "Target thread used to validate the global ID namespace",
        createdAt: "2026-07-11T00:00:00.000Z",
        updatedAt: "2026-07-11T00:00:00.000Z",
        resolvedAt: "",
        deletedAt: "",
        replies: [{
          id: TARGET_REPLY_ID,
          body: "Target reply used to validate the global ID namespace",
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
          deletedAt: "",
        }],
      }],
    }),
  );
  const write = await request.put("/api/state", {
    headers: { "If-Match": `"state-${baseRevision}"` },
    data: { state: payload.state, baseRevision },
  });
  expect(write.ok()).toBeTruthy();
}

function resourceFrom(snapshot, resourceId) {
  return snapshot.state.resources.find((resource) => resource.id === resourceId);
}

function blockIds(resource) {
  return (resource?.blocks || []).map((block) => block.id);
}

function resourceCommentIntegrity(resource) {
  const resourceBlockIds = new Set(blockIds(resource));
  const threadIds = new Set((resource?.commentThreads || []).map((thread) => thread.id));
  const anchorsValid = (resource?.commentThreads || []).every((thread) => (
    thread.scope !== "inline" || resourceBlockIds.has(thread.anchor?.blockId)
  ));
  const marksValid = (resource?.blocks || []).every((block) => (
    (block.marks || []).every((mark) => mark.type !== "comment" || threadIds.has(mark.commentId))
  ));
  return anchorsValid && marksValid;
}

async function expectMoveState(request, blockId, targetId, moved) {
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return {
      source: blockIds(resourceFrom(snapshot, FIXTURE_IDS.resource)).includes(blockId),
      target: blockIds(resourceFrom(snapshot, targetId)).includes(blockId),
    };
  }).toEqual({ source: !moved, target: moved });
}

async function expectDuplicateWriteRejected(request, mode, mutate) {
  const before = await fixtureSnapshot(request);
  const draft = structuredClone(before.state);
  mutate(draft);
  const baseRevision = before.serverRevision;
  const target = draft.resources.find((resource) => resource.id === COLLISION_RESOURCE_ID);
  const response = mode === "full"
    ? await request.put("/api/state", {
      headers: { "If-Match": `"state-${baseRevision}"` },
      data: { state: draft, baseRevision },
    })
    : await request.put(`/api/resources/${encodeURIComponent(COLLISION_RESOURCE_ID)}`, {
      headers: { "If-Match": `"state-${baseRevision}"` },
      data: { resource: target, baseRevision },
    });
  expect(response.status()).toBe(422);
  const payload = await response.json();
  expect(payload.code).toBe("INVALID_STATE");
  expect(payload.details?.issues?.some((issue) => issue.code === "duplicate_id")).toBe(true);
  const after = await fixtureSnapshot(request);
  expect(after.serverRevision).toBe(before.serverRevision);
  expect(after.state).toEqual(before.state);
}

test("searchable move submenu clamps to a short viewport and returns focus on Back, Cancel, and Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 280 });
  let moveMenu = await openMoveMenu(page, "fixture-block-paragraph");
  const bounds = await moveMenu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(280);

  await expect(moveMenu.locator(`[data-selected-block-move-target="${FIXTURE_IDS.resource}"]`)).toHaveCount(0);
  await expect(moveMenu.locator(`[data-selected-block-move-target="${FIXTURE_IDS.readOnlyResource}"]`)).toHaveCount(0);
  await expect(moveMenu.locator(`[data-selected-block-move-target="${LOCKED_RESOURCE_ID}"]`)).toHaveCount(0);
  await expect(moveMenu.locator(`[data-selected-block-move-target="${TRASHED_RESOURCE_ID}"]`)).toHaveCount(0);

  await moveMenu.locator("[data-selected-block-move-back]").click();
  await expect(page.locator('[data-selected-block-action="move-to"]')).toBeFocused();
  await page.locator('[data-selected-block-action="move-to"]').click();
  moveMenu = page.locator(".is-selection-move-menu");
  await moveMenu.locator("[data-selected-block-move-query]").fill("Database Needle");
  await expect(moveMenu.locator("[data-selected-block-move-target]")).toHaveCount(1);
  await moveMenu.locator("[data-selected-block-move-query]").press("ArrowDown");
  await moveMenu.locator("[data-selected-block-move-query]").press("Escape");
  await expect(sourceBlock(page, "fixture-block-paragraph")).toHaveClass(/is-selected/);
  await expect(sourceBlock(page, "fixture-block-paragraph").locator("[data-block-drag]")).toBeFocused();

  await page.keyboard.press("Meta+/");
  await page.locator('[data-selected-block-action="move-to"]').click();
  await page.locator("[data-selected-block-move-cancel]").click();
  await expect(sourceBlock(page, "fixture-block-paragraph").locator("[data-block-drag]")).toBeFocused();
});

test("single-block move persists source-to-target writes and undo/redo atomically restores both pages", async ({ page, request }) => {
  const beforeMove = await fixtureSnapshot(request);
  await openMoveMenu(page, "fixture-block-paragraph");
  await chooseDestination(page, "Body Search Fixture");
  await expect(page.locator("#toast")).toContainText("1개 블록");
  await expectMoveState(request, "fixture-block-paragraph", FIXTURE_IDS.bodySearchResource, true);

  let snapshot = await fixtureSnapshot(request);
  let resourceAttempts = snapshot.writeAttempts.filter((attempt) => attempt.resourceId && attempt.outcome === "saved");
  expect(resourceAttempts.slice(-2).map((attempt) => attempt.resourceId)).toEqual([
    FIXTURE_IDS.resource,
    FIXTURE_IDS.bodySearchResource,
  ]);
  expect(blockIds(resourceFrom(snapshot, FIXTURE_IDS.resource)).length).toBeGreaterThan(0);

  const wrongOrderResponse = await request.put(`/api/resources/${encodeURIComponent(FIXTURE_IDS.resource)}`, {
    headers: { "If-Match": `"state-${snapshot.serverRevision}"` },
    data: {
      resource: resourceFrom(beforeMove, FIXTURE_IDS.resource),
      baseRevision: snapshot.serverRevision,
    },
  });
  expect(wrongOrderResponse.status()).toBe(422);
  const wrongOrderPayload = await wrongOrderResponse.json();
  expect(wrongOrderPayload.code).toBe("INVALID_STATE");
  expect(wrongOrderPayload.details?.issues?.some((issue) => issue.code === "duplicate_id")).toBe(true);
  const afterWrongOrder = await fixtureSnapshot(request);
  expect(afterWrongOrder.serverRevision).toBe(snapshot.serverRevision);
  expect(afterWrongOrder.state).toEqual(snapshot.state);
  expect(afterWrongOrder.writeAttempts.at(-1)).toMatchObject({
    resourceId: FIXTURE_IDS.resource,
    outcome: "invalid-state",
  });

  await page.keyboard.press("Meta+z");
  await expectMoveState(request, "fixture-block-paragraph", FIXTURE_IDS.bodySearchResource, false);
  await page.keyboard.press("Meta+Shift+z");
  await expectMoveState(request, "fixture-block-paragraph", FIXTURE_IDS.bodySearchResource, true);

  snapshot = await fixtureSnapshot(request);
  resourceAttempts = snapshot.writeAttempts.filter((attempt) => attempt.resourceId && attempt.outcome === "saved");
  expect(resourceAttempts.slice(-6).map((attempt) => attempt.resourceId)).toEqual([
    FIXTURE_IDS.resource,
    FIXTURE_IDS.bodySearchResource,
    FIXTURE_IDS.bodySearchResource,
    FIXTURE_IDS.resource,
    FIXTURE_IDS.resource,
    FIXTURE_IDS.bodySearchResource,
  ]);

  await page.reload();
  await page.goto(`/resources/${encodeURIComponent(FIXTURE_IDS.bodySearchResource)}`);
  const targetNote = page.locator(`[data-resource-note="${FIXTURE_IDS.bodySearchResource}"]`);
  await expect(targetNote.locator('[data-block-content="fixture-block-paragraph"]')).toHaveText("Paragraph fixture fulltext-needle");
});

test("multi-root move keeps source order while normalizing each moved root to base indent zero", async ({ page, request }) => {
  await selectBlock(page, "fixture-block-heading-1");
  await sourceContent(page, "fixture-block-heading-3").click({ modifiers: ["Shift"] });
  await expect(sourceBlock(page, "fixture-block-heading-2")).toHaveClass(/is-selected/);
  await page.keyboard.press("Meta+/");
  await page.locator('[data-selected-block-action="move-to"]').click();
  await chooseDestination(page, "Database Needle Resource");
  await expect.poll(async () => {
    const target = resourceFrom(await fixtureSnapshot(request), FIXTURE_IDS.titleSearchResource);
    return target.blocks.slice(-3).map((block) => [block.id, block.indent]);
  }).toEqual([
    ["fixture-block-heading-1", 0],
    ["fixture-block-heading-2", 0],
    ["fixture-block-heading-3", 0],
  ]);
});

test("moving every source block leaves one editable paragraph behind", async ({ page, request }) => {
  await selectBlock(page, "fixture-block-paragraph");
  await sourceContent(page, FIXTURE_IDS.inlineBlock).click({ modifiers: ["Shift"] });
  await expect(sourceNote(page).locator(".block.is-selected")).toHaveCount(14);
  await page.keyboard.press("Meta+/");
  await page.locator('[data-selected-block-action="move-to"]').click();
  await chooseDestination(page, "Database Needle Resource");

  await expect.poll(async () => {
    const source = resourceFrom(await fixtureSnapshot(request), FIXTURE_IDS.resource);
    return source.blocks.map((block) => ({ type: block.type, text: block.text, indent: block.indent }));
  }).toEqual([{ type: "paragraph", text: "", indent: 0 }]);
  const remaining = sourceNote(page).locator('.block[data-type="paragraph"] [data-block-content]');
  await expect(remaining).toHaveCount(1);
  await expect(remaining).toHaveAttribute("contenteditable", "true");
});

test("nested move preserves descendants and inline comment threads follow their anchored block through undo/redo", async ({ page, request }) => {
  await openMoveMenu(page, "fixture-block-toggle");
  await chooseDestination(page, "Archived Fixture Resource");
  await expect.poll(async () => {
    const target = resourceFrom(await fixtureSnapshot(request), FIXTURE_IDS.archivedResource);
    return target.blocks.slice(-2).map((block) => [block.id, block.indent]);
  }).toEqual([
    ["fixture-block-toggle", 0],
    ["fixture-block-toggle-child", 1],
  ]);

  await page.keyboard.press("Meta+z");
  await expectMoveState(request, "fixture-block-toggle", FIXTURE_IDS.archivedResource, false);
  await openMoveMenu(page, FIXTURE_IDS.inlineBlock);
  await chooseDestination(page, "Body Search Fixture");
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    const source = resourceFrom(snapshot, FIXTURE_IDS.resource);
    const target = resourceFrom(snapshot, FIXTURE_IDS.bodySearchResource);
    const targetThread = target.commentThreads.find((thread) => thread.id === FIXTURE_IDS.inlineThread);
    const targetBlock = target.blocks.find((block) => block.id === FIXTURE_IDS.inlineBlock);
    return {
      sourceThread: source.commentThreads.some((thread) => thread.id === FIXTURE_IDS.inlineThread),
      targetThread: Boolean(targetThread),
      anchor: targetThread?.anchor,
      mark: targetBlock?.marks.find((mark) => mark.commentId === FIXTURE_IDS.inlineThread)?.commentId || "",
    };
  }).toEqual({
    sourceThread: false,
    targetThread: true,
    anchor: { blockId: FIXTURE_IDS.inlineBlock, start: 39, end: 46 },
    mark: FIXTURE_IDS.inlineThread,
  });

  await page.keyboard.press("Meta+z");
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return {
      sourceThread: resourceFrom(snapshot, FIXTURE_IDS.resource).commentThreads.some((thread) => thread.id === FIXTURE_IDS.inlineThread),
      targetThread: resourceFrom(snapshot, FIXTURE_IDS.bodySearchResource).commentThreads.some((thread) => thread.id === FIXTURE_IDS.inlineThread),
    };
  }).toEqual({ sourceThread: true, targetThread: false });
  await page.keyboard.press("Meta+Shift+z");
  await expectMoveState(request, FIXTURE_IDS.inlineBlock, FIXTURE_IDS.bodySearchResource, true);
  const finalSnapshot = await fixtureSnapshot(request);
  expect(resourceCommentIntegrity(resourceFrom(finalSnapshot, FIXTURE_IDS.resource))).toBe(true);
  expect(resourceCommentIntegrity(resourceFrom(finalSnapshot, FIXTURE_IDS.bodySearchResource))).toBe(true);
});

test("destination block ID collisions abort without mutating either Resource or writing incremental state", async ({ page, request }) => {
  const before = await fixtureSnapshot(request);
  await page.evaluate(({ targetResourceId, collidingBlockId }) => {
    const target = state.resources.find((resource) => resource.id === targetResourceId);
    target.blocks[0].id = collidingBlockId;
  }, {
    targetResourceId: COLLISION_RESOURCE_ID,
    collidingBlockId: "fixture-block-paragraph",
  });
  await openMoveMenu(page, "fixture-block-paragraph");
  await chooseDestination(page, "Collision Move Target", { expectClosed: false });
  await expect(page.locator("#toast")).toContainText("같은 블록 또는 댓글 ID");
  const after = await fixtureSnapshot(request);
  expect(resourceFrom(after, FIXTURE_IDS.resource)).toEqual(resourceFrom(before, FIXTURE_IDS.resource));
  expect(resourceFrom(after, COLLISION_RESOURCE_ID)).toEqual(resourceFrom(before, COLLISION_RESOURCE_ID));
  expect(after.writeAttempts.filter((attempt) => attempt.resourceId)).toHaveLength(0);
});

test("fixture rejects cross-Resource duplicate block, comment-thread, and reply IDs on full and incremental writes", async ({ request }) => {
  const duplicateMutations = [
    (draft) => {
      const source = draft.resources.find((resource) => resource.id === FIXTURE_IDS.resource);
      const target = draft.resources.find((resource) => resource.id === COLLISION_RESOURCE_ID);
      target.blocks[0].id = source.blocks[0].id;
    },
    (draft) => {
      const source = draft.resources.find((resource) => resource.id === FIXTURE_IDS.resource);
      const target = draft.resources.find((resource) => resource.id === COLLISION_RESOURCE_ID);
      target.commentThreads[0].id = source.commentThreads[0].id;
    },
    (draft) => {
      const target = draft.resources.find((resource) => resource.id === COLLISION_RESOURCE_ID);
      target.commentThreads[0].replies[0].id = SOURCE_REPLY_ID;
    },
  ];
  for (const mode of ["full", "incremental"]) {
    for (const mutate of duplicateMutations) await expectDuplicateWriteRejected(request, mode, mutate);
  }
});
