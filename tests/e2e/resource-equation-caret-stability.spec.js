import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const resourceId = FIXTURE_IDS.bodySearchResource;
const paragraph = (id, text = "", marks = [], indent = 0) => ({ id, type: "paragraph", text, marks, indent, checked: false, collapsed: false });

test.use({ reducedMotion: "reduce" });

async function savedBlocks(request) {
  return (await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === resourceId).blocks;
}

async function open(page, request, blocks) {
  await resetFixture(request);
  const snapshot = await fixtureSnapshot(request);
  const state = structuredClone(snapshot.state);
  state.resources.find((resource) => resource.id === resourceId).blocks = blocks;
  const response = await request.put("/api/state", { headers: { "If-Match": `"state-${snapshot.serverRevision}"` }, data: { state, baseRevision: snapshot.serverRevision } });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-nav-key="resources"]').evaluate((button) => button.click());
  await page.locator(`[data-resource-open="${resourceId}"]`).click();
  const editor = page.locator(`.block-editor[data-owner-id="${resourceId}"]`);
  await expect(editor).toBeVisible();
  return editor;
}

async function setCaret(content, edge) {
  await content.scrollIntoViewIfNeeded();
  await content.evaluate((element, edge) => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(edge === "start");
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, edge);
}

async function caret(content) {
  return content.evaluate((element) => {
    const selection = getSelection();
    if (!selection?.rangeCount || !element.contains(selection.focusNode)) return null;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(selection.focusNode, selection.focusOffset);
    const node = selection.focusNode.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode.parentElement;
    return { offset: range.toString().length, collapsed: selection.isCollapsed, focused: document.activeElement === element, insideEquation: Boolean(node.closest('[data-inline-mark="equation"]')) };
  });
}

for (const type of ["paragraph", "heading2", "toggle-child"]) test(`Enter at the start follows the moved ${type} text and preserves its format`, async ({ page, request }) => {
  const marks = [{ type: "bold", start: 0, end: 2 }];
  const target = { ...paragraph("target", "기존 문장", marks, type === "toggle-child" ? 1 : 0), type: type === "toggle-child" ? "paragraph" : type };
  const blocks = [...(type === "toggle-child" ? [{ ...paragraph("parent", "상위 토글"), type: "toggle" }] : []), target, paragraph("following", "다음 문장")];
  const editor = await open(page, request, blocks);
  const original = editor.locator('[data-block-content="target"]');
  await setCaret(original, "start");
  await original.press("Enter");
  const moved = editor.locator("[data-block-content]").filter({ hasText: /^기존 문장$/ });
  await expect(moved).toBeFocused();
  expect(await caret(moved)).toEqual({ offset: 0, collapsed: true, focused: true, insideEquation: false });
  await expect(moved.locator('[data-inline-mark="bold"]')).toHaveText("기존");
  await expect(original).toHaveText("");
  await expect.poll(async () => {
    const stored = await savedBlocks(request);
    const index = stored.findIndex((block) => block.text === "기존 문장");
    return { preceding: stored[index - 1]?.text, type: stored[index]?.type, indent: stored[index]?.indent, marks: stored[index]?.marks };
  }).toEqual({ preceding: "", type: target.type, indent: target.indent, marks });
  await moved.press("Meta+z");
  await expect(original).toHaveText("기존 문장");
  await expect(original).toBeFocused();
  await original.press("Meta+Shift+z");
  await expect(moved).toBeFocused();
  expect(await caret(moved)).toMatchObject({ offset: 0, focused: true });
  const movedId = await moved.getAttribute("data-block-content");
  const edited = editor.locator(`[data-block-content="${movedId}"]`);
  await edited.pressSequentially("X");
  await expect(edited).toHaveText("X기존 문장");
  await expect(original).toHaveText("");
});

