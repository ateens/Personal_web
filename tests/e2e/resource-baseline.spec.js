import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("production guard uses only the isolated in-memory state", async ({ request }) => {
  const status = await request.get("/api/state/status");
  expect(status.ok()).toBeTruthy();
  expect(status.headers()["x-e2e-fixture"]).toBe("memory-only");
  expect(status.headers()["x-e2e-production-write-guard"]).toBe("active");
  expect(await status.json()).toMatchObject({
    appStateId: FIXTURE_IDS.appState,
    tokenStore: "memory",
    relationalStore: "memory",
  });

  const snapshot = await fixtureSnapshot(request);
  expect(snapshot).toMatchObject({
    backend: "memory",
    databaseAccess: false,
    productionWritesBlocked: true,
    appStateId: FIXTURE_IDS.appState,
    serverRevision: 1,
    writes: [],
  });
  expect(snapshot.appStateId).not.toBe("default");

  const stateResponse = await request.get("/api/state");
  const etag = stateResponse.headers().etag;
  expect(etag).toBe('"state-1"');
  const current = await stateResponse.json();
  const conditionalWrite = await request.put("/api/state", {
    headers: { "If-Match": etag },
    data: { state: current.state, baseRevision: 1 },
  });
  expect(conditionalWrite.status()).toBe(200);
  expect(conditionalWrite.headers().etag).toBe('"state-2"');

  const staleWrite = await request.put("/api/state", {
    headers: { "If-Match": etag },
    data: { state: current.state, baseRevision: 1 },
  });
  expect(staleWrite.status()).toBe(409);
  expect(await staleWrite.json()).toMatchObject({ code: "STATE_REVISION_CONFLICT", revision: 2 });
});

test("fixture generation rejects pre-reset stale writes before revision checks", async ({ request }) => {
  const first = await fixtureSnapshot(request);
  expect(first.serverRevision).toBe(1);
  expect(Number.isSafeInteger(first.resetGeneration)).toBeTruthy();

  await resetFixture(request);
  const reset = await fixtureSnapshot(request);
  expect(reset.serverRevision).toBe(1);
  expect(reset.resetGeneration).toBeGreaterThan(first.resetGeneration);

  const staleState = structuredClone(first.state);
  staleState.updatedAt = "2026-07-12T00:00:00.000Z";
  const staleWrite = await request.put("/api/state", {
    headers: { "If-Match": `"state-${first.serverRevision}"` },
    data: {
      state: staleState,
      baseRevision: first.serverRevision,
      e2eFixtureGeneration: first.resetGeneration,
    },
  });
  expect(staleWrite.status()).toBe(409);
  expect(await staleWrite.json()).toMatchObject({
    code: "E2E_FIXTURE_GENERATION_CONFLICT",
    revision: 1,
    resetGeneration: reset.resetGeneration,
  });

  const afterStale = await fixtureSnapshot(request);
  expect(afterStale.serverRevision).toBe(1);
  expect(afterStale.writes).toEqual([]);
  expect(afterStale.state).toEqual(reset.state);
  expect(afterStale.writeAttempts.at(-1)).toMatchObject({
    baseRevision: 1,
    suppliedGeneration: first.resetGeneration,
    resetGeneration: reset.resetGeneration,
    outcome: "generation-conflict",
  });

  const currentResource = structuredClone(reset.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource));
  currentResource.title = "Current generation write succeeds";
  const currentWrite = await request.put(`/api/resources/${encodeURIComponent(currentResource.id)}`, {
    headers: { "If-Match": `"state-${reset.serverRevision}"` },
    data: {
      resource: currentResource,
      baseRevision: reset.serverRevision,
      e2eFixtureGeneration: reset.resetGeneration,
    },
  });
  expect(currentWrite.status()).toBe(200);
  expect(await currentWrite.json()).toMatchObject({ revision: 2 });
  const afterCurrent = await fixtureSnapshot(request);
  expect(afterCurrent.serverRevision).toBe(2);
  expect(afterCurrent.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource)?.title).toBe("Current generation write succeeds");
});
