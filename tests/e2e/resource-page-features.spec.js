import { expect, test } from "@playwright/test";
import {
  FIXTURE_IDS,
  fixtureSnapshot,
  openResources,
  resetFixture,
} from "./helpers.js";

const RESOURCE_PATH = (resourceId) => `/resources/${encodeURIComponent(resourceId)}`;

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
});

async function openResource(page, resourceId = FIXTURE_IDS.resource) {
  await page.goto(RESOURCE_PATH(resourceId));
  const note = page.locator(`[data-resource-note="${resourceId}"]`);
  await expect(note).toBeVisible();
  return note;
}

async function expandResourceProperties(note, resourceId = FIXTURE_IDS.resource) {
  const toggle = note.locator(`[data-resource-props="${resourceId}"]`);
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const panel = note.locator(`[data-resource-properties="${resourceId}"]`);
  await expect(panel).toBeVisible();
  return { toggle, panel };
}

async function openPageMenu(page, note, resourceId = FIXTURE_IDS.resource) {
  const button = note.locator(`[data-resource-page-menu="${resourceId}"]`);
  const menu = page.locator(`[data-resource-page-menu-panel="${resourceId}"]`);
  if (!(await menu.isVisible())) await button.click();
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("role", "menu");
  return menu;
}

async function openResourcesWithoutMainRowExpectation(page) {
  const navToggle = page.locator('[data-action="toggle-nav"]');
  if (await navToggle.isVisible()) {
    await navToggle.click();
    await expect(page.locator("[data-sidebar]")).toHaveClass(/is-open/);
  }
  await page.locator('[data-nav-key="resources"]').click();
  await expect(page.locator('[data-resource-view="library"]')).toBeVisible();
}

function resourceFromSnapshot(snapshot, resourceId = FIXTURE_IDS.resource) {
  return snapshot.state.resources.find((resource) => resource.id === resourceId);
}

function threadFromSnapshot(snapshot, threadId, resourceId = FIXTURE_IDS.resource) {
  return resourceFromSnapshot(snapshot, resourceId)?.commentThreads?.find((thread) => thread.id === threadId);
}

