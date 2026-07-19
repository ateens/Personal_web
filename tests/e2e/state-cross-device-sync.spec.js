import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, openResources, resetFixture } from "./helpers.js";

const LOCAL_DATABASE_NAME = "sygma-resource-local-v1";
const SNAPSHOT_STORE = "snapshots";
const OPERATION_STORE = "operations";
const ORIGINAL_TITLE = "E2E Notion Parity Resource";

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("two active clients converge through state events without focus or reload", async ({ browser, request }, testInfo) => {
  const macContext = await newAppContext(browser, testInfo, { width: 1440, height: 1000 });
  const ipadContext = await newAppContext(browser, testInfo, { width: 1024, height: 1366, hasTouch: true, isMobile: true });
  const macPage = await macContext.newPage();
  const ipadPage = await ipadContext.newPage();
  const changedTitle = "Synced live without a wake event";

  try {
    const macEventStream = waitForStateEventStream(macPage);
    const ipadEventStream = waitForStateEventStream(ipadPage);
    await Promise.all([macPage.goto("/"), ipadPage.goto("/"), macEventStream, ipadEventStream]);
    await openResources(macPage);
    await openResources(ipadPage);
    await expectResourceTitle(ipadPage, ORIGINAL_TITLE);
    await expect.poll(() => localSnapshotRevision(macPage)).toBe(1);
    await expect.poll(() => localSnapshotRevision(ipadPage)).toBe(1);

    const ipadDocumentIdentity = await ipadPage.evaluate(() => {
      window.__e2eDocumentIdentity = crypto.randomUUID();
      return window.__e2eDocumentIdentity;
    });

    await macPage.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`).first().click();
    const macTitle = macPage.locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`);
    await expect(macTitle).toBeVisible();
    await macTitle.fill(changedTitle);
    await expect.poll(async () => {
      const snapshot = await fixtureSnapshot(request);
      return { revision: snapshot.serverRevision, title: resourceTitle(snapshot.state) };
    }).toEqual({ revision: 2, title: changedTitle });

    await expect(
      ipadPage.locator(`[data-resource-title-display="${FIXTURE_IDS.resource}"]`).first()
    ).toHaveText(changedTitle, { timeout: 5_000 });
    await expect.poll(() => localSnapshotRevision(ipadPage), { timeout: 5_000 }).toBe(2);
    expect(await ipadPage.evaluate(() => window.__e2eDocumentIdentity)).toBe(ipadDocumentIdentity);
  } finally {
    await Promise.all([macContext.close(), ipadContext.close()]);
  }
});

for (const wakeEvent of ["focus", "pageshow"]) {
  test(`a second device pulls a newer revision on ${wakeEvent} without reloading`, async ({ browser, request }, testInfo) => {
    const macContext = await newAppContext(browser, testInfo, { width: 1440, height: 1000 });
    const ipadContext = await newAppContext(browser, testInfo, { width: 1024, height: 1366, hasTouch: true, isMobile: true });
    const macPage = await macContext.newPage();
    const ipadPage = await ipadContext.newPage();
    const changedTitle = `Synced from Mac after ${wakeEvent}`;

    try {
      await Promise.all([macPage.goto("/"), ipadPage.goto("/")]);
      await openResources(macPage);
      await openResources(ipadPage);
      await expectResourceTitle(ipadPage, ORIGINAL_TITLE);
      await expect.poll(() => localSnapshotRevision(macPage)).toBe(1);
      await expect.poll(() => localSnapshotRevision(ipadPage)).toBe(1);

      const ipadDocumentIdentity = await ipadPage.evaluate(() => {
        window.__e2eDocumentIdentity = crypto.randomUUID();
        return window.__e2eDocumentIdentity;
      });

      await macPage.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`).first().click();
      const macTitle = macPage.locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`);
      await expect(macTitle).toBeVisible();
      await macTitle.fill(changedTitle);
      await expect.poll(async () => {
        const snapshot = await fixtureSnapshot(request);
        return {
          revision: snapshot.serverRevision,
          title: resourceTitle(snapshot.state),
        };
      }).toEqual({ revision: 2, title: changedTitle });

      await dispatchWakeEvent(ipadPage, wakeEvent);
      await expectResourceTitle(ipadPage, changedTitle);
      await expect.poll(() => localSnapshotRevision(ipadPage)).toBe(2);
      expect(await ipadPage.evaluate(() => window.__e2eDocumentIdentity)).toBe(ipadDocumentIdentity);

      const remote = await fixtureSnapshot(request);
      expect(remote.serverRevision).toBe(2);
      expect(remote.writeAttempts).toEqual([
        expect.objectContaining({
          resourceId: FIXTURE_IDS.resource,
          baseRevision: 1,
          serverRevision: 1,
          outcome: "saved",
        }),
      ]);
    } finally {
      await Promise.all([macContext.close(), ipadContext.close()]);
    }
  });
}

