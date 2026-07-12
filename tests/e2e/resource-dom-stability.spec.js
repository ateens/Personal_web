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

async function setWindowModeSettings(request, notionParityMode, advancedWindowMode) {
  const stateResponse = await request.get("/api/state");
  const etag = stateResponse.headers().etag;
  const current = await stateResponse.json();
  current.state.settings.notionParityMode = notionParityMode;
  current.state.settings.advancedWindowMode = advancedWindowMode;
  const write = await request.put("/api/state", {
    headers: { "If-Match": etag },
    data: { state: current.state, baseRevision: current.revision },
  });
  expect(write.ok()).toBeTruthy();
}

async function expectFloatingInsideViewport(note) {
  await expect.poll(() => note.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const inline = {
      left: Number.parseFloat(element.style.left),
      top: Number.parseFloat(element.style.top),
      width: Number.parseFloat(element.style.width),
      height: Number.parseFloat(element.style.height),
    };
    return (
      Object.values(inline).every(Number.isFinite) &&
      inline.left >= 0 &&
      inline.top >= 0 &&
      inline.left + inline.width <= window.innerWidth &&
      inline.top + inline.height <= window.innerHeight &&
      rect.left >= -1 &&
      rect.top >= -1 &&
      rect.right <= window.innerWidth + 1 &&
      rect.bottom <= window.innerHeight + 1
    );
  })).toBe(true);
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

test("strict parity wins and heals contradictory persisted window-mode flags", async ({ page, request }) => {
  await setWindowModeSettings(request, true, true);

  await page.goto("/");
  await openResources(page);
  await page.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`).first().click();

  const note = page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
  await expect(note).toHaveAttribute("data-resource-shell", "center");
  await expect(note.locator("[data-resource-mode], [data-resource-layout='triple']")).toHaveCount(0);
  await expect.poll(async () => {
    const settings = (await fixtureSnapshot(request)).state.settings;
    return [settings.notionParityMode, settings.advancedWindowMode];
  }).toEqual([true, false]);
});

test("Advanced windows isolate a Resource property mutation from every other open editor", async ({ page, request }) => {
  await setWindowModeSettings(request, false, true);

  await page.goto("/");
  await openResources(page);
  await page.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`).first().click();
  await page.locator(`[data-open-resource="${FIXTURE_IDS.bodySearchResource}"]`).first().evaluate((element) => element.click());
  const first = page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
  const second = page.locator(`[data-resource-note="${FIXTURE_IDS.bodySearchResource}"]`);
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  const accessibleNames = await page.locator("[data-resource-note]").evaluateAll((elements) => (
    elements.map((element) => element.getAttribute("aria-label"))
  ));
  expect(accessibleNames).toHaveLength(2);
  expect(new Set(accessibleNames).size).toBe(2);
  expect(accessibleNames).toEqual(expect.arrayContaining([
    expect.stringContaining(FIXTURE_IDS.resource),
    expect.stringContaining(FIXTURE_IDS.bodySearchResource),
  ]));
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

test("Advanced floating windows clamp stored and rendered geometry through phone and desktop resizes", async ({ page, request }) => {
  await setWindowModeSettings(request, false, true);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/");
  await openResources(page);
  await page.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`).first().click();

  const note = page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
  await note.locator(`[data-resource-mode="${FIXTURE_IDS.resource}"][data-mode="floating"]`).click();
  await expect(note).toHaveClass(/is-floating/);
  await expectFloatingInsideViewport(note);

  for (const viewport of [
    { width: 320, height: 480 },
    { width: 280, height: 420 },
    { width: 900, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await expectFloatingInsideViewport(note);
  }
});