async function selectTextRange(page, blockContent, start, end) {
  await blockContent.evaluate((element, rangeOffsets) => {
    const textNodes = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    const pointAt = (offset) => {
      let remaining = offset;
      for (const node of textNodes) {
        if (remaining <= node.data.length) return { node, offset: remaining };
        remaining -= node.data.length;
      }
      const node = textNodes.at(-1) || element;
      return { node, offset: node.nodeType === Node.TEXT_NODE ? node.data.length : 0 };
    };
    const startPoint = pointAt(rangeOffsets.start);
    const endPoint = pointAt(rangeOffsets.end);
    const range = document.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    element.focus();
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, { start, end });
}

test("semantic Resource blocks expose heading, quote, and code structure without losing block hooks", async ({ page }) => {
  const note = await openResource(page);
  const headings = [
    ["fixture-block-heading-1", "h1", 1, "Heading one"],
    ["fixture-block-heading-2", "h2", 2, "Heading two"],
    ["fixture-block-heading-3", "h3", 3, "Heading three"],
  ];

  for (const [blockId, tagName, level, name] of headings) {
    const block = note.locator(`[data-block-id="${blockId}"][data-type="heading${level}"]`);
    await expect(block.locator(`${tagName} [data-block-content="${blockId}"]`)).toBeVisible();
    await expect(note.getByRole("heading", { level, name })).toBeVisible();
  }

  await expect(note.locator('[data-block-id="fixture-block-quote"] blockquote [data-block-content="fixture-block-quote"]')).toContainText("Quote fixture");
  const lists = note.getByRole("list");
  await expect(lists).toHaveCount(2);
  await expect(note.locator('[data-block-id="fixture-block-bullet"][role="listitem"]')).toHaveAttribute("aria-level", "1");
  await expect(note.locator('[data-block-id="fixture-block-numbered"][role="listitem"]')).toHaveAttribute("aria-level", "1");
  const code = note.locator('[data-block-id="fixture-block-code"] pre[aria-label="Plain text code block"] code[data-block-content="fixture-block-code"]');
  await expect(code).toContainText("const fixture = true;");
  await expect(code).toHaveAttribute("data-language", "plain-text");
});

test("editable block contents retain data hooks and expose named multiline textbox semantics", async ({ page }) => {
  const note = await openResource(page);
  const blockIds = [
    "fixture-block-paragraph",
    "fixture-block-heading-1",
    "fixture-block-heading-2",
    "fixture-block-heading-3",
    "fixture-block-quote",
    "fixture-block-code",
  ];

  for (const blockId of blockIds) {
    const editable = note.locator(`[data-block-id="${blockId}"] [data-block-content="${blockId}"]`);
    await expect(editable).toHaveAttribute("contenteditable", "true");
    await expect(editable).toHaveAttribute("role", "textbox");
    await expect(editable).toHaveAttribute("aria-multiline", "true");
    expect((await editable.getAttribute("aria-label"))?.trim()).toBeTruthy();
  }
});

test("page title owns document semantics and moves focus to and from the first block", async ({ page, request }) => {
  const note = await openResource(page);
  const title = note.locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`);
  const firstBlock = note.locator('[data-block-content="fixture-block-paragraph"]');
  await expect(note.getByRole("heading", { level: 1, name: "E2E Notion Parity Resource" })).toHaveCount(1);
  await expect(page).toHaveTitle(/E2E Notion Parity Resource/);

  await title.fill("");
  await title.press("Enter");
  await expect(firstBlock).toBeFocused();
  await firstBlock.press("ArrowUp");
  await expect(title).toBeFocused();
  await expect.poll(async () => resourceFromSnapshot(await fixtureSnapshot(request))?.title).toBe("");
  await expect(page).toHaveTitle(/Untitled/);
  await expect(note.getByRole("heading", { level: 1, name: "Untitled" })).toHaveCount(1);
});

test("collapsed Resource properties leave the tab order and booleans use checkbox or switch controls", async ({ page }) => {
  const note = await openResource(page);
  const { toggle, panel } = await expandResourceProperties(note);

  for (const field of ["pinned", "readLater"]) {
    const control = panel.locator(`[data-field="${field}"]`);
    await expect(control).toHaveCount(1);
    expect(await control.evaluate((element) => (
      element.matches('input[type="checkbox"]') ||
      element.getAttribute("role") === "checkbox" ||
      element.getAttribute("role") === "switch"
    ))).toBe(true);
    expect(await control.evaluate((element) => (
      element.getAttribute("aria-label") || element.closest("label")?.textContent || ""
    ).trim())).toBeTruthy();
    await expect(panel.locator(`select[data-field="${field}"]`)).toHaveCount(0);
  }

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(await panel.evaluate((element) => (
    element.hidden || element.inert || element.getAttribute("aria-hidden") === "true"
  ))).toBe(true);
  await toggle.focus();
  await page.keyboard.press("Tab");
  expect(await panel.evaluate((element) => element.contains(document.activeElement))).toBe(false);
});

test("URL property exposes safe Open, Copy, Edit, and Clear actions and never links unsafe protocols", async ({ page }) => {
  const note = await openResource(page);
  const { panel } = await expandResourceProperties(note);
  const actions = panel.locator('[data-resource-url-actions]');

  const open = actions.locator('a[data-resource-url-action="open"]');
  await expect(open).toHaveAttribute("href", "https://example.com/resource");
  await expect(actions.locator('button[data-resource-url-action="copy"]')).toBeVisible();
  await expect(actions.locator('button[data-resource-url-action="edit"]')).toBeVisible();
  await expect(actions.locator('button[data-resource-url-action="clear"]')).toBeVisible();

  for (const unsafeUrl of ["javascript:alert(document.domain)", "data:text/html,<script>alert(1)</script>"]) {
    const edit = actions.locator('button[data-resource-url-action="edit"]');
    if (await edit.isVisible()) await edit.click();
    const editor = panel.locator('[data-resource-url-editor]');
    await expect(editor).toBeVisible();
    await editor.fill(unsafeUrl);
    await editor.press("Enter");
    if (await editor.isVisible()) await editor.blur();
    await expect(panel.locator('a[data-resource-url-action="open"]')).toHaveCount(0);
    await expect(panel.locator('a[href^="javascript:" i], a[href^="data:" i]')).toHaveCount(0);
  }
});

test("page menu exposes only implemented font, copy, Duplicate, Lock, Move, Export, and trash features", async ({ page }) => {
  const note = await openResource(page);
  const menu = await openPageMenu(page, note);

  await expect(menu.locator('[role="menuitemradio"][data-resource-page-font="default"]')).toHaveCount(1);
  await expect(menu.locator('[role="menuitemradio"][data-resource-page-font="serif"]')).toHaveCount(1);
  await expect(menu.locator('[role="menuitemradio"][data-resource-page-font="mono"]')).toHaveCount(1);
  await expect(menu.locator('[role="menuitemcheckbox"][data-resource-page-option="smallText"]')).toHaveCount(1);
  await expect(menu.locator('[role="menuitemcheckbox"][data-resource-page-option="fullWidth"]')).toHaveCount(1);
  await expect(menu.locator('[role="menuitem"][data-resource-copy-link]')).toHaveCount(1);
  await expect(menu.locator('[role="menuitem"][data-resource-duplicate]')).toHaveCount(1);
  await expect(menu.locator('[role="menuitemcheckbox"][data-resource-page-lock]')).toHaveCount(1);
  await expect(menu.locator('[role="menuitem"][data-resource-move-menu]')).toHaveCount(1);
  await expect(menu.locator('[role="menuitem"][data-resource-export-markdown]')).toHaveCount(1);
  await expect(menu.locator('[role="menuitem"][data-resource-move-to-trash]')).toHaveCount(1);

  const items = menu.locator('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]');
  await expect(items).toHaveCount(11);
  const accessibleNames = await items.evaluateAll((elements) => elements.map((element) => (
    element.getAttribute("aria-label") || element.textContent || ""
  ).trim()));
  expect(accessibleNames.every(Boolean)).toBe(true);
});

test("page menu keeps the editor node stable and follows keyboard, Escape, focus-return, and outside-click rules", async ({ page }) => {
  const note = await openResource(page);
  await note.locator(".block-editor").evaluate((editor) => { window.__resourceEditorIdentity = editor; });
  const trigger = note.locator(`[data-resource-page-menu="${FIXTURE_IDS.resource}"]`);

  await trigger.click();
  const menu = page.locator(`[data-resource-page-menu-panel="${FIXTURE_IDS.resource}"]`);
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-resource-page-font="default"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.locator('[data-resource-page-font="serif"]')).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.locator("[data-resource-move-to-trash]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(note).toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await note.locator(".block-editor").evaluate((editor) => editor === window.__resourceEditorIdentity)).toBe(true);

  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-resource-page-font="default"]')).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menu).toHaveCount(0);
  await expect(note.locator(`[data-resource-expand="${FIXTURE_IDS.resource}"]`)).toBeFocused();

  await trigger.click();
  await expect(menu).toBeVisible();
  await note.locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`).click();
  await expect(menu).toHaveCount(0);
  expect(await note.locator(".block-editor").evaluate((editor) => editor === window.__resourceEditorIdentity)).toBe(true);
});