test("a future-dated stale IndexedDB snapshot cannot overwrite the remote workspace", async ({ browser, request }, testInfo) => {
  const context = await newAppContext(browser, testInfo, { width: 1440, height: 1000 });
  const page = await context.newPage();
  const staleTitle = "Future-dated stale local title";

  try {
    await page.goto("/");
    await openResources(page);
    await expectResourceTitle(page, ORIGINAL_TITLE);
    await expect.poll(() => localSnapshotRevision(page)).toBe(1);

    await overwriteLocalSnapshot(page, staleTitle);
    expect(await localSnapshotTitle(page)).toBe(staleTitle);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => localSnapshotTitle(page)).toBe(ORIGINAL_TITLE);
    await expect.poll(() => localSnapshotRevision(page)).toBe(1);
    await openResources(page);
    await expectResourceTitle(page, ORIGINAL_TITLE);

    const remote = await fixtureSnapshot(request);
    expect(remote.serverRevision).toBe(1);
    expect(resourceTitle(remote.state)).toBe(ORIGINAL_TITLE);
    expect(remote.writes).toEqual([]);
    expect(remote.writeAttempts).toEqual([]);
  } finally {
    await context.close();
  }
});

test("an online restart discards even a same-revision pending workspace operation and shows the remote workspace", async ({ browser, request }, testInfo) => {
  const context = await newAppContext(browser, testInfo, { width: 1440, height: 1000 });
  const setupPage = await context.newPage();
  const staleTitle = "Stale pending workspace title";

  try {
    await setupPage.goto("/");
    await expect.poll(() => localSnapshotRevision(setupPage)).toBe(1);
    await installStaleWorkspaceDraft(setupPage, staleTitle);
    expect(await localSnapshotTitle(setupPage)).toBe(staleTitle);
    expect(await localWorkspaceOperationCount(setupPage)).toBe(1);
    await setupPage.close();

    const restartPage = await context.newPage();
    await restartPage.goto("/");
    await openResources(restartPage);
    await expectResourceTitle(restartPage, ORIGINAL_TITLE);
    await expect.poll(() => localSnapshotTitle(restartPage)).toBe(ORIGINAL_TITLE);
    await expect.poll(() => localSnapshotRevision(restartPage)).toBe(1);
    await expect.poll(() => localWorkspaceOperationCount(restartPage)).toBe(0);

    const remote = await fixtureSnapshot(request);
    expect(remote.serverRevision).toBe(1);
    expect(resourceTitle(remote.state)).toBe(ORIGINAL_TITLE);
    expect(remote.writes).toEqual([]);
    expect(remote.writeAttempts).toEqual([]);
  } finally {
    await context.close();
  }
});

