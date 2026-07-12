import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, openResources, resetFixture } from "./helpers.js";

const LOCAL_DATABASE_NAME = "sygma-resource-local-v1";
const OPERATION_STORE = "operations";
const FIXTURE_GUARD_HEADERS = { "x-e2e-reset-token": "sygma-local-e2e-reset" };
const MOVED_RESOURCE_ID = FIXTURE_IDS.resource;
const OLD_PARENT_ID = FIXTURE_IDS.titleSearchResource;
const NEW_PARENT_ID = FIXTURE_IDS.bodySearchResource;
const RESOURCE_PATH = `/resources/${encodeURIComponent(MOVED_RESOURCE_ID)}`;

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
  await seedHierarchy(request);
});

test("A→B, A→root, root→A, and same-parent saves keep every intermediate hierarchy valid", async ({ page, request }) => {
  const beforeUnsafeWrite = await fixtureSnapshot(request);
  const unsafeNewParent = structuredClone(beforeUnsafeWrite.state.resources.find((resource) => resource.id === NEW_PARENT_ID));
  unsafeNewParent.childOrder = [MOVED_RESOURCE_ID];
  const unsafeWrite = await request.put(`/api/resources/${NEW_PARENT_ID}`, {
    headers: { "If-Match": `"state-${beforeUnsafeWrite.serverRevision}"` },
    data: { resource: unsafeNewParent, baseRevision: beforeUnsafeWrite.serverRevision },
  });
  expect(unsafeWrite.status()).toBe(422);
  expect(await unsafeWrite.json()).toMatchObject({
    code: "INVALID_STATE",
    revision: beforeUnsafeWrite.serverRevision,
    details: { issues: expect.arrayContaining([expect.objectContaining({ code: "invalid_child_parent" })]) },
  });
  expect((await fixtureSnapshot(request)).serverRevision).toBe(beforeUnsafeWrite.serverRevision);

  const note = await openMovedResource(page);
  await selectParent(note, NEW_PARENT_ID);
  await expectHierarchy(request, NEW_PARENT_ID);
  await expectResourceWriteIds(request, [OLD_PARENT_ID, MOVED_RESOURCE_ID, NEW_PARENT_ID]);

  const attemptsBeforeSameParent = (await fixtureSnapshot(request)).writeAttempts.length;
  await selectParent(note, NEW_PARENT_ID);
  await page.waitForTimeout(250);
  expect((await fixtureSnapshot(request)).writeAttempts).toHaveLength(attemptsBeforeSameParent);

  await selectParent(note, "");
  await expectHierarchy(request, "");
  await expectResourceWriteIds(request, [
    OLD_PARENT_ID,
    MOVED_RESOURCE_ID,
    NEW_PARENT_ID,
    NEW_PARENT_ID,
    MOVED_RESOURCE_ID,
  ]);

  await selectParent(note, OLD_PARENT_ID);
  await expectHierarchy(request, OLD_PARENT_ID);
  await expectResourceWriteIds(request, [
    OLD_PARENT_ID,
    MOVED_RESOURCE_ID,
    NEW_PARENT_ID,
    NEW_PARENT_ID,
    MOVED_RESOURCE_ID,
    MOVED_RESOURCE_ID,
    OLD_PARENT_ID,
  ]);
  const finalSnapshot = await fixtureSnapshot(request);
  expect(finalSnapshot.writeAttempts.filter((attempt) => attempt.resourceId).map((attempt) => attempt.outcome)).toEqual([
    "invalid-state",
    "saved",
    "saved",
    "saved",
    "saved",
    "saved",
    "saved",
    "saved",
  ]);
});

test("Page menu Move to exposes valid destinations and persists through the safe hierarchy queue", async ({ page, request }) => {
  const note = await openMovedResource(page);
  await note.locator(`[data-resource-page-menu="${MOVED_RESOURCE_ID}"]`).click();
  const menu = page.locator(`[data-resource-page-menu-panel="${MOVED_RESOURCE_ID}"]`);
  await expect(menu).toBeVisible();
  const moveMenu = menu.locator(`[data-resource-move-menu="${MOVED_RESOURCE_ID}"]`);
  await expect(moveMenu).toBeEnabled();
  await moveMenu.click();

  const destinations = page.locator(`[data-resource-move-menu-panel="${MOVED_RESOURCE_ID}"]`);
  await expect(destinations).toBeVisible();
  await expect(destinations.locator(`[data-resource-move-parent="${MOVED_RESOURCE_ID}"]`)).toHaveCount(0);
  await expect(destinations.locator(`[data-resource-move-parent="${OLD_PARENT_ID}"]`)).toHaveAttribute("aria-checked", "true");
  await destinations.locator(`[data-resource-move-parent="${NEW_PARENT_ID}"]`).click();

  await expectHierarchy(request, NEW_PARENT_ID);
  await expectResourceWriteIds(request, [OLD_PARENT_ID, MOVED_RESOURCE_ID, NEW_PARENT_ID]);
  await expect(note.locator(`[data-resource-parent="${MOVED_RESOURCE_ID}"]`)).toHaveValue(NEW_PARENT_ID);
  await expect(note.locator(`[data-resource-page-menu="${MOVED_RESOURCE_ID}"]`)).toBeFocused();
});

