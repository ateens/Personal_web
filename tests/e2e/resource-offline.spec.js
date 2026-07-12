import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, openResources, resetFixture } from "./helpers.js";

const LOCAL_DATABASE_NAME = "sygma-resource-local-v1";
const SNAPSHOT_STORE = "snapshots";
const OPERATION_STORE = "operations";
const PROVISIONAL_WORKSPACE_ID = "__sygma_provisional_workspace_v1__";
const RESOURCE_PATH = `/resources/${encodeURIComponent(FIXTURE_IDS.resource)}`;
const FIXTURE_GUARD_HEADERS = { "x-e2e-reset-token": "sygma-local-e2e-reset" };

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("the online workspace snapshot is durable in IndexedDB before edits begin", async ({ browser }, testInfo) => {
  const { context, page } = await openServiceWorkerControlledApp(browser, testInfo);
  try {
    await openMainResource(page);
    await expectSyncState(page, "saved", /Saved|저장됨/i);

    await expect.poll(async () => (await readLocalPersistence(page)).snapshot?.baseRevision).toBe(1);
    const local = await readLocalPersistence(page);
    expect(local).toMatchObject({
      exists: true,
      stores: expect.arrayContaining([SNAPSHOT_STORE, OPERATION_STORE]),
      snapshot: {
        workspaceId: FIXTURE_IDS.appState,
        schemaVersion: 1,
        baseRevision: 1,
        state: { version: 4, revision: 1 },
      },
      operations: [],
    });
    expectTimestamp(local.snapshot.savedAt);
    expect(resourceTitleFromState(local.snapshot.state)).toBe("E2E Notion Parity Resource");
  } finally {
    await context.close();
  }
});

test("a first-offline title input survives immediate pagehide and migrates once to the real workspace", async ({ browser, request }, testInfo) => {
  test.setTimeout(60_000);
  const { context, page } = await openServiceWorkerControlledApp(browser, testInfo);
  const localTitle = "First offline close-safe title";
  let offlinePage = null;
  let recoveredPage = null;
  try {
    await clearLocalPersistence(page);
    await page.close();
    await context.setOffline(true);

    offlinePage = await context.newPage();
    await offlinePage.goto("/", { waitUntil: "domcontentloaded" });
    await expect(offlinePage.locator("#app")).toBeVisible();
    const navToggle = offlinePage.locator('[data-action="toggle-nav"]');
    if (await navToggle.isVisible()) {
      await navToggle.click();
      await expect(offlinePage.locator("[data-sidebar]")).toHaveClass(/is-open/);
    }
    await offlinePage.locator('[data-nav-key="resources"]').click();
    await expect(offlinePage.locator('[data-resource-view="library"]')).toBeVisible();
    const opener = offlinePage.locator("[data-open-resource]").first();
    const resourceId = await opener.getAttribute("data-open-resource");
    expect(resourceId).toBeTruthy();
    await opener.click();
    const dynamicTitle = offlinePage.locator(`[data-resource-title="${resourceId}"]`);
    await expect(dynamicTitle).toBeVisible();

    await dynamicTitle.evaluate((input, title) => {
      input.value = title;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: title, inputType: "insertText" }));
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    }, localTitle);
    await offlinePage.close();
    offlinePage = null;

    recoveredPage = await context.newPage();
    await recoveredPage.goto(`/resources/${encodeURIComponent(resourceId)}`, { waitUntil: "domcontentloaded" });
    const recoveredShell = recoveredPage.locator(`[data-resource-note="${resourceId}"]`);
    await expect(recoveredShell).toBeVisible();
    await expect(recoveredPage.locator(`[data-resource-title="${resourceId}"]`)).toHaveValue(localTitle);
    await expect(recoveredShell.locator("[data-resource-save-status]")).toHaveAttribute("data-sync-state", "offline");

    const provisional = await readAllLocalPersistence(recoveredPage);
    expect(provisional.snapshots.filter((snapshot) => snapshot.workspaceId === PROVISIONAL_WORKSPACE_ID)).toHaveLength(1);
    const provisionalOperations = provisional.operations.filter((operation) => operation.workspaceId === PROVISIONAL_WORKSPACE_ID);
    expect(provisionalOperations).toHaveLength(1);
    expect(provisionalOperations[0]).toMatchObject({
      entityType: "resource",
      entityId: resourceId,
      payload: { resource: { id: resourceId, title: localTitle } },
    });

    await context.setOffline(false);
    await expect.poll(async () => {
      const snapshot = await fixtureSnapshot(request);
      return snapshot.state.resources.filter((resource) => resource.id === resourceId && resource.title === localTitle).length;
    }).toBe(1);
    await expect(recoveredShell.locator("[data-resource-save-status]")).toHaveAttribute("data-sync-state", "saved");

    await expect.poll(async () => (await readAllLocalPersistence(recoveredPage)).operations.length).toBe(0);
    const migrated = await readAllLocalPersistence(recoveredPage);
    expect(migrated.snapshots.some((snapshot) => snapshot.workspaceId === PROVISIONAL_WORKSPACE_ID)).toBe(false);
    expect(migrated.snapshots.filter((snapshot) => snapshot.workspaceId === FIXTURE_IDS.appState)).toHaveLength(1);
    const remote = await fixtureSnapshot(request);
    expect(remote.writeAttempts.filter((attempt) => attempt.resourceId === resourceId)).toEqual([
      expect.objectContaining({ baseRevision: 1, outcome: "saved" }),
    ]);
    expect(remote.state.resources.filter((resource) => resource.id === resourceId)).toHaveLength(1);

    await recoveredPage.reload({ waitUntil: "domcontentloaded" });
    await expect(recoveredPage.locator(`[data-resource-title="${resourceId}"]`)).toHaveValue(localTitle);
    expect((await fixtureSnapshot(request)).state.resources.filter((resource) => resource.id === resourceId)).toHaveLength(1);
  } finally {
    await context.setOffline(false);
    await offlinePage?.close();
    await recoveredPage?.close();
    await context.close();
  }
});

