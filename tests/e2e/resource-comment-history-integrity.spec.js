import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const CUSTOM_BLOCK_MIME = "application/x-sygma-blocks";
const INTEGRITY_RESOURCE_ID = "fixture-resource-comment-integrity";
const PERSISTENCE_TIMEOUT_MS = 20_000;

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

function note(page, resourceId = FIXTURE_IDS.resource) {
  return page.locator(`[data-resource-note="${resourceId}"]`);
}

function editor(page, resourceId = FIXTURE_IDS.resource) {
  return note(page, resourceId).locator(`.block-editor[data-owner-type="resources"][data-owner-id="${resourceId}"]`);
}

function content(page, blockId, resourceId = FIXTURE_IDS.resource) {
  return editor(page, resourceId).locator(`[data-block-content="${blockId}"]`);
}

async function openResource(page, resourceId = FIXTURE_IDS.resource) {
  await page.goto(`/resources/${encodeURIComponent(resourceId)}`);
  await expect(note(page, resourceId)).toBeVisible();
}

async function resourceState(request, resourceId = FIXTURE_IDS.resource) {
  const snapshot = await fixtureSnapshot(request);
  return snapshot.state.resources.find((resource) => resource.id === resourceId);
}

async function threadState(request, threadId, resourceId = FIXTURE_IDS.resource) {
  return (await resourceState(request, resourceId))?.commentThreads?.find((thread) => thread.id === threadId);
}

async function selectTextRange(locator, start, end) {
  await locator.evaluate((element, range) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const selection = window.getSelection();
    const domRange = document.createRange();
    let offset = 0;
    let startNode = null;
    let startOffset = 0;
    let endNode = null;
    let endOffset = 0;
    let node = walker.nextNode();
    while (node) {
      const nextOffset = offset + node.textContent.length;
      if (!startNode && range.start <= nextOffset) {
        startNode = node;
        startOffset = Math.max(0, range.start - offset);
      }
      if (!endNode && range.end <= nextOffset) {
        endNode = node;
        endOffset = Math.max(0, range.end - offset);
        break;
      }
      offset = nextOffset;
      node = walker.nextNode();
    }
    startNode ||= element;
    endNode ||= startNode;
    domRange.setStart(startNode, startNode === element ? 0 : startOffset);
    domRange.setEnd(endNode, endNode === element ? 0 : endOffset);
    selection.removeAllRanges();
    selection.addRange(domRange);
    element.focus();
    element.dispatchEvent(new Event("select", { bubbles: true }));
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  }, { start, end });
}

async function selectBlock(page, blockId, resourceId = FIXTURE_IDS.resource) {
  const target = content(page, blockId, resourceId);
  await target.focus();
  await target.press("Escape");
  await expect(editor(page, resourceId).locator(`[data-block-id="${blockId}"]`)).toHaveClass(/is-selected/);
}

async function dispatchClipboardEvent(target, type, values = {}) {
  return target.evaluate((element, payload) => {
    const transfer = new DataTransfer();
    for (const [mime, value] of Object.entries(payload.values)) transfer.setData(mime, value);
    const event = new ClipboardEvent(payload.type, { bubbles: true, cancelable: true, clipboardData: transfer });
    element.dispatchEvent(event);
    return {
      defaultPrevented: event.defaultPrevented,
      data: Object.fromEntries([...transfer.types].map((mime) => [mime, transfer.getData(mime)])),
    };
  }, { type, values });
}

function commentThread(id, body, blockId, start, end) {
  return {
    id,
    scope: "inline",
    anchor: { blockId, start, end },
    body,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    resolvedAt: "",
    deletedAt: "",
    replies: [],
  };
}

function commentBlock(id, text, threadId, body, start, end) {
  return {
    id,
    type: "paragraph",
    text,
    marks: [{ type: "comment", start, end, commentId: threadId, body }],
    checked: false,
    indent: 0,
    collapsed: false,
  };
}

