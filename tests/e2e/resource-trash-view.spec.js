import { expect, test } from "@playwright/test";
import {
  FIXTURE_IDS,
  fixtureSnapshot,
  openResources,
  resetFixture,
} from "./helpers.js";

const TRASH_FILTER = '[data-view-control-choice="resources"][data-control-field="filter"][data-control-value="trash"]';

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

function resourceFromSnapshot(snapshot, resourceId = FIXTURE_IDS.resource) {
  return snapshot.state.resources.find((resource) => resource.id === resourceId);
}

function preservedResourceFields(resource) {
  return {
    id: resource.id,
    blocks: resource.blocks,
    commentThreads: resource.commentThreads,
    parentId: resource.parentId,
    childOrder: resource.childOrder,
    createdAt: resource.createdAt,
  };
}

async function seedFixtureHierarchy(request) {
  const response = await request.get("/api/state");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  const nextState = JSON.parse(JSON.stringify(payload.state));
  const parent = resourceFromSnapshot({ state: nextState }, FIXTURE_IDS.bodySearchResource);
  const resource = resourceFromSnapshot({ state: nextState });
  const child = resourceFromSnapshot({ state: nextState }, FIXTURE_IDS.titleSearchResource);

  expect(parent).toBeTruthy();
  expect(resource).toBeTruthy();
  expect(child).toBeTruthy();
  parent.childOrder = [resource.id];
  resource.parentId = parent.id;
  resource.childOrder = [child.id];
  child.parentId = resource.id;
  child.blocks[0].text = "Parent Resource";
  child.blocks[0].marks = [{
    type: "mention",
    start: 0,
    end: "Parent Resource".length,
    mentionType: "page",
    label: resource.title,
    targetType: "resources",
    targetId: resource.id,
  }];
  nextState.updatedAt = new Date().toISOString();

  const write = await request.put("/api/state", {
    headers: { "If-Match": response.headers().etag || `"state-${payload.revision}"` },
    data: { state: nextState, baseRevision: payload.revision },
  });
  expect(write.ok()).toBeTruthy();
}

async function seedTrashedResourceWithReadOnlySibling(request) {
  const response = await request.get("/api/state");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  const nextState = JSON.parse(JSON.stringify(payload.state));
  const resource = resourceFromSnapshot({ state: nextState });
  const readOnly = resourceFromSnapshot({ state: nextState }, FIXTURE_IDS.readOnlyResource);
  expect(resource).toBeTruthy();
  expect(readOnly?.readOnly).toBe(true);
  const trashedAt = new Date().toISOString();
  resource.trashedAt = trashedAt;
  readOnly.trashedAt = trashedAt;
  nextState.updatedAt = trashedAt;
  const write = await request.put("/api/state", {
    headers: { "If-Match": response.headers().etag || `"state-${payload.revision}"` },
    data: { state: nextState, baseRevision: payload.revision },
  });
  expect(write.ok()).toBeTruthy();
}

async function selectTrashFilter(page) {
  await page.locator('[data-view-control-panel-toggle="resources"][data-control-panel="filter"]').click();
  const trash = page.locator(TRASH_FILTER).first();
  await expect(trash).toBeVisible();
  await trash.click();
  const view = page.locator("[data-resource-trash-view]");
  await expect(view).toBeVisible();
  return view;
}

async function openResourcesWithoutMainRowExpectation(page) {
  const navToggle = page.locator('[data-action="toggle-nav"]');
  if (await navToggle.isVisible()) {
    await navToggle.click();
    await expect(page.locator("[data-sidebar]")).toHaveClass(/is-open/);
  }
  await page.locator('[data-nav-key="resources"]').click();
  await expect(page.locator('[data-resource-view="library"]')).toBeVisible();
}

test("Resource drag actions expose a reversible Trash target and never expose delete", async ({ page }) => {
  await page.goto("/");
  await openResources(page);

  const actions = await page.evaluate((resourceId) => (
    window.dragActionTargets("resources", resourceId).map(({ action, title, meta }) => ({ action, title, meta }))
  ), FIXTURE_IDS.resource);
  expect(actions.filter(({ action }) => action === "trash")).toHaveLength(1);
  expect(actions.some(({ action }) => action === "delete")).toBe(false);

  const card = page.locator(`[data-delete-drag-type="resources"][data-delete-drag-id="${FIXTURE_IDS.resource}"]`).first();
  await expect(card).toBeVisible();
  const bounds = await card.boundingBox();
  expect(bounds).toBeTruthy();
  const startX = bounds.x + bounds.width / 2;
  const startY = bounds.y + 4;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 14, { steps: 2 });

  const dragStage = page.locator(".delete-drag-stage");
  await expect(dragStage).toBeVisible();
  await expect(dragStage.locator('[data-delete-drop][data-drag-action="trash"]')).toBeVisible();
  await expect(dragStage.locator('[data-delete-drop][data-drag-action="delete"]')).toHaveCount(0);

  await page.evaluate(() => window.cancelDeleteDrag());
  await page.mouse.up();
  await expect(dragStage).toHaveCount(0);
});

