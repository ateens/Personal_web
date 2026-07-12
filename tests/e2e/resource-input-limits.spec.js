import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, openResources, resetFixture } from "./helpers.js";

const MAX_BODY = 20_000;
const MAX_THREADS = 1_000;
const MAX_REPLIES = 500;

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("title and comment body overflow is rejected locally without a server write", async ({ page, request }) => {
  await openMainResource(page);
  const note = resourceNote(page);
  const title = note.locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`);
  await expect(title).toHaveAttribute("maxlength", String(MAX_BODY));

  await setOverflowValue(title, "T".repeat(MAX_BODY + 1));
  await expect(title).toHaveValue("E2E Notion Parity Resource");
  await expect(title).toHaveAttribute("aria-invalid", "true");
  expect(await page.evaluate((overlongTitle) => window.createResource(overlongTitle, { deferCreate: true }), "N".repeat(MAX_BODY + 1))).toBeNull();

  await note.locator(`[data-resource-comments-toggle="${FIXTURE_IDS.resource}"]`).click();
  const composer = note.locator(`[data-page-discussion-composer="${FIXTURE_IDS.resource}"]`);
  await expect(composer).toHaveAttribute("maxlength", String(MAX_BODY));
  await setOverflowValue(composer, "C".repeat(MAX_BODY + 1));
  await note.locator(`[data-page-discussion-submit="${FIXTURE_IDS.resource}"]`).click();
  await expect(composer).toHaveAttribute("aria-invalid", "true");

  const reply = note.locator(`[data-comment-thread="${FIXTURE_IDS.pageThread}"] [data-comment-reply-input]`);
  await expect(reply).toHaveAttribute("maxlength", String(MAX_BODY));
  await setOverflowValue(reply, "R".repeat(MAX_BODY + 1));
  await note.locator(`[data-comment-reply-submit="${FIXTURE_IDS.pageThread}"]`).click();
  await expect(reply).toHaveAttribute("aria-invalid", "true");

  const opened = await page.evaluate(({ resourceId, blockId }) => window.openCommentPopover(
    "resources",
    resourceId,
    blockId,
    { start: 0, end: 4, collapsed: false },
  ), { resourceId: FIXTURE_IDS.resource, blockId: "fixture-block-paragraph" });
  expect(opened).toBe(true);
  const inline = page.locator("[data-inline-comment-input]");
  await expect(inline).toBeVisible();
  await expect(inline).toHaveAttribute("maxlength", String(MAX_BODY));
  await setOverflowValue(inline, "I".repeat(MAX_BODY + 1));
  await page.locator("[data-inline-comment-apply]").click();
  await expect(inline).toHaveAttribute("aria-invalid", "true");

  await page.waitForTimeout(900);
  const snapshot = await fixtureSnapshot(request);
  expect(snapshot.writes).toEqual([]);
  expect(snapshot.writeAttempts).toEqual([]);
  const resource = snapshot.state.resources.find((entry) => entry.id === FIXTURE_IDS.resource);
  expect(resource.title).toBe("E2E Notion Parity Resource");
  expect(resource.commentThreads).toHaveLength(2);
  expect(resource.commentThreads.find((thread) => thread.id === FIXTURE_IDS.pageThread)?.replies).toEqual([]);
});

test("thread and reply collection limits disable controls and guards still reject forced submits", async ({ page, request }) => {
  await page.route("**/api/state", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const payload = await response.json();
    const resource = payload.state.resources.find((entry) => entry.id === FIXTURE_IDS.resource);
    const now = "2026-07-12T00:00:00.000Z";
    const pageThread = resource.commentThreads.find((thread) => thread.id === FIXTURE_IDS.pageThread);
    pageThread.replies = Array.from({ length: MAX_REPLIES }, (_, index) => ({
      id: `limit-reply-${index}`,
      body: `reply ${index}`,
      createdAt: now,
      updatedAt: now,
      deletedAt: now,
    }));
    resource.commentThreads.push(...Array.from({ length: MAX_THREADS - resource.commentThreads.length }, (_, index) => ({
      id: `limit-thread-${index}`,
      scope: "page",
      anchor: null,
      body: `thread ${index}`,
      createdAt: now,
      updatedAt: now,
      resolvedAt: "",
      deletedAt: now,
      replies: [],
    })));
    await route.fulfill({ response, json: payload });
  });

  await openMainResource(page);
  const note = resourceNote(page);
  await note.locator(`[data-resource-comments-toggle="${FIXTURE_IDS.resource}"]`).click();

  const composer = note.locator(`[data-page-discussion-composer="${FIXTURE_IDS.resource}"]`);
  const addComment = note.locator(`[data-page-discussion-submit="${FIXTURE_IDS.resource}"]`);
  await expect(composer).toBeDisabled();
  await expect(addComment).toBeDisabled();
  await expect(note.locator("[data-comment-thread-limit]")).toContainText(String(MAX_THREADS));

  const pageThread = note.locator(`[data-comment-thread="${FIXTURE_IDS.pageThread}"]`);
  const reply = pageThread.locator("[data-comment-reply-input]");
  const addReply = pageThread.locator(`[data-comment-reply-submit="${FIXTURE_IDS.pageThread}"]`);
  await expect(reply).toBeDisabled();
  await expect(addReply).toBeDisabled();
  await expect(pageThread.locator("[data-comment-reply-limit]")).toContainText(String(MAX_REPLIES));

  await composer.evaluate((input) => {
    input.disabled = false;
    input.removeAttribute("aria-disabled");
    input.value = "forced thread";
  });
  await addComment.evaluate((button) => {
    button.disabled = false;
    button.removeAttribute("aria-disabled");
    button.click();
  });
  await expect(composer).toHaveAttribute("aria-invalid", "true");

  await reply.evaluate((input) => {
    input.disabled = false;
    input.removeAttribute("aria-disabled");
    input.value = "forced reply";
  });
  await addReply.evaluate((button) => {
    button.disabled = false;
    button.removeAttribute("aria-disabled");
    button.click();
  });
  await expect(reply).toHaveAttribute("aria-invalid", "true");

  await page.waitForTimeout(900);
  const snapshot = await fixtureSnapshot(request);
  expect(snapshot.writes).toEqual([]);
  expect(snapshot.writeAttempts).toEqual([]);
});

async function openMainResource(page) {
  await page.goto("/");
  await openResources(page);
  await page.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`).first().click();
  await expect(resourceNote(page)).toBeVisible();
  await expect(resourceNote(page).locator("[data-resource-save-status]")).toHaveAttribute("data-sync-state", "saved");
}

function resourceNote(page) {
  return page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
}

async function setOverflowValue(locator, value) {
  await locator.evaluate((input, nextValue) => {
    input.removeAttribute("maxlength");
    input.value = nextValue;
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: nextValue,
      inputType: "insertText",
    }));
  }, value);
}
