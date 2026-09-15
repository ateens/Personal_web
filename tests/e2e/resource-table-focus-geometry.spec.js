import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

test.use({ reducedMotion: "reduce" });

async function openTable(page, request, width) {
  await page.setViewportSize({ width, height: 900 });
  await resetFixture(request);
  const snapshot = await fixtureSnapshot(request);
  const resource = snapshot.state.resources.find((item) => item.id === FIXTURE_IDS.bodySearchResource);
  resource.blocks = [{
    id: "uneven-cells", type: "table", indent: 0, marks: [], checked: false, collapsed: false,
    text: `| ${"길이가 다른 제목 ".repeat(6)} | 짧은 제목 | 끝 제목 |\n| --- | --- | --- |\n| ${"여러 줄이 되는 설명입니다. ".repeat(10)} | 짧은 내용 | 끝 내용 |\n| 아래 왼쪽 | 아래 가운데 | 아래 오른쪽 |`,
    columnWidths: [180, 180, 180],
    tableCellFormats: { "1:1": { backgroundColor: "yellow", color: "blue", bold: true }, "2:2": { header: true, backgroundColor: "green" } },
  }];
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${snapshot.serverRevision}"` },
    data: { state: snapshot.state, baseRevision: snapshot.serverRevision },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-nav-key="resources"]').evaluate((button) => button.click());
  await page.locator(`[data-resource-open="${resource.id}"]`).click();
  const block = page.locator('[data-block-id="uneven-cells"]');
  await expect(block).toBeVisible();
  await expect.poll(() => block.evaluate((element) => element.closest(".resource-window").getAnimations().every((animation) => animation.playState !== "running"))).toBe(true);
  return block;
}

async function metrics(content) {
  return content.evaluate((element) => {
    const cell = element.parentElement;
    const bounds = cell.getBoundingClientRect();
    const span = element.getBoundingClientRect();
    const style = getComputedStyle(cell);
    const outline = getComputedStyle(cell, "::after");
    const table = cell.closest("table").getBoundingClientRect();
    return {
      width: bounds.width, height: bounds.height, spanHeight: span.height,
      tableWidth: table.width, tableHeight: table.height,
      background: style.backgroundColor, color: style.color, weight: style.fontWeight,
      outlineWidth: Number.parseFloat(outline.width), outlineHeight: Number.parseFloat(outline.height),
      borders: [outline.borderTopWidth, outline.borderRightWidth, outline.borderBottomWidth, outline.borderLeftWidth],
      outlineContent: outline.content, pointerEvents: outline.pointerEvents,
      spanShadow: getComputedStyle(element).boxShadow,
      htmlWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, viewport: innerWidth,
    };
  });
}

for (const width of [1440, 390]) test(`full-cell focus and selection keep equal borders on unequal rows at ${width}px`, async ({ page, request }, testInfo) => {
  const block = await openTable(page, request, width);
  const result = [];
  for (const [row, column] of [[0, 1], [1, 1], [2, 2]]) {
    const content = block.locator(`[data-resource-table-cell][data-table-row="${row}"][data-table-column="${column}"]`);
    await content.scrollIntoViewIfNeeded();
    const before = await metrics(content);
    await content.click();
    await expect(content).toBeFocused();
    const focused = await metrics(content);
    if (row < 2) expect(focused.height - focused.spanHeight).toBeGreaterThan(40);
    expect(focused.borders).toEqual(Array(4).fill("2px"));
    expect(Math.abs(focused.outlineHeight - focused.height)).toBeLessThan(1);
    expect(Math.abs(focused.outlineWidth - focused.width)).toBeLessThan(1);
    expect(focused.pointerEvents).toBe("none");
    expect(focused.spanShadow).toBe("none");
    for (const field of ["width", "height", "tableWidth", "tableHeight", "background", "color", "weight"]) expect(focused[field]).toBe(before[field]);
    expect(focused.htmlWidth).toBeLessThanOrEqual(width);
    expect(focused.bodyWidth).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`focus-${row}-${column}-${width}.png`) });
    await content.press("Escape");
    await expect(content).toHaveClass(/is-cell-selected/);
    const selected = await metrics(content);
    expect(selected.borders).toEqual(Array(4).fill("2px"));
    expect(Math.abs(selected.outlineHeight - selected.height)).toBeLessThan(1);
    expect(Math.abs(selected.outlineWidth - selected.width)).toBeLessThan(1);
    expect(selected.background).toBe(before.background);
    expect(selected.color).toBe(before.color);
    expect(selected.tableHeight).toBe(before.tableHeight);
    result.push({ row, column, before, focused, selected });
    await content.press("Enter");
  }
  await page.locator('[data-resource-back]').first().focus();
  expect(await block.locator("td, th").evaluateAll((cells) => cells.every((cell) => getComputedStyle(cell, "::after").content === "none"))).toBe(true);
  await writeFile(testInfo.outputPath(`cell-focus-geometry-${width}.json`), JSON.stringify(result, null, 2));
});