test("page menu Move submenu follows ArrowRight and layered Escape focus rules", async ({ page }) => {
  const note = await openResource(page);
  const trigger = note.locator(`[data-resource-page-menu="${FIXTURE_IDS.resource}"]`);
  const menu = await openPageMenu(page, note);
  const move = menu.locator(`[data-resource-move-menu="${FIXTURE_IDS.resource}"]`);
  await move.focus();
  await page.keyboard.press("ArrowRight");

  const destinations = page.locator(`[data-resource-move-menu-panel="${FIXTURE_IDS.resource}"]`);
  await expect(destinations).toBeVisible();
  await expect(destinations.locator("[role^='menuitem']").first()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(destinations).toHaveCount(0);
  await expect(menu).toBeVisible();
  await expect(move).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("page menu and Move destinations remain scrollable inside 320px and short landscape viewports", async ({ page }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
    await page.setViewportSize(viewport);
    const note = await openResource(page);
    const menu = await openPageMenu(page, note);
    const move = menu.locator(`[data-resource-move-menu="${FIXTURE_IDS.resource}"]`);
    await move.scrollIntoViewIfNeeded();
    await move.click();
    await expect(page.locator(`[data-resource-move-menu-panel="${FIXTURE_IDS.resource}"]`)).toBeVisible();

    const geometry = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        viewportHeight: window.innerHeight,
        scrollable: element.scrollHeight > element.clientHeight,
      };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    expect(geometry.scrollable).toBe(true);

    const trash = menu.locator("[data-resource-move-to-trash]");
    await trash.scrollIntoViewIfNeeded();
    const trashBox = await trash.boundingBox();
    expect(trashBox?.y).toBeGreaterThanOrEqual(geometry.top);
    expect((trashBox?.y || 0) + (trashBox?.height || 0)).toBeLessThanOrEqual(geometry.bottom + 1);

    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }
});

test("Duplicate creates an independent page without copying discussions and preserves Back history", async ({ page, request }) => {
  const before = await fixtureSnapshot(request);
  const source = structuredClone(resourceFromSnapshot(before));
  const note = await openResource(page);
  const menu = await openPageMenu(page, note);
  await menu.locator(`[data-resource-duplicate="${FIXTURE_IDS.resource}"]`).click();

  let duplicate;
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    duplicate = snapshot.state.resources.find((resource) => !before.state.resources.some((entry) => entry.id === resource.id));
    return duplicate?.title || "";
  }).toBe(`${source.title} copy`);

  expect(duplicate.id).not.toBe(source.id);
  expect(duplicate.blocks.map(({ type, text, checked, indent }) => ({ type, text, checked, indent }))).toEqual(
    source.blocks.map(({ type, text, checked, indent }) => ({ type, text, checked, indent })),
  );
  expect(new Set(duplicate.blocks.map((block) => block.id)).size).toBe(duplicate.blocks.length);
  expect(duplicate.blocks.every((block) => !source.blocks.some((sourceBlock) => sourceBlock.id === block.id))).toBe(true);
  expect(duplicate.blocks.flatMap((block) => block.marks || []).some((mark) => mark.type === "comment")).toBe(false);
  expect(duplicate.commentThreads).toEqual([]);
  expect(duplicate.childOrder).toEqual([]);
  expect(duplicate.readOnly).toBe(false);
  expect(duplicate.locked).toBe(false);
  expect(duplicate.trashedAt).toBe("");
  await expect.poll(() => new URL(page.url()).pathname).toBe(RESOURCE_PATH(duplicate.id));
  await expect(page.locator(`[data-resource-note="${duplicate.id}"]`)).toBeVisible();

  await page.goBack();
  await expect.poll(() => new URL(page.url()).pathname).toBe(RESOURCE_PATH(source.id));
  await expect(page.locator(`[data-resource-note="${source.id}"]`)).toBeVisible();
  expect(resourceFromSnapshot(await fixtureSnapshot(request))).toEqual(source);
});

