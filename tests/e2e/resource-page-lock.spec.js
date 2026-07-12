import { expect, test } from "@playwright/test";
import {
  FIXTURE_IDS,
  fixtureSnapshot,
  openResources,
  resetFixture,
} from "./helpers.js";

const LOCAL_DATABASE_NAME = "sygma-resource-local-v1";
const SNAPSHOT_STORE = "snapshots";
const OPERATION_STORE = "operations";
const RESOURCE_ID = FIXTURE_IDS.resource;
const READ_ONLY_RESOURCE_ID = FIXTURE_IDS.readOnlyResource;
const PAGE_THREAD_ID = FIXTURE_IDS.pageThread;
const RESOURCE_PATH = (resourceId) => `/resources/${encodeURIComponent(resourceId)}`;

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

function resourceFromSnapshot(snapshot, resourceId = RESOURCE_ID) {
  return snapshot.state.resources.find((resource) => resource.id === resourceId);
}

function resourceShell(page, resourceId = RESOURCE_ID) {
  return page.locator(`[data-resource-note="${resourceId}"]`);
}

async function openResource(page, resourceId = RESOURCE_ID) {
  await page.goto(RESOURCE_PATH(resourceId));
  const shell = resourceShell(page, resourceId);
  await expect(shell).toBeVisible();
  return shell;
}

async function openPageMenu(page, shell, resourceId = RESOURCE_ID) {
  const trigger = shell.locator(`[data-resource-page-menu="${resourceId}"]`);
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const menu = page.locator(`[data-resource-page-menu-panel="${resourceId}"]`);
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("role", "menu");
  return menu;
}

function lockMenuItem(menu, resourceId = RESOURCE_ID) {
  return menu.locator(`[data-resource-page-lock="${resourceId}"]`);
}

async function copyPageLink(page, shell, resourceId = RESOURCE_ID) {
  const origin = new URL(page.url()).origin;
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const copy = shell.locator(`[data-resource-copy-link="${resourceId}"]`);
  await expect(copy).toBeEnabled();
  await copy.click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(new URL(RESOURCE_PATH(resourceId), origin).href);
}

async function expandProperties(shell, resourceId = RESOURCE_ID) {
  const toggle = shell.locator(`[data-resource-props="${resourceId}"]`);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const properties = shell.locator(`[data-resource-properties="${resourceId}"]`);
  await expect(properties).toBeVisible();
  return properties;
}

async function setPageLocked(page, request, locked, resourceId = RESOURCE_ID) {
  const shell = resourceShell(page, resourceId);
  const before = await fixtureSnapshot(request);
  const beforeResource = resourceFromSnapshot(before, resourceId);
  const menu = await openPageMenu(page, shell, resourceId);
  const toggle = lockMenuItem(menu, resourceId);
  await expect(toggle).toHaveAttribute("role", "menuitemcheckbox");
  await expect(toggle).toHaveAttribute("aria-checked", String(!locked));
  await expect(toggle).toBeEnabled();
  await toggle.click();

  await expect.poll(async () => resourceFromSnapshot(await fixtureSnapshot(request), resourceId)?.locked).toBe(locked);
  const after = await fixtureSnapshot(request);
  const afterResource = resourceFromSnapshot(after, resourceId);
  expect(afterResource.revision).toBeGreaterThan(beforeResource.revision);
  expect(after.serverRevision).toBeGreaterThan(before.serverRevision);
  await expect(shell).toHaveAttribute("data-resource-locked", String(locked));
  return { before, beforeResource, after, afterResource };
}

async function expectDisabledControls(locator) {
  const controls = await locator.all();
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) await expect(control).toBeDisabled();
}