test("an offline title edit survives a direct deep-link reload without reaching the server", async ({ browser, request }, testInfo) => {
  const { context, page } = await openServiceWorkerControlledApp(browser, testInfo);
  const localTitle = "Offline durable title";
  try {
    await openMainResource(page);
    await context.setOffline(true);
    await resourceTitle(page).fill(localTitle);

    await expectSyncState(page, "offline", /Offline|오프라인/i);
    await expectQueuedResourceOperation(page, {
      baseRevision: 1,
      entityId: FIXTURE_IDS.resource,
      status: "pending",
      title: localTitle,
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => new URL(page.url()).pathname).toBe(RESOURCE_PATH);
    await expect(resourceShell(page)).toBeVisible();
    await expect(resourceTitle(page)).toHaveValue(localTitle);
    await expectSyncState(page, "offline", /Offline|오프라인/i);

    const localAfterReload = await readLocalPersistence(page);
    expect(resourceTitleFromState(localAfterReload.snapshot.state)).toBe(localTitle);
    expect(localAfterReload.snapshot.baseRevision).toBe(1);
    expect(localAfterReload.operations).toHaveLength(1);

    const remote = await fixtureSnapshot(request);
    expect(resourceTitleFromState(remote.state)).toBe("E2E Notion Parity Resource");
    expect(remote.writeAttempts).toEqual([]);
  } finally {
    await context.setOffline(false);
    await context.close();
  }
});

test("the durable queue replays once online with its original base revision and commits atomically", async ({ browser, request }, testInfo) => {
  const { context, page } = await openServiceWorkerControlledApp(browser, testInfo);
  const localTitle = "Replay this queued title";
  try {
    await openMainResource(page);
    await context.setOffline(true);
    await resourceTitle(page).fill(localTitle);
    await expectQueuedResourceOperation(page, {
      baseRevision: 1,
      entityId: FIXTURE_IDS.resource,
      status: "pending",
      title: localTitle,
    });

    await context.setOffline(false);
    await expect.poll(async () => resourceTitleFromState((await fixtureSnapshot(request)).state)).toBe(localTitle);
    await expectSyncState(page, "saved", /Saved|저장됨/i);

    const remote = await fixtureSnapshot(request);
    expect(remote.serverRevision).toBe(2);
    expect(remote.writeAttempts).toEqual([
      expect.objectContaining({
        baseRevision: 1,
        ifMatch: '"state-1"',
        serverRevision: 1,
        outcome: "saved",
      }),
    ]);

    await expect.poll(async () => (await readLocalPersistence(page)).operations.length).toBe(0);
    const committed = await readLocalPersistence(page);
    expect(committed.snapshot.baseRevision).toBe(2);
    expect(committed.snapshot.state.revision).toBe(2);
    expect(resourceTitleFromState(committed.snapshot.state)).toBe(localTitle);
  } finally {
    await context.close();
  }
});

test("a transient write failure is visible as Retrying and keeps the operation until the retry succeeds", async ({ browser, request }, testInfo) => {
  const { context, page } = await openServiceWorkerControlledApp(browser, testInfo);
  const localTitle = "Retrying queue title";
  let abortedWrites = 0;
  const abortFirstWrite = async (route) => {
    const requestMethod = route.request().method();
    if (abortedWrites === 0 && ["PUT", "POST"].includes(requestMethod)) {
      abortedWrites += 1;
      await route.abort("failed");
      return;
    }
    await route.continue();
  };
  try {
    await openMainResource(page);
    await context.route("**/api/**", abortFirstWrite);
    await resourceTitle(page).fill(localTitle);

    await expectSyncState(page, "retrying", /Retrying|재시도/i);
    await expectQueuedResourceOperation(page, {
      baseRevision: 1,
      entityId: FIXTURE_IDS.resource,
      status: "retrying",
      title: localTitle,
      minimumAttempts: 1,
    });

    await expect.poll(async () => resourceTitleFromState((await fixtureSnapshot(request)).state)).toBe(localTitle);
    expect(abortedWrites).toBe(1);
    await expectSyncState(page, "saved", /Saved|저장됨/i);
    await expect.poll(async () => (await readLocalPersistence(page)).operations.length).toBe(0);
  } finally {
    await context.unroute("**/api/**", abortFirstWrite);
    await context.close();
  }
});

test("a stale queued edit becomes a durable conflict and never overwrites the remote Resource", async ({ browser, request }, testInfo) => {
  test.setTimeout(45_000);
  const { context, page } = await openServiceWorkerControlledApp(browser, testInfo);
  const localTitle = "Conflicting offline title";
  const remoteTitle = "Newer remote title";
  try {
    await openMainResource(page);
    await context.setOffline(true);
    await resourceTitle(page).fill(localTitle);
    await expectQueuedResourceOperation(page, {
      baseRevision: 1,
      entityId: FIXTURE_IDS.resource,
      status: "pending",
      title: localTitle,
    });

    const externalWrite = await request.post("/__e2e__/external-write", {
      headers: FIXTURE_GUARD_HEADERS,
      data: { title: remoteTitle },
    });
    expect(externalWrite.ok()).toBeTruthy();
    expect((await externalWrite.json()).revision).toBe(2);

    await context.setOffline(false);
    await expectSyncState(page, "conflict", /Conflict|충돌/i);

    const conflict = page.locator(`[data-resource-sync-conflict="${FIXTURE_IDS.resource}"]`);
    await expect(conflict).toBeVisible();
    await expect(conflict.locator("[data-conflict-local-title]")).toHaveText(localTitle);
    await expect(conflict.locator("[data-conflict-remote-title]")).toHaveText(remoteTitle);
    await expect(conflict.locator('[data-conflict-resolution="keep-local"]')).toBeVisible();
    await expect(conflict.locator('[data-conflict-resolution="use-remote"]')).toBeVisible();
    await expect(resourceTitle(page)).toHaveValue(localTitle);

    await expectQueuedResourceOperation(page, {
      baseRevision: 1,
      entityId: FIXTURE_IDS.resource,
      status: "conflict",
      title: localTitle,
      remoteRevision: 2,
    });
    await page.waitForTimeout(3_500);

    const remote = await fixtureSnapshot(request);
    expect(remote.serverRevision).toBe(2);
    expect(remote.writes).toEqual([]);
    expect(remote.writeAttempts).toEqual([
      expect.objectContaining({
        baseRevision: 1,
        ifMatch: '"state-1"',
        serverRevision: 2,
        outcome: "conflict",
      }),
    ]);
    expect(resourceTitleFromState(remote.state)).toBe(remoteTitle);

    const local = await readLocalPersistence(page);
    expect(local.snapshot.baseRevision).toBe(1);
    expect(resourceTitleFromState(local.snapshot.state)).toBe(localTitle);
  } finally {
    await context.close();
  }
});

test("a waiting service-worker update is blocked by pending work and only applies after a successful save", async ({ browser, request }, testInfo) => {
  test.setTimeout(60_000);
  const { context, page } = await openServiceWorkerControlledApp(browser, testInfo);
  const localTitle = "Save before applying update";
  const holdWrites = async (route) => {
    if (["PUT", "POST"].includes(route.request().method())) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  };
  try {
    await openMainResource(page);
    await context.setOffline(true);
    await resourceTitle(page).fill(localTitle);
    await expectSyncState(page, "offline", /Offline|오프라인/i);
    await context.route("**/api/**", holdWrites);
    await context.setOffline(false);
    await expectSyncState(page, "retrying", /Retrying|재시도/i);

    const bump = await request.post("/__e2e__/service-worker-version", {
      headers: FIXTURE_GUARD_HEADERS,
    });
    expect(bump.ok()).toBeTruthy();
    expect((await bump.json()).version).toBe(2);

    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) throw new Error("The app did not register a service worker.");
      await registration.update();
    });
    await expect.poll(() => waitingServiceWorker(page)).toBe(true);

    const update = page.locator('[data-service-worker-update][data-update-state="blocked"]');
    const applyUpdate = update.locator('[data-action="apply-app-update"]');
    await expect(update).toBeVisible();
    await expect(update).toContainText(/pending|save|저장|대기/i);
    await expect(applyUpdate).toBeDisabled();

    const documentIdentity = await page.evaluate(() => {
      window.__e2eDocumentIdentity = crypto.randomUUID();
      return window.__e2eDocumentIdentity;
    });
    await page.waitForTimeout(750);
    expect(await page.evaluate(() => window.__e2eDocumentIdentity)).toBe(documentIdentity);
    await expect(resourceTitle(page)).toHaveValue(localTitle);

    await context.unroute("**/api/**", holdWrites);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => resourceTitleFromState((await fixtureSnapshot(request)).state)).toBe(localTitle);
    await expectSyncState(page, "saved", /Saved|저장됨/i);

    const readyUpdate = page.locator('[data-service-worker-update][data-update-state="ready"]');
    const readyApply = readyUpdate.locator('[data-action="apply-app-update"]');
    await expect(readyUpdate).toBeVisible();
    await expect(readyApply).toBeEnabled();
    expect(await page.evaluate(() => window.__e2eDocumentIdentity)).toBe(documentIdentity);

    await Promise.all([
      page.waitForEvent("framenavigated"),
      readyApply.click(),
    ]);
    await expect.poll(() => new URL(page.url()).pathname).toBe(RESOURCE_PATH);
    await expect(resourceTitle(page)).toHaveValue(localTitle);
    await expect.poll(() => waitingServiceWorker(page)).toBe(false);
    await expect.poll(() => controlledByServiceWorker(page)).toBe(true);
    await expect.poll(async () => (await readLocalPersistence(page)).operations.length).toBe(0);
  } finally {
    await context.setOffline(false);
    await context.unroute("**/api/**", holdWrites);
    await context.close();
  }
});