async function seedIntegrityResource(request) {
  const response = await request.get("/api/state");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  const baseRevision = Number(response.headers()["x-state-revision"] || payload.revision);
  const template = payload.state.resources.find((resource) => resource.id === FIXTURE_IDS.bodySearchResource);
  const resource = {
    ...structuredClone(template),
    id: INTEGRITY_RESOURCE_ID,
    title: "Comment Anchor Integrity",
    parentId: "",
    childOrder: [],
    revision: 1,
    updatedAt: "2026-07-11T00:00:00.000Z",
    blocks: [
      { id: "anchor-back-previous", type: "paragraph", text: "Previous ", marks: [], checked: false, indent: 0, collapsed: false },
      commentBlock("anchor-back", "Backspace anchor", "thread-back", "Backspace discussion", 0, 9),
      { id: "anchor-delete-current", type: "paragraph", text: "Current ", marks: [], checked: false, indent: 0, collapsed: false },
      commentBlock("anchor-delete-next", "Delete anchor", "thread-delete", "Delete discussion", 0, 6),
      commentBlock("anchor-selected", "Selected anchor", "thread-selected", "Selected discussion", 0, 8),
      commentBlock("anchor-slash", "Slash anchor", "thread-slash", "Slash discussion", 0, 5),
    ],
    commentThreads: [
      commentThread("thread-back", "Backspace discussion", "anchor-back", 0, 9),
      commentThread("thread-delete", "Delete discussion", "anchor-delete-next", 0, 6),
      commentThread("thread-selected", "Selected discussion", "anchor-selected", 0, 8),
      commentThread("thread-slash", "Slash discussion", "anchor-slash", 0, 5),
    ],
  };
  const write = await request.put(`/api/resources/${encodeURIComponent(INTEGRITY_RESOURCE_ID)}`, {
    headers: { "If-Match": `"state-${baseRevision}"` },
    data: { resource, baseRevision },
  });
  expect(write.ok()).toBeTruthy();
}

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

test("inline comment creation and page discussion lifecycle are atomic undo/redo history entries", async ({ page, request }) => {
  await openResource(page);
  const paragraph = content(page, "fixture-block-paragraph");
  await selectTextRange(paragraph, 0, 9);
  await page.locator('[data-inline-mark-toggle="comment"]').click();
  await page.locator("[data-inline-comment-input]").fill("Undoable inline discussion");
  await page.locator("[data-inline-comment-apply]").click();

  let inlineThreadId = "";
  await expect.poll(async () => {
    const resource = await resourceState(request);
    inlineThreadId = resource.commentThreads.find((thread) => thread.body === "Undoable inline discussion")?.id || "";
    return inlineThreadId;
  }).not.toBe("");
  await page.keyboard.press("Meta+z");
  await expect(paragraph.locator(`[data-inline-comment-id="${inlineThreadId}"]`)).toHaveCount(0);
  await expect.poll(
    async () => Boolean(await threadState(request, inlineThreadId)),
    { timeout: PERSISTENCE_TIMEOUT_MS },
  ).toBe(false);
  await page.keyboard.press("Meta+Shift+z");
  await expect(paragraph.locator(`[data-inline-comment-id="${inlineThreadId}"]`)).toHaveCount(1);
  await expect.poll(
    async () => (await threadState(request, inlineThreadId))?.anchor,
    { timeout: PERSISTENCE_TIMEOUT_MS },
  ).toEqual({
    blockId: "fixture-block-paragraph",
    start: 0,
    end: 9,
  });

  await note(page).locator(`[data-resource-comments-toggle="${FIXTURE_IDS.resource}"]`).first().click();
  const pane = page.locator(`[data-resource-comments-pane="${FIXTURE_IDS.resource}"]`);
  const composer = pane.locator(`[data-page-discussion-composer="${FIXTURE_IDS.resource}"]`);
  await composer.fill("Undoable page discussion");
  await pane.locator(`[data-page-discussion-submit="${FIXTURE_IDS.resource}"]`).click();
  let pageThreadId = "";
  await expect.poll(async () => {
    pageThreadId = (await resourceState(request)).commentThreads.find((thread) => thread.body === "Undoable page discussion")?.id || "";
    return pageThreadId;
  }).not.toBe("");
  await page.keyboard.press("Meta+z");
  await expect(pane.locator(`[data-comment-thread="${pageThreadId}"]`)).toHaveCount(0);
  await expect.poll(
    async () => Boolean(await threadState(request, pageThreadId)),
    { timeout: PERSISTENCE_TIMEOUT_MS },
  ).toBe(false);
  await page.keyboard.press("Meta+Shift+z");
  await expect(pane.locator(`[data-comment-thread="${pageThreadId}"]`)).toHaveCount(1);
  await expect.poll(
    async () => (await threadState(request, pageThreadId))?.scope,
    { timeout: PERSISTENCE_TIMEOUT_MS },
  ).toBe("page");

  let thread = pane.locator(`[data-comment-thread="${FIXTURE_IDS.pageThread}"]`);
  await thread.locator(`[data-comment-reply-input="${FIXTURE_IDS.pageThread}"]`).fill("Undoable reply");
  await thread.locator(`[data-comment-reply-submit="${FIXTURE_IDS.pageThread}"]`).click();
  await expect.poll(async () => (await threadState(request, FIXTURE_IDS.pageThread))?.replies.length).toBe(1);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await threadState(request, FIXTURE_IDS.pageThread))?.replies.length).toBe(0);
  await page.keyboard.press("Meta+Shift+z");
  await expect.poll(async () => (await threadState(request, FIXTURE_IDS.pageThread))?.replies.length).toBe(1);

  thread = pane.locator(`[data-comment-thread="${FIXTURE_IDS.pageThread}"]`);
  await thread.locator(`[data-comment-resolve="${FIXTURE_IDS.pageThread}"]`).click();
  await expect.poll(async () => Boolean((await threadState(request, FIXTURE_IDS.pageThread))?.resolvedAt)).toBe(true);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await threadState(request, FIXTURE_IDS.pageThread))?.resolvedAt).toBe("");
  await page.keyboard.press("Meta+Shift+z");
  await expect.poll(async () => Boolean((await threadState(request, FIXTURE_IDS.pageThread))?.resolvedAt)).toBe(true);

  thread = pane.locator(`[data-comment-thread="${FIXTURE_IDS.pageThread}"]`);
  await thread.locator(`[data-comment-delete="${FIXTURE_IDS.pageThread}"]`).click();
  await expect.poll(async () => Boolean((await threadState(request, FIXTURE_IDS.pageThread))?.deletedAt)).toBe(true);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await threadState(request, FIXTURE_IDS.pageThread))?.deletedAt).toBe("");
  await page.keyboard.press("Meta+Shift+z");
  await expect.poll(async () => Boolean((await threadState(request, FIXTURE_IDS.pageThread))?.deletedAt)).toBe(true);
});