test("overlapping initialization requests keep the workspace locked until the final remote read completes", async ({ browser, request }, testInfo) => {
  const context = await newAppContext(browser, testInfo, { width: 1440, height: 1000 });
  const page = await context.newPage();
  let stateRequestCount = 0;
  let releaseFirstState;
  let releaseSecondState;
  const firstStateGate = new Promise((resolve) => { releaseFirstState = resolve; });
  const secondStateGate = new Promise((resolve) => { releaseSecondState = resolve; });

  await page.route("**/api/state", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    stateRequestCount += 1;
    if (stateRequestCount === 1) await firstStateGate;
    if (stateRequestCount === 2) await secondStateGate;
    await route.continue();
  });

  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect.poll(() => stateRequestCount).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    releaseFirstState();
    await expect.poll(() => stateRequestCount).toBe(2);

    const app = page.locator("#app");
    await expect(app).toHaveAttribute("data-workspace-authority", "loading");
    await expect(page.locator("[data-workspace-authority-gate]")).toBeVisible();
    expect(await page.locator(".layout").evaluate((element) => element.inert)).toBe(true);

    releaseSecondState();
    await expect(app).toHaveAttribute("data-workspace-authority", "ready");
    await expect(page.locator("[data-workspace-authority-gate]")).toBeHidden();
    expect(await page.locator(".layout").evaluate((element) => element.inert)).toBe(false);

    const remote = await fixtureSnapshot(request);
    expect(remote.serverRevision).toBe(1);
    expect(remote.writes).toEqual([]);
    expect(remote.writeAttempts).toEqual([]);
  } finally {
    releaseFirstState?.();
    releaseSecondState?.();
    await context.close();
  }
});

async function newAppContext(browser, testInfo, viewport) {
  const { width, height, ...deviceOptions } = viewport;
  return browser.newContext({
    baseURL: String(testInfo.project.use.baseURL),
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: { width, height },
    serviceWorkers: "block",
    ...deviceOptions,
  });
}

async function expectResourceTitle(page, title) {
  await expect(page.locator(`[data-resource-title-display="${FIXTURE_IDS.resource}"]`).first()).toHaveText(title);
}

function waitForStateEventStream(page) {
  return page.waitForResponse((response) => new URL(response.url()).pathname === "/api/state/events");
}

async function dispatchWakeEvent(page, eventName) {
  await page.evaluate((name) => {
    if (name === "pageshow") {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      return;
    }
    window.dispatchEvent(new Event(name));
  }, eventName);
}

async function overwriteLocalSnapshot(page, staleTitle) {
  await page.evaluate(async ({ databaseName, snapshotStore, workspaceId, title }) => {
    const database = await openDatabase(databaseName);
    const transaction = database.transaction(snapshotStore, "readwrite");
    const store = transaction.objectStore(snapshotStore);
    const snapshot = await requestResult(store.get(workspaceId));
    if (!snapshot) throw new Error(`Missing local snapshot for ${workspaceId}.`);

    const resource = snapshot.state.resources.find((entry) => entry.id === "fixture-resource-main");
    if (!resource) throw new Error("Missing fixture Resource in local snapshot.");
    const futureTimestamp = "2099-12-31T23:59:59.999Z";
    resource.title = title;
    resource.updatedAt = futureTimestamp;
    snapshot.state.updatedAt = futureTimestamp;
    snapshot.savedAt = futureTimestamp;
    store.put(snapshot);

    await transactionComplete(transaction);
    database.close();

    function openDatabase(name) {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error(`Unable to open ${name}.`));
      });
    }

    function requestResult(request) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
      });
    }

    function transactionComplete(pendingTransaction) {
      return new Promise((resolve, reject) => {
        pendingTransaction.oncomplete = resolve;
        pendingTransaction.onerror = () => reject(pendingTransaction.error || new Error("IndexedDB transaction failed."));
        pendingTransaction.onabort = () => reject(pendingTransaction.error || new Error("IndexedDB transaction aborted."));
      });
    }
  }, {
    databaseName: LOCAL_DATABASE_NAME,
    snapshotStore: SNAPSHOT_STORE,
    workspaceId: FIXTURE_IDS.appState,
    title: staleTitle,
  });
}