async function openServiceWorkerControlledApp(browser, testInfo) {
  const context = await browser.newContext({
    baseURL: String(testInfo.project.use.baseURL),
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect.poll(() => controlledByServiceWorker(page), { timeout: 15_000 }).toBe(true);
  await expect(page.locator("#app")).toBeVisible();
  return { context, page };
}

async function openMainResource(page) {
  await openResources(page);
  await page.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`).first().click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(RESOURCE_PATH);
  await expect(resourceShell(page)).toBeVisible();
  await expect(resourceTitle(page)).toHaveValue("E2E Notion Parity Resource");
  await expect.poll(async () => (await readLocalPersistence(page)).snapshot?.baseRevision).toBe(1);
}

function resourceShell(page) {
  return page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
}

function resourceTitle(page) {
  return page.locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`);
}

function saveStatus(page) {
  return resourceShell(page).locator("[data-resource-save-status]");
}

async function expectSyncState(page, state, textPattern) {
  const status = saveStatus(page);
  await expect(status).toHaveAttribute("data-sync-state", state);
  await expect(status).toContainText(textPattern);
}

async function expectQueuedResourceOperation(page, expected) {
  await expect.poll(async () => {
    const local = await readLocalPersistence(page);
    return local.operations.length === 1 ? local.operations[0].status : "";
  }).toBe(expected.status);

  const local = await readLocalPersistence(page);
  expect(local.exists).toBe(true);
  expect(local.operations).toHaveLength(1);
  const operation = local.operations[0];
  expect(operation).toMatchObject({
    id: expect.any(String),
    workspaceId: FIXTURE_IDS.appState,
    entityType: "resource",
    entityId: expected.entityId,
    baseRevision: expected.baseRevision,
    status: expected.status,
    attempts: expect.any(Number),
    createdAt: expect.any(String),
    payload: {
      resource: {
        id: expected.entityId,
        title: expected.title,
      },
    },
  });
  expectTimestamp(operation.createdAt);
  if (expected.minimumAttempts !== undefined) expect(operation.attempts).toBeGreaterThanOrEqual(expected.minimumAttempts);
  if (expected.remoteRevision !== undefined) expect(operation.remoteRevision).toBe(expected.remoteRevision);
  expect(local.snapshot.baseRevision).toBe(expected.baseRevision);
  expect(resourceTitleFromState(local.snapshot.state)).toBe(expected.title);
}

async function readLocalPersistence(page) {
  return page.evaluate(async ({ databaseName, snapshotStore, operationStore, workspaceId }) => {
    const knownDatabases = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
    if (knownDatabases.length && !knownDatabases.some((entry) => entry.name === databaseName)) {
      return { exists: false, stores: [], snapshot: null, operations: [] };
    }

    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`Unable to open ${databaseName}.`));
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(new Error(`${databaseName} does not exist.`));
      };
    }).catch(() => null);
    if (!database) return { exists: false, stores: [], snapshot: null, operations: [] };

    const stores = Array.from(database.objectStoreNames);
    if (!stores.includes(snapshotStore) || !stores.includes(operationStore)) {
      database.close();
      return { exists: true, version: database.version, stores, snapshot: null, operations: [] };
    }

    const transaction = database.transaction([snapshotStore, operationStore], "readonly");
    const allSnapshots = await requestResult(transaction.objectStore(snapshotStore).getAll());
    const allOperations = await requestResult(transaction.objectStore(operationStore).getAll());
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB read transaction failed."));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB read transaction aborted."));
    });
    const version = database.version;
    database.close();
    return {
      exists: true,
      version,
      stores,
      snapshot: allSnapshots.find((entry) => entry.workspaceId === workspaceId) || null,
      operations: allOperations
        .filter((entry) => entry.workspaceId === workspaceId)
        .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")) || String(left.id || "").localeCompare(String(right.id || ""))),
    };

    function requestResult(request) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
      });
    }
  }, {
    databaseName: LOCAL_DATABASE_NAME,
    snapshotStore: SNAPSHOT_STORE,
    operationStore: OPERATION_STORE,
    workspaceId: FIXTURE_IDS.appState,
  });
}

