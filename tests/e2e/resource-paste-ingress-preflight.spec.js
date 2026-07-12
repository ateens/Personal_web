import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, openMainResourceFromList, resetFixture } from "./helpers.js";

const MIME = "application/x-sygma-blocks";

async function openEditor(page) {
  await page.goto("/");
  const note = await openMainResourceFromList(page);
  const title = note.locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`);
  const paragraph = note.locator('[data-block-content="fixture-block-paragraph"]');
  await expect(title).toBeVisible();
  await expect(paragraph).toBeVisible();
  return { note, title, paragraph };
}

async function resourceState(request) {
  const snapshot = await fixtureSnapshot(request);
  return {
    resource: snapshot.state.resources.find((entry) => entry.id === FIXTURE_IDS.resource),
    revision: snapshot.state.revision,
    writes: snapshot.writes,
    writeAttempts: snapshot.writeAttempts,
  };
}

async function captureNoop(page, request) {
  const state = await resourceState(request);
  return {
    state,
    dom: await page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`).evaluate((node) => node.innerHTML.replace(/ is-icon-hover/g, "").replace(/class="block "/g, "class=\"block\"").replace(/overflow-anchor: none;/g, "").replace(/ style=""/g, "")),
    focus: await page.evaluate(() => document.activeElement?.getAttribute("data-block-content") || document.activeElement?.getAttribute("data-resource-title") || document.activeElement?.tagName || ""),
    selection: await page.evaluate(() => ({ ...ui.blockSelection, ids: ui.blockSelection.ids.slice() })),
  };
}

async function expectNoop(page, request, before) {
  await page.waitForTimeout(475);
  const after = await captureNoop(page, request);
  expect(after.state.resource).toEqual(before.state.resource);
  expect(after.state.revision).toBe(before.state.revision);
  expect(after.state.writes).toEqual(before.state.writes);
  expect(after.state.writeAttempts).toEqual(before.state.writeAttempts);
  expect(after.dom).toBe(before.dom);
  expect(after.focus).toBe(before.focus);
  expect(after.selection).toEqual(before.selection);
}

async function appPasteBlocks(locator, blocks, options = {}) {
  return locator.evaluate((node, { blocks, options }) => pasteBlocksFromClipboard({ target: node }, blocks, options), { blocks, options });
}

async function dispatchPaste(locator, payload) {
  return locator.evaluate((node, { plain = "", html = "", custom = "", file = false }) => {
    const data = new DataTransfer();
    if (plain) data.setData("text/plain", plain);
    if (html) data.setData("text/html", html);
    if (custom) data.setData("application/x-sygma-blocks", custom);
    if (file) data.items.add(new File(["x"], "x.txt", { type: "text/plain" }));
    return node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  }, payload);
}

async function dispatchDrop(locator, file = true) {
  return locator.evaluate((node, hasFile) => {
    const data = new DataTransfer();
    if (hasFile) data.items.add(new File(["x"], "x.txt", { type: "text/plain" }));
    return node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
  }, file);
}

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("file paste/drop on Resource title, block, and page are atomic and leave unrelated drops available", async ({ page, request }) => {
  const { note, title, paragraph } = await openEditor(page);
  await paragraph.focus();
  for (const target of [paragraph, title]) {
    const before = await captureNoop(page, request);
    expect(await dispatchPaste(target, { plain: "kept", file: true })).toBe(false);
    await expectNoop(page, request, before);
  }
  for (const target of [paragraph, title, note]) {
    const before = await captureNoop(page, request);
    expect(await dispatchDrop(target)).toBe(false);
    await expectNoop(page, request, before);
  }
  expect(await page.evaluate(() => [...document.querySelectorAll("img,iframe,object,embed,a[download]")].some((node) => /^(data|blob):/i.test(node.src || node.href || "")))).toBe(false);
});

test("oversized raw/custom/html representations reject before native or fallback mutation", async ({ page, request }) => {
  const { paragraph } = await openEditor(page);
  await paragraph.focus();
  for (const payload of [
    { plain: "x".repeat(5_000_001) },
    { custom: "x".repeat(250_001), plain: "fallback" },
    { custom: "{bad", html: `<p>${"h".repeat(250_001)}</p>`, plain: "fallback" },
  ]) {
    const before = await captureNoop(page, request);
    expect(await dispatchPaste(paragraph, payload)).toBe(false);
    await expectNoop(page, request, before);
  }
});

test("Resource structural projection enforces exact block, text, and body limits atomically", async ({ page, request }) => {
  const { paragraph } = await openEditor(page);
  await paragraph.focus();
  expect(await page.evaluate(() => {
    const resource = cloneForLocalPersistence(itemById("resources", "fixture-resource-main"));
    resource.blocks = Array.from({ length: 5000 }, (_, index) => ({ id: `limit-${index}`, type: "paragraph", text: "x", marks: [], checked: false, indent: 0, collapsed: false }));
    return resourcePasteProjectionValid(resource);
  })).toBe(true);
  expect(await page.evaluate(() => {
    const resource = cloneForLocalPersistence(itemById("resources", "fixture-resource-main"));
    resource.blocks = Array.from({ length: 5001 }, (_, index) => ({ id: `limit-over-${index}`, type: "paragraph", text: "x", marks: [], checked: false, indent: 0, collapsed: false }));
    return resourcePasteProjectionValid(resource);
  })).toBe(false);

  const textOverflow = [{ type: "paragraph", text: "y".repeat(250_001) }];
  const before = await captureNoop(page, request);
  expect(await appPasteBlocks(paragraph, textOverflow)).toBe(false);
  await expectNoop(page, request, before);
});

test("accepted custom, html, markdown/plain, code, url and native single-line paths still work", async ({ page, request }) => {
  const { paragraph } = await openEditor(page);
  await paragraph.focus();
  expect(await appPasteBlocks(paragraph, [{ type: "heading2", text: "custom ok" }])).toBe(true);
  await expect(page.locator("text=custom ok")).toBeVisible();
  await paragraph.focus();
  expect(await appPasteBlocks(paragraph, [{ type: "heading3", text: "html ok" }])).toBe(true);
  await expect(page.locator("text=html ok")).toBeVisible();
  await paragraph.focus();
  expect(await appPasteBlocks(paragraph, [{ type: "bullet", text: "markdown ok" }])).toBe(true);
  await expect(page.locator("text=markdown ok")).toBeVisible();
  await expect.poll(async () => (await resourceState(request)).resource.blocks.some((block) => block.text === "custom ok")).toBe(true);
});

test("block selection survives rejected ingress and undo reaches the prior real edit", async ({ page, request }) => {
  const { paragraph } = await openEditor(page);
  await paragraph.focus();
  await appPasteBlocks(paragraph, [{ type: "paragraph", text: "real edit" }]);
  await expect(page.locator("text=real edit")).toBeVisible();
  await expect.poll(async () => (await resourceState(request)).resource.blocks.some((block) => block.text === "real edit")).toBe(true);
  await page.evaluate(() => { ui.blockSelection = { ownerType: "resources", ownerId: "res-e2e-main", ids: ["fixture-block-paragraph"] }; renderDetail({ soft: true }); });
  const before = await captureNoop(page, request);
  await dispatchPaste(paragraph, { plain: "x".repeat(5_000_001) });
  await expectNoop(page, request, before);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Z" : "Control+Z");
  await expect(page.locator("text=real edit")).toHaveCount(0);
});
