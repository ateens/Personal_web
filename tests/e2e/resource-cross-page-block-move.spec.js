import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const COLLISION_RESOURCE_ID = "fixture-resource-collision-move-target";
const SOURCE_REPLY_ID = "fixture-source-move-reply";
const TARGET_THREAD_ID = "fixture-target-move-thread";
const TARGET_REPLY_ID = "fixture-target-move-reply";

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
  await seedCollisionTarget(request);
});

async function seedCollisionTarget(request) {
  const response = await request.get("/api/state");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  const baseRevision = Number(response.headers()["x-state-revision"] || payload.revision);
  const template = payload.state.resources.find((resource) => resource.id === FIXTURE_IDS.bodySearchResource);
  const source = payload.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource);
  source.commentThreads[0].replies.push({
    id: SOURCE_REPLY_ID,
    body: "Source reply used to validate the global ID namespace",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    deletedAt: "",
  });
  payload.state.resources.push({
    ...structuredClone(template),
    id: COLLISION_RESOURCE_ID,
    title: "Collision Move Target",
    parentId: "",
    childOrder: [],
    updatedAt: "2026-07-11T00:00:01.000Z",
    revision: 8,
    blocks: [{
      id: `${COLLISION_RESOURCE_ID}-paragraph`,
      type: "paragraph",
      text: "Collision Move Target body",
      marks: [],
      checked: false,
      indent: 0,
      collapsed: false,
    }],
    commentThreads: [{
      id: TARGET_THREAD_ID,
      scope: "page",
      anchor: null,
      body: "Target thread used to validate the global ID namespace",
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
      resolvedAt: "",
      deletedAt: "",
      replies: [{
        id: TARGET_REPLY_ID,
        body: "Target reply used to validate the global ID namespace",
        createdAt: "2026-07-11T00:00:00.000Z",
        updatedAt: "2026-07-11T00:00:00.000Z",
        deletedAt: "",
      }],
    }],
    readOnly: false,
    locked: false,
    trashedAt: "",
  });
  const write = await request.put("/api/state", {
    headers: { "If-Match": `"state-${baseRevision}"` },
    data: { state: payload.state, baseRevision },
  });
  expect(write.ok()).toBeTruthy();
}

async function expectDuplicateWriteRejected(request, mode, mutate) {
  const before = await fixtureSnapshot(request);
  const draft = structuredClone(before.state);
  mutate(draft);
  const target = draft.resources.find((resource) => resource.id === COLLISION_RESOURCE_ID);
  const response = mode === "full"
    ? await request.put("/api/state", {
      headers: { "If-Match": `"state-${before.serverRevision}"` },
      data: { state: draft, baseRevision: before.serverRevision },
    })
    : await request.put(`/api/resources/${encodeURIComponent(COLLISION_RESOURCE_ID)}`, {
      headers: { "If-Match": `"state-${before.serverRevision}"` },
      data: { resource: target, baseRevision: before.serverRevision },
    });
  expect(response.status()).toBe(422);
  const payload = await response.json();
  expect(payload.code).toBe("INVALID_STATE");
  expect(payload.details?.issues?.some((issue) => issue.code === "duplicate_id")).toBe(true);
  const after = await fixtureSnapshot(request);
  expect(after.serverRevision).toBe(before.serverRevision);
  expect(after.state).toEqual(before.state);
}

test("fixture rejects cross-Resource duplicate block, comment-thread, and reply IDs on full and incremental writes", async ({ request }) => {
  const duplicateMutations = [
    (draft) => {
      const source = draft.resources.find((resource) => resource.id === FIXTURE_IDS.resource);
      const target = draft.resources.find((resource) => resource.id === COLLISION_RESOURCE_ID);
      target.blocks[0].id = source.blocks[0].id;
    },
    (draft) => {
      const source = draft.resources.find((resource) => resource.id === FIXTURE_IDS.resource);
      const target = draft.resources.find((resource) => resource.id === COLLISION_RESOURCE_ID);
      target.commentThreads[0].id = source.commentThreads[0].id;
    },
    (draft) => {
      const target = draft.resources.find((resource) => resource.id === COLLISION_RESOURCE_ID);
      target.commentThreads[0].replies[0].id = SOURCE_REPLY_ID;
    },
  ];
  for (const mode of ["full", "incremental"]) {
    for (const mutate of duplicateMutations) await expectDuplicateWriteRejected(request, mode, mutate);
  }
});

test("incremental writes cannot create a childOrder link before the child points at that parent", async ({ request }) => {
  const before = await fixtureSnapshot(request);
  const seededState = structuredClone(before.state);
  const oldParent = seededState.resources.find((resource) => resource.id === FIXTURE_IDS.titleSearchResource);
  const newParent = seededState.resources.find((resource) => resource.id === FIXTURE_IDS.bodySearchResource);
  const moved = seededState.resources.find((resource) => resource.id === FIXTURE_IDS.resource);
  oldParent.childOrder = [moved.id];
  newParent.childOrder = [];
  moved.parentId = oldParent.id;

  const seed = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state: seededState, baseRevision: before.serverRevision },
  });
  expect(seed.ok()).toBeTruthy();

  const seeded = await fixtureSnapshot(request);
  const unsafeNewParent = structuredClone(
    seeded.state.resources.find((resource) => resource.id === FIXTURE_IDS.bodySearchResource),
  );
  unsafeNewParent.childOrder = [FIXTURE_IDS.resource];
  const unsafeWrite = await request.put(`/api/resources/${encodeURIComponent(unsafeNewParent.id)}`, {
    headers: { "If-Match": `"state-${seeded.serverRevision}"` },
    data: { resource: unsafeNewParent, baseRevision: seeded.serverRevision },
  });

  expect(unsafeWrite.status()).toBe(422);
  expect(await unsafeWrite.json()).toMatchObject({
    code: "INVALID_STATE",
    revision: seeded.serverRevision,
    details: { issues: expect.arrayContaining([expect.objectContaining({ code: "invalid_child_parent" })]) },
  });
  const after = await fixtureSnapshot(request);
  expect(after.serverRevision).toBe(seeded.serverRevision);
  expect(after.state).toEqual(seeded.state);
  expect(after.writeAttempts.at(-1)?.outcome).toBe("invalid-state");
});
