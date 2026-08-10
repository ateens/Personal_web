import { expect, test } from "@playwright/test";
import { resetFixture } from "./helpers.js";

const LOCAL_DATABASE_NAME = "sygma-resource-local-v1";

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
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

  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
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
    stores: ["operations", "snapshots"],
  });
});
