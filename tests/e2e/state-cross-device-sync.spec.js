import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const LOCAL_DATABASE_NAME = "sygma-resource-local-v1";
const SNAPSHOT_STORE = "snapshots";
const OPERATION_STORE = "operations";
const ORIGINAL_NAME = "Fixture Project";

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("two active clients converge through state events without focus or reload", async ({ browser, request }, testInfo) => {
  const macContext = await newAppContext(browser, testInfo, { width: 1440, height: 1000 });
  const ipadContext = await newAppContext(browser, testInfo, { width: 1024, height: 1366, hasTouch: true, isMobile: true });
  const macPage = await macContext.newPage();
  const ipadPage = await ipadContext.newPage();
  const changedName = "Synced live without a wake event";

  try {
    const macEventStream = waitForStateEventStream(macPage);
    const ipadEventStream = waitForStateEventStream(ipadPage);
    await Promise.all([macPage.goto("/"), ipadPage.goto("/"), macEventStream, ipadEventStream]);
    await openProjects(macPage);
    await openProjects(ipadPage);
    await expectProjectName(ipadPage, ORIGINAL_NAME);
    await expect.poll(() => localSnapshotRevision(macPage)).toBe(1);
    await expect.poll(() => localSnapshotRevision(ipadPage)).toBe(1);

    const ipadDocumentIdentity = await ipadPage.evaluate(() => {
      window.__e2eDocumentIdentity = crypto.randomUUID();
      return window.__e2eDocumentIdentity;
    });

    await macPage.locator(`[data-project-edit="${FIXTURE_IDS.project}"]`).click();
    const macName = macPage.locator(
      `[data-inline-owner-type="projects"][data-inline-owner-id="${FIXTURE_IDS.project}"] [data-field="name"]`,
    );
    await expect(macName).toBeVisible();
    await macName.fill(changedName);
    await macName.press("Tab");
    await expect.poll(async () => {
      const snapshot = await fixtureSnapshot(request);
      return { revision: snapshot.serverRevision, name: projectName(snapshot.state) };
    }).toEqual({ revision: 2, name: changedName });

    await expectProjectName(ipadPage, changedName, { timeout: 5_000 });
    await expect.poll(() => localSnapshotRevision(ipadPage), { timeout: 5_000 }).toBe(2);
    expect(await ipadPage.evaluate(() => window.__e2eDocumentIdentity)).toBe(ipadDocumentIdentity);
  } finally {
    await Promise.all([macContext.close(), ipadContext.close()]);
  }
});

test("열린 Resource는 일반 화면과 Quick Resource 패널 사이에서 즉시 동기화된다", async ({ browser, request }, testInfo) => {
  const mainContext = await newAppContext(browser, testInfo, { width: 1440, height: 1000 });
  const quickContext = await newAppContext(browser, testInfo, { width: 496, height: 900 });
  const mainPage = await mainContext.newPage();
  const quickPage = await quickContext.newPage();
  const firstTitle = "Synced from main Resource";
  const firstBody = "Main Resource body synced live";
  const secondTitle = "Synced back from Quick Resource";
  const secondBody = "Quick Resource body synced live";

  try {
    const mainEventStream = waitForStateEventStream(mainPage);
    const quickEventStream = waitForStateEventStream(quickPage);
    await Promise.all([mainPage.goto("/"), quickPage.goto("/?surface=quick-resource"), mainEventStream, quickEventStream]);
    await mainPage.locator('[data-action="toggle-nav"]').click();
    await expect(mainPage.locator("[data-sidebar]")).toHaveClass(/is-open/);
    await mainPage.locator('[data-nav-key="resources"]').click();
    await expect(mainPage.locator("[data-resource-view]")).toBeVisible();
    await expect(quickPage.locator("[data-resource-view]")).toBeVisible();

    for (const page of [mainPage, quickPage]) {
      await page.locator(`[data-resource-open="${FIXTURE_IDS.resource}"]`).evaluate((button) => button.click());
      await expect(page.locator(`[data-resource-document="${FIXTURE_IDS.resource}"]`)).toBeVisible();
    }
    const mainDocument = mainPage.locator(`[data-resource-document="${FIXTURE_IDS.resource}"]`);
    const quickDocument = quickPage.locator(`[data-resource-document="${FIXTURE_IDS.resource}"]`);
    const mainTitle = mainDocument.locator("[data-resource-title]");
    const quickTitle = quickDocument.locator("[data-resource-title]");
    const mainBody = mainDocument.locator("[data-block-content]").first();
    const quickBody = quickDocument.locator("[data-block-content]").first();

    await mainTitle.fill(firstTitle);
    await mainBody.fill(firstBody);
    await expect.poll(async () => {
      const resource = (await fixtureSnapshot(request)).state.resources.find((item) => item.id === FIXTURE_IDS.resource);
      return [resource?.title, resource?.blocks?.[0]?.text];
    }).toEqual([firstTitle, firstBody]);
    await expect(quickTitle).toHaveValue(firstTitle);
    await expect(quickBody).toHaveText(firstBody);
    expect(await mainPage.evaluate(() => document.visibilityState)).toBe("visible");
    expect(await quickPage.evaluate(() => document.visibilityState)).toBe("visible");

    await quickTitle.fill(secondTitle);
    await quickBody.fill(secondBody);
    await expect.poll(async () => {
      const resource = (await fixtureSnapshot(request)).state.resources.find((item) => item.id === FIXTURE_IDS.resource);
      return [resource?.title, resource?.blocks?.[0]?.text];
    }).toEqual([secondTitle, secondBody]);
    await expect(mainTitle).toHaveValue(secondTitle);
    await expect(mainBody).toHaveText(secondBody);
  } finally {
    await Promise.all([mainContext.close(), quickContext.close()]);
  }
});

