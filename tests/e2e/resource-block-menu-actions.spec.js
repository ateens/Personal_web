import { expect, test } from "@playwright/test";
import {
  FIXTURE_IDS,
  fixtureSnapshot,
  resetFixture,
} from "./helpers.js";

const RESOURCE_PATH = `/resources/${encodeURIComponent(FIXTURE_IDS.resource)}`;
const PARAGRAPH_ID = "fixture-block-paragraph";

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto(RESOURCE_PATH);
  await expect(resourceNote(page)).toBeVisible();
});

function resourceNote(page) {
  return page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
}

function block(page, blockId = PARAGRAPH_ID) {
  return resourceNote(page).locator(`.block[data-block-id="${blockId}"]`);
}

function content(page, blockId = PARAGRAPH_ID) {
  return resourceNote(page).locator(`[data-block-content="${blockId}"]`);
}

async function openBlockMenu(page, blockId = PARAGRAPH_ID) {
  await content(page, blockId).focus();
  await content(page, blockId).press("Escape");
  await expect(block(page, blockId)).toHaveClass(/is-selected/);
  await page.keyboard.press("Meta+/");
  const menu = page.locator(".slash-menu.is-selection-menu");
  await expect(menu).toBeVisible();
  return menu;
}

async function serverResource(request) {
  const snapshot = await fixtureSnapshot(request);
  return snapshot.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource);
}

test("comment toolbar persists a local-only read cursor without a workspace write", async ({ page, request }) => {
  const commentsButton = resourceNote(page).locator(`[data-resource-comments-toggle="${FIXTURE_IDS.resource}"]`);
  const unread = commentsButton.locator("[data-resource-comment-unread]");
  await expect(unread).toHaveText("2");
  await expect(commentsButton).toHaveAccessibleName(/읽지 않은 댓글 2개/);
  const before = await fixtureSnapshot(request);

  await commentsButton.click();
  await expect(resourceNote(page).locator(`[data-resource-comments-pane="${FIXTURE_IDS.resource}"]`)).toBeVisible();
  await expect(commentsButton.locator("[data-resource-comment-unread]")).toHaveCount(0);
  await expect.poll(async () => {
    return page.evaluate(({ workspaceId, resourceId }) => new Promise((resolve, reject) => {
      const request = indexedDB.open("sygma-resource-local-v1");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("resource-metadata", "readonly");
        const get = transaction.objectStore("resource-metadata").get([workspaceId, resourceId]);
        get.onerror = () => reject(get.error);
        get.onsuccess = () => resolve(Date.parse(get.result?.resourceCommentReadAt || "") || 0);
      };
    }), { workspaceId: FIXTURE_IDS.appState, resourceId: FIXTURE_IDS.resource });
  }).toBeGreaterThan(0);

  const afterOpen = await fixtureSnapshot(request);
  expect(afterOpen.serverRevision).toBe(before.serverRevision);
  expect(afterOpen.writes).toEqual(before.writes);
  expect(afterOpen.writeAttempts).toEqual(before.writeAttempts);
  expect(afterOpen.state.settings?.resourceCommentReadAt?.[FIXTURE_IDS.resource]).toBeUndefined();

  await page.reload();
  const reloadedCommentsButton = resourceNote(page).locator(`[data-resource-comments-toggle="${FIXTURE_IDS.resource}"]`);
  await expect(resourceNote(page)).toBeVisible();
  await expect(reloadedCommentsButton.locator("[data-resource-comment-unread]")).toHaveCount(0);
  const afterReload = await fixtureSnapshot(request);
  expect(afterReload.serverRevision).toBe(before.serverRevision);
  expect(afterReload.writes).toEqual(before.writes);
  expect(afterReload.writeAttempts).toEqual(before.writeAttempts);
});