test("text edits rebase an inline anchor and complete mark deletion preserves the discussion as lost", async ({ page, request }) => {
  await openResource(page);
  const inline = content(page, FIXTURE_IDS.inlineBlock);
  await selectTextRange(inline, 0, 0);
  await page.keyboard.type("XY");
  await expect.poll(async () => (await threadState(request, FIXTURE_IDS.inlineThread))?.anchor).toEqual({
    blockId: FIXTURE_IDS.inlineBlock,
    start: 41,
    end: 48,
  });

  await selectTextRange(inline, 41, 48);
  await page.keyboard.press("Backspace");
  await expect.poll(async () => {
    const thread = await threadState(request, FIXTURE_IDS.inlineThread);
    return {
      scope: thread?.scope,
      anchor: thread?.anchor,
      formerAnchor: thread?.formerAnchor,
      lost: Boolean(thread?.anchorLostAt),
    };
  }).toEqual({
    scope: "page",
    anchor: null,
    formerAnchor: { blockId: FIXTURE_IDS.inlineBlock, start: 41, end: 48 },
    lost: true,
  });

  await page.reload();
  await note(page).locator(`[data-resource-comments-toggle="${FIXTURE_IDS.resource}"]`).first().click();
  const lostThread = page.locator(`[data-comment-thread="${FIXTURE_IDS.inlineThread}"]`);
  await expect(lostThread).toHaveAttribute("data-comment-scope", "page");
  await expect(lostThread.locator(".resource-comment-meta span")).toContainText("Anchor lost");
  const snapshot = await fixtureSnapshot(request);
  expect(snapshot.writeAttempts.some((attempt) => attempt.outcome === "invalid-state")).toBe(false);
});