async function readAllLocalPersistence(page) {
  return page.evaluate(async ({ databaseName, snapshotStore, operationStore }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`Unable to open ${databaseName}.`));
    });
    const transaction = database.transaction([snapshotStore, operationStore], "readonly");
    const snapshots = await requestResult(transaction.objectStore(snapshotStore).getAll());
    const operations = await requestResult(transaction.objectStore(operationStore).getAll());
    await transactionComplete(transaction);
    database.close();
    return { snapshots, operations };

    function requestResult(request) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB read failed."));
      });
    }

    function transactionComplete(activeTransaction) {
      return new Promise((resolve, reject) => {
        activeTransaction.oncomplete = resolve;
        activeTransaction.onerror = () => reject(activeTransaction.error || new Error("IndexedDB transaction failed."));
        activeTransaction.onabort = () => reject(activeTransaction.error || new Error("IndexedDB transaction aborted."));
      });
    }
  }, { databaseName: LOCAL_DATABASE_NAME, snapshotStore: SNAPSHOT_STORE, operationStore: OPERATION_STORE });
}

async function clearLocalPersistence(page) {
  await page.evaluate(async ({ databaseName, snapshotStore, operationStore }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`Unable to open ${databaseName}.`));
    });
    const transaction = database.transaction([snapshotStore, operationStore], "readwrite");
    transaction.objectStore(snapshotStore).clear();
    transaction.objectStore(operationStore).clear();
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB clear failed."));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB clear aborted."));
    });
    database.close();
  }, { databaseName: LOCAL_DATABASE_NAME, snapshotStore: SNAPSHOT_STORE, operationStore: OPERATION_STORE });
}

async function controlledByServiceWorker(page) {
  try {
    return await page.evaluate(() => Boolean(navigator.serviceWorker?.controller));
  } catch {
    return false;
  }
}

async function waitingServiceWorker(page) {
  try {
    return await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting));
  } catch {
    return false;
  }
}

function resourceTitleFromState(state) {
  return state?.resources?.find((resource) => resource.id === FIXTURE_IDS.resource)?.title || "";
}

function expectTimestamp(value) {
  expect(Number.isFinite(Date.parse(value))).toBe(true);
}
