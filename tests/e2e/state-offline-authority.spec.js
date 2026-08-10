import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const LOCAL_DATABASE_NAME = "sygma-resource-local-v1";
const SNAPSHOT_STORE = "snapshots";
const OPERATION_STORE = "operations";

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("the online workspace snapshot is durable before any edit", async ({ browser }, testInfo) => {
  test.setTimeout(45_000);
  const { context, page } = await openServiceWorkerControlledApp(browser, testInfo);
  try {
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
    expect(local.snapshot.state.projects.find((project) => project.id === FIXTURE_IDS.project)?.name).toBe("Fixture Project");
    expect(local.snapshot.state.resources.some((resource) => resource.id === FIXTURE_IDS.resource)).toBe(true);
  } finally {
    await context.close();
  }
});

test("a cold offline start stays locked until the authoritative workspace is available", async ({ browser, request }, testInfo) => {
  test.setTimeout(45_000);
  const { context, page } = await openServiceWorkerControlledApp(browser, testInfo);
  let offlinePage = null;
  try {
    await clearLocalPersistence(page);
    await page.close();
    await context.setOffline(true);

    offlinePage = await context.newPage();
    await offlinePage.goto("/", { waitUntil: "domcontentloaded" });
    const app = offlinePage.locator("#app");
    await expect(app).toHaveAttribute("data-workspace-authority", "offline");
    await expect(offlinePage.locator("[data-workspace-authority-gate]")).toContainText("서버에 연결할 수 없습니다");
    expect(await offlinePage.locator(".layout").evaluate((element) => element.inert)).toBe(true);
    expect((await readAllLocalPersistence(offlinePage)).operations).toEqual([]);

    await context.setOffline(false);
    await expect(app).toHaveAttribute("data-workspace-authority", "ready");
    await expect(offlinePage.locator("[data-workspace-authority-gate]")).toBeHidden();
    expect(await offlinePage.locator(".layout").evaluate((element) => element.inert)).toBe(false);
    await expect.poll(async () => (await readAllLocalPersistence(offlinePage)).snapshots.length).toBe(1);
    const remote = await fixtureSnapshot(request);
    expect(remote.serverRevision).toBe(1);
    expect(remote.writes).toEqual([]);
    expect(remote.writeAttempts).toEqual([]);
  } finally {
    await context.setOffline(false);
    await offlinePage?.close();
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
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  return { context, page };
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
    await transactionComplete(transaction);
    const version = database.version;
    database.close();
    return {
      exists: true,
      version,
      stores,
      snapshot: allSnapshots.find((entry) => entry.workspaceId === workspaceId) || null,
      operations: allOperations.filter((entry) => entry.workspaceId === workspaceId),
    };

    function requestResult(request) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
      });
    }

    function transactionComplete(activeTransaction) {
      return new Promise((resolve, reject) => {
        activeTransaction.oncomplete = resolve;
        activeTransaction.onerror = () => reject(activeTransaction.error || new Error("IndexedDB transaction failed."));
        activeTransaction.onabort = () => reject(activeTransaction.error || new Error("IndexedDB transaction aborted."));
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

function expectTimestamp(value) {
  expect(Number.isFinite(Date.parse(value))).toBe(true);
}
