import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

function fixtureInlineThread(resource) {
  return resource.commentThreads.find((thread) => thread.id === FIXTURE_IDS.inlineThread);
}

function fixtureInlineMarkLocation(resource) {
  for (const block of resource.blocks) {
    const markIndex = (block.marks || []).findIndex((mark) => mark.type === "comment" && mark.commentId === FIXTURE_IDS.inlineThread);
    if (markIndex >= 0) return { block, mark: block.marks[markIndex], markIndex };
  }
  return null;
}

async function expectCommentReferenceWriteRejected(request, mode, mutate, expectedIssueCode) {
  const before = await fixtureSnapshot(request);
  const draft = structuredClone(before.state);
  const resource = draft.resources.find((entry) => entry.id === FIXTURE_IDS.resource);
  mutate(resource);
  const response = mode === "full"
    ? await request.put("/api/state", {
      headers: { "If-Match": `"state-${before.serverRevision}"` },
      data: { state: draft, baseRevision: before.serverRevision },
    })
    : await request.put(`/api/resources/${encodeURIComponent(resource.id)}`, {
      headers: { "If-Match": `"state-${before.serverRevision}"` },
      data: { resource, baseRevision: before.serverRevision },
    });
  expect(response.status(), `${mode} write should reject ${expectedIssueCode}`).toBe(422);
  const payload = await response.json();
  expect(payload.code).toBe("INVALID_STATE");
  expect(payload.details?.issues, `${mode} write should report ${expectedIssueCode}`).toContainEqual(
    expect.objectContaining({ code: expectedIssueCode }),
  );
  const after = await fixtureSnapshot(request);
  expect(after.serverRevision).toBe(before.serverRevision);
  expect(after.state).toEqual(before.state);
  expect(after.writes).toEqual(before.writes);
  expect(after.writeAttempts).toHaveLength(before.writeAttempts.length + 1);
  expect(after.writeAttempts.at(-1)?.outcome).toBe("invalid-state");
}

test("full and incremental writes reject orphaned, missing, duplicate, or mismatched comment references without mutation", async ({ request }) => {
  const invalidCases = [
    {
      code: "orphan_comment_mark",
      mutate(resource) {
        fixtureInlineMarkLocation(resource).mark.commentId = "fixture-missing-comment-thread";
      },
    },
    {
      code: "missing_comment_mark",
      mutate(resource) {
        const { block, markIndex } = fixtureInlineMarkLocation(resource);
        block.marks.splice(markIndex, 1);
      },
    },
    {
      code: "comment_anchor_mismatch",
      mutate(resource) {
        fixtureInlineMarkLocation(resource).mark.start += 1;
      },
    },
    {
      code: "duplicate_comment_mark",
      mutate(resource) {
        const { block, mark } = fixtureInlineMarkLocation(resource);
        block.marks.push(structuredClone(mark));
      },
    },
    {
      code: "comment_body_mismatch",
      mutate(resource) {
        fixtureInlineMarkLocation(resource).mark.body = "A different inline discussion";
      },
    },
    {
      code: "deleted_comment_mark",
      mutate(resource) {
        fixtureInlineThread(resource).deletedAt = "2026-07-12T00:00:00.000Z";
      },
    },
    {
      code: "non_inline_comment_mark",
      mutate(resource) {
        const thread = fixtureInlineThread(resource);
        thread.formerAnchor = structuredClone(thread.anchor);
        thread.scope = "page";
        thread.anchor = null;
        thread.anchorLostAt = "2026-07-12T00:00:00.000Z";
      },
    },
    {
      code: "duplicate_id",
      mutate(resource) {
        const duplicate = structuredClone(resource.commentThreads.find((thread) => thread.id === FIXTURE_IDS.pageThread));
        duplicate.id = FIXTURE_IDS.inlineThread;
        resource.commentThreads.push(duplicate);
      },
    },
  ];

  for (const mode of ["full", "incremental"]) {
    for (const invalidCase of invalidCases) {
      await expectCommentReferenceWriteRejected(request, mode, invalidCase.mutate, invalidCase.code);
    }
  }
});

