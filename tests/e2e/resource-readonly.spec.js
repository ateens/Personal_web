import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const RESOURCE_ID = FIXTURE_IDS.readOnlyResource;
const RESOURCE_PATH = `/resources/${encodeURIComponent(RESOURCE_ID)}`;
const PAGE_THREAD_ID = "fixture-thread-read-only-page";

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto(RESOURCE_PATH);
  await expect(page.locator(`[data-resource-note="${RESOURCE_ID}"]`)).toBeVisible();
});

function resourceFromSnapshot(snapshot) {
  return snapshot.state.resources.find((resource) => resource.id === RESOURCE_ID);
}

async function expandProperties(note) {
  const toggle = note.locator(`[data-resource-props="${RESOURCE_ID}"]`);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  return note.locator(`[data-resource-properties="${RESOURCE_ID}"]`);
}

test("read-only Resource keeps navigation, comments, Open, and Copy available while every write surface is disabled", async ({ page }) => {
  const note = page.locator(`[data-resource-note="${RESOURCE_ID}"]`);
  await expect(note).toHaveAttribute("data-resource-read-only", "true");

  const title = note.locator(`[data-resource-title="${RESOURCE_ID}"]`);
  await expect(title).toHaveAttribute("readonly", "");
  await expect(title).toHaveAttribute("aria-readonly", "true");

  const blockContents = note.locator("[data-block-content]");
  await expect(blockContents).toHaveCount(2);
  for (const content of await blockContents.all()) {
    await expect(content).toHaveAttribute("contenteditable", "false");
    await expect(content).toHaveAttribute("aria-readonly", "true");
  }
  await expect(note.locator("[data-block-add], [data-block-drag]")).toHaveCount(0);
  await expect(note.locator('[data-block-check="fixture-read-only-todo"]')).toBeDisabled();

  await expect(note.locator(`[data-resource-create-child="${RESOURCE_ID}"]`)).toBeDisabled();
  await expect(note.locator(`[data-resource-page-menu="${RESOURCE_ID}"]`)).toBeDisabled();
  await expect(note.locator("[data-resource-icon-edit], [data-resource-cover-edit], [data-resource-cover-remove]")).toHaveCount(0);
  await expect(note.locator(`[data-resource-parent="${RESOURCE_ID}"]`)).toBeDisabled();

  const properties = await expandProperties(note);
  const propertyWrites = properties.locator("select[data-field], input[data-field]");
  expect(await propertyWrites.count()).toBeGreaterThan(0);
  for (const control of await propertyWrites.all()) await expect(control).toBeDisabled();

  const urlActions = properties.locator("[data-resource-url-actions]");
  await expect(urlActions.locator('a[data-resource-url-action="open"]')).toHaveAttribute("href", "https://example.com/read-only-resource");
  await expect(urlActions.locator('button[data-resource-url-action="copy"]')).toBeEnabled();
  await expect(urlActions.locator('button[data-resource-url-action="edit"]')).toBeDisabled();
  await expect(urlActions.locator('button[data-resource-url-action="clear"]')).toBeDisabled();

  await expect(note.locator(`[data-resource-copy-link="${RESOURCE_ID}"]`)).toBeEnabled();
  expect(await note.locator("[data-resource-navigate]:enabled").count()).toBeGreaterThan(0);

  const commentsToggle = note.locator(`[data-resource-comments-toggle="${RESOURCE_ID}"]`).first();
  await expect(commentsToggle).toBeEnabled();
  await commentsToggle.click();
  const comments = page.locator(`[data-resource-comments-pane="${RESOURCE_ID}"]`);
  await expect(comments).toBeVisible();
  await expect(comments.locator(`[data-page-discussion-composer="${RESOURCE_ID}"]`)).toBeDisabled();
  await expect(comments.locator(`[data-page-discussion-submit="${RESOURCE_ID}"]`)).toBeDisabled();
  await expect(comments.locator(`[data-comment-reply-input="${PAGE_THREAD_ID}"]`)).toBeDisabled();
  await expect(comments.locator(`[data-comment-reply-submit="${PAGE_THREAD_ID}"]`)).toBeDisabled();
  await expect(comments.locator(`[data-comment-resolve="${PAGE_THREAD_ID}"]`)).toBeDisabled();
  await expect(comments.locator(`[data-resource-comments-toggle="${RESOURCE_ID}"]`)).toBeEnabled();
});