test("Parent picker excludes immutable destinations and rolls back rejected changes", async ({ page, request }) => {
  const updateState = async (mutate) => {
    const snapshot = await fixtureSnapshot(request);
    const nextState = structuredClone(snapshot.state);
    mutate(nextState);
    const response = await request.put("/api/state", {
      headers: { "If-Match": `"state-${snapshot.serverRevision}"` },
      data: { state: nextState, baseRevision: snapshot.serverRevision },
    });
    expect(response.ok()).toBeTruthy();
  };
  const currentNote = () => page.locator(`[data-resource-note="${MOVED_RESOURCE_ID}"]`);
  const assertCurrentParentPreventsMove = async () => {
    await page.reload();
    const note = currentNote();
    await expect(note).toBeVisible();
    await expect(note.locator(`[data-resource-parent="${MOVED_RESOURCE_ID}"]`)).toBeDisabled();
    await note.locator(`[data-resource-page-menu="${MOVED_RESOURCE_ID}"]`).click();
    const menu = page.locator(`[data-resource-page-menu-panel="${MOVED_RESOURCE_ID}"]`);
    await expect(menu).toBeVisible();
    await expect(menu.locator(`[data-resource-move-menu="${MOVED_RESOURCE_ID}"]`)).toBeDisabled();
    await page.keyboard.press("Escape");
  };

  await updateState((nextState) => {
    nextState.resources.find((resource) => resource.id === NEW_PARENT_ID).locked = true;
    nextState.resources.find((resource) => resource.id === FIXTURE_IDS.archivedResource).trashedAt = "2026-07-12T00:00:00.000Z";
  });
  let note = await openMovedResource(page);
  let parentPicker = note.locator(`[data-resource-parent="${MOVED_RESOURCE_ID}"]`);
  await expect(parentPicker).toBeEnabled();
  const candidateIds = await parentPicker.locator("option").evaluateAll((options) => options.map((option) => option.value));
  expect(candidateIds).toContain(OLD_PARENT_ID);
  expect(candidateIds).not.toContain(NEW_PARENT_ID);
  expect(candidateIds).not.toContain(FIXTURE_IDS.readOnlyResource);
  expect(candidateIds).not.toContain(FIXTURE_IDS.archivedResource);

  const revisionBeforeRejectedMove = (await fixtureSnapshot(request)).serverRevision;
  await parentPicker.evaluate((select, rejectedParentId) => {
    const option = document.createElement("option");
    option.value = rejectedParentId;
    option.textContent = "Injected immutable parent";
    select.append(option);
    select.value = rejectedParentId;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, FIXTURE_IDS.readOnlyResource);
  await expect(parentPicker).toHaveValue(OLD_PARENT_ID);
  expect((await fixtureSnapshot(request)).serverRevision).toBe(revisionBeforeRejectedMove);

  await updateState((nextState) => {
    const currentParent = nextState.resources.find((resource) => resource.id === OLD_PARENT_ID);
    currentParent.locked = true;
  });
  await assertCurrentParentPreventsMove();

  await updateState((nextState) => {
    const currentParent = nextState.resources.find((resource) => resource.id === OLD_PARENT_ID);
    currentParent.locked = false;
    currentParent.readOnly = true;
  });
  await assertCurrentParentPreventsMove();

  await updateState((nextState) => {
    const currentParent = nextState.resources.find((resource) => resource.id === OLD_PARENT_ID);
    currentParent.readOnly = false;
    currentParent.trashedAt = "2026-07-12T00:01:00.000Z";
  });
  await assertCurrentParentPreventsMove();
});

test("Duplicate under a parent creates the child before updating parent childOrder", async ({ page, request }) => {
  const before = await fixtureSnapshot(request);
  const note = await openMovedResource(page);
  await note.locator(`[data-resource-page-menu="${MOVED_RESOURCE_ID}"]`).click();
  await page.locator(`[data-resource-page-menu-panel="${MOVED_RESOURCE_ID}"] [data-resource-duplicate="${MOVED_RESOURCE_ID}"]`).click();

  let duplicateId = "";
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    duplicateId = snapshot.state.resources.find((resource) => !before.state.resources.some((entry) => entry.id === resource.id))?.id || "";
    const parent = snapshot.state.resources.find((resource) => resource.id === OLD_PARENT_ID);
    const duplicate = snapshot.state.resources.find((resource) => resource.id === duplicateId);
    return { duplicateId, parentId: duplicate?.parentId || "", childOrder: parent?.childOrder || [] };
  }).toEqual({
    duplicateId: expect.any(String),
    parentId: OLD_PARENT_ID,
    childOrder: [MOVED_RESOURCE_ID, expect.any(String)],
  });
  expect(duplicateId).not.toBe("");
  expect((await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === OLD_PARENT_ID)?.childOrder).toEqual([
    MOVED_RESOURCE_ID,
    duplicateId,
  ]);
  await expectResourceWriteIds(request, [duplicateId, OLD_PARENT_ID]);
});

