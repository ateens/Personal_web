import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("server rejects a non-boolean locked field without changing state", async ({ request }) => {
  const before = await fixtureSnapshot(request);
  const invalid = structuredClone(before.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource));
  invalid.locked = "true";
  invalid.revision += 1;

  const response = await request.put(`/api/resources/${encodeURIComponent(FIXTURE_IDS.resource)}`, {
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
});