test("commitDragAction soft-trashes a complete Resource and the dedicated Trash view restores it", async ({ page, request }) => {
  await seedFixtureHierarchy(request);
  await page.goto("/");
  await openResources(page);

  const before = await fixtureSnapshot(request);
  const beforeResource = resourceFromSnapshot(before);
  const beforeParent = resourceFromSnapshot(before, FIXTURE_IDS.bodySearchResource);
  const beforeChild = resourceFromSnapshot(before, FIXTURE_IDS.titleSearchResource);
  const beforeCount = before.state.resources.length;
  const beforePreserved = preservedResourceFields(beforeResource);

  const committed = await page.evaluate((resourceId) => (
    window.commitDragAction("resources", resourceId, "trash")
  ), FIXTURE_IDS.resource);
  expect(committed).toBe(true);
  await expect(page.locator(`#viewRoot [data-open-resource="${FIXTURE_IDS.resource}"]`)).toHaveCount(0);

  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return resourceFromSnapshot(snapshot)?.trashedAt || "";
  }).not.toBe("");
  const trashedSnapshot = await fixtureSnapshot(request);
  const trashedResource = resourceFromSnapshot(trashedSnapshot);
  expect(trashedSnapshot.state.resources).toHaveLength(beforeCount);
  expect(preservedResourceFields(trashedResource)).toEqual(beforePreserved);
  expect(Number.isFinite(Date.parse(trashedResource.trashedAt))).toBe(true);
  expect(trashedResource.revision).toBeGreaterThan(beforeResource.revision);
  expect(resourceFromSnapshot(trashedSnapshot, beforeParent.id).childOrder).toEqual(beforeParent.childOrder);
  expect(resourceFromSnapshot(trashedSnapshot, beforeChild.id).parentId).toBe(beforeChild.parentId);

  const trashView = await selectTrashFilter(page);
  await expect(page.locator('[data-resource-view="library"]')).toHaveCount(0);
  const row = trashView.locator(`[data-resource-trash-row="${FIXTURE_IDS.resource}"]`);
  await expect(row).toBeVisible();
  await expect(row.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`)).toBeVisible();
  await expect(row.locator(`[data-restore-resource="${FIXTURE_IDS.resource}"]`)).toBeVisible();

  await row.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`).click();
  const recovery = page.locator(`[data-resource-trashed="${FIXTURE_IDS.resource}"]`);
  await expect(recovery).toBeVisible();
  await expect(recovery.locator("[data-resource-comments-toggle], [data-resource-create-child], [data-resource-page-menu]")).toHaveCount(0);
  await expect(recovery.locator(`[data-resource-copy-link="${FIXTURE_IDS.resource}"]`)).toBeVisible();
  await expect(recovery.locator(`[data-restore-resource="${FIXTURE_IDS.resource}"]`).first()).toBeVisible();
  await recovery.locator(`[data-resource-close="${FIXTURE_IDS.resource}"]`).click();
  await expect(recovery).toHaveCount(0);
  await expect(trashView).toBeVisible();

  await trashView.locator(`[data-resource-trash-row="${FIXTURE_IDS.resource}"] [data-restore-resource="${FIXTURE_IDS.resource}"]`).click();
  await expect.poll(async () => resourceFromSnapshot(await fixtureSnapshot(request))?.trashedAt).toBe("");
  await expect(trashView.locator(`[data-resource-trash-row="${FIXTURE_IDS.resource}"]`)).toHaveCount(0);
  await expect(page.locator("[data-resource-trash-heading]")).toBeFocused();

  const restoredSnapshot = await fixtureSnapshot(request);
  const restoredResource = resourceFromSnapshot(restoredSnapshot);
  expect(restoredSnapshot.state.resources).toHaveLength(beforeCount);
  expect(preservedResourceFields(restoredResource)).toEqual(beforePreserved);
  expect(resourceFromSnapshot(restoredSnapshot, beforeParent.id).childOrder).toEqual(beforeParent.childOrder);
  expect(resourceFromSnapshot(restoredSnapshot, beforeChild.id).parentId).toBe(beforeChild.parentId);

  await page.locator('[data-view-control-reset="resources"]').click();
  await expect(page.locator('[data-resource-view="library"]')).toBeVisible();
  await expect(page.locator(`#viewRoot [data-open-resource="${FIXTURE_IDS.resource}"]`).first()).toBeVisible();
});