test("Export Markdown downloads deterministic page content without mutating state", async ({ page, request }) => {
  const initial = await fixtureSnapshot(request);
  const exportState = structuredClone(initial.state);
  const longestBacktickRun = "`".repeat(7);
  const trickyCode = `before\n${longestBacktickRun}\nafter`;
  exportState.resources.find((resource) => resource.id === FIXTURE_IDS.resource).blocks.push({
    id: "fixture-block-long-backticks",
    type: "code",
    text: trickyCode,
    marks: [],
    checked: false,
    indent: 0,
    collapsed: false,
  });
  const seedResponse = await request.put("/api/state", {
    headers: { "If-Match": `"state-${initial.serverRevision}"` },
    data: { state: exportState, baseRevision: initial.serverRevision },
  });
  expect(seedResponse.ok()).toBeTruthy();
  const before = await fixtureSnapshot(request);
  const note = await openResource(page);
  const menu = await openPageMenu(page, note);
  const downloadPromise = page.waitForEvent("download");
  await menu.locator(`[data-resource-export-markdown="${FIXTURE_IDS.resource}"]`).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("E2E Notion Parity Resource.md");
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const markdown = Buffer.concat(chunks).toString("utf8");
  expect(markdown).toContain('title: "E2E Notion Parity Resource"');
  expect(markdown).toContain("# E2E Notion Parity Resource");
  expect(markdown).toContain("# Heading one");
  expect(markdown).toContain("- [x] Completed todo");
  expect(markdown).toContain("> Quote fixture");
  expect(markdown).toContain("```\nconst fixture = true;\n```");
  const safeFence = "`".repeat(8);
  expect(markdown).toContain(`${safeFence}\n${trickyCode}\n${safeFence}`);

  const after = await fixtureSnapshot(request);
  expect(after.serverRevision).toBe(before.serverRevision);
  expect(after.state).toEqual(before.state);
  expect(after.writes).toEqual(before.writes);
});