async function expectLockedWriteSurfaces(page, shell) {
  await expect(shell).toHaveAttribute("data-resource-locked", "true");
  await expect(shell).toHaveAttribute("data-resource-read-only", "false");

  const title = shell.locator(`[data-resource-title="${RESOURCE_ID}"]`);
  await expect(title).toHaveAttribute("readonly", "");
  await expect(title).toHaveAttribute("aria-readonly", "true");

  const blocks = shell.locator("[data-block-content]");
  expect(await blocks.count()).toBeGreaterThan(0);
  for (const block of await blocks.all()) {
    await expect(block).toHaveAttribute("contenteditable", "false");
    await expect(block).toHaveAttribute("aria-readonly", "true");
  }
  await expect(shell.locator("[data-block-add], [data-block-drag]")).toHaveCount(0);
  await expect(shell.locator('[data-block-check="fixture-block-todo"]')).toBeDisabled();

  await expect(shell.locator(`[data-resource-create-child="${RESOURCE_ID}"]`)).toBeDisabled();
  await expect(shell.locator(`[data-resource-parent="${RESOURCE_ID}"]`)).toBeDisabled();
  await expect(shell.locator("[data-resource-icon-edit], [data-resource-cover-edit], [data-resource-cover-remove]")).toHaveCount(0);

  const properties = await expandProperties(shell);
  await expectDisabledControls(properties.locator("select[data-field], input[data-field]"));
  const urlActions = properties.locator("[data-resource-url-actions]");
  await expect(urlActions.locator('a[data-resource-url-action="open"]')).toBeVisible();
  await expect(urlActions.locator('button[data-resource-url-action="copy"]')).toBeEnabled();
  await expect(urlActions.locator('button[data-resource-url-action="edit"]')).toBeDisabled();
  await expect(urlActions.locator('button[data-resource-url-action="clear"]')).toBeDisabled();

  const commentsToggle = shell.locator(`[data-resource-comments-toggle="${RESOURCE_ID}"]`).first();
  await expect(commentsToggle).toBeEnabled();
  await commentsToggle.click();
  const comments = page.locator(`[data-resource-comments-pane="${RESOURCE_ID}"]`);
  await expect(comments).toBeVisible();
  await expect(comments.locator(`[data-page-discussion-composer="${RESOURCE_ID}"]`)).toBeDisabled();
  await expect(comments.locator(`[data-page-discussion-submit="${RESOURCE_ID}"]`)).toBeDisabled();
  await expect(comments.locator(`[data-comment-reply-input="${PAGE_THREAD_ID}"]`)).toBeDisabled();
  await expect(comments.locator(`[data-comment-reply-submit="${PAGE_THREAD_ID}"]`)).toBeDisabled();
  await expect(comments.locator(`[data-comment-resolve="${PAGE_THREAD_ID}"]`)).toBeDisabled();

  await expect(shell.locator(`[data-resource-copy-link="${RESOURCE_ID}"]`)).toBeEnabled();
  const menu = await openPageMenu(page, shell);
  const unlock = lockMenuItem(menu);
  await expect(unlock).toBeEnabled();
  await expect(unlock).toHaveAttribute("aria-checked", "true");
  await expect(unlock).toContainText(/Unlock page/i);
  await expect(menu.locator(`[data-resource-copy-link="${RESOURCE_ID}"]`)).toBeEnabled();
  await expectDisabledControls(menu.locator("[data-resource-page-font], [data-resource-page-option], [data-resource-duplicate], [data-resource-move-menu], [data-resource-move-to-trash]"));
  await expect(menu.locator(`[data-resource-export-markdown="${RESOURCE_ID}"]`)).toBeEnabled();
  await page.keyboard.press("Escape");
}