test("offline hierarchy queue survives reload and a transient retry in old→moved→new order", async ({ browser, request }, testInfo) => {
  test.setTimeout(45_000);
  const context = await browser.newContext({
    baseURL: String(testInfo.project.use.baseURL),
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  let abortedWrites = 0;
  const abortFirstResourceWrite = async (route) => {
    if (abortedWrites === 0 && route.request().method() === "PUT") {
      abortedWrites += 1;
      await route.abort("failed");
      return;
    }
    await route.continue();
  };
  try {
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), { timeout: 15_000 }).toBe(true);
    await page.goto(`/resources/${encodeURIComponent(NEW_PARENT_ID)}`);
    const newParentNote = page.locator(`[data-resource-note="${NEW_PARENT_ID}"]`);
    await expect(newParentNote).toBeVisible();
    await context.setOffline(true);
    await newParentNote.locator(`[data-resource-title="${NEW_PARENT_ID}"]`).fill("Queued new parent title");
    await expect.poll(async () => (await readResourceQueue(page)).map((operation) => operation.entityId)).toEqual([NEW_PARENT_ID]);

    await page.locator(`[data-resource-close="${NEW_PARENT_ID}"]`).click();
    await openResources(page);
    await page.locator(`[data-open-resource="${MOVED_RESOURCE_ID}"]`).first().click();
    const note = page.locator(`[data-resource-note="${MOVED_RESOURCE_ID}"]`);
    await expect(note).toBeVisible();
    const properties = note.locator(`[data-resource-props="${MOVED_RESOURCE_ID}"]`);
    if ((await properties.getAttribute("aria-expanded")) !== "true") await properties.click();
    await expect(properties).toHaveAttribute("aria-expanded", "true");
    await selectParent(note, NEW_PARENT_ID);

    await expect.poll(async () => (await readResourceQueue(page)).map((operation) => operation.entityId)).toEqual([
      OLD_PARENT_ID,
      MOVED_RESOURCE_ID,
      NEW_PARENT_ID,
    ]);
    expect((await readResourceQueue(page)).map((operation) => operation.queueOrder)).toEqual([0, 1, 2]);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(`[data-resource-note="${MOVED_RESOURCE_ID}"]`)).toBeVisible();
    await expect(page.locator(`[data-resource-parent="${MOVED_RESOURCE_ID}"]`)).toHaveValue(NEW_PARENT_ID);
    expect((await readResourceQueue(page)).map((operation) => operation.entityId)).toEqual([
      OLD_PARENT_ID,
      MOVED_RESOURCE_ID,
      NEW_PARENT_ID,
    ]);

    await context.route("**/api/resources/**", abortFirstResourceWrite);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expectHierarchy(request, NEW_PARENT_ID);
    await expectResourceWriteIds(request, [OLD_PARENT_ID, MOVED_RESOURCE_ID, NEW_PARENT_ID]);
    expect(abortedWrites).toBe(1);
    await expect.poll(async () => (await readResourceQueue(page)).length).toBe(0);
  } finally {
    await context.setOffline(false);
    await context.unroute("**/api/resources/**", abortFirstResourceWrite);
    await context.close();
  }
});