test("trashed parent and page mention keep their relation and expose recovery state", async ({ page, request }) => {
  await seedFixtureHierarchy(request);
  await page.goto("/");
  await openResources(page);
  await page.evaluate((resourceId) => window.commitDragAction("resources", resourceId, "trash"), FIXTURE_IDS.resource);

  await page.evaluate((childId) => window.openResourceNote(childId), FIXTURE_IDS.titleSearchResource);
  const childShell = page.locator(`[data-resource-note="${FIXTURE_IDS.titleSearchResource}"]`);
  await expect(childShell).toBeVisible();
  const selectedParent = childShell.locator(`[data-resource-parent="${FIXTURE_IDS.titleSearchResource}"] option:checked`);
  await expect(selectedParent).toContainText("(휴지통)");
  const mention = childShell.locator('[data-inline-mark="mention"][data-mention-target-state="trashed"]');
  await expect(mention).toBeVisible();
  await expect(mention).toHaveAttribute("aria-label", /휴지통의 Resource/);

  await page.evaluate((resourceId) => window.restoreResourcePage(resourceId, { preserveFocus: true }), FIXTURE_IDS.resource);
  await expect(childShell.locator('[data-inline-mark="mention"][data-mention-target-state="active"]')).toBeVisible();
  await expect(selectedParent).not.toContainText("(휴지통)");
  const restored = resourceFromSnapshot(await fixtureSnapshot(request));
  expect(restored.parentId).toBe(FIXTURE_IDS.bodySearchResource);
  expect(restored.childOrder).toEqual([FIXTURE_IDS.titleSearchResource]);
});

test("Trash restore focuses the adjacent row opener when its Restore action is read-only", async ({ page, request }) => {
  await seedTrashedResourceWithReadOnlySibling(request);
  await page.goto("/");
  await openResourcesWithoutMainRowExpectation(page);
  const trashView = await selectTrashFilter(page);
  const readOnlyRow = trashView.locator(`[data-resource-trash-row="${FIXTURE_IDS.readOnlyResource}"]`);
  await expect(readOnlyRow.locator("[data-resource-restore]")).toBeDisabled();

  await trashView.locator(`[data-resource-trash-row="${FIXTURE_IDS.resource}"] [data-resource-restore]`).click();
  await expect(trashView.locator(`[data-resource-trash-row="${FIXTURE_IDS.resource}"]`)).toHaveCount(0);
  await expect(readOnlyRow.locator(`[data-open-resource="${FIXTURE_IDS.readOnlyResource}"]`)).toBeFocused();
});

test("Trash toast offers immediate Undo without stealing focus", async ({ page, request }) => {
  await page.goto("/");
  await openResources(page);
  const search = page.locator('[data-view-control-search="resources"]');
  await search.focus();

  const committed = await page.evaluate((resourceId) => (
    window.commitDragAction("resources", resourceId, "trash")
  ), FIXTURE_IDS.resource);
  expect(committed).toBe(true);
  await expect(search).toBeFocused();

  const undo = page.locator("#toast [data-toast-action]");
  await expect(undo).toBeVisible();
  await expect(undo).toHaveText("실행 취소");
  await undo.focus();
  await page.keyboard.press("Enter");

  await expect.poll(async () => resourceFromSnapshot(await fixtureSnapshot(request))?.trashedAt).toBe("");
  await expect(page.locator(`#viewRoot [data-open-resource="${FIXTURE_IDS.resource}"]`).first()).toBeVisible();
  await expect(page.locator("#toast")).toContainText("Resource를 복원했습니다.");
  await expect(page.locator("#toast [data-toast-action]")).toHaveCount(0);
  await expect(search).toBeFocused();
});

test("deleteEntity rejects Resource deletion and leaves browser and server state unchanged", async ({ page, request }) => {
  await page.goto("/");
  await openResources(page);
  const serverBefore = await fixtureSnapshot(request);

  const browserResult = await page.evaluate((resourceId) => {
    const before = JSON.parse(JSON.stringify(window.getCollection("resources")));
    const removed = window.deleteEntity("resources", resourceId);
    const after = JSON.parse(JSON.stringify(window.getCollection("resources")));
    return { removed, before, after };
  }, FIXTURE_IDS.resource);

  expect(browserResult.removed).toBeNull();
  expect(browserResult.after).toEqual(browserResult.before);
  await expect(page.locator(`#viewRoot [data-open-resource="${FIXTURE_IDS.resource}"]`).first()).toBeVisible();

  const serverAfter = await fixtureSnapshot(request);
  expect(serverAfter.state.resources).toEqual(serverBefore.state.resources);
  expect(serverAfter.serverRevision).toBe(serverBefore.serverRevision);
  expect(serverAfter.writes).toEqual(serverBefore.writes);
});