test("normal and read-only pages expose the Page menu and exact deep-link copy while read-only cannot toggle Lock", async ({ page, request }) => {
  const initial = await fixtureSnapshot(request);
  expect(resourceFromSnapshot(initial)?.locked).toBe(false);
  expect(resourceFromSnapshot(initial, READ_ONLY_RESOURCE_ID)?.locked).toBe(false);

  let shell = await openResource(page);
  let menu = await openPageMenu(page, shell);
  const normalLock = lockMenuItem(menu);
  await expect(normalLock).toBeEnabled();
  await expect(normalLock).toHaveAttribute("role", "menuitemcheckbox");
  await expect(normalLock).toHaveAttribute("aria-checked", "false");
  await expect(normalLock).toContainText(/Lock page/i);
  await expect(menu.locator(`[data-resource-copy-link="${RESOURCE_ID}"]`)).toBeEnabled();
  await page.keyboard.press("Escape");
  await copyPageLink(page, shell);

  shell = await openResource(page, READ_ONLY_RESOURCE_ID);
  await expect(shell).toHaveAttribute("data-resource-read-only", "true");
  menu = await openPageMenu(page, shell, READ_ONLY_RESOURCE_ID);
  const readOnlyLock = lockMenuItem(menu, READ_ONLY_RESOURCE_ID);
  await expect(readOnlyLock).toHaveAttribute("role", "menuitemcheckbox");
  await expect(readOnlyLock).toHaveAttribute("aria-checked", "false");
  await expect(readOnlyLock).toBeDisabled();
  await expect(readOnlyLock).toHaveAttribute("aria-disabled", "true");
  await expect(menu.locator(`[data-resource-copy-link="${READ_ONLY_RESOURCE_ID}"]`)).toBeEnabled();
  await expectDisabledControls(menu.locator("[data-resource-page-font], [data-resource-page-option], [data-resource-duplicate], [data-resource-move-menu], [data-resource-move-to-trash]"));
  await expect(menu.locator(`[data-resource-export-markdown="${READ_ONLY_RESOURCE_ID}"]`)).toBeEnabled();
  await page.keyboard.press("Escape");
  await copyPageLink(page, shell, READ_ONLY_RESOURCE_ID);

  const beforeForcedToggle = await fixtureSnapshot(request);
  await page.evaluate((resourceId) => {
    const shellElement = document.querySelector(`[data-resource-note="${resourceId}"]`);
    const injected = document.createElement("button");
    injected.type = "button";
    injected.dataset.resourcePageLock = resourceId;
    shellElement.append(injected);
    injected.click();
    injected.remove();
  }, READ_ONLY_RESOURCE_ID);
  await page.waitForTimeout(500);
  const afterForcedToggle = await fixtureSnapshot(request);
  expect(resourceFromSnapshot(afterForcedToggle, READ_ONLY_RESOURCE_ID)).toEqual(
    resourceFromSnapshot(beforeForcedToggle, READ_ONLY_RESOURCE_ID),
  );
  expect(afterForcedToggle.serverRevision).toBe(beforeForcedToggle.serverRevision);
});

test("Lock persists, blocks every write surface, and Unlock restores editing", async ({ page, request }) => {
  let shell = await openResource(page);
  const locked = await setPageLocked(page, request, true);
  await expectLockedWriteSurfaces(page, shell);
  await copyPageLink(page, shell);

  await page.reload();
  shell = resourceShell(page);
  await expect(shell).toBeVisible();
  await expect(shell).toHaveAttribute("data-resource-locked", "true");
  await expect(shell.locator(`[data-resource-title="${RESOURCE_ID}"]`)).toHaveAttribute("readonly", "");
  const persisted = resourceFromSnapshot(await fixtureSnapshot(request));
  expect(persisted.locked).toBe(true);
  expect(persisted.revision).toBe(locked.afterResource.revision);

  const unlocked = await setPageLocked(page, request, false);
  expect(unlocked.afterResource.revision).toBeGreaterThan(locked.afterResource.revision);
  shell = resourceShell(page);
  await expect(shell).toHaveAttribute("data-resource-locked", "false");
  await expect(shell.locator(`[data-resource-title="${RESOURCE_ID}"]`)).not.toHaveAttribute("readonly", "");
  await expect(shell.locator('[data-block-content="fixture-block-paragraph"]')).toHaveAttribute("contenteditable", "true");
  await expect(shell.locator("[data-block-add], [data-block-drag]").first()).toBeVisible();
  await expect(shell.locator(`[data-resource-create-child="${RESOURCE_ID}"]`)).toBeEnabled();
  await expect(shell.locator(`[data-resource-parent="${RESOURCE_ID}"]`)).toBeEnabled();
  await expect(shell.locator("[data-resource-icon-edit]")).toBeVisible();

  const properties = await expandProperties(shell);
  const propertyWrites = properties.locator("select[data-field], input[data-field]");
  expect(await propertyWrites.count()).toBeGreaterThan(0);
  for (const control of await propertyWrites.all()) await expect(control).toBeEnabled();

  const commentsToggle = shell.locator(`[data-resource-comments-toggle="${RESOURCE_ID}"]`).first();
  await commentsToggle.click();
  await expect(page.locator(`[data-page-discussion-composer="${RESOURCE_ID}"]`)).toBeEnabled();

  const unlockedTitle = "Unlocked Resource title";
  await shell.locator(`[data-resource-title="${RESOURCE_ID}"]`).fill(unlockedTitle);
  await expect.poll(async () => resourceFromSnapshot(await fixtureSnapshot(request))?.title).toBe(unlockedTitle);
});

