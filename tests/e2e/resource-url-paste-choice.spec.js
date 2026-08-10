import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("server rejects an unsafe bookmark URL without changing revision or stored state", async ({ request }) => {
  const before = await fixtureSnapshot(request);
  const draft = structuredClone(before.state);
  const resource = draft.resources.find((entry) => entry.id === FIXTURE_IDS.resource);
  resource.blocks[0] = {
    ...resource.blocks[0],
    type: "bookmark",
    text: "javascript:alert(1)",
    url: "javascript:alert(1)",
    marks: [],
  };

  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state: draft, baseRevision: before.serverRevision },
  });
  expect(response.status()).toBe(422);
  const payload = await response.json();
  expect(payload.code).toBe("INVALID_STATE");
  expect(payload.details?.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "unsafe_block_url" }),
  ]));

  const after = await fixtureSnapshot(request);
  expect(after.serverRevision).toBe(before.serverRevision);
  expect(after.state).toEqual(before.state);
});
