import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const resetHeaders = { "x-e2e-reset-token": "sygma-local-e2e-reset" };

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("full-state writes cannot omit an existing Resource or mutate fixture state", async ({ request }) => {
  const before = await fixtureSnapshot(request);
  const incomingState = structuredClone(before.state);
  incomingState.resources = incomingState.resources.filter((resource) => resource.id !== FIXTURE_IDS.archivedResource);

  const response = await request.put("/api/state", {
    headers: {
      "Content-Type": "application/json",
      "If-Match": `"state-${before.serverRevision}"`,
    },
    data: { state: incomingState, baseRevision: before.serverRevision },
  });
  const payload = await response.json();

  expect(response.status()).toBe(422);
  expect(payload).toMatchObject({
    code: "RESOURCE_PERMANENT_DELETE_DISABLED",
    revision: before.serverRevision,
    details: { revision: before.serverRevision },
  });
  expect(payload.details?.issues).toContainEqual(expect.objectContaining({
    path: "state.resources",
    code: "resource_permanent_delete_disabled",
    missingResourceCount: 1,
    missingResourceIds: [FIXTURE_IDS.archivedResource],
  }));
  expect(response.headers().etag).toBe(`"state-${before.serverRevision}"`);
  expect(response.headers()["x-state-revision"]).toBe(String(before.serverRevision));

  const after = await fixtureSnapshot(request);
  expect(after.serverRevision).toBe(before.serverRevision);
  expect(after.state).toEqual(before.state);
  expect(after.writes).toEqual(before.writes);
  expect(after.writeAttempts).toHaveLength(before.writeAttempts.length + 1);
  expect(after.writeAttempts.at(-1)?.outcome).toBe("resource-permanent-delete-disabled");
});

test("incremental soft trash and restore remain writable and operator reset can replace fixture state", async ({ request }) => {
  const before = await fixtureSnapshot(request);
  const source = before.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource);
  const trashed = structuredClone(source);
  trashed.trashedAt = "2026-07-12T00:00:00.000Z";
  trashed.updatedAt = "2026-07-12T00:00:00.000Z";
  trashed.revision = Number(trashed.revision || 0) + 1;

  const trashResponse = await request.put(`/api/resources/${encodeURIComponent(trashed.id)}`, {
    headers: { "Content-Type": "application/json", "If-Match": '"state-1"' },
    data: { resource: trashed, baseRevision: 1 },
  });
  expect(trashResponse.ok()).toBeTruthy();
  expect((await trashResponse.json()).revision).toBe(2);

  const restored = structuredClone(trashed);
  restored.trashedAt = "";
  restored.updatedAt = "2026-07-12T00:01:00.000Z";
  restored.revision += 1;
  const restoreResponse = await request.put(`/api/resources/${encodeURIComponent(restored.id)}`, {
    headers: { "Content-Type": "application/json", "If-Match": '"state-2"' },
    data: { resource: restored, baseRevision: 2 },
  });
  expect(restoreResponse.ok()).toBeTruthy();
  expect((await restoreResponse.json()).revision).toBe(3);

  const afterRestore = await fixtureSnapshot(request);
  expect(afterRestore.state.resources.find((resource) => resource.id === restored.id)?.trashedAt).toBe("");

  const extra = {
    ...structuredClone(restored),
    id: "fixture-resource-operator-reset-extra",
    title: "Operator reset extra Resource",
    parentId: "",
    childOrder: [],
    commentThreads: [],
    blocks: [{ id: "fixture-resource-operator-reset-extra-block", type: "paragraph", text: "Extra", indent: 0, marks: [] }],
  };
  const createResponse = await request.put(`/api/resources/${encodeURIComponent(extra.id)}`, {
    headers: { "Content-Type": "application/json", "If-Match": '"state-3"' },
    data: { resource: extra, baseRevision: 3 },
  });
  expect(createResponse.ok()).toBeTruthy();
  expect((await createResponse.json()).revision).toBe(4);
  expect((await fixtureSnapshot(request)).state.resources.some((resource) => resource.id === extra.id)).toBe(true);

  const resetResponse = await request.post("/__e2e__/reset", { headers: resetHeaders });
  expect(resetResponse.ok()).toBeTruthy();
  const afterReset = await fixtureSnapshot(request);
  expect(afterReset.serverRevision).toBe(1);
  expect(afterReset.state.resources.some((resource) => resource.id === extra.id)).toBe(false);
  expect(afterReset.state.resources.some((resource) => resource.id === FIXTURE_IDS.resource)).toBe(true);
});

test("the UI supplements example data without deleting existing Resources or entering a 422 retry loop", async ({ page, request }) => {
  const before = await fixtureSnapshot(request);
  const existingResources = structuredClone(before.state.resources);

  await page.goto("/");
  const navToggle = page.locator('[data-action="toggle-nav"]');
  if (await navToggle.isVisible()) await navToggle.click();
  await page.locator('[data-nav-key="database"]').click();
  const supplement = page.getByRole("button", { name: "통계 예제 데이터 보충" });
  await expect(supplement).toBeVisible();
  await supplement.click();
  await expect(page.locator("#toast")).toContainText("기존 데이터를 유지하고 통계 예제 데이터를 보충했습니다.");

  await expect.poll(async () => (await fixtureSnapshot(request)).serverRevision).toBeGreaterThan(before.serverRevision);
  const after = await fixtureSnapshot(request);
  const resourcesById = new Map(after.state.resources.map((resource) => [resource.id, resource]));
  for (const existing of existingResources) expect(resourcesById.get(existing.id)).toEqual(existing);
  expect(after.state.resources.length).toBeGreaterThanOrEqual(existingResources.length);
  expect(after.writeAttempts.slice(before.writeAttempts.length).map((attempt) => attempt.outcome)).toEqual(["saved"]);
  expect(after.writeAttempts.some((attempt) => attempt.outcome === "resource-permanent-delete-disabled")).toBe(false);
  await expect(page.locator("[data-database-sync-status]")).not.toContainText(/retry|재시도/i);
});