test("locked mutation handlers reject forced DOM events without changing local or server state", async ({ page, request }) => {
  const shell = await openResource(page);
  await setPageLocked(page, request, true);
  await expandProperties(shell);
  await shell.locator(`[data-resource-comments-toggle="${RESOURCE_ID}"]`).first().click();
  await expect(page.locator(`[data-resource-comments-pane="${RESOURCE_ID}"]`)).toBeVisible();
  await expect(shell.locator("[data-resource-save-status]")).toHaveAttribute("data-sync-state", "saved");

  const before = await fixtureSnapshot(request);
  const beforeResource = structuredClone(resourceFromSnapshot(before));
  const beforeResourceCount = before.state.resources.length;

  const localResult = await page.evaluate(({ resourceId, threadId, attemptedParentId }) => {
    const shellElement = document.querySelector(`[data-resource-note="${resourceId}"]`);
    const clickInjected = (dataset, parent = shellElement) => {
      const button = document.createElement("button");
      button.type = "button";
      Object.assign(button.dataset, dataset);
      parent.append(button);
      button.click();
      button.remove();
    };

    const title = shellElement.querySelector(`[data-resource-title="${resourceId}"]`);
    title.removeAttribute("readonly");
    title.value = "Forced locked title";
    title.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }));

    const block = shellElement.querySelector('[data-block-content="fixture-block-paragraph"]');
    block.setAttribute("contenteditable", "true");
    block.textContent = "Forced locked block";
    block.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }));
    block.focus();
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "Forced pasted block");
    block.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    clickInjected({ blockAdd: "fixture-block-paragraph" }, shellElement.querySelector(".block-editor"));

    const todo = shellElement.querySelector('[data-block-check="fixture-block-todo"]');
    todo.disabled = false;
    todo.click();

    const type = shellElement.querySelector('[data-field="type"]');
    type.disabled = false;
    type.value = "scrap";
    type.dispatchEvent(new Event("change", { bubbles: true }));

    const parent = shellElement.querySelector(`[data-resource-parent="${resourceId}"]`);
    parent.disabled = false;
    parent.value = attemptedParentId;
    parent.dispatchEvent(new Event("change", { bubbles: true }));

    const composer = shellElement.querySelector(`[data-page-discussion-composer="${resourceId}"]`);
    composer.disabled = false;
    composer.value = "Forced locked discussion";
    clickInjected({ pageDiscussionSubmit: resourceId });

    const reply = shellElement.querySelector(`[data-comment-reply-input="${threadId}"]`);
    reply.disabled = false;
    reply.value = "Forced locked reply";
    clickInjected({ commentReplySubmit: threadId });
    clickInjected({ commentResolve: threadId });

    clickInjected({ resourcePageFont: "serif", resourcePageOwner: resourceId });
    clickInjected({ resourcePageOption: "smallText", resourcePageOwner: resourceId });
    clickInjected({ resourceDuplicate: resourceId });
    clickInjected({ resourceMoveMenu: resourceId });
    clickInjected({ resourceMoveParent: attemptedParentId, resourceMoveOwner: resourceId });
    clickInjected({ resourceMoveToTrash: resourceId });
    clickInjected({ resourceCreateChild: resourceId });
    clickInjected({ resourceIconChoice: "💡", resourceIconOwner: resourceId });
    clickInjected({ resourceIconRemove: resourceId });
    clickInjected({ resourceCoverRemove: resourceId });
    clickInjected({ resourceUrlAction: "edit", resourceUrlOwner: resourceId });
    clickInjected({ resourceUrlAction: "clear", resourceUrlOwner: resourceId });

    return {
      title: shellElement.querySelector(`[data-resource-title="${resourceId}"]`).value,
      block: shellElement.querySelector('[data-block-content="fixture-block-paragraph"]').textContent,
      type: shellElement.querySelector('[data-field="type"]').value,
      parent: shellElement.querySelector(`[data-resource-parent="${resourceId}"]`).value,
      blockCount: shellElement.querySelectorAll("[data-block-id]").length,
    };
  }, { resourceId: RESOURCE_ID, threadId: PAGE_THREAD_ID, attemptedParentId: FIXTURE_IDS.bodySearchResource });

  expect(localResult).toEqual({
    title: beforeResource.title,
    block: beforeResource.blocks.find((block) => block.id === "fixture-block-paragraph").text,
    type: beforeResource.type,
    parent: beforeResource.parentId,
    blockCount: beforeResource.blocks.length,
  });

  await page.waitForTimeout(900);
  const after = await fixtureSnapshot(request);
  expect(resourceFromSnapshot(after)).toEqual(beforeResource);
  expect(after.state.resources).toHaveLength(beforeResourceCount);
  expect(after.serverRevision).toBe(before.serverRevision);
  expect(after.writes).toEqual(before.writes);
  expect(after.writeAttempts).toEqual(before.writeAttempts);

  await page.reload();
  const reloaded = resourceShell(page);
  await expect(reloaded).toHaveAttribute("data-resource-locked", "true");
  await expect(reloaded.locator(`[data-resource-title="${RESOURCE_ID}"]`)).toHaveValue(beforeResource.title);
  await expect(reloaded.locator('[data-block-content="fixture-block-paragraph"]')).toHaveText(
    beforeResource.blocks.find((block) => block.id === "fixture-block-paragraph").text,
  );
});