test("unchanged equation renderers survive spaces, backspaces and other block structure edits", async ({ page, request }) => {
  const marks = [{ type: "equation", start: 2, end: 5, formula: "x+y" }, { type: "equation", start: 8, end: 11, formula: "z^2" }];
  const tableText = "| 수식 |\n| --- |\n| t+1 끝 |";
  const table = { ...paragraph("table", tableText), type: "table", tableCellMarks: { "1:0": [{ type: "equation", start: 0, end: 3, formula: "t+1" }] } };
  const editor = await open(page, request, [paragraph("equations", "A x+y B z^2 C", marks), paragraph("other", "다른 문장"), table]);
  const beforeBlocks = await savedBlocks(request);
  const content = editor.locator('[data-block-content="equations"]');
  const hosts = editor.locator("sygma-display-equation");
  for (const host of await hosts.all()) {
    await expect(host).toHaveAttribute("data-equation-rendered", "true");
    await expect.poll(() => host.evaluate((node) => Boolean(node.shadowRoot.querySelector('link[rel="stylesheet"]').sheet))).toBe(true);
  }
  await hosts.evaluateAll((nodes) => { window.__stableEquations = nodes.map((host) => ({ host, shadow: host.shadowRoot, math: host.shadowRoot.querySelector(".katex-html"), formula: host.dataset.formula, mode: host.dataset.displayMode })); });
  const expectStable = async () => {
    const identity = await hosts.evaluateAll((nodes) => nodes.map((host, index) => {
      const before = window.__stableEquations[index];
      return { formula: host.dataset.formula, mode: host.dataset.displayMode, beforeFormula: before?.formula, beforeMode: before?.mode, host: host === before?.host, connected: host.isConnected, shadow: host.shadowRoot === before?.shadow, math: host.shadowRoot.querySelector(".katex-html") === before?.math };
    }));
    const stable = identity.length === 3 && identity.every((entry) => entry.host && entry.connected && entry.shadow && entry.math);
    const detail = stable ? "" : JSON.stringify({ identity, before: beforeBlocks.find((block) => block.id === "table"), after: (await savedBlocks(request)).find((block) => block.id === "table") });
    expect(stable, detail).toBe(true);
  };
  await setCaret(content, "end");
  for (let index = 0; index < 3; index += 1) {
    await content.press("Space");
    await expectStable();
    await content.press("Backspace");
    await expectStable();
  }
  const cell = editor.locator('[data-resource-table-cell][data-table-row="1"][data-table-column="0"]');
  await setCaret(cell, "end");
  await cell.press("Space");
  await expectStable();
  await cell.press("Backspace");
  await expectStable();
  const other = editor.locator('[data-block-content="other"]');
  await setCaret(other, "end");
  await expectStable();
  await other.press("Enter");
  await expect(editor.locator("[data-block-content]:focus")).toHaveText("");
  await expectStable();
  await page.keyboard.press("Backspace");
  await expect(other).toBeFocused();
  await expectStable();
  await expect.poll(async () => (await savedBlocks(request)).map(({ text, marks }) => ({ text, marks }))).toEqual([{ text: "A x+y B z^2 C", marks }, { text: "다른 문장", marks: [] }, { text: tableText, marks: [] }]);
  await content.locator('[data-inline-mark="equation"]').first().click();
  const dialog = page.getByRole("dialog", { name: "수식 편집" });
  const input = dialog.getByRole("textbox", { name: "수식 입력" });
  await input.fill("x-y");
  await input.press("Enter");
  await expect(hosts.first().locator('annotation[encoding="application/x-tex"]')).toHaveText("x-y");
  expect(await hosts.evaluateAll((nodes) => ({ changed: nodes[0] !== window.__stableEquations[0].host, unchanged: nodes.slice(1).every((node, index) => node === window.__stableEquations[index + 1].host && node.shadowRoot.querySelector(".katex-html") === window.__stableEquations[index + 1].math) }))).toEqual({ changed: true, unchanged: true });
});