test("read-only mutation handlers reject forced DOM events and never write or change the server fixture", async ({ page, request }) => {
  const before = await fixtureSnapshot(request);
  const beforeResource = structuredClone(resourceFromSnapshot(before));
  const note = page.locator(`[data-resource-note="${RESOURCE_ID}"]`);
  await expandProperties(note);
  await note.locator(`[data-resource-comments-toggle="${RESOURCE_ID}"]`).first().click();
  await expect(page.locator(`[data-resource-comments-pane="${RESOURCE_ID}"]`)).toBeVisible();

  const localResult = await page.evaluate(({ resourceId, threadId, attemptedParentId }) => {
    const shell = document.querySelector(`[data-resource-note="${resourceId}"]`);
    const clickInjected = (dataset, parent = shell) => {
      const button = document.createElement("button");
      button.type = "button";
      Object.assign(button.dataset, dataset);
      parent.append(button);
      button.click();
      button.remove();
    };

    const title = shell.querySelector(`[data-resource-title="${resourceId}"]`);
    title.removeAttribute("readonly");
    title.value = "Forced title mutation";
    title.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }));

    const block = shell.querySelector('[data-block-content="fixture-read-only-paragraph"]');
    block.setAttribute("contenteditable", "true");
    block.textContent = "Forced block mutation";
    block.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }));
    block.focus();
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "Forced pasted block");
    block.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    clickInjected({ blockAdd: "fixture-read-only-paragraph" }, shell.querySelector(".block-editor"));

    const todo = shell.querySelector('[data-block-check="fixture-read-only-todo"]');
    todo.disabled = false;
    todo.click();

    const type = shell.querySelector('[data-field="type"]');
    type.disabled = false;
    type.value = "scrap";
    type.dispatchEvent(new Event("change", { bubbles: true }));

    const parent = shell.querySelector(`[data-resource-parent="${resourceId}"]`);
    parent.disabled = false;
    parent.value = attemptedParentId;
    parent.dispatchEvent(new Event("change", { bubbles: true }));

    const composer = shell.querySelector(`[data-page-discussion-composer="${resourceId}"]`);
    composer.disabled = false;
    composer.value = "Forced page discussion";
    clickInjected({ pageDiscussionSubmit: resourceId });

    const reply = shell.querySelector(`[data-comment-reply-input="${threadId}"]`);
    reply.disabled = false;
    reply.value = "Forced reply";
    clickInjected({ commentReplySubmit: threadId });
    clickInjected({ commentResolve: threadId });

    clickInjected({ resourcePageFont: "serif", resourcePageOwner: resourceId });
    clickInjected({ resourcePageOption: "smallText", resourcePageOwner: resourceId });
    clickInjected({ resourceMoveToTrash: resourceId });
    clickInjected({ resourceCreateChild: resourceId });
    clickInjected({ resourceIconChoice: "💡", resourceIconOwner: resourceId });
    clickInjected({ resourceCoverRemove: resourceId });
    clickInjected({ resourceUrlAction: "edit", resourceUrlOwner: resourceId });
    clickInjected({ resourceUrlAction: "clear", resourceUrlOwner: resourceId });

    return {
      title: shell.querySelector(`[data-resource-title="${resourceId}"]`).value,
      block: shell.querySelector('[data-block-content="fixture-read-only-paragraph"]').textContent,
      type: shell.querySelector('[data-field="type"]').value,
      parent: shell.querySelector(`[data-resource-parent="${resourceId}"]`).value,
      blockCount: shell.querySelectorAll("[data-block-id]").length,
    };
  }, { resourceId: RESOURCE_ID, threadId: PAGE_THREAD_ID, attemptedParentId: FIXTURE_IDS.resource });

  expect(localResult).toEqual({
    title: beforeResource.title,
    block: beforeResource.blocks[0].text,
    type: beforeResource.type,
    parent: beforeResource.parentId,
    blockCount: beforeResource.blocks.length,
  });

  await page.waitForTimeout(900);
  const after = await fixtureSnapshot(request);
  expect(resourceFromSnapshot(after)).toEqual(beforeResource);
  expect(after.state.resources).toHaveLength(before.state.resources.length);
  expect(after.serverRevision).toBe(before.serverRevision);
  expect(after.writes).toEqual(before.writes);
  expect(after.writeAttempts).toEqual(before.writeAttempts);

  await page.reload();
  const reloaded = page.locator(`[data-resource-note="${RESOURCE_ID}"]`);
  await expect(reloaded.locator(`[data-resource-title="${RESOURCE_ID}"]`)).toHaveValue(beforeResource.title);
  await expect(reloaded.locator('[data-block-content="fixture-read-only-paragraph"]')).toHaveText(beforeResource.blocks[0].text);
});
