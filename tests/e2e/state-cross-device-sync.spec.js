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

test("열린 Resource 본문은 일반 화면과 Quick Editor 사이에서 즉시 동기화된다", async ({ browser, request }, testInfo) => {
  const mainContext = await newAppContext(browser, testInfo, { width: 1440, height: 1000 });
  const quickContext = await newAppContext(browser, testInfo, { width: 496, height: 900 });
  const mainPage = await mainContext.newPage();
  const quickPage = await quickContext.newPage();
  const firstTitle = "Synced from main Resource";
  const firstBody = "Main Resource body synced live";
  const secondBody = "Quick Editor body synced live";

  try {
    await quickPage.addInitScript(() => {
      window.__quickMemoMessages = [];
      window.addEventListener("sygma:quickMemo", (event) => window.__quickMemoMessages.push(event.detail));
    });
    const mainEventStream = waitForStateEventStream(mainPage);
    const quickEventStream = waitForStateEventStream(quickPage);
    await Promise.all([mainPage.goto("/"), quickPage.goto("/?surface=quick-editor"), mainEventStream, quickEventStream]);
    await quickPage.evaluate(() => window.sygmaQuickEditor.loadLocal({
      id: "fallback-local",
      blocks: [{ id: "fallback-body", type: "paragraph", text: "Fallback local body", marks: [], indent: 0 }],
    }));
    await mainPage.locator('[data-action="toggle-nav"]').click();
    await expect(mainPage.locator("[data-sidebar]")).toHaveClass(/is-open/);
    await mainPage.locator('[data-nav-key="resources"]').click();
    await expect(mainPage.locator("[data-resource-view]")).toBeVisible();
    await mainPage.locator(`[data-resource-open="${FIXTURE_IDS.resource}"]`).evaluate((button) => button.click());
    await expect(mainPage.locator(`[data-resource-document="${FIXTURE_IDS.resource}"]`)).toBeVisible();
    await expect.poll(() => quickPage.evaluate((resourceId) => window.sygmaQuickEditor.openResource(resourceId), FIXTURE_IDS.resource)).toBe(true);
    const mainDocument = mainPage.locator(`[data-resource-document="${FIXTURE_IDS.resource}"]`);
    const mainTitle = mainDocument.locator("[data-resource-title]");
    const mainBody = mainDocument.locator("[data-block-content]").first();
    const quickEditor = quickPage.locator(`.block-editor[data-owner-id="${FIXTURE_IDS.resource}"]`);
    const quickBody = quickEditor.locator("[data-block-content]").first();
    const quickFocusedBody = quickEditor.locator('[data-block-content][contenteditable="true"]').last();
    await expect(quickEditor).toBeVisible();
    await expect(quickFocusedBody).toBeFocused();
    expect(await quickFocusedBody.evaluate((element) => {
      const selection = getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      return Boolean(range?.collapsed
        && element.contains(range.startContainer)
        && range.startOffset === (range.startContainer.textContent || "").length);
    })).toBe(true);
    await quickEditor.evaluate((element) => { window.__quickEditorIdentity = element; });
    await quickBody.evaluate((element) => {
      element.focus();
      const range = document.createRange();
      range.setStart(element.firstChild || element, Math.min(3, element.textContent.length));
      range.collapse(true);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    for (const selector of ["[data-resource-view]", ".resource-window", ".resource-document", "[data-resource-title]", "[data-resource-relations]"]) {
      await expect(quickPage.locator(selector)).toHaveCount(0);
    }

    await mainTitle.fill(firstTitle);
    await mainBody.fill(firstBody);
    await expect.poll(async () => {
      const resource = (await fixtureSnapshot(request)).state.resources.find((item) => item.id === FIXTURE_IDS.resource);
      return [resource?.title, resource?.blocks?.[0]?.text];
    }).toEqual([firstTitle, firstBody]);
    await expect(quickBody).toHaveText(firstBody);
    expect(await quickEditor.evaluate((element) => element === window.__quickEditorIdentity)).toBe(true);
    await expect(quickBody).toBeFocused();
    expect(await quickBody.evaluate((element) => {
      const selection = getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      return range && element.contains(range.startContainer) ? range.startOffset : -1;
    })).toBe(3);
    expect(await mainPage.evaluate(() => document.visibilityState)).toBe("visible");
    expect(await quickPage.evaluate(() => document.visibilityState)).toBe("visible");

    await quickBody.evaluate((element) => {
      element.focus();
      element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "한" }));
      element.textContent = "한글 조합 중";
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const editor = element.closest(".block-editor");
      const resource = itemById("resources", editor.dataset.ownerId);
      resource.blocks.find((block) => block.id === element.dataset.blockContent).text = "원격 교체 내용";
      rerenderAfterStateReplace();
    });
    await expect(quickBody).toHaveText("한글 조합 중");
    await expect(quickBody).toBeFocused();
    expect(await quickEditor.evaluate((element) => element === window.__quickEditorIdentity)).toBe(true);
    await quickBody.dispatchEvent("compositionend", { data: "중" });
    await expect(quickBody).toHaveText("한글 조합 중");

    await mainDocument.focus();
    await quickBody.fill(secondBody);
    await expect.poll(async () => {
      const resource = (await fixtureSnapshot(request)).state.resources.find((item) => item.id === FIXTURE_IDS.resource);
      return [resource?.title, resource?.blocks?.[0]?.text];
    }).toEqual([firstTitle, secondBody]);
    await expect(mainTitle).toHaveValue(firstTitle);
    await expect(mainBody).toHaveText(secondBody);

    const beforeTrash = await fixtureSnapshot(request);
    const trashedResource = structuredClone(beforeTrash.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource));
    trashedResource.trashedAt = new Date().toISOString();
    trashedResource.updatedAt = trashedResource.trashedAt;
    trashedResource.revision = Number(trashedResource.revision || 0) + 1;
    const trashResponse = await request.put(`/api/resources/${encodeURIComponent(trashedResource.id)}`, {
      headers: { "If-Match": `"state-${beforeTrash.serverRevision}"` },
      data: { resource: trashedResource, baseRevision: beforeTrash.serverRevision },
    });
    expect(trashResponse.ok()).toBeTruthy();
    await expect(quickPage.locator('.block-editor[data-owner-id="quick-note:fallback-local"]')).toBeVisible();
    await expect(quickPage.locator('[data-block-content="fallback-body"]')).toHaveText("Fallback local body");
    await expect.poll(() => quickPage.evaluate(() => window.__quickMemoMessages.filter((message) => message.type === "localSelected").at(-1))).toMatchObject({
      type: "localSelected",
      id: "fallback-local",
      title: "Fallback local body",
      characterCount: "Fallback local body".length,
    });
  } finally {
    await Promise.all([mainContext.close(), quickContext.close()]);
  }
});

