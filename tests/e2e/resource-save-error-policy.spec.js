import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, openResources, resetFixture } from "./helpers.js";

const RESOURCE_PATH = `/resources/${encodeURIComponent(FIXTURE_IDS.resource)}`;
const LOCAL_DATABASE_NAME = "sygma-resource-local-v1";
const OPERATION_STORE = "operations";
const SNAPSHOT_STORE = "snapshots";

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("terminal validation failure never loops, and an online restart restores the remote Resource", async ({ page, request }) => {
  test.setTimeout(45_000);
  let rejectMain = true;
  let mainWriteAttempts = 0;
  await page.route(`**/api/resources/${FIXTURE_IDS.resource}`, async (route) => {
    mainWriteAttempts += 1;
    if (!rejectMain) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      headers: {
        ETag: '"state-1"',
        "x-state-revision": "1",
      },
      body: JSON.stringify({
        error: "State validation failed.\u0000 Private payload omitted.",
        code: "INVALID_STATE<script>",
        revision: 1,
        details: {
          issues: [{
            path: `resource.title\u0000${"x".repeat(220)}`,
            code: "invalid_resource_title<script>",
            message: `Title <b>must be fixed</b>.\u0007 ${"z".repeat(300)}`,
          }],
        },
      }),
    });
  });

  await openResource(page, FIXTURE_IDS.resource);
  const failedTitle = "Terminal failure remains local";
  await resourceTitle(page, FIXTURE_IDS.resource).fill(failedTitle);

  await expectSyncState(page, FIXTURE_IDS.resource, "error", /Error|저장하지 못함/i);
  const banner = page.locator(`[data-resource-save-error="${FIXTURE_IDS.resource}"]`);
  await expect(banner).toBeVisible();
  await expect(banner.locator("[data-resource-save-error-issue]")).toContainText("Title <b>must be fixed</b>.");
  await expect(banner.locator("b, script, img")).toHaveCount(0);
  await expect.poll(() => mainWriteAttempts).toBe(1);

  let local = await readLocalPersistence(page);
  expect(local.operations).toHaveLength(1);
  expect(local.operations[0]).toMatchObject({
    entityType: "resource",
    entityId: FIXTURE_IDS.resource,
    status: "failed",
    payload: { resource: { id: FIXTURE_IDS.resource, title: failedTitle } },
    lastError: {
      status: 422,
      code: "INVALID_STATEscript",
      issue: {
        code: "invalid_resource_titlescript",
      },
    },
  });
  expect(local.operations[0].lastError.message.length).toBeLessThanOrEqual(240);
  expect(local.operations[0].lastError.issue.message.length).toBeLessThanOrEqual(240);
  expect(local.operations[0].lastError.issue.path.length).toBeLessThanOrEqual(160);
  expect(JSON.stringify(local.operations[0].lastError)).not.toMatch(/[\u0000-\u001f\u007f]/);
  expect(resourceFrom(local.snapshot.state, FIXTURE_IDS.resource).title).toBe(failedTitle);
  expect(await page.evaluate(() => window.hasUnsavedResourceWork())).toBe(true);

  await banner.locator(`[data-resource-save-retry="${FIXTURE_IDS.resource}"]`).click();
  await expect.poll(() => mainWriteAttempts).toBe(2);
  await expectSyncState(page, FIXTURE_IDS.resource, "error", /Error|저장하지 못함/i);
  await page.waitForTimeout(3_400);
  expect(mainWriteAttempts).toBe(2);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`)).toBeVisible();
  await expect(resourceTitle(page, FIXTURE_IDS.resource)).toHaveValue("E2E Notion Parity Resource");
  await expectSyncState(page, FIXTURE_IDS.resource, "saved", /Saved|저장됨/i);
  await expect(page.locator(`[data-resource-save-error="${FIXTURE_IDS.resource}"]`)).toHaveCount(0);
  await expect.poll(async () => (await readLocalPersistence(page)).operations.length).toBe(0);
  await page.waitForTimeout(3_400);
  expect(mainWriteAttempts).toBe(2);

  const unrelatedTitle = "Unrelated Resource still saves";
  await page.goto(`/resources/${encodeURIComponent(FIXTURE_IDS.bodySearchResource)}`);
  await expect(page.locator(`[data-resource-note="${FIXTURE_IDS.bodySearchResource}"]`)).toBeVisible();
  await resourceTitle(page, FIXTURE_IDS.bodySearchResource).fill(unrelatedTitle);
  await expect.poll(async () => resourceFrom((await fixtureSnapshot(request)).state, FIXTURE_IDS.bodySearchResource).title).toBe(unrelatedTitle);
  expect(mainWriteAttempts).toBe(2);

  local = await readLocalPersistence(page);
  expect(local.operations).toEqual([]);

  rejectMain = false;
  const correctedTitle = "Affected Resource valid follow-up";
  await page.goto(RESOURCE_PATH);
  await expect(resourceTitle(page, FIXTURE_IDS.resource)).toHaveValue("E2E Notion Parity Resource");
  await resourceTitle(page, FIXTURE_IDS.resource).fill(correctedTitle);
  await expect.poll(async () => resourceFrom((await fixtureSnapshot(request)).state, FIXTURE_IDS.resource).title).toBe(correctedTitle);
  await expectSyncState(page, FIXTURE_IDS.resource, "saved", /Saved|저장됨/i);
  await expect.poll(async () => (await readLocalPersistence(page)).operations.length).toBe(0);
  expect(mainWriteAttempts).toBe(3);
});

for (const status of [408, 425, 429, 503]) {
  test(`${status} is transient and retries with the queued payload`, async ({ page, request }) => {
    let attempts = 0;
    await page.route(`**/api/resources/${FIXTURE_IDS.resource}`, async (route) => {
      attempts += 1;
      if (attempts > 1) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status,
        contentType: "application/json",
        headers: { "Retry-After": "1", "x-state-revision": "1" },
        body: JSON.stringify({ error: "Please retry.", code: "RETRY_LATER", revision: 1 }),
      });
    });

    await openResource(page, FIXTURE_IDS.resource);
    const title = `Transient ${status}`;
    await resourceTitle(page, FIXTURE_IDS.resource).fill(title);
    await expectSyncState(page, FIXTURE_IDS.resource, "retrying", /Retrying|재시도/i);
    await expect.poll(async () => resourceFrom((await fixtureSnapshot(request)).state, FIXTURE_IDS.resource).title).toBe(title);
    expect(attempts).toBe(2);
    await expectSyncState(page, FIXTURE_IDS.resource, "saved", /Saved|저장됨/i);
  });
}

test("412 is a conflict and remains blocked without a retry loop", async ({ page }) => {
  let attempts = 0;
  await page.route(`**/api/resources/${FIXTURE_IDS.resource}`, async (route) => {
    attempts += 1;
    await route.fulfill({
      status: 412,
      contentType: "application/json",
      headers: { "x-state-revision": "1" },
      body: JSON.stringify({ error: "Precondition failed.", code: "STATE_PRECONDITION_FAILED", revision: 1 }),
    });
  });

  await openResource(page, FIXTURE_IDS.resource);
  await resourceTitle(page, FIXTURE_IDS.resource).fill("412 conflict title");
  await expectSyncState(page, FIXTURE_IDS.resource, "conflict", /Conflict|충돌/i);
  await expect(page.locator(`[data-resource-sync-conflict="${FIXTURE_IDS.resource}"]`)).toBeVisible();
  await page.waitForTimeout(3_400);
  expect(attempts).toBe(1);
  const local = await readLocalPersistence(page);
  expect(local.operations[0]?.status).toBe("conflict");
});

async function openResource(page, resourceId) {
  await page.goto("/");
  await openResources(page);
  await page.locator(`[data-open-resource="${resourceId}"]`).first().click();
  await expect(page.locator(`[data-resource-note="${resourceId}"]`)).toBeVisible();
  await expectSyncState(page, resourceId, "saved", /Saved|저장됨/i);
}

function resourceTitle(page, resourceId) {
  return page.locator(`[data-resource-title="${resourceId}"]`);
}

async function expectSyncState(page, resourceId, state, label) {
  const status = page.locator(`[data-resource-note="${resourceId}"] [data-resource-save-status]`);
  await expect(status).toHaveAttribute("data-sync-state", state);
  await expect(status).toContainText(label);
}

function resourceFrom(state, resourceId) {
  return state?.resources?.find((resource) => resource.id === resourceId);
}

async function readLocalPersistence(page) {
  return page.evaluate(async ({ databaseName, operationStore, snapshotStore, workspaceId }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed."));
    });
    const transaction = database.transaction([operationStore, snapshotStore], "readonly");
    const operations = await requestResult(transaction.objectStore(operationStore).getAll());
    const snapshot = await requestResult(transaction.objectStore(snapshotStore).get(workspaceId));
    await transactionComplete(transaction);
    database.close();
    return {
      operations: operations.filter((operation) => operation.workspaceId === workspaceId),
      snapshot,
    };

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
  }, {
    databaseName: LOCAL_DATABASE_NAME,
    operationStore: OPERATION_STORE,
    snapshotStore: SNAPSHOT_STORE,
    workspaceId: FIXTURE_IDS.appState,
  });
}