for (const wakeEvent of ["focus", "pageshow"]) {
  test(`a second device pulls a newer revision on ${wakeEvent} without reloading`, async ({ browser, request }, testInfo) => {
    const macContext = await newAppContext(browser, testInfo, { width: 1440, height: 1000 });
    const ipadContext = await newAppContext(browser, testInfo, { width: 1024, height: 1366, hasTouch: true, isMobile: true });
    const macPage = await macContext.newPage();
    const ipadPage = await ipadContext.newPage();
    const changedName = `Synced from Mac after ${wakeEvent}`;

    try {
      await Promise.all([macPage.goto("/"), ipadPage.goto("/")]);
      await openProjects(macPage);
      await openProjects(ipadPage);
      await expectProjectName(ipadPage, ORIGINAL_NAME);
      await expect.poll(() => localSnapshotRevision(macPage)).toBe(1);
      await expect.poll(() => localSnapshotRevision(ipadPage)).toBe(1);

      const ipadDocumentIdentity = await ipadPage.evaluate(() => {
        window.__e2eDocumentIdentity = crypto.randomUUID();
        return window.__e2eDocumentIdentity;
      });

      await macPage.locator(`[data-project-edit="${FIXTURE_IDS.project}"]`).click();
      const macName = macPage.locator(
        `[data-inline-owner-type="projects"][data-inline-owner-id="${FIXTURE_IDS.project}"] [data-field="name"]`,
      );
      await expect(macName).toBeVisible();
      await macName.fill(changedName);
      await macName.press("Tab");
      await expect.poll(async () => {
        const snapshot = await fixtureSnapshot(request);
        return {
          revision: snapshot.serverRevision,
          name: projectName(snapshot.state),
        };
      }).toEqual({ revision: 2, name: changedName });

      await dispatchWakeEvent(ipadPage, wakeEvent);
      await expectProjectName(ipadPage, changedName);
      await expect.poll(() => localSnapshotRevision(ipadPage)).toBe(2);
      expect(await ipadPage.evaluate(() => window.__e2eDocumentIdentity)).toBe(ipadDocumentIdentity);

      const remote = await fixtureSnapshot(request);
      expect(remote.serverRevision).toBe(2);
      expect(remote.writeAttempts).toEqual([
        expect.objectContaining({
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
  const staleName = "Future-dated stale local name";

  try {
    await page.goto("/");
    await openProjects(page);
    await expectProjectName(page, ORIGINAL_NAME);
    await expect.poll(() => localSnapshotRevision(page)).toBe(1);

    await overwriteLocalSnapshot(page, staleName);
    expect(await localSnapshotName(page)).toBe(staleName);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => localSnapshotName(page)).toBe(ORIGINAL_NAME);
    await expect.poll(() => localSnapshotRevision(page)).toBe(1);
    await openProjects(page);
    await expectProjectName(page, ORIGINAL_NAME);

    const remote = await fixtureSnapshot(request);
    expect(remote.serverRevision).toBe(1);
    expect(projectName(remote.state)).toBe(ORIGINAL_NAME);
    expect(remote.writes).toEqual([]);
    expect(remote.writeAttempts).toEqual([]);
  } finally {
    await context.close();
  }
});

test("an online restart discards even a same-revision pending workspace operation and shows the remote workspace", async ({ browser, request }, testInfo) => {
  const context = await newAppContext(browser, testInfo, { width: 1440, height: 1000 });
  const setupPage = await context.newPage();
  const staleName = "Stale pending workspace name";

  try {
    await setupPage.goto("/");
    await expect.poll(() => localSnapshotRevision(setupPage)).toBe(1);
    await installStaleWorkspaceDraft(setupPage, staleName);
    expect(await localSnapshotName(setupPage)).toBe(staleName);
    expect(await localWorkspaceOperationCount(setupPage)).toBe(1);
    await setupPage.close();

    const restartPage = await context.newPage();
    await restartPage.goto("/");
    await openProjects(restartPage);
    await expectProjectName(restartPage, ORIGINAL_NAME);
    await expect.poll(() => localSnapshotName(restartPage)).toBe(ORIGINAL_NAME);
    await expect.poll(() => localSnapshotRevision(restartPage)).toBe(1);
    await expect.poll(() => localWorkspaceOperationCount(restartPage)).toBe(0);

    const remote = await fixtureSnapshot(request);
    expect(remote.serverRevision).toBe(1);
    expect(projectName(remote.state)).toBe(ORIGINAL_NAME);
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

async function openProjects(page) {
  const navToggle = page.locator('[data-action="toggle-nav"]');
  if (await navToggle.isVisible()) {
    await navToggle.click();
    await expect(page.locator("[data-sidebar]")).toHaveClass(/is-open/);
  }
  await page.locator('[data-nav-key="projects"]').click();
  await expect(projectCard(page)).toBeVisible();
}

function projectCard(page) {
  return page.locator(`[data-project-item="${FIXTURE_IDS.project}"]`);
}

async function expectProjectName(page, name, options = {}) {
  await expect(projectCard(page).locator(`[data-project-toggle="${FIXTURE_IDS.project}"] h3`)).toHaveText(name, options);
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

async function overwriteLocalSnapshot(page, staleName) {
  await page.evaluate(async ({ databaseName, snapshotStore, workspaceId, name }) => {
    const database = await openDatabase(databaseName);
    const transaction = database.transaction(snapshotStore, "readwrite");
    const store = transaction.objectStore(snapshotStore);
    const snapshot = await requestResult(store.get(workspaceId));
    if (!snapshot) throw new Error(`Missing local snapshot for ${workspaceId}.`);

    const project = snapshot.state.projects.find((entry) => entry.id === "fixture-project");
    if (!project) throw new Error("Missing fixture Project in local snapshot.");
    const futureTimestamp = "2099-12-31T23:59:59.999Z";
    project.name = name;
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
    name: staleName,
  });
}

async function installStaleWorkspaceDraft(page, staleName) {
  await page.evaluate(async ({ databaseName, snapshotStore, operationStore, workspaceId, name }) => {
    const database = await openDatabase(databaseName);
    const transaction = database.transaction([snapshotStore, operationStore], "readwrite");
    const snapshots = transaction.objectStore(snapshotStore);
    const operations = transaction.objectStore(operationStore);
    const snapshot = await requestResult(snapshots.get(workspaceId));
    if (!snapshot) throw new Error(`Missing local snapshot for ${workspaceId}.`);

    const staleState = structuredClone(snapshot.state);
    const project = staleState.projects.find((entry) => entry.id === "fixture-project");
    if (!project) throw new Error("Missing fixture Project in local snapshot.");
    const staleTimestamp = "2020-01-01T00:00:00.000Z";
    project.name = name;
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
    name: staleName,
  });
}

async function localSnapshotRevision(page) {
  return readLocalSnapshot(page).then((snapshot) => snapshot?.baseRevision ?? null);
}

async function localSnapshotName(page) {
  return readLocalSnapshot(page).then((snapshot) => projectName(snapshot?.state));
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

function projectName(state) {
  return state?.projects?.find((project) => project.id === FIXTURE_IDS.project)?.name || "";
}