test("Keep local rebases the complete hierarchy queue without dropping or reordering operations", async ({ page, context, request }) => {
  test.setTimeout(45_000);
  const note = await openMovedResource(page);
  await context.setOffline(true);
  await selectParent(note, NEW_PARENT_ID);
  await expect.poll(async () => (await readResourceQueue(page)).length).toBe(3);

  const externalWrite = await request.post("/__e2e__/external-write", {
    headers: FIXTURE_GUARD_HEADERS,
    data: { resourceId: FIXTURE_IDS.archivedResource, title: "Unrelated remote edit" },
  });
  expect(externalWrite.ok()).toBeTruthy();
  expect((await externalWrite.json()).revision).toBe(3);

  await context.setOffline(false);
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return snapshot.writeAttempts.filter((attempt) => attempt.resourceId).map((attempt) => attempt.outcome);
  }).toEqual(["conflict"]);

  await page.locator(`[data-resource-close="${MOVED_RESOURCE_ID}"]`).click();
  await openResources(page);
  await page.locator(`[data-open-resource="${OLD_PARENT_ID}"]`).first().click();
  const conflict = page.locator(`[data-resource-sync-conflict="${OLD_PARENT_ID}"]`);
  await expect(conflict).toBeVisible();
  await conflict.locator('[data-conflict-resolution="keep-local"]').click();

  await expectHierarchy(request, NEW_PARENT_ID);
  await expectResourceWriteIds(request, [OLD_PARENT_ID, MOVED_RESOURCE_ID, NEW_PARENT_ID]);
  const finalSnapshot = await fixtureSnapshot(request);
  expect(finalSnapshot.writeAttempts.filter((attempt) => attempt.resourceId).map((attempt) => attempt.outcome)).toEqual([
    "conflict",
    "saved",
    "saved",
    "saved",
  ]);
  expect(finalSnapshot.state.resources.find((resource) => resource.id === FIXTURE_IDS.archivedResource)?.title).toBe("Unrelated remote edit");
  await expect.poll(async () => (await readResourceQueue(page)).length).toBe(0);
});

async function seedHierarchy(request) {
  const response = await request.get("/api/state");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  const oldParent = payload.state.resources.find((resource) => resource.id === OLD_PARENT_ID);
  const newParent = payload.state.resources.find((resource) => resource.id === NEW_PARENT_ID);
  const moved = payload.state.resources.find((resource) => resource.id === MOVED_RESOURCE_ID);
  oldParent.childOrder = [MOVED_RESOURCE_ID];
  newParent.childOrder = [];
  moved.parentId = OLD_PARENT_ID;
  const write = await request.put("/api/state", {
    headers: { "If-Match": `"state-${payload.revision}"` },
    data: { state: payload.state, baseRevision: payload.revision },
  });
  expect(write.ok()).toBeTruthy();
  expect((await write.json()).revision).toBe(2);
}

async function openMovedResource(page) {
  await page.goto(RESOURCE_PATH);
  const note = page.locator(`[data-resource-note="${MOVED_RESOURCE_ID}"]`);
  await expect(note).toBeVisible();
  const properties = note.locator(`[data-resource-props="${MOVED_RESOURCE_ID}"]`);
  if ((await properties.getAttribute("aria-expanded")) !== "true") await properties.click();
  await expect(properties).toHaveAttribute("aria-expanded", "true");
  return note;
}

async function selectParent(note, parentId) {
  await note.locator(`[data-resource-parent="${MOVED_RESOURCE_ID}"]`).selectOption(parentId);
}

async function expectHierarchy(request, parentId) {
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    const resources = new Map(snapshot.state.resources.map((resource) => [resource.id, resource]));
    return {
      parentId: resources.get(MOVED_RESOURCE_ID)?.parentId,
      oldChildren: resources.get(OLD_PARENT_ID)?.childOrder,
      newChildren: resources.get(NEW_PARENT_ID)?.childOrder,
    };
  }).toEqual({
    parentId,
    oldChildren: parentId === OLD_PARENT_ID ? [MOVED_RESOURCE_ID] : [],
    newChildren: parentId === NEW_PARENT_ID ? [MOVED_RESOURCE_ID] : [],
  });
}

async function expectResourceWriteIds(request, expectedIds) {
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return snapshot.writes.filter((write) => write.resourceId).map((write) => write.resourceId);
  }).toEqual(expectedIds);
}

async function readResourceQueue(page) {
  return page.evaluate(async ({ databaseName, operationStore, workspaceId }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed."));
    });
    const transaction = database.transaction(operationStore, "readonly");
    const operations = await new Promise((resolve, reject) => {
      const request = transaction.objectStore(operationStore).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB operation read failed."));
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
    });
    database.close();
    return operations
      .filter((operation) => operation.workspaceId === workspaceId && operation.entityType === "resource")
      .sort((left, right) => Number(left.queueOrder) - Number(right.queueOrder));
  }, { databaseName: LOCAL_DATABASE_NAME, operationStore: OPERATION_STORE, workspaceId: FIXTURE_IDS.appState });
}