async function installStaleWorkspaceDraft(page, staleTitle) {
  await page.evaluate(async ({ databaseName, snapshotStore, operationStore, workspaceId, title }) => {
    const database = await openDatabase(databaseName);
    const transaction = database.transaction([snapshotStore, operationStore], "readwrite");
    const snapshots = transaction.objectStore(snapshotStore);
    const operations = transaction.objectStore(operationStore);
    const snapshot = await requestResult(snapshots.get(workspaceId));
    if (!snapshot) throw new Error(`Missing local snapshot for ${workspaceId}.`);

    const staleState = structuredClone(snapshot.state);
    const resource = staleState.resources.find((entry) => entry.id === "fixture-resource-main");
    if (!resource) throw new Error("Missing fixture Resource in local snapshot.");
    const staleTimestamp = "2020-01-01T00:00:00.000Z";
    resource.title = title;
    resource.updatedAt = staleTimestamp;
    staleState.updatedAt = staleTimestamp;
    staleState.revision = snapshot.baseRevision;

    snapshots.put({
      ...snapshot,
      baseRevision: snapshot.baseRevision,
      savedAt: staleTimestamp,
      state: staleState,
    });
    operations.put({
      id: `workspace:${workspaceId}`,
      workspaceId,
      entityType: "workspace",
      entityId: workspaceId,
      baseRevision: snapshot.baseRevision,
      status: "pending",
      attempts: 0,
      queueOrder: 0,
      createdAt: staleTimestamp,
      updatedAt: staleTimestamp,
      payload: { state: structuredClone(staleState) },
      scope: "workspace",
    });

    await transactionComplete(transaction);
    database.close();

    function openDatabase(name) {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error(`Unable to open ${name}.`));
      });
    }

    function requestResult(request) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
      });
    }

    function transactionComplete(pendingTransaction) {
      return new Promise((resolve, reject) => {
        pendingTransaction.oncomplete = resolve;
        pendingTransaction.onerror = () => reject(pendingTransaction.error || new Error("IndexedDB transaction failed."));
        pendingTransaction.onabort = () => reject(pendingTransaction.error || new Error("IndexedDB transaction aborted."));
      });
    }
  }, {
    databaseName: LOCAL_DATABASE_NAME,
    snapshotStore: SNAPSHOT_STORE,
    operationStore: OPERATION_STORE,
    workspaceId: FIXTURE_IDS.appState,
    title: staleTitle,
  });
}

async function localSnapshotRevision(page) {
  return readLocalSnapshot(page).then((snapshot) => snapshot?.baseRevision ?? null);
}

async function localSnapshotTitle(page) {
  return readLocalSnapshot(page).then((snapshot) => resourceTitle(snapshot?.state));
}

async function localWorkspaceOperationCount(page) {
  return page.evaluate(async ({ databaseName, operationStore, workspaceId }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`Unable to open ${databaseName}.`));
    });
    const transaction = database.transaction(operationStore, "readonly");
    const operations = await new Promise((resolve, reject) => {
      const request = transaction.objectStore(operationStore).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB operation read failed."));
    });
    database.close();
    return operations.filter((operation) => operation.workspaceId === workspaceId).length;
  }, {
    databaseName: LOCAL_DATABASE_NAME,
    operationStore: OPERATION_STORE,
    workspaceId: FIXTURE_IDS.appState,
  });
}

async function readLocalSnapshot(page) {
  return page.evaluate(async ({ databaseName, snapshotStore, workspaceId }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`Unable to open ${databaseName}.`));
    });
    const transaction = database.transaction(snapshotStore, "readonly");
    const snapshot = await new Promise((resolve, reject) => {
      const request = transaction.objectStore(snapshotStore).get(workspaceId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
    });
    database.close();
    return snapshot;
  }, {
    databaseName: LOCAL_DATABASE_NAME,
    snapshotStore: SNAPSHOT_STORE,
    workspaceId: FIXTURE_IDS.appState,
  });
}

function resourceTitle(state) {
  return state?.resources?.find((resource) => resource.id === FIXTURE_IDS.resource)?.title || "";
}