test("table cell marks and comments reject invalid coordinates, ranges and cross-cell anchors", async ({ request }) => {
  const before = await fixtureSnapshot(request);
  const resource = structuredClone(before.state.resources.find((entry) => entry.id === FIXTURE_IDS.resource));
  const { block, mark, markIndex } = fixtureInlineMarkLocation(resource);
  const text = block.text;
  block.marks.splice(markIndex, 1);
  resource.blocks.push({ id: "inline-comment-table", type: "table", text: `| Heading | Other |\n| --- | --- |\n| ${text} | ${text} |`, marks: [], checked: false, indent: 0, collapsed: false, tableCellMarks: { "1:0": [mark] } });
  fixtureInlineThread(resource).anchor = { ...fixtureInlineThread(resource).anchor, blockId: "inline-comment-table", tableRow: 1, tableColumn: 0 };
  const response = await request.put(`/api/resources/${encodeURIComponent(resource.id)}`, {
    headers: { "If-Match": `"state-${before.serverRevision}"` }, data: { resource, baseRevision: before.serverRevision },
  });
  expect(response.ok()).toBeTruthy();
  const table = (entry) => entry.blocks.find((candidate) => candidate.id === "inline-comment-table");
  const cases = [
    ["invalid_table_cell_coordinate", (entry) => { table(entry).tableCellMarks["99:0"] = []; }],
    ["invalid_table_cell_coordinate", (entry) => { table(entry).tableCellMarks["01:0"] = []; }],
    ["invalid_marks", (entry) => { table(entry).tableCellMarks["0:0"] = {}; }],
    ["invalid_mark_range", (entry) => { table(entry).tableCellMarks["1:0"][0].end = text.length + 1; }],
    ["invalid_comment_cell", (entry) => { delete fixtureInlineThread(entry).anchor.tableColumn; }],
    ["comment_anchor_mismatch", (entry) => { fixtureInlineThread(entry).anchor.tableColumn = 1; }],
    ["orphan_comment_mark", (entry) => { table(entry).tableCellMarks["1:0"][0].commentId = "missing-cell-comment"; }],
  ];
  for (const mode of ["full", "incremental"]) {
    for (const [code, mutate] of cases) await expectCommentReferenceWriteRejected(request, mode, mutate, code);
  }
});

test("trim-equivalent bodies, deleted threads without marks, and lost page threads without marks remain valid", async ({ request }) => {
  let before = await fixtureSnapshot(request);
  let resource = structuredClone(before.state.resources.find((entry) => entry.id === FIXTURE_IDS.resource));
  fixtureInlineThread(resource).body = "  Existing inline thread ";
  fixtureInlineMarkLocation(resource).mark.body = " Existing inline thread  ";
  let response = await request.put(`/api/resources/${encodeURIComponent(resource.id)}`, {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { resource, baseRevision: before.serverRevision },
  });
  expect(response.ok()).toBeTruthy();

  before = await fixtureSnapshot(request);
  resource = structuredClone(before.state.resources.find((entry) => entry.id === FIXTURE_IDS.resource));
  const deletedThread = fixtureInlineThread(resource);
  const formerAnchor = structuredClone(deletedThread.anchor);
  deletedThread.deletedAt = "2026-07-12T00:01:00.000Z";
  const { block, markIndex } = fixtureInlineMarkLocation(resource);
  block.marks.splice(markIndex, 1);
  resource.commentThreads.push({
    id: "fixture-thread-lost-page",
    scope: "page",
    anchor: null,
    formerAnchor,
    anchorLostAt: "2026-07-12T00:01:00.000Z",
    body: "Lost anchor discussion",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:01:00.000Z",
    resolvedAt: "",
    deletedAt: "",
    replies: [],
  });
  response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: {
      state: {
        ...structuredClone(before.state),
        resources: before.state.resources.map((entry) => entry.id === resource.id ? resource : structuredClone(entry)),
      },
      baseRevision: before.serverRevision,
    },
  });
  expect(response.ok()).toBeTruthy();
  const after = await fixtureSnapshot(request);
  const stored = after.state.resources.find((entry) => entry.id === resource.id);
  expect(fixtureInlineThread(stored).deletedAt).not.toBe("");
  expect(fixtureInlineMarkLocation(stored)).toBeNull();
  expect(stored.commentThreads.find((thread) => thread.id === "fixture-thread-lost-page")).toMatchObject({
    scope: "page",
    anchor: null,
    formerAnchor,
  });
});
