import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const RESOURCE_PATH = (resourceId) => `/resources/${encodeURIComponent(resourceId)}`;
const LOCAL_DATABASE_NAME = "sygma-resource-local-v1";
const LOCAL_METADATA_STORE = "resource-metadata";

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

function resourceShell(page, resourceId) {
  return page.locator(`[data-resource-note="${resourceId}"]`);
}

function commentsButton(page, resourceId) {
  return resourceShell(page, resourceId).locator(`[data-resource-comments-toggle="${resourceId}"]`).first();
}

async function expectServerUnchanged(request, before) {
  const after = await fixtureSnapshot(request);
  expect(after.serverRevision).toBe(before.serverRevision);
  expect(after.writes).toEqual(before.writes);
  expect(after.writeAttempts).toEqual(before.writeAttempts);
  expect(after.state.settings?.resourceCommentReadAt).toEqual(before.state.settings?.resourceCommentReadAt);
}

async function markReadReloadAndVerify(page, request, resourceId, unreadCount) {
  const toggle = commentsButton(page, resourceId);
  await expect(toggle.locator("[data-resource-comment-unread]")).toHaveText(String(unreadCount));
  const before = await fixtureSnapshot(request);

  await toggle.click();
  await expect(resourceShell(page, resourceId).locator(`[data-resource-comments-pane="${resourceId}"]`)).toBeVisible();
  await expect(toggle.locator("[data-resource-comment-unread]")).toHaveCount(0);
  await expectServerUnchanged(request, before);

  await page.reload();
  await expect(resourceShell(page, resourceId)).toBeVisible();
  await expect(commentsButton(page, resourceId).locator("[data-resource-comment-unread]")).toHaveCount(0);
  await expectServerUnchanged(request, before);
}

async function localReadCursor(page, workspaceId, resourceId) {
  return page.evaluate(({ databaseName, metadataStore, workspaceId, resourceId }) => new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(metadataStore, "readonly");
      const get = transaction.objectStore(metadataStore).get([workspaceId, resourceId]);
      get.onerror = () => reject(get.error);
      get.onsuccess = () => resolve(get.result?.resourceCommentReadAt || "");
    };
  }), {
    databaseName: LOCAL_DATABASE_NAME,
    metadataStore: LOCAL_METADATA_STORE,
    workspaceId,
    resourceId,
  });
}

test("locked Resource keeps its read cursor across reload with zero server writes", async ({ page, request }) => {
  const resourceId = FIXTURE_IDS.resource;
  await page.goto(RESOURCE_PATH(resourceId));
  const shell = resourceShell(page, resourceId);
  await expect(shell).toBeVisible();

  await shell.locator(`[data-resource-page-menu="${resourceId}"]`).click();
  await page.locator(`[data-resource-page-lock="${resourceId}"]`).click();
  await expect(shell).toHaveAttribute("data-resource-locked", "true");
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return snapshot.state.resources.find((resource) => resource.id === resourceId)?.locked;
  }).toBe(true);

  await markReadReloadAndVerify(page, request, resourceId, 2);
  await expect(resourceShell(page, resourceId)).toHaveAttribute("data-resource-locked", "true");
});

test("read-only Resource keeps its read cursor across reload with zero server writes", async ({ page, request }) => {
  const resourceId = FIXTURE_IDS.readOnlyResource;
  await page.goto(RESOURCE_PATH(resourceId));
  await expect(resourceShell(page, resourceId)).toHaveAttribute("data-resource-read-only", "true");

  await markReadReloadAndVerify(page, request, resourceId, 1);
  await expect(resourceShell(page, resourceId)).toHaveAttribute("data-resource-read-only", "true");
});

test("legacy workspace read cursors migrate into local metadata without another server revision", async ({ page, request }) => {
  const before = await fixtureSnapshot(request);
  const legacyReadAt = new Date(Date.now() + 1000).toISOString();
  const legacyState = structuredClone(before.state);
  legacyState.settings.resourceCommentReadAt = { [FIXTURE_IDS.resource]: legacyReadAt };
  legacyState.updatedAt = new Date(Date.now()).toISOString();
  const seed = await request.put("/api/state", {
    headers: {
      "Content-Type": "application/json",
      "If-Match": `"state-${before.serverRevision}"`,
    },
    data: { state: legacyState, baseRevision: before.serverRevision },
  });
  expect(seed.ok()).toBeTruthy();
  const afterSeed = await fixtureSnapshot(request);

  await page.goto(RESOURCE_PATH(FIXTURE_IDS.resource));
  await expect(resourceShell(page, FIXTURE_IDS.resource)).toBeVisible();
  await expect(commentsButton(page, FIXTURE_IDS.resource).locator("[data-resource-comment-unread]")).toHaveCount(0);
  await expect.poll(async () => localReadCursor(page, FIXTURE_IDS.appState, FIXTURE_IDS.resource)).toBe(legacyReadAt);

  const afterLoad = await fixtureSnapshot(request);
  expect(afterLoad.serverRevision).toBe(afterSeed.serverRevision);
  expect(afterLoad.writes).toEqual(afterSeed.writes);
  expect(afterLoad.writeAttempts).toEqual(afterSeed.writeAttempts);
});

test("the version-1 IndexedDB upgrades in place and retains the existing queue stores", async ({ page }) => {
  await page.goto("/health");
  await page.evaluate((databaseName) => new Promise((resolve, reject) => {
    const deletion = indexedDB.deleteDatabase(databaseName);
    deletion.onerror = () => reject(deletion.error);
    deletion.onsuccess = () => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore("snapshots", { keyPath: "workspaceId" });
        const operations = database.createObjectStore("operations", { keyPath: "id" });
        operations.createIndex("workspaceId", "workspaceId", { unique: false });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    };
  }), LOCAL_DATABASE_NAME);

  await page.goto(RESOURCE_PATH(FIXTURE_IDS.resource));
  await expect(resourceShell(page, FIXTURE_IDS.resource)).toBeVisible();
  const databaseShape = await page.evaluate((databaseName) => new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      resolve({ version: database.version, stores: Array.from(database.objectStoreNames) });
      database.close();
    };
  }), LOCAL_DATABASE_NAME);
  expect(databaseShape).toEqual({
    version: 2,
    stores: ["operations", "resource-metadata", "snapshots"],
  });
});
