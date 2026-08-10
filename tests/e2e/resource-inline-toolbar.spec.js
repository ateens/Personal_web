import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const PARAGRAPH_ID = "fixture-block-paragraph";

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("server rejects arbitrary inline color payloads without mutating state", async ({ request }) => {
  const before = await fixtureSnapshot(request);
  const incomingState = structuredClone(before.state);
  const block = incomingState.resources
    .find((resource) => resource.id === FIXTURE_IDS.resource)
    ?.blocks.find((entry) => entry.id === PARAGRAPH_ID);
  block.marks = [{ type: "textColor", start: 0, end: 5, color: "url-javascript" }];

  const response = await request.put("/api/state", {
    headers: {
      "Content-Type": "application/json",
      "If-Match": `"state-${before.serverRevision}"`,
    },
    data: { state: incomingState, baseRevision: before.serverRevision },
  });
  const payload = await response.json();
  expect(response.status()).toBe(422);
  expect(payload.code).toBe("INVALID_STATE");
  expect(payload.details?.issues).toContainEqual(expect.objectContaining({
    path: expect.stringMatching(/\.marks\[0\]\.color$/),
    code: "unsupported_inline_color",
  }));
  const after = await fixtureSnapshot(request);
  expect(after.serverRevision).toBe(before.serverRevision);
  expect(after.state).toEqual(before.state);
});