test("font, Small text, and Full width settings persist per Resource and survive reload", async ({ page, request }) => {
  const note = await openResource(page);

  let menu = await openPageMenu(page, note);
  await menu.locator('[data-resource-page-font="serif"]').click();
  menu = await openPageMenu(page, note);
  await menu.locator('[data-resource-page-option="smallText"]').click();
  menu = await openPageMenu(page, note);
  await menu.locator('[data-resource-page-option="fullWidth"]').click();

  await expect.poll(async () => resourceFromSnapshot(await fixtureSnapshot(request))?.pageSettings).toEqual({
    font: "serif",
    smallText: true,
    fullWidth: true,
  });
  const snapshot = await fixtureSnapshot(request);
  expect(resourceFromSnapshot(snapshot, FIXTURE_IDS.bodySearchResource)?.pageSettings).toEqual({
    font: "default",
    smallText: false,
    fullWidth: false,
  });

  await page.reload();
  const reloaded = page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
  await expect(reloaded).toHaveAttribute("data-resource-font", "serif");
  await expect(reloaded).toHaveAttribute("data-resource-small-text", "true");
  await expect(reloaded).toHaveAttribute("data-resource-full-width", "true");
});

test("emoji icons and HTTPS covers add, reposition, persist, reject unsafe URLs, and remove", async ({ page, request }) => {
  let note = await openResource(page);
  const media = note.locator(`[data-resource-media="${FIXTURE_IDS.resource}"]`);
  await media.hover();
  await media.locator(`[data-resource-icon-edit="${FIXTURE_IDS.resource}"]`).click();
  const iconPicker = note.locator(`[data-resource-icon-picker="${FIXTURE_IDS.resource}"]`);
  await expect(iconPicker).toBeVisible();
  await iconPicker.locator('[data-resource-icon-choice="💡"]').click();
  await expect(note.locator(`[data-resource-icon="${FIXTURE_IDS.resource}"]`)).toHaveText("💡");
  await expect.poll(async () => resourceFromSnapshot(await fixtureSnapshot(request))?.icon).toBe("💡");

  await media.hover();
  await media.locator(`[data-resource-cover-edit="${FIXTURE_IDS.resource}"]`).click();
  let coverUrl = note.locator(`[data-resource-cover-url="${FIXTURE_IDS.resource}"]`);
  await coverUrl.fill("javascript:alert(1)");
  await note.locator(`[data-resource-cover-apply="${FIXTURE_IDS.resource}"]`).click();
  await expect(coverUrl).toHaveAttribute("aria-invalid", "true");
  expect(resourceFromSnapshot(await fixtureSnapshot(request))?.cover?.url).toBe("");

  await coverUrl.fill("https://example.com/resource-cover.jpg");
  await note.locator(`[data-resource-cover-position="${FIXTURE_IDS.resource}"]`).fill("72");
  await note.locator(`[data-resource-cover-apply="${FIXTURE_IDS.resource}"]`).click();
  const cover = note.locator(`[data-resource-cover="${FIXTURE_IDS.resource}"]`);
  await expect(cover).toHaveAttribute("src", "https://example.com/resource-cover.jpg");
  await expect.poll(async () => resourceFromSnapshot(await fixtureSnapshot(request))?.cover).toEqual({
    url: "https://example.com/resource-cover.jpg",
    position: 72,
  });

  await page.reload();
  note = page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
  await expect(note.locator(`[data-resource-icon="${FIXTURE_IDS.resource}"]`)).toHaveText("💡");
  await expect(note.locator(`[data-resource-cover="${FIXTURE_IDS.resource}"]`)).toHaveCSS("object-position", "50% 72%");
  await note.locator(`[data-resource-media="${FIXTURE_IDS.resource}"]`).hover();
  await note.locator(`[data-resource-cover-remove="${FIXTURE_IDS.resource}"]`).click();
  await expect(note.locator(`[data-resource-cover="${FIXTURE_IDS.resource}"]`)).toHaveCount(0);
  await expect.poll(async () => resourceFromSnapshot(await fixtureSnapshot(request))?.cover?.url).toBe("");
});

