import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const resourceId = FIXTURE_IDS.bodySearchResource;
const tableText = "| 제목 A | 제목 B | 제목 C |\n| --- | --- | --- |\n| alpha bravo charlie | 둘째 | 긴 설명<br>두 번째 줄<br>세 번째 줄<br>네 번째 줄 |\n| 아래 A | 아래 B | 아래 C |\n| 마지막 A | 마지막 B | 마지막 C |";
test.use({ reducedMotion: "reduce", hasTouch: true });

async function setup(page, request) {
  await resetFixture(request);
  const snapshot = await fixtureSnapshot(request);
  snapshot.state.resources.find((resource) => resource.id === resourceId).blocks = [{
    id: "range-table", type: "table", text: tableText, marks: [], indent: 0, checked: false, collapsed: false, columnWidths: [140, 140, 140],
  }];
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${snapshot.serverRevision}"` },
    data: { state: snapshot.state, baseRevision: snapshot.serverRevision },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-nav-key="resources"]').evaluate((node) => node.click());
  await page.locator(`[data-resource-open="${resourceId}"]`).click();
  const block = page.locator('[data-block-id="range-table"]');
  await block.scrollIntoViewIfNeeded();
  await expect.poll(() => block.evaluate((node) => node.closest(".resource-window").getAnimations().every((animation) => animation.playState !== "running"))).toBe(true);
  return block;
}
const cell = (block, row, column) => block.locator(`[data-resource-table-cell][data-table-row="${row}"][data-table-column="${column}"]`);
const selected = (block) => block.locator(".is-cell-selected").evaluateAll((nodes) => nodes.map((node) => `${node.dataset.tableRow}:${node.dataset.tableColumn}`));
async function point(content, bottom = false) {
  const rect = await content.locator("..").boundingBox();
  return { x: rect.x + rect.width / 2, y: bottom ? rect.y + rect.height - 10 : rect.y + 15 };
}
async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

for (const width of [1440, 390]) test(`full cell whitespace focuses the editor and horizontal drag selects exactly two cells at ${width}px`, async ({ page, request }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  const block = await setup(page, request);
  const first = cell(block, 1, 0), second = cell(block, 1, 1);
  const from = await point(first, true), to = await point(second, true);
  if (width === 390) await page.touchscreen.tap(from.x, from.y);
  else await page.mouse.click(from.x, from.y);
  await expect(first).toBeFocused();
  await expect(block).not.toHaveClass(/\bis-selected\b/);
  await drag(page, from, to);
  await expect.poll(() => selected(block)).toEqual(["1:0", "1:1"]);
  await expect(block).not.toHaveClass(/\bis-selected\b/);
  expect(await page.evaluate(() => getSelection().toString())).toBe("");
  await block.screenshot({ path: info.outputPath("two-selected-cells.png") });
  await block.locator('[data-resource-table-format="tableBold"]').click();
  await expect.poll(async () => {
    const state = await fixtureSnapshot(request);
    return state.state.resources.find((resource) => resource.id === resourceId).blocks[0];
  }).toMatchObject({ text: tableText, tableCellFormats: { "1:0": { bold: true }, "1:1": { bold: true } } });
  await expect.poll(() => selected(block)).toEqual(["1:0", "1:1"]);
  await expect(cell(block, 1, 2).locator("..")).toHaveCSS("font-weight", "400");
});

test("cell rectangles extend vertically and shrink when the pointer returns", async ({ page, request }) => {
  const block = await setup(page, request);
  await drag(page, await point(cell(block, 1, 1)), await point(cell(block, 2, 1)));
  await expect.poll(() => selected(block)).toEqual(["1:1", "2:1"]);
  const from = await point(cell(block, 2, 1)), diagonal = await point(cell(block, 1, 0)), back = await point(cell(block, 2, 0));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(diagonal.x, diagonal.y, { steps: 12 });
  await expect.poll(() => selected(block)).toEqual(["1:0", "1:1", "2:0", "2:1"]);
  await page.mouse.move(back.x, back.y, { steps: 12 });
  const bounds = await block.boundingBox();
  await page.mouse.move(bounds.x - 12, back.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => selected(block)).toEqual(["2:0", "2:1"]);
  expect(await page.evaluate(() => getSelection().toString())).toBe("");
  await page.keyboard.press("Enter");
  await expect(cell(block, 2, 1)).toBeFocused();
  await expect.poll(() => selected(block)).toEqual([]);
});

test("dragging text inside one cell preserves native text selection", async ({ page, request }) => {
  const block = await setup(page, request);
  const content = cell(block, 1, 0);
  const from = await point(content), to = await point(cell(block, 1, 1));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await expect.poll(() => selected(block)).toEqual(["1:0", "1:1"]);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => selected(block)).toEqual([]);
  await expect(block.locator('[data-table-selection-edges], [aria-readonly="true"]')).toHaveCount(0);
  await expect(content).toHaveAttribute("contenteditable", "true");
  const rect = await content.evaluate((node) => {
    const range = document.createRange();
    range.setStart(node.firstChild, 0); range.setEnd(node.firstChild, 5);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await drag(page, { x: rect.x + 1, y: rect.y + rect.height / 2 }, { x: rect.x + rect.width - 1, y: rect.y + rect.height / 2 });
  await expect.poll(() => selected(block)).toEqual([]);
  await expect.poll(() => page.evaluate(() => getSelection().toString())).toBe("alpha");
  await expect(block).not.toHaveClass(/\bis-selected\b/);
});
