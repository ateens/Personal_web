import { expect, test } from "@playwright/test";
import {
  FIXTURE_IDS,
  fixtureSnapshot,
  openResources,
  resetFixture,
} from "./helpers.js";

const RESOURCE_PATH = (resourceId) => `/resources/${encodeURIComponent(resourceId)}`;

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

async function openResource(page, resourceId = FIXTURE_IDS.resource) {
  await page.goto(RESOURCE_PATH(resourceId));
  const note = page.locator(`[data-resource-note="${resourceId}"]`);
  await expect(note).toBeVisible();
  return note;
}

async function expandProperties(note, resourceId = FIXTURE_IDS.resource) {
  const toggle = note.locator(`[data-resource-props="${resourceId}"]`);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.evaluate((element) => element.click());
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

test("property, URL, relation, and comment soft mutations preserve the active editor DOM", async ({ page, request }) => {
  const note = await openResource(page);
  await expandProperties(note);
  const editor = note.locator(`.block-editor[data-owner-type="resources"][data-owner-id="${FIXTURE_IDS.resource}"]`);
  const block = note.locator('[data-block-content="fixture-block-paragraph"]');
  const type = note.locator('[data-resource-properties] [data-field="type"]');

  await block.evaluate((element) => {
    const node = element.firstChild;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(9, node.data.length));
    element.focus();
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    window.__resourceDetailIdentity = {
      viewRoot: document.querySelector("#viewRoot"),
      editor: element.closest(".block-editor"),
      block: element,
      type: element.closest("[data-resource-note]").querySelector('[data-field="type"]'),
    };
  });

  await type.evaluate((control) => {
    control.value = "thought";
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect.poll(async () => (await fixtureSnapshot(request)).state.resources.find((entry) => entry.id === FIXTURE_IDS.resource)?.type).toBe("thought");
  expect(await page.evaluate(() => {
    const refs = window.__resourceDetailIdentity;
    const selection = window.getSelection();
    return {
      viewRoot: refs.viewRoot === document.querySelector("#viewRoot"),
      editor: refs.editor === document.querySelector('.block-editor[data-owner-type="resources"][data-owner-id="fixture-resource-main"]'),
      block: refs.block === document.querySelector('[data-block-content="fixture-block-paragraph"]'),
      type: refs.type === document.querySelector('[data-resource-properties] [data-field="type"]'),
      selectedText: selection.toString(),
    };
  })).toEqual({ viewRoot: true, editor: true, block: true, type: true, selectedText: "Paragraph" });

  await note.locator('[data-resource-url-action="edit"]').click();
  await expect(note.locator(`[data-resource-url-editor="${FIXTURE_IDS.resource}"]`)).toBeVisible();
  expect(await editor.evaluate((element) => element === window.__resourceDetailIdentity.editor)).toBe(true);

  await note.locator(`[data-resource-parent="${FIXTURE_IDS.resource}"]`).selectOption(FIXTURE_IDS.bodySearchResource);
  await expect.poll(async () => (await fixtureSnapshot(request)).state.resources.find((entry) => entry.id === FIXTURE_IDS.resource)?.parentId).toBe(FIXTURE_IDS.bodySearchResource);
  expect(await editor.evaluate((element) => element === window.__resourceDetailIdentity.editor)).toBe(true);

  await note.locator(`[data-resource-comments-toggle="${FIXTURE_IDS.resource}"]`).first().click();
  const composer = note.locator(`[data-page-discussion-composer="${FIXTURE_IDS.resource}"]`);
  await composer.fill("DOM stability comment");
  await note.locator(`[data-page-discussion-submit="${FIXTURE_IDS.resource}"]`).click();
  await expect.poll(async () => (await fixtureSnapshot(request)).state.resources.find((entry) => entry.id === FIXTURE_IDS.resource)?.commentThreads.some((thread) => thread.body === "DOM stability comment")).toBe(true);
  expect(await editor.evaluate((element) => element === window.__resourceDetailIdentity.editor)).toBe(true);
});

test("Advanced windows isolate a Resource property mutation from every other open editor", async ({ page, request }) => {
  const stateResponse = await request.get("/api/state");
  const etag = stateResponse.headers().etag;
  const current = await stateResponse.json();
  current.state.settings.notionParityMode = false;
  current.state.settings.advancedWindowMode = true;
  const write = await request.put("/api/state", {
    headers: { "If-Match": etag },
    data: { state: current.state, baseRevision: current.revision },
  });
  expect(write.ok()).toBeTruthy();

  await page.goto("/");
  await openResources(page);
  await page.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`).first().click();
  await page.locator(`[data-open-resource="${FIXTURE_IDS.bodySearchResource}"]`).first().evaluate((element) => element.click());
  const first = page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
  const second = page.locator(`[data-resource-note="${FIXTURE_IDS.bodySearchResource}"]`);
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await expandProperties(first);
  await second.locator(".block-editor").evaluate((element) => { window.__otherAdvancedEditor = element; });

  await first.locator('[data-field="importance"]').evaluate((control) => {
    control.value = "normal";
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect.poll(async () => (await fixtureSnapshot(request)).state.resources.find((entry) => entry.id === FIXTURE_IDS.resource)?.importance).toBe("normal");
  expect(await second.locator(".block-editor").evaluate((element) => element === window.__otherAdvancedEditor)).toBe(true);
  await expect(page.locator("[data-resource-note]")).toHaveCount(2);
});