test("soft trash removes a Resource from normal views while direct routes can restore every block", async ({ page, request }) => {
  const before = resourceFromSnapshot(await fixtureSnapshot(request));
  const note = await openResource(page);
  const menu = await openPageMenu(page, note);
  await menu.locator(`[data-resource-move-to-trash="${FIXTURE_IDS.resource}"]`).click();

  await expect.poll(async () => Boolean(resourceFromSnapshot(await fixtureSnapshot(request))?.trashedAt)).toBe(true);
  const trashed = resourceFromSnapshot(await fixtureSnapshot(request));
  expect(trashed.blocks).toEqual(before.blocks);
  const currentRecovery = page.locator(`[data-resource-trashed="${FIXTURE_IDS.resource}"]`);
  await expect(currentRecovery).toBeVisible();
  await expect.poll(() => currentRecovery.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await page.goto("/");
  await openResourcesWithoutMainRowExpectation(page);
  await expect(page.locator(`#viewRoot [data-open-resource="${FIXTURE_IDS.resource}"]`)).toHaveCount(0);

  await page.goto(RESOURCE_PATH(FIXTURE_IDS.resource));
  const recovery = page.locator(`[data-resource-trashed="${FIXTURE_IDS.resource}"]`);
  await expect(recovery).toBeVisible();
  await recovery.locator(`[data-resource-restore="${FIXTURE_IDS.resource}"]`).first().click();

  const restored = page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
  await expect(restored).toBeVisible();
  await expect.poll(() => restored.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await expect(restored.locator('[data-block-content="fixture-block-heading-1"]')).toContainText("Heading one");
  await expect.poll(async () => resourceFromSnapshot(await fixtureSnapshot(request))?.trashedAt).toBe("");
  expect(resourceFromSnapshot(await fixtureSnapshot(request)).blocks).toEqual(before.blocks);
});

test("trash offers an immediate Undo that restores the original Resource", async ({ page, request }) => {
  const resourceId = FIXTURE_IDS.bodySearchResource;
  const note = await openResource(page, resourceId);
  const before = resourceFromSnapshot(await fixtureSnapshot(request), resourceId);
  const menu = await openPageMenu(page, note, resourceId);
  await menu.locator(`[data-resource-move-to-trash="${resourceId}"]`).click();

  const undo = page.locator(`[data-resource-trash-undo="${resourceId}"]`);
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(async () => resourceFromSnapshot(await fixtureSnapshot(request), resourceId)?.trashedAt).toBe("");
  expect(resourceFromSnapshot(await fixtureSnapshot(request), resourceId).blocks).toEqual(before.blocks);

  await page.goto("/");
  await openResources(page);
  await expect(page.locator(`#viewRoot [data-open-resource="${resourceId}"]`).first()).toBeVisible();
});

test("sub-page creation records parent and child order while the parent picker excludes self and descendants", async ({ page, request }) => {
  const before = await fixtureSnapshot(request);
  const existingIds = new Set(before.state.resources.map((resource) => resource.id));
  const note = await openResource(page);
  await note.locator(`[data-resource-create-child="${FIXTURE_IDS.resource}"]`).click();

  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return snapshot.state.resources.filter((resource) => !existingIds.has(resource.id)).length;
  }).toBe(1);
  const snapshot = await fixtureSnapshot(request);
  const child = snapshot.state.resources.find((resource) => !existingIds.has(resource.id));
  const parent = resourceFromSnapshot(snapshot);
  expect(child).toMatchObject({ parentId: FIXTURE_IDS.resource, trashedAt: "" });
  expect(child.blocks.length).toBeGreaterThan(0);
  expect(parent.childOrder).toContain(child.id);

  const parentNote = await openResource(page);
  await expect(parentNote.locator(`[data-resource-children="${FIXTURE_IDS.resource}"] [data-open-resource="${child.id}"]`)).toBeVisible();
  const parentPicker = parentNote.locator(`select[data-resource-parent="${FIXTURE_IDS.resource}"]`);
  await expect(parentPicker).toBeVisible();
  const parentOptions = await parentPicker.locator("option").evaluateAll((options) => options.map((option) => option.value));
  expect(parentOptions).not.toContain(FIXTURE_IDS.resource);
  expect(parentOptions).not.toContain(child.id);
});