test("활성 Resource 작성은 앱 복귀 갱신과 새 버전 대기 중에도 유지된다", async ({ browser, request }, testInfo) => {
  const context = await newAppContext(browser, testInfo, { width: 1440, height: 1000 });
  const page = await context.newPage();
  const draft = "앱 복귀 중에도 유지되는 작성 내용";
  const remoteProjectName = "작성 뒤 동기화된 프로젝트";

  try {
    const eventStream = waitForStateEventStream(page);
    await Promise.all([page.goto("/"), eventStream]);
    await page.locator('[data-action="toggle-nav"]').click();
    await expect(page.locator("[data-sidebar]")).toHaveClass(/is-open/);
    await page.locator('[data-nav-key="resources"]').click();
    await page.locator(`[data-resource-open="${FIXTURE_IDS.resource}"]`).evaluate((button) => button.click());
    const resourceWindow = page.locator(`[data-resource-window="${FIXTURE_IDS.resource}"]`);
    const body = resourceWindow.locator("[data-block-content]").first();
    await expect(body).toBeVisible();
    await body.fill(draft);
    await body.evaluate((element) => {
      window.__focusedResourceDraft = element;
      window.__focusedResourceDocument = crypto.randomUUID();
      window.__focusedResourceView = document.querySelector("[data-resource-view]");
    });
    await expect(body).toBeFocused();
    await expect.poll(async () => {
      const resource = (await fixtureSnapshot(request)).state.resources.find((item) => item.id === FIXTURE_IDS.resource);
      return resource?.blocks?.[0]?.text;
    }).toBe(draft);

    const beforeRemote = await fixtureSnapshot(request);
    const state = structuredClone(beforeRemote.state);
    state.projects.find((project) => project.id === FIXTURE_IDS.project).name = remoteProjectName;
    const response = await request.put("/api/state", {
      headers: { "If-Match": `"state-${beforeRemote.serverRevision}"` },
      data: { state, baseRevision: beforeRemote.serverRevision },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const remoteRevision = beforeRemote.serverRevision + 1;

    await page.evaluate(() => {
      window.__skipWaitingCalls = 0;
      setWaitingServiceWorkerRegistration({ waiting: { postMessage: () => { window.__skipWaitingCalls += 1; } } });
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await page.waitForTimeout(750);
    await expect(body).toBeFocused();
    await expect(body).toHaveText(draft);
    expect(await body.evaluate((element) => element === window.__focusedResourceDraft)).toBe(true);
    await expect.poll(() => page.evaluate(() => currentWorkspaceRevision())).toBe(remoteRevision);
    expect(await page.evaluate((projectId) => itemById("projects", projectId)?.name, FIXTURE_IDS.project)).toBe(remoteProjectName);
    expect(await page.evaluate(() => document.querySelector("[data-resource-view]") === window.__focusedResourceView)).toBe(true);
    expect(await page.evaluate(() => window.__skipWaitingCalls)).toBe(0);
    await expect(page.locator(".service-worker-update")).toBeVisible();
    await expect(page.locator('[data-action="apply-app-update"]')).toBeDisabled();
    await expect(page.locator("[data-workspace-authority-gate]")).toBeHidden();

    await resourceWindow.locator("[data-resource-document]").focus();
    await page.evaluate(() => {
      renderServiceWorkerUpdateNoticeIfNeeded();
      window.dispatchEvent(new Event("focus"));
    });
    await expect(page.locator('[data-action="apply-app-update"]')).toBeEnabled();
    await expect.poll(() => page.evaluate(() => document.querySelector("[data-resource-view]") !== window.__focusedResourceView)).toBe(true);
    await expect(resourceWindow.locator("[data-block-content]").first()).toHaveText(draft);
    expect(await page.evaluate(() => window.__skipWaitingCalls)).toBe(0);
    expect(await page.evaluate(() => window.__focusedResourceDocument)).toBeTruthy();
    const saved = await fixtureSnapshot(request);
    expect(saved.state.resources.find((item) => item.id === FIXTURE_IDS.resource)?.blocks?.[0]?.text).toBe(draft);
  } finally {
    await context.close();
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
    const authorityGate = page.locator("[data-workspace-authority-gate]");
    await expect(authorityGate).toBeVisible();
    const authorityBounds = await authorityGate.boundingBox();
    expect(authorityBounds.width).toBeLessThan(page.viewportSize().width / 2);
    expect(authorityBounds.height).toBeLessThan(page.viewportSize().height / 3);
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
