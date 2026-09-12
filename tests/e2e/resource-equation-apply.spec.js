import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const resourceId = FIXTURE_IDS.bodySearchResource;
const formula = String.raw`\mathbb{R}^{n}`;
const prefix = "앞 ";
const suffix = " 뒤";
const source = `${prefix}${formula}${suffix}`;
const paragraph = (id, text = "") => ({ id, type: "paragraph", text, marks: [], checked: false, indent: 0, collapsed: false });

test.use({ reducedMotion: "reduce" });

async function open(page) {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-nav-key="resources"]').evaluate((button) => button.click());
  await page.locator(`[data-resource-open="${resourceId}"]`).click();
  const editor = page.locator(`.block-editor[data-owner-id="${resourceId}"]`);
  await expect(editor).toBeVisible();
  return editor;
}

async function setup(page, request, table) {
  await resetFixture(request);
  const snapshot = await fixtureSnapshot(request);
  const state = structuredClone(snapshot.state);
  const block = table ? { ...paragraph("target", `| 값 |\n| --- |\n| ${source} |`), type: "table" } : paragraph("target", source);
  state.resources.find((resource) => resource.id === resourceId).blocks = [block, paragraph("following", "다음 문장")];
  const response = await request.put("/api/state", { headers: { "If-Match": `"state-${snapshot.serverRevision}"` }, data: { state, baseRevision: snapshot.serverRevision } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return open(page);
}

function contentFor(editor, table) {
  return editor.locator(table ? '[data-resource-table-cell][data-table-row="1"][data-table-column="0"]' : '[data-block-content="target"]');
}

async function saved(request, table) {
  const resource = (await fixtureSnapshot(request)).state.resources.find((entry) => entry.id === resourceId);
  const block = resource.blocks.find((entry) => entry.id === "target");
  return { text: block.text, marks: table ? block.tableCellMarks?.["1:0"] || [] : block.marks, blocks: resource.blocks.length };
}

async function selectFormula(page, content) {
  await content.scrollIntoViewIfNeeded();
  await content.focus();
  await content.press("Meta+ArrowLeft");
  for (let index = 0; index < prefix.length; index += 1) await content.press("ArrowRight");
  for (let index = 0; index < formula.length; index += 1) await content.press("Shift+ArrowRight");
  expect(await page.evaluate(() => getSelection().toString())).toBe(formula);
}

async function expectRightCaret(content) {
  await expect(content).toBeFocused();
  await expect(content).toHaveAttribute("data-inline-boundary-caret", "true");
  const measure = () => content.evaluate((element) => {
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(selection.focusNode, selection.focusOffset);
    const node = selection.focusNode.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode.parentElement;
    const mark = element.querySelector('[data-inline-mark="equation"]');
    const markRect = [...mark.getClientRects()].at(-1);
    const rect = element.getBoundingClientRect();
    const pseudo = getComputedStyle(element, "::after");
    return { offset: range.toString().length, collapsed: selection.isCollapsed, insideEquation: Boolean(node.closest('[data-inline-mark="equation"]')), x: rect.left + parseFloat(pseudo.left) - element.scrollLeft, expectedX: markRect.right + 1, width: parseFloat(pseudo.width), height: parseFloat(pseudo.height), opacity: Number(pseudo.opacity), nativeCaret: getComputedStyle(element).caretColor, viewport: innerWidth };
  });
  const initial = await measure();
  await content.evaluate(() => document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  const position = await measure();
  expect(position).toMatchObject({ offset: prefix.length + formula.length, collapsed: true, insideEquation: false, width: 1, opacity: 1 });
  expect(position.height).toBeGreaterThan(10);
  expect(Math.abs(position.x - position.expectedX), JSON.stringify({ initial, settled: position })).toBeLessThan(2);
  expect(position.nativeCaret).toMatch(/transparent|rgba\(0, 0, 0, 0\)/);
  expect(position.x).toBeGreaterThanOrEqual(0);
  expect(position.x + 1).toBeLessThanOrEqual(position.viewport);
}

const cases = [
  { name: "selected LaTeX Cmd+Shift+A", method: "shortcut", mode: "inline" },
  { name: "inline toolbar", method: "toolbar", mode: "inline" },
  { name: "display toolbar", method: "toolbar", mode: "display" },
];

for (const table of [false, true]) for (const entry of cases) test(`${entry.name} immediately applies in ${table ? "table" : "paragraph"} and places the caret outside`, async ({ page, request }, info) => {
  let editor = await setup(page, request, table);
  let content = contentFor(editor, table);
  await selectFormula(page, content);
  if (entry.method === "shortcut") {
    expect(await content.evaluate((element) => element.dispatchEvent(new KeyboardEvent("keydown", { key: "R", code: "KeyR", metaKey: true, shiftKey: true, bubbles: true, cancelable: true })))).toBe(true);
    await expect(content.locator('[data-inline-mark="equation"]')).toHaveCount(0);
    await page.keyboard.press("Meta+Shift+A");
  }
  else {
    const toolbar = page.locator(".inline-format-toolbar");
    await expect(toolbar.getByRole("button", { name: "인라인 수식", exact: true })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "블록 수식", exact: true })).toBeVisible();
    await toolbar.locator(`[data-inline-equation-apply="${entry.mode}"]`).click();
  }
  await expect(page.getByRole("dialog", { name: "수식 편집" })).toHaveCount(0);
  const mark = content.locator('[data-inline-mark="equation"]');
  await expect(mark).toHaveAttribute("data-equation-formula", formula);
  await expect(mark).toHaveAttribute("data-equation-mode", entry.mode);
  await expect(mark).toHaveCSS("background-color", entry.mode === "inline" ? "rgba(0, 0, 0, 0)" : "rgba(55, 53, 47, 0.08)");
  await expect(mark.locator("sygma-display-equation")).toHaveAttribute("data-equation-rendered", "true");
  await expectRightCaret(content);
  await content.screenshot({ path: info.outputPath(`immediate-${entry.mode}-${table ? "table" : "paragraph"}.png`), caret: "initial" });
  await content.press("Meta+z");
  await expect(content.locator('[data-inline-mark="equation"]')).toHaveCount(0);
  await expect.poll(() => content.evaluate((element) => element.textContent)).toBe(source);
  await content.press("Meta+Shift+z");
  await expect(mark).toHaveAttribute("data-equation-mode", entry.mode);
  await expectRightCaret(content);
  await content.pressSequentially("X");
  await expect.poll(() => content.evaluate((element) => element.textContent)).toBe(`${prefix}${formula}X${suffix}`);
  expect(await mark.evaluate((element) => element.textContent)).toBe(formula);
  const expected = { text: table ? `| 값 |\n| --- |\n| ${prefix}${formula.replaceAll("\\", "\\\\")}X${suffix} |` : `${prefix}${formula}X${suffix}`, marks: [{ type: "equation", start: prefix.length, end: prefix.length + formula.length, formula, ...(entry.mode === "display" ? { displayMode: true } : {}) }], blocks: 2 };
  await expect.poll(() => saved(request, table)).toEqual(expected);
  editor = await open(page);
  content = contentFor(editor, table);
  await expect(content.locator('[data-inline-mark="equation"]')).toHaveAttribute("data-equation-mode", entry.mode);
  await expect.poll(() => saved(request, table)).toEqual(expected);
  await expect(editor.locator('[data-block-content="following"]')).toHaveText("다음 문장");
});

for (const mode of ["inline", "display"]) test(`mobile ${mode} toolbar applies immediately with visible outside caret`, async ({ page, request }, info) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const editor = await setup(page, request, false);
  const content = contentFor(editor, false);
  await selectFormula(page, content);
  const toolbar = page.locator(".inline-format-toolbar");
  const button = toolbar.getByRole("button", { name: mode === "inline" ? "인라인 수식" : "블록 수식", exact: true });
  await expect(button).toBeVisible();
  await button.click({ trial: true });
  const rect = await button.boundingBox();
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(390);
  await button.click();
  await expect(page.getByRole("dialog", { name: "수식 편집" })).toHaveCount(0);
  await expect(content.locator('[data-inline-mark="equation"]')).toHaveAttribute("data-equation-mode", mode);
  await expectRightCaret(content);
  await page.locator(`[data-resource-document="${resourceId}"]`).screenshot({ path: info.outputPath(`immediate-${mode}-mobile.png`), caret: "initial" });
  await content.pressSequentially("X");
  expect(await content.locator('[data-inline-mark="equation"]').evaluate((element) => element.textContent)).toBe(formula);
  expect(await content.evaluate((element) => element.textContent)).toBe(`${prefix}${formula}X${suffix}`);
  expect(await page.evaluate(() => document.body.scrollWidth)).toBe(390);
});
