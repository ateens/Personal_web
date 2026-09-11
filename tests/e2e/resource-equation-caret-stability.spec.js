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
    await expect.poll(() => host.evaluate((node) => Boolean(node.shadowRoot.adoptedStyleSheets[0] || node.shadowRoot.querySelector('link[rel="stylesheet"]')?.sheet))).toBe(true);
  }
  await hosts.evaluateAll((nodes) => { window.__stableEquations = nodes.map((host) => ({ host, shadow: host.shadowRoot, math: host.shadowRoot.querySelector(".katex-html"), stylesheet: host.shadowRoot.adoptedStyleSheets[0] || host.shadowRoot.querySelector('link[rel="stylesheet"]')?.sheet, formula: host.dataset.formula, mode: host.dataset.displayMode })); });
  const expectStable = async () => {
    const identity = await hosts.evaluateAll((nodes) => nodes.map((host, index) => {
      const before = window.__stableEquations[index];
      return { formula: host.dataset.formula, mode: host.dataset.displayMode, beforeFormula: before?.formula, beforeMode: before?.mode, host: host === before?.host, connected: host.isConnected, shadow: host.shadowRoot === before?.shadow, math: host.shadowRoot.querySelector(".katex-html") === before?.math, stylesheet: (host.shadowRoot.adoptedStyleSheets[0] || host.shadowRoot.querySelector('link[rel="stylesheet"]')?.sheet) === before?.stylesheet };
    }));
    const stable = identity.length === 3 && identity.every((entry) => entry.host && entry.connected && entry.shadow && entry.math && entry.stylesheet);
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

test.describe("Enter preserves equation rendering without a reload", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const define = customElements.define.bind(customElements);
      customElements.define = (name, constructor, options) => {
        if (name === "sygma-display-equation") {
          for (const phase of ["connected", "disconnected"]) {
            const original = constructor.prototype[`${phase}Callback`];
            constructor.prototype[`${phase}Callback`] = function (...args) {
              original?.apply(this, args);
              window.__equationReloadTrace?.events.push({ host: this, phase, formula: this.dataset.formula, stylesheetReady: Boolean(this.shadowRoot?.adoptedStyleSheets[0] || this.shadowRoot?.querySelector('link[rel="stylesheet"]')?.sheet) });
            };
          }
        }
        return define(name, constructor, options);
      };
    });
  });

  async function beginTrace(editor) {
    for (const host of await editor.locator("sygma-display-equation").all()) {
      await expect(host).toHaveAttribute("data-equation-rendered", "true");
      await expect.poll(() => host.evaluate((node) => Boolean(node.shadowRoot.adoptedStyleSheets[0] || node.shadowRoot.querySelector('link[rel="stylesheet"]')?.sheet))).toBe(true);
    }
    await editor.evaluate((element) => {
      const refs = [...element.querySelectorAll("sygma-display-equation")].map((host) => ({ host, formula: host.dataset.formula, shadow: host.shadowRoot, math: host.shadowRoot.querySelector(".katex-html"), stylesheet: host.shadowRoot.adoptedStyleSheets[0] || host.shadowRoot.querySelector('link[rel="stylesheet"]')?.sheet }));
      const trace = window.__equationReloadTrace = { refs, events: [], missingPaint: [], running: true };
      const sample = () => {
        if (!trace.running) return;
        for (const host of element.querySelectorAll("sygma-display-equation")) {
          const root = host.shadowRoot;
          const math = root?.querySelector(".katex-html");
          const stylesheetReady = Boolean(root?.adoptedStyleSheets[0] || root?.querySelector('link[rel="stylesheet"]')?.sheet);
          if (!stylesheetReady || !math || math.getBoundingClientRect().width === 0) trace.missingPaint.push({ formula: host.dataset.formula, stylesheetReady, mathReady: Boolean(math) });
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  }

  async function traceResult(editor) {
    await editor.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return editor.evaluate((element) => {
      const trace = window.__equationReloadTrace;
      trace.running = false;
      const hosts = [...element.querySelectorAll("sygma-display-equation")];
      return {
        identity: trace.refs.map((before) => {
          const host = hosts.find((candidate) => candidate.dataset.formula === before.formula);
          return { formula: before.formula, host: host === before.host, shadow: host?.shadowRoot === before.shadow, math: host?.shadowRoot?.querySelector(".katex-html") === before.math, stylesheet: (host?.shadowRoot?.adoptedStyleSheets[0] || host?.shadowRoot?.querySelector('link[rel="stylesheet"]')?.sheet) === before.stylesheet, connected: Boolean(host?.isConnected) };
        }),
        events: trace.events.map(({ host, ...event }) => ({ ...event, original: trace.refs.some((ref) => ref.host === host) })),
        missingPaint: trace.missingPaint,
      };
    });
  }

  async function assertTrace(editor, info, allowReconnect = false) {
    const result = await traceResult(editor);
    await writeFile(info.outputPath("equation-enter-lifecycle.json"), JSON.stringify(result, null, 2));
    expect(result.identity.every(({ host, shadow, math, stylesheet, connected }) => host && shadow && math && stylesheet && connected), JSON.stringify(result)).toBe(true);
    expect(result.missingPaint, JSON.stringify(result)).toEqual([]);
    if (!allowReconnect) expect(result.events, JSON.stringify(result)).toEqual([]);
  }

  for (const position of ["start", "middle", "end"]) test(`same equation block Enter at ${position} retains existing renderers`, async ({ page, request }, info) => {
    const text = "AA x+y BB z^2 CC";
    const marks = [{ type: "equation", start: 3, end: 6, formula: "x+y" }, { type: "equation", start: 10, end: 13, formula: "z^2" }];
    const editor = await open(page, request, [paragraph("same", text, marks), paragraph("after", "다음")]);
    const content = editor.locator('[data-block-content="same"]');
    await setCaret(content, position === "end" ? "end" : "start");
    if (position === "middle") await content.evaluate((element) => {
      const mark = element.querySelector('[data-inline-mark="equation"]');
      const range = document.createRange();
      range.setStart(mark.nextSibling, 2);
      range.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await beginTrace(editor);
    await content.press("Enter");
    await expect(editor.locator("[data-block-content]")).toHaveCount(3);
    await assertTrace(editor, info, position !== "end");
    await expect.poll(async () => (await savedBlocks(request)).flatMap((block) => block.marks.filter((mark) => mark.type === "equation").map((mark) => mark.formula))).toEqual(["x+y", "z^2"]);
  });

  test("repeated Enter around a standalone display equation does not reconnect it", async ({ page, request }, info) => {
    const formula = String.raw`\frac{a}{b}`;
    const editor = await open(page, request, [paragraph("before", "이전"), paragraph("display", formula, [{ type: "equation", start: 0, end: formula.length, formula, displayMode: true }]), paragraph("after", "다음")]);
    await setCaret(editor.locator('[data-block-content="before"]'), "end");
    await beginTrace(editor);
    for (let count = 0; count < 3; count += 1) await page.keyboard.press("Enter");
    await setCaret(editor.locator('[data-block-content="after"]'), "start");
    for (let count = 0; count < 3; count += 1) await page.keyboard.press("Enter");
    await assertTrace(editor, info);
    await expect(editor.locator('[data-block-content="display"] sygma-display-equation')).toHaveCount(1);
  });

  test("repeated Enter before the same standalone display equation retains its renderer", async ({ page, request }, info) => {
    const formula = String.raw`\sum_{i=1}^{n} i`;
    const editor = await open(page, request, [paragraph("display", formula, [{ type: "equation", start: 0, end: formula.length, formula, displayMode: true }]), paragraph("after", "다음")]);
    await setCaret(editor.locator('[data-block-content="display"]'), "start");
    await beginTrace(editor);
    for (let count = 0; count < 3; count += 1) await page.keyboard.press("Enter");
    await assertTrace(editor, info, true);
    await expect(editor.locator("sygma-display-equation")).toHaveCount(1);
  });

  test("Enter in another numbered item does not reconnect list equations", async ({ page, request }, info) => {
    const numbered = (id, text, marks = []) => ({ ...paragraph(id, text, marks), type: "numbered" });
    const editor = await open(page, request, [numbered("equation-item", "값 x+y", [{ type: "equation", start: 2, end: 5, formula: "x+y" }]), numbered("plain-item", "일반 항목"), numbered("second-equation", "값 z^2", [{ type: "equation", start: 2, end: 5, formula: "z^2" }])]);
    await setCaret(editor.locator('[data-block-content="plain-item"]'), "end");
    await beginTrace(editor);
    await page.keyboard.press("Enter");
    await assertTrace(editor, info);
    await expect.poll(async () => (await savedBlocks(request)).map((block) => block.type)).toEqual(["numbered", "numbered", "numbered", "numbered"]);
  });
});

test.describe("equation right-edge navigation and deletion", () => {
  const formula = "x+y";
  const contexts = [
    { name: "inline at paragraph end", prefix: "A", suffix: "" },
    { name: "inline between text", prefix: "A", suffix: "B" },
    { name: "standalone display", prefix: "", suffix: "", displayMode: true },
    { name: "bold and color wrapped inline", prefix: "A", suffix: "", wrapped: true },
    { name: "inline in table", prefix: "A", suffix: "B", table: true },
    { name: "display in table", prefix: "", suffix: "", displayMode: true, table: true },
  ];

  async function setup(page, request, context) {
    const text = `${context.prefix}${formula}${context.suffix}`;
    const range = { start: context.prefix.length, end: context.prefix.length + formula.length };
    const marks = [...(context.wrapped ? [{ type: "bold", ...range }, { type: "textColor", ...range, color: "blue" }] : []), { type: "equation", ...range, formula, ...(context.displayMode ? { displayMode: true } : {}) }];
    const block = context.table
      ? { ...paragraph("target", `| 수식 |\n| --- |\n| ${text} |`), type: "table", tableCellMarks: { "1:0": marks } }
      : paragraph("target", text, marks);
    const editor = await open(page, request, [paragraph("before", "이전"), block, paragraph("after", "다음")]);
    const selector = context.table ? '[data-resource-table-cell][data-table-row="1"][data-table-column="0"]' : '[data-block-content="target"]';
    const content = editor.locator(selector);
    await expect(content.locator("sygma-display-equation")).toHaveAttribute("data-equation-rendered", "true");
    return { editor, content, selector, text, marks };
  }

  async function nativeEnd(content, length, requireTextEnd = false) {
    await content.scrollIntoViewIfNeeded();
    await content.focus();
    await content.press("Meta+ArrowRight");
    const position = await caret(content);
    expect(position).toMatchObject({ collapsed: true, focused: true });
    // WebKit can place the visual right edge inside the hidden equation source.
    expect(position.offset === length || (!requireTextEnd && position.insideEquation), JSON.stringify(position)).toBe(true);
  }

  for (const context of contexts) test(`${context.name}: one Left crosses and Backspace deletes the whole equation`, async ({ page, request }) => {
    const { editor, content, selector, text, marks } = await setup(page, request, context);
    const start = context.prefix.length;
    const end = start + formula.length;
    const original = structuredClone((await savedBlocks(request)).find((block) => block.id === "target"));
    await nativeEnd(content, text.length, Boolean(context.suffix));
    if (context.suffix) {
      await content.press("ArrowLeft");
      expect(await caret(content)).toMatchObject({ offset: end, insideEquation: false });
    }
    await content.press("ArrowLeft");
    expect(await caret(content)).toEqual({ offset: start, collapsed: true, focused: true, insideEquation: false });
    await expect(content).toHaveAttribute("data-inline-boundary-caret", "true");
    if (context.wrapped) {
      await content.pressSequentially("L");
      await expect.poll(() => content.evaluate((node) => node.textContent)).toBe(`${context.prefix}L${formula}`);
      expect(await content.locator('[data-inline-mark="equation"]').evaluate((node) => node.textContent)).toBe(formula);
      await content.press("Meta+z");
      await expect.poll(() => content.evaluate((node) => node.textContent)).toBe(text);
      await nativeEnd(content, text.length, Boolean(context.suffix));
      await content.press("ArrowLeft");
      expect(await caret(content)).toMatchObject({ offset: start, insideEquation: false });
    }
    for (let count = 0; count < 3; count += 1) {
      await content.press("ArrowRight");
      expect(await caret(content)).toEqual({ offset: end, collapsed: true, focused: true, insideEquation: false });
      await content.press("ArrowLeft");
      expect(await caret(content)).toEqual({ offset: start, collapsed: true, focused: true, insideEquation: false });
    }
    await content.press("ArrowRight");
    await content.press("Backspace");
    await expect(content).toHaveText(`${context.prefix}${context.suffix}`);
    await expect(content.locator('[data-inline-mark="equation"]')).toHaveCount(0);
    expect(await caret(content)).toMatchObject({ offset: start, collapsed: true, focused: true });
    await expect(editor.locator(".block.is-selected")).toHaveCount(0);
    await content.press("Meta+z");
    await expect.poll(() => content.evaluate((node) => node.textContent)).toBe(text);
    await expect(content.locator('[data-inline-mark="equation"]')).toHaveCount(1);
    await expect.poll(() => caret(content)).toMatchObject({ offset: end, focused: true, insideEquation: false });
    await expect.poll(async () => {
      const stored = (await savedBlocks(request)).find((block) => block.id === "target");
      return context.table ? stored.tableCellMarks["1:0"] : stored.marks;
    }).toEqual(marks);
    await content.press("Meta+Shift+z");
    await expect(content).toHaveText(`${context.prefix}${context.suffix}`);
    await expect(content.locator('[data-inline-mark="equation"]')).toHaveCount(0);
    await content.press("Meta+z");
    await expect.poll(() => content.evaluate((node) => node.textContent)).toBe(text);
    await expect.poll(() => caret(content)).toMatchObject({ offset: end, focused: true, insideEquation: false });
    if (context.suffix) {
      await nativeEnd(content, text.length, true);
      await content.press("Backspace");
      await expect.poll(() => content.evaluate((node) => node.textContent)).toBe(`${context.prefix}${formula}`);
      await expect(content.locator('[data-inline-mark="equation"]')).toHaveAttribute("data-equation-formula", formula);
      await content.press("Meta+z");
      await expect.poll(() => content.evaluate((node) => node.textContent)).toBe(text);
    }
    await nativeEnd(content, text.length, Boolean(context.suffix));
    if (context.suffix) await content.press("ArrowLeft");
    await content.press("Backspace");
    await expect(content).toHaveText(`${context.prefix}${context.suffix}`);
    await expect.poll(async () => {
      const stored = (await savedBlocks(request)).find((block) => block.id === "target");
      return { text: stored.text, marks: context.table ? stored.tableCellMarks?.["1:0"] || [] : stored.marks };
    }).toEqual({ text: context.table ? `| 수식 |\n| --- |\n| ${context.prefix}${context.suffix} |` : `${context.prefix}${context.suffix}`, marks: [] });
    const stored = await savedBlocks(request);
    expect(stored.find((block) => block.id === "target").type).toBe(original.type);
    expect(stored.filter((block) => block.id !== "target").map((block) => block.text)).toEqual(["이전", "다음"]);
    await page.reload();
    await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
    if (!await editor.isVisible()) {
      await page.locator('[data-nav-key="resources"]').evaluate((button) => button.click());
      await page.locator(`[data-resource-open="${resourceId}"]`).click();
    }
    await expect(editor.locator(selector)).toHaveText(`${context.prefix}${context.suffix}`);
    await expect(editor.locator("sygma-display-equation")).toHaveCount(0);
  });

  for (const table of [false, true]) test(`deleteContentBackward without keydown deletes the ${table ? "table" : "paragraph"} equation once`, async ({ page, request }) => {
    const context = { name: "beforeinput", prefix: "A", suffix: "", table };
    const { content, text } = await setup(page, request, context);
    await nativeEnd(content, text.length);
    const prevented = await content.evaluate((element) => !element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentBackward" })));
    expect(prevented).toBe(true);
    await expect(content).toHaveText("A");
    await expect(content.locator('[data-inline-mark="equation"]')).toHaveCount(0);
    await content.press("Meta+z");
    await expect.poll(() => content.evaluate((node) => node.textContent)).toBe(text);
    await expect(content.locator('[data-inline-mark="equation"]')).toHaveCount(1);
    await expect.poll(() => caret(content)).toMatchObject({ offset: text.length, focused: true, insideEquation: false });
  });

  for (const table of [false, true]) test(`Backspace immediately after composition preserves the ${table ? "table" : "paragraph"} equation and composed prefix`, async ({ page, request }) => {
    const { content } = await setup(page, request, { prefix: "A", suffix: "Z", table });
    const result = await content.evaluate((element) => {
      element.focus();
      const set = (node, offset) => {
        const range = document.createRange();
        range.setStart(node, offset);
        range.collapse(true);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      };
      const text = element.firstChild;
      set(text, 1);
      element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      text.insertData(1, "한글말");
      set(text, 4);
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "한글말", isComposing: true }));
      element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한글말" }));
      // Keep keydown in the same task, before deferred composition reconciliation.
      const keyAllowed = element.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", code: "Backspace", bubbles: true, cancelable: true }));
      const afterKey = { text: element.textContent, equations: element.querySelectorAll('[data-inline-mark="equation"]').length };
      let inputAllowed = false;
      if (keyAllowed) {
        inputAllowed = element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentBackward" }));
        if (inputAllowed) {
          // Synthetic key events lack native default editing; delete the last
          // composed character only after both real application handlers allow it.
          const currentText = element.firstChild;
          currentText.deleteData(3, 1);
          set(currentText, 3);
          element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
        }
      }
      return { keyAllowed, inputAllowed, afterKey };
    });
    expect(result).toEqual({ keyAllowed: true, inputAllowed: true, afterKey: { text: "A한글말x+yZ", equations: 1 } });
    await expect.poll(() => content.evaluate((node) => node.textContent)).toBe("A한글x+yZ");
    await expect(content.locator('[data-inline-mark="equation"]')).toHaveAttribute("data-equation-formula", formula);
    await expect.poll(async () => {
      const block = (await savedBlocks(request)).find((entry) => entry.id === "target");
      return { text: block.text, marks: table ? block.tableCellMarks?.["1:0"] : block.marks };
    }).toEqual({ text: table ? "| 수식 |\n| --- |\n| A한글x+yZ |" : "A한글x+yZ", marks: [{ type: "equation", start: 3, end: 6, formula }] });
  });
});