test("merge, selected removal, slash replacement, and divider conversion keep every thread server-valid", async ({ page, request }) => {
  await seedIntegrityResource(request);
  await openResource(page, INTEGRITY_RESOURCE_ID);

  await selectTextRange(content(page, "anchor-back", INTEGRITY_RESOURCE_ID), 0, 0);
  await page.keyboard.press("Backspace");
  await expect.poll(async () => (await threadState(request, "thread-back", INTEGRITY_RESOURCE_ID))?.anchor).toEqual({
    blockId: "anchor-back-previous",
    start: 9,
    end: 18,
  });

  const deleteCurrent = content(page, "anchor-delete-current", INTEGRITY_RESOURCE_ID);
  await selectTextRange(deleteCurrent, 8, 8);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await threadState(request, "thread-delete", INTEGRITY_RESOURCE_ID))?.anchor).toEqual({
    blockId: "anchor-delete-current",
    start: 8,
    end: 14,
  });

  await selectBlock(page, "anchor-selected", INTEGRITY_RESOURCE_ID);
  await page.keyboard.press("Backspace");
  await expect.poll(async () => {
    const resource = await resourceState(request, INTEGRITY_RESOURCE_ID);
    const thread = resource.commentThreads.find((entry) => entry.id === "thread-selected");
    return { block: resource.blocks.some((block) => block.id === "anchor-selected"), scope: thread?.scope, lost: Boolean(thread?.anchorLostAt) };
  }).toEqual({ block: false, scope: "page", lost: true });
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await threadState(request, "thread-selected", INTEGRITY_RESOURCE_ID))?.scope).toBe("inline");
  await page.keyboard.press("Meta+Shift+z");
  await expect.poll(async () => (await threadState(request, "thread-selected", INTEGRITY_RESOURCE_ID))?.scope).toBe("page");

  const slash = content(page, "anchor-slash", INTEGRITY_RESOURCE_ID);
  await slash.fill("/divider");
  await expect(page.locator('.slash-menu [data-block-type="divider"]')).toBeVisible();
  await page.locator('.slash-menu [data-block-type="divider"]').click();
  await expect(editor(page, INTEGRITY_RESOURCE_ID).locator('[data-block-id="anchor-slash"]')).toHaveAttribute("data-type", "divider");
  await expect.poll(async () => {
    const thread = await threadState(request, "thread-slash", INTEGRITY_RESOURCE_ID);
    return { scope: thread?.scope, anchor: thread?.anchor, lost: Boolean(thread?.anchorLostAt) };
  }).toEqual({ scope: "page", anchor: null, lost: true });

  await page.reload();
  await note(page, INTEGRITY_RESOURCE_ID).locator(`[data-resource-comments-toggle="${INTEGRITY_RESOURCE_ID}"]`).first().click();
  await expect(page.locator('[data-comment-thread="thread-selected"] .resource-comment-meta span')).toContainText("Anchor lost");
  await expect(page.locator('[data-comment-thread="thread-slash"] .resource-comment-meta span')).toContainText("Anchor lost");
  const snapshot = await fixtureSnapshot(request);
  expect(snapshot.writeAttempts.some((attempt) => attempt.outcome === "invalid-state")).toBe(false);
});

test("duplicate plus internal and external clipboard copies strip unowned comment marks", async ({ page, request }) => {
  await openResource(page);
  await selectBlock(page, FIXTURE_IDS.inlineBlock);
  await page.keyboard.press("Meta+d");
  await expect.poll(async () => {
    const resource = await resourceState(request);
    return resource.blocks.filter((block) => block.text === "Bold Italic Underline Strike Code Link Comment Mention Equation").length;
  }).toBe(2);
  let resource = await resourceState(request);
  const duplicate = resource.blocks.find((block) => block.id !== FIXTURE_IDS.inlineBlock && block.text.includes("Bold Italic Underline"));
  expect(duplicate.marks.some((mark) => mark.type === "comment")).toBe(false);

  await page.keyboard.press("Meta+z");
  await selectBlock(page, FIXTURE_IDS.inlineBlock);
  const copied = await dispatchClipboardEvent(content(page, FIXTURE_IDS.inlineBlock), "copy");
  const custom = JSON.parse(copied.data[CUSTOM_BLOCK_MIME]);
  expect(custom.blocks[0].marks.some((mark) => mark.type === "comment")).toBe(false);

  await selectBlock(page, "fixture-block-paragraph");
  const pasted = await dispatchClipboardEvent(content(page, "fixture-block-paragraph"), "paste", {
    [CUSTOM_BLOCK_MIME]: JSON.stringify({
      version: 1,
      blocks: [{
        type: "paragraph",
        text: "Injected orphan mark",
        marks: [{ type: "comment", start: 0, end: 8, commentId: "external-thread", body: "Must not survive" }],
        indent: 0,
      }],
    }),
    "text/plain": "Injected orphan mark",
  });
  expect(pasted.defaultPrevented).toBe(true);
  await expect.poll(async () => (await resourceState(request)).blocks.some((block) => block.text === "Injected orphan mark")).toBe(true);
  resource = await resourceState(request);
  const injected = resource.blocks.find((block) => block.text === "Injected orphan mark");
  expect(injected.marks.some((mark) => mark.type === "comment")).toBe(false);
  expect(resource.commentThreads.some((thread) => thread.id === "external-thread")).toBe(false);
  expect(resource.commentThreads.find((thread) => thread.id === FIXTURE_IDS.inlineThread)?.scope).toBe("inline");
});

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