test("server rejects a non-boolean locked field without changing state", async ({ request }) => {
  const before = await fixtureSnapshot(request);
  const invalid = structuredClone(resourceFromSnapshot(before));
  invalid.locked = "true";
  invalid.revision += 1;

  const response = await request.put(`/api/resources/${encodeURIComponent(RESOURCE_ID)}`, {
    headers: {
      "Content-Type": "application/json",
      "If-Match": `"state-${before.serverRevision}"`,
    },
    data: { resource: invalid, baseRevision: before.serverRevision },
  });
  const payload = await response.json();
  expect(response.status()).toBe(422);
  expect(payload.code).toBe("INVALID_STATE");
  expect(payload.details?.issues).toContainEqual(expect.objectContaining({
    code: "invalid_resource_locked",
  }));

  const after = await fixtureSnapshot(request);
  expect(after.serverRevision).toBe(before.serverRevision);
  expect(after.state).toEqual(before.state);
  expect(after.writes).toEqual(before.writes);
});

test("an offline Lock survives reload and replays through the durable Resource queue", async ({ browser, request }, testInfo) => {
  test.setTimeout(45_000);
  const { context, page } = await openServiceWorkerControlledApp(browser, testInfo);
  try {
    await openMainResource(page);
    await context.setOffline(true);

    const shell = resourceShell(page);
    const menu = await openPageMenu(page, shell);
    const offlineLock = lockMenuItem(menu);
    await expect(offlineLock).toHaveAttribute("role", "menuitemcheckbox");
    await offlineLock.click();
    await expect(shell).toHaveAttribute("data-resource-locked", "true");
    await expect(shell.locator("[data-resource-save-status]")).toHaveAttribute("data-sync-state", "offline");

    await expect.poll(async () => {
      const local = await readLocalPersistence(page);
      const operation = local.operations.find((entry) => entry.entityId === RESOURCE_ID);
      const localResource = local.snapshot?.state?.resources?.find((resource) => resource.id === RESOURCE_ID);
      return {
        operationLocked: operation?.payload?.resource?.locked,
        snapshotLocked: localResource?.locked,
        status: operation?.status,
      };
    }).toEqual({ operationLocked: true, snapshotLocked: true, status: "pending" });

    const remoteBeforeReplay = await fixtureSnapshot(request);
    expect(resourceFromSnapshot(remoteBeforeReplay)?.locked).toBe(false);

    await page.reload({ waitUntil: "domcontentloaded" });
    const reloaded = resourceShell(page);
    await expect(reloaded).toBeVisible();
    await expect(reloaded).toHaveAttribute("data-resource-locked", "true");
    await expect(reloaded.locator(`[data-resource-title="${RESOURCE_ID}"]`)).toHaveAttribute("readonly", "");
    const reloadedMenu = await openPageMenu(page, reloaded);
    await expect(lockMenuItem(reloadedMenu)).toHaveAttribute("aria-checked", "true");
    await expect(lockMenuItem(reloadedMenu)).toContainText(/Unlock page/i);
    await page.keyboard.press("Escape");

    await context.setOffline(false);
    await expect.poll(async () => resourceFromSnapshot(await fixtureSnapshot(request))?.locked).toBe(true);
    await expect.poll(async () => {
      const local = await readLocalPersistence(page);
      return local.operations.map((operation) => ({
        entityId: operation.entityId,
        baseRevision: operation.baseRevision,
        status: operation.status,
        attempts: operation.attempts,
        remoteRevision: operation.remoteRevision,
        locked: operation.payload?.resource?.locked,
      }));
    }).toEqual([]);
    await expect(reloaded.locator("[data-resource-save-status]")).toHaveAttribute("data-sync-state", "saved");
  } finally {
    await context.setOffline(false);
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
  await page.locator(`[data-open-resource="${RESOURCE_ID}"]`).first().click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(RESOURCE_PATH(RESOURCE_ID));
  await expect(resourceShell(page)).toBeVisible();
  await expect.poll(async () => (await readLocalPersistence(page)).snapshot?.baseRevision).toBe(1);
}

async function readLocalPersistence(page) {
  return page.evaluate(async ({ databaseName, snapshotStore, operationStore, workspaceId }) => {
    const knownDatabases = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
    if (knownDatabases.length && !knownDatabases.some((entry) => entry.name === databaseName)) {
      return { exists: false, snapshot: null, operations: [] };
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
    if (!database) return { exists: false, snapshot: null, operations: [] };

    const stores = Array.from(database.objectStoreNames);
    if (!stores.includes(snapshotStore) || !stores.includes(operationStore)) {
      database.close();
      return { exists: true, snapshot: null, operations: [] };
    }

    const transaction = database.transaction([snapshotStore, operationStore], "readonly");
    const snapshots = await requestResult(transaction.objectStore(snapshotStore).getAll());
    const operations = await requestResult(transaction.objectStore(operationStore).getAll());
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB read failed."));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB read aborted."));
    });
    database.close();
    return {
      exists: true,
      snapshot: snapshots.find((entry) => entry.workspaceId === workspaceId) || null,
      operations: operations
        .filter((entry) => entry.workspaceId === workspaceId)
        .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || ""))),
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

async function controlledByServiceWorker(page) {
  try {
    return await page.evaluate(() => Boolean(navigator.serviceWorker?.controller));
  } catch {
    return false;
  }
}