test("selected-block menu exposes direct actions and applies visible color and move controls", async ({ page, request }) => {
  let menu = await openBlockMenu(page);
  for (const action of ["copy-link", "comment", "move-up", "move-down", "copy", "duplicate", "delete"]) {
    await expect(menu.locator(`[data-selected-block-action="${action}"]`)).toBeVisible();
  }
  await expect(menu.locator('[role="group"][aria-label="블록 색상"]')).toBeVisible();
  await expect(menu.locator('[data-selected-block-action^="color:text:"]')).toHaveCount(9);
  await expect(menu.locator('[data-selected-block-action^="color:background:"]')).toHaveCount(9);

  await menu.locator('[data-selected-block-action="color:background:blue"]').click();
  await expect(block(page)).toHaveAttribute("data-block-background", "blue");
  await expect.poll(async () => {
    const resource = await serverResource(request);
    return resource.blocks.find((entry) => entry.id === PARAGRAPH_ID)?.backgroundColor;
  }).toBe("blue");

  menu = await openBlockMenu(page);
  await menu.locator('[data-selected-block-action="move-down"]').click();
  await expect.poll(async () => (await serverResource(request)).blocks.map((entry) => entry.id).slice(0, 2)).toEqual([
    "fixture-block-heading-1",
    PARAGRAPH_ID,
  ]);
});

test("only a direct block-handle click opens the selected-block menu", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 1279 });
  const todo = block(page, "fixture-block-todo");
  const checkbox = todo.locator('[data-block-check="fixture-block-todo"]');
  const rect = await checkbox.evaluate((element) => element.getBoundingClientRect().toJSON());

  await page.mouse.click(Math.floor(rect.left) - 1, rect.top + rect.height / 2);
  await expect(page.locator(".slash-menu.is-selection-menu")).toHaveCount(0);

  await todo.locator('[data-block-drag="fixture-block-todo"]').click();
  await expect(page.locator(".slash-menu.is-selection-menu")).toBeVisible();
});

test("block menu creates a whole-block comment and copies a focusable deep link", async ({ page, context, request }) => {
  let menu = await openBlockMenu(page);
  await menu.locator('[data-selected-block-action="comment"]').click();
  const commentInput = page.locator("[data-inline-comment-input]");
  await expect(commentInput).toBeVisible();
  await commentInput.fill("Whole block menu comment");
  await page.locator("[data-inline-comment-apply]").click();

  await expect.poll(async () => {
    const resource = await serverResource(request);
    const thread = resource.commentThreads.find((entry) => entry.body === "Whole block menu comment");
    return thread && {
      scope: thread.scope,
      blockId: thread.anchor?.blockId,
      start: thread.anchor?.start,
      end: thread.anchor?.end,
    };
  }).toEqual({
    scope: "inline",
    blockId: PARAGRAPH_ID,
    start: 0,
    end: "Paragraph fixture fulltext-needle".length,
  });

  await resourceNote(page).locator(`[data-resource-comments-toggle="${FIXTURE_IDS.resource}"]`).click();
  const createdThread = resourceNote(page).locator("[data-comment-thread]", { hasText: "Whole block menu comment" });
  await expect(createdThread).toBeVisible();
  await createdThread.locator("[data-comment-delete]").click();
  await expect(createdThread).toHaveCount(0);
  await expect.poll(async () => {
    const resource = await serverResource(request);
    const thread = resource.commentThreads.find((entry) => entry.body === "Whole block menu comment");
    const blockState = resource.blocks.find((entry) => entry.id === PARAGRAPH_ID);
    return {
      deleted: Boolean(thread?.deletedAt),
      markPresent: blockState?.marks?.some((mark) => mark.commentId === thread?.id) || false,
    };
  }).toEqual({ deleted: true, markPresent: false });

  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  menu = await openBlockMenu(page);
  await menu.locator('[data-selected-block-action="copy-link"]').click();
  await expect(page.locator("#toast")).toContainText("블록 링크를 복사했습니다");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(copied).pathname).toBe(RESOURCE_PATH);
  expect(new URL(copied).hash).toBe(`#block-${encodeURIComponent(PARAGRAPH_ID)}`);

  await page.goto(copied);
  await expect(block(page)).toHaveClass(/is-route-target/);
  await expect(content(page)).toBeFocused();
  await expect(page.locator("#appAnnouncements")).toHaveText("링크된 블록으로 이동했습니다.");
});