test("backlinks are derived from page mentions instead of a duplicated stored index", async ({ page, request }) => {
  const snapshot = await fixtureSnapshot(request);
  expect(resourceFromSnapshot(snapshot, FIXTURE_IDS.bodySearchResource)).not.toHaveProperty("backlinks");

  const note = await openResource(page, FIXTURE_IDS.bodySearchResource);
  const backlinks = note.locator(`[data-resource-backlinks="${FIXTURE_IDS.bodySearchResource}"]`);
  await expect(backlinks).toBeVisible();
  const source = backlinks.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`);
  await expect(source).toContainText("E2E Notion Parity Resource");
});

test("single-user page discussions support add, reply, resolve, and reopen without fabricated identity", async ({ page, request }) => {
  const note = await openResource(page);
  await note.locator(`[data-resource-comments-toggle="${FIXTURE_IDS.resource}"]`).click();
  const pane = page.locator(`[data-resource-comments-pane="${FIXTURE_IDS.resource}"]`);
  await expect(pane).toBeVisible();

  const newBody = "New fixture page discussion";
  await pane.locator(`[data-page-discussion-composer="${FIXTURE_IDS.resource}"]`).fill(newBody);
  await pane.locator(`[data-page-discussion-submit="${FIXTURE_IDS.resource}"]`).click();
  await expect.poll(async () => resourceFromSnapshot(await fixtureSnapshot(request))?.commentThreads?.some((thread) => (
    thread.scope === "page" && thread.body === newBody
  ))).toBe(true);

  const thread = pane.locator(`[data-comment-thread="${FIXTURE_IDS.pageThread}"][data-comment-scope="page"]`);
  await thread.locator(`[data-comment-reply-input="${FIXTURE_IDS.pageThread}"]`).fill("Page discussion reply");
  await thread.locator(`[data-comment-reply-submit="${FIXTURE_IDS.pageThread}"]`).click();
  await expect.poll(async () => threadFromSnapshot(await fixtureSnapshot(request), FIXTURE_IDS.pageThread)?.replies?.map((reply) => reply.body)).toContain("Page discussion reply");

  await thread.locator(`[data-comment-resolve="${FIXTURE_IDS.pageThread}"]`).click();
  await expect(thread).toHaveAttribute("data-comment-status", "resolved");
  await expect.poll(async () => Boolean(threadFromSnapshot(await fixtureSnapshot(request), FIXTURE_IDS.pageThread)?.resolvedAt)).toBe(true);
  await thread.locator(`[data-comment-reopen="${FIXTURE_IDS.pageThread}"]`).click();
  await expect(thread).toHaveAttribute("data-comment-status", "open");
  await expect.poll(async () => threadFromSnapshot(await fixtureSnapshot(request), FIXTURE_IDS.pageThread)?.resolvedAt).toBe("");

  const finalResource = resourceFromSnapshot(await fixtureSnapshot(request));
  for (const commentThread of finalResource.commentThreads) {
    expect(commentThread).not.toHaveProperty("author");
    for (const reply of commentThread.replies) expect(reply).not.toHaveProperty("author");
  }
  await expect(pane.locator("[data-comment-author], [data-presence], [data-collaborator]")).toHaveCount(0);
});

test("an inline selection creates a threaded anchor that can reply, resolve, and reopen", async ({ page, request }) => {
  const note = await openResource(page);
  const blockId = "fixture-block-paragraph";
  const content = note.locator(`[data-block-content="${blockId}"]`);
  await selectTextRange(page, content, 0, 9);
  await page.locator('[data-inline-mark-toggle="comment"]').click();
  await page.locator("[data-inline-comment-input]").fill("New inline thread");
  await page.locator("[data-inline-comment-apply]").click();

  await expect.poll(async () => resourceFromSnapshot(await fixtureSnapshot(request))?.commentThreads?.some((thread) => (
    thread.scope === "inline" && thread.body === "New inline thread" && thread.anchor?.blockId === blockId
  ))).toBe(true);
  const snapshot = await fixtureSnapshot(request);
  const inlineThread = resourceFromSnapshot(snapshot).commentThreads.find((thread) => (
    thread.scope === "inline" && thread.body === "New inline thread" && thread.anchor?.blockId === blockId
  ));
  expect(inlineThread.anchor).toMatchObject({ blockId, start: 0, end: 9 });
  expect(inlineThread).not.toHaveProperty("author");

  const mark = note.locator(`[data-inline-comment-id="${inlineThread.id}"]`);
  await expect(mark).toBeVisible();
  await mark.click();
  const pane = page.locator(`[data-resource-comments-pane="${FIXTURE_IDS.resource}"]`);
  const thread = pane.locator(`[data-comment-thread="${inlineThread.id}"][data-comment-scope="inline"]`);
  await expect(thread).toBeVisible();
  await thread.locator(`[data-comment-reply-input="${inlineThread.id}"]`).fill("Inline thread reply");
  await thread.locator(`[data-comment-reply-submit="${inlineThread.id}"]`).click();
  await expect.poll(async () => threadFromSnapshot(await fixtureSnapshot(request), inlineThread.id)?.replies?.map((reply) => reply.body)).toContain("Inline thread reply");

  await thread.locator(`[data-comment-resolve="${inlineThread.id}"]`).click();
  await expect(thread).toHaveAttribute("data-comment-status", "resolved");
  await thread.locator(`[data-comment-reopen="${inlineThread.id}"]`).click();
  await expect(thread).toHaveAttribute("data-comment-status", "open");
  await expect.poll(async () => threadFromSnapshot(await fixtureSnapshot(request), inlineThread.id)?.resolvedAt).toBe("");
  await expect(pane.locator("[data-comment-author], [data-presence], [data-collaborator]")).toHaveCount(0);
});