for (const width of [1440, 390]) test(`Left and Right cross each equation with one visible outside caret at ${width}px`, async ({ page, request }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  const formula = String.raw`\frac{a}{b}`;
  const cases = [{ id: "middle", prefix: "A", suffix: "Z", displayMode: false }, { id: "leading", prefix: "", suffix: "끝", displayMode: false }, { id: "display", prefix: "", suffix: "", displayMode: true }];
  const originals = cases.map(({ id, prefix, suffix, displayMode }) => paragraph(id, `${prefix}${formula}${suffix}`, [{ type: "equation", start: prefix.length, end: prefix.length + formula.length, formula, ...(displayMode ? { displayMode: true } : {}) }]));
  const editor = await open(page, request, [paragraph("previous", "이전"), ...originals, paragraph("next", "다음")]);
  const geometry = [];
  const inspectBoundary = async (content, id, forward) => {
    await expect(content).toHaveAttribute("data-inline-boundary-caret", "true");
    await expect(editor.locator("[data-inline-boundary-caret]")).toHaveCount(1);
    const bounds = await content.evaluate((node, forward) => {
      const mark = node.querySelector('[data-inline-mark="equation"]');
      const rects = [...mark.getClientRects()];
      const edge = rects[forward ? rects.length - 1 : 0];
      const rect = node.getBoundingClientRect();
      const pseudo = getComputedStyle(node, "::after");
      return { x: rect.left + parseFloat(pseudo.left) - node.scrollLeft, y: rect.top + parseFloat(pseudo.top) - node.scrollTop, width: parseFloat(pseudo.width), height: parseFloat(pseudo.height), expectedX: forward ? edge.right + 1 : edge.left - 1, nativeCaret: getComputedStyle(node).caretColor, opacity: Number(pseudo.opacity), viewport: innerWidth };
    }, forward);
    expect(bounds.nativeCaret).toMatch(/transparent|rgba\(0, 0, 0, 0\)/);
    expect(bounds.width).toBe(1);
    expect(bounds.height).toBeGreaterThan(10);
    expect(bounds.opacity).toBe(1);
    expect(Math.abs(bounds.x - bounds.expectedX)).toBeLessThan(2);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    geometry.push({ id, side: forward ? "right" : "left", ...bounds });
    const blockBounds = await editor.locator(`[data-block-id="${id}"]`).boundingBox();
    const viewport = page.viewportSize();
    const x = Math.max(0, blockBounds.x - 8);
    const y = Math.max(0, blockBounds.y - 8);
    // Include the caret just outside the block rather than clipping it at the edge.
    await page.screenshot({ path: info.outputPath(`equation-caret-${id}-${forward ? "right" : "left"}-${width}.png`), caret: "initial", clip: { x, y, width: Math.min(viewport.width, blockBounds.x + blockBounds.width + 8) - x, height: Math.min(viewport.height, blockBounds.y + blockBounds.height + 8) - y } });
  };
  for (const entry of cases) {
    const content = editor.locator(`[data-block-content="${entry.id}"]`);
    const mark = content.locator('[data-inline-mark="equation"]');
    await expect(mark.locator("sygma-display-equation")).toHaveAttribute("data-equation-rendered", "true");
    await content.scrollIntoViewIfNeeded();
    if (entry.prefix && entry.suffix) {
      await setCaret(content, "start");
      await content.press("ArrowRight");
      expect(await caret(content)).toEqual({ offset: entry.prefix.length, collapsed: true, focused: true, insideEquation: false });
      await inspectBoundary(content, entry.id, false);
      await content.press("ArrowRight");
      await content.press("ArrowRight");
      expect(await caret(content)).toEqual({ offset: entry.prefix.length + formula.length + 1, collapsed: true, focused: true, insideEquation: false });
      await content.press("ArrowLeft");
      expect(await caret(content)).toEqual({ offset: entry.prefix.length + formula.length, collapsed: true, focused: true, insideEquation: false });
      await inspectBoundary(content, entry.id, true);
    }
    await mark.evaluate((node) => {
      node.closest("[data-block-content]").focus();
      const range = document.createRange();
      range.setStartBefore(node);
      range.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    for (let index = 0; index < 3; index += 1) {
      await content.press("ArrowRight");
      expect(await caret(content)).toEqual({ offset: entry.prefix.length + formula.length, collapsed: true, focused: true, insideEquation: false });
      await content.press("ArrowLeft");
      expect(await caret(content)).toEqual({ offset: entry.prefix.length, collapsed: true, focused: true, insideEquation: false });
    }
    await inspectBoundary(content, entry.id, false);
    await content.press("ArrowRight");
    await inspectBoundary(content, entry.id, true);
    await content.pressSequentially("R");
    await expect.poll(async () => (await savedBlocks(request)).find((block) => block.id === entry.id)?.text).toBe(`${entry.prefix}${formula}R${entry.suffix}`);
    await expect(mark).toHaveAttribute("data-equation-formula", formula);
    await expect(editor.locator(".block.is-selected")).toHaveCount(0);
  }
  const stored = await savedBlocks(request);
  for (const original of originals) expect(stored.find((block) => block.id === original.id).marks).toEqual(original.marks);
  expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(width);
  await writeFile(info.outputPath(`equation-caret-geometry-${width}.json`), JSON.stringify(geometry, null, 2));
});
