import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const RESOURCE_ID = FIXTURE_IDS.bodySearchResource;
const PREFIX = "앞 문장 ";
const FORMULA = "x+y";
const SUFFIX = " 뒤 문장";
const TEXT = PREFIX + FORMULA + SUFFIX;
const equation = (display = false) => ({ type: "equation", start: PREFIX.length, end: PREFIX.length + FORMULA.length, formula: FORMULA, ...(display ? { displayMode: true } : {}) });
const paragraph = (id, display = false) => ({ id, type: "paragraph", text: TEXT, marks: [equation(display)], checked: false, indent: 0, collapsed: false });

test.use({ reducedMotion: "reduce" });

async function seed(request, blocks) {
  await resetFixture(request);
  const before = await fixtureSnapshot(request);
  before.state.resources.find((resource) => resource.id === RESOURCE_ID).blocks = blocks;
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state: before.state, baseRevision: before.serverRevision },
  });
  expect(response.ok()).toBeTruthy();
}

async function open(page) {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-nav-key="resources"]').evaluate((button) => button.click());
  await page.locator(`[data-resource-open="${RESOURCE_ID}"]`).click();
  return page.locator(`.block-editor[data-owner-id="${RESOURCE_ID}"]`);
}

async function selectRange(content, start = 0, end = TEXT.length) {
  await content.evaluate((element, { start, end }) => {
    element.focus();
    const point = (offset) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && offset > node.textContent.length) { offset -= node.textContent.length; node = walker.nextNode(); }
      return { node: node || element, offset: node ? offset : element.childNodes.length };
    };
    const a = point(start), b = point(end), range = document.createRange();
    range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, { start, end });
}

async function savedMarks(request, table = false, id = "target") {
  const block = (await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === RESOURCE_ID).blocks.find((entry) => entry.id === id);
  return table ? block.tableCellMarks?.["1:0"] || [] : block.marks;
}

async function expectFormula(content, bold) {
  await expect(content.locator("sygma-display-equation")).toHaveCount(1);
  const host = content.locator("sygma-display-equation");
  await expect(host).toHaveAttribute("data-equation-rendered", "true");
  await expect(host).toHaveAttribute("data-formula", FORMULA);
  await expect(content.locator(".inline-equation-source")).toHaveText(FORMULA);
  await expect.poll(() => host.locator(".katex").evaluate((element) => getComputedStyle(element).fontWeight)).toBe(bold ? "700" : "400");
  await expect.poll(() => content.evaluate((element) => element.textContent)).toBe(TEXT);
}

for (const table of [false, true]) for (const display of [false, true]) {
  test(`${table ? "표" : "문단"} ${display ? "블록" : "인라인"} 수식을 포함한 문장은 굵게 적용·해제·저장·실행 취소된다`, async ({ page, request }) => {
    const block = table
      ? { ...paragraph("target"), type: "table", text: `| 제목 |\n| --- |\n| ${TEXT} |`, marks: [], tableCellMarks: { "1:0": [equation(display)] } }
      : paragraph("target", display);
    await seed(request, [block]);
    const editor = await open(page);
    const selector = table ? '[data-resource-table-cell][data-table-row="1"][data-table-column="0"]' : '[data-block-content="target"]';
    const content = editor.locator(selector);
    await expectFormula(content, false);
    await selectRange(content);
    await page.keyboard.press("ControlOrMeta+b");
    await expect.poll(() => savedMarks(request, table)).toEqual(expect.arrayContaining([equation(display), { type: "bold", start: 0, end: TEXT.length }]));
    await expectFormula(content, true);
    await expect(content.locator('[data-inline-mark="bold"]').first()).toHaveCSS("font-weight", "700");
    await open(page);
    await expectFormula(content, true);
    await selectRange(content);
    await page.keyboard.press("ControlOrMeta+b");
    await expect.poll(() => savedMarks(request, table)).toEqual([equation(display)]);
    await expectFormula(content, false);
    await page.keyboard.press("ControlOrMeta+z");
    await expectFormula(content, true);
  });
}

test("수식 일부를 걸친 굵게 범위는 수식 하나로 유지되고 같은 범위를 다시 누르면 해제된다", async ({ page, request }) => {
  await seed(request, [paragraph("target")]);
  const editor = await open(page);
  const content = editor.locator('[data-block-content="target"]');
  await selectRange(content, PREFIX.length - 1, PREFIX.length + 1);
  await page.locator('[data-inline-mark-toggle="bold"]').click();
  await expectFormula(content, true);
  await expect.poll(() => savedMarks(request)).toEqual(expect.arrayContaining([
    equation(), { type: "bold", start: PREFIX.length - 1, end: PREFIX.length + FORMULA.length },
  ]));
  await selectRange(content, PREFIX.length - 1, PREFIX.length + 1);
  await page.keyboard.press("ControlOrMeta+b");
  await expectFormula(content, false);
  await expect.poll(() => savedMarks(request)).toEqual([equation()]);
});

test("이미 굵게 표시된 문장을 수식으로 바꾸어도 수식과 주변 문장의 굵기가 유지된다", async ({ page, request }) => {
  await seed(request, [{ ...paragraph("target"), marks: [{ type: "bold", start: 0, end: TEXT.length }] }]);
  const editor = await open(page);
  const content = editor.locator('[data-block-content="target"]');
  await selectRange(content, PREFIX.length, PREFIX.length + FORMULA.length);
  await page.keyboard.press("ControlOrMeta+Shift+a");
  await expectFormula(content, true);
  await expect.poll(() => savedMarks(request)).toEqual(expect.arrayContaining([
    equation(), { type: "bold", start: 0, end: TEXT.length },
  ]));
  await page.keyboard.press("ControlOrMeta+z");
  await expect(content.locator("sygma-display-equation")).toHaveCount(0);
  await expect.poll(() => savedMarks(request)).toEqual([{ type: "bold", start: 0, end: TEXT.length }]);
});

test("여러 블록 선택에 굵게를 적용해도 각 수식과 문장 서식이 함께 유지된다", async ({ page, request }) => {
  await seed(request, [paragraph("first"), paragraph("second", true)]);
  const editor = await open(page);
  const first = editor.locator('[data-block-content="first"]');
  await first.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(editor.locator(".block.is-selected")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+b");
  for (const id of ["first", "second"]) {
    await expectFormula(editor.locator(`[data-block-content="${id}"]`), true);
    await expect.poll(() => savedMarks(request, false, id)).toEqual(expect.arrayContaining([{ type: "bold", start: 0, end: TEXT.length }]));
  }
});

for (const prefix of ["앞 문장 ", ""]) test(`마우스로 ${prefix ? "문장과" : "단독"} 수식을 선택하고 굵게 처리한다`, async ({ page, request }) => {
  const text = prefix + FORMULA;
  const mark = { type: "equation", start: prefix.length, end: text.length, formula: FORMULA };
  await seed(request, [{ ...paragraph("target"), text: prefix ? "" : text, marks: prefix ? [] : [mark] }]);
  const editor = await open(page);
  const content = editor.locator('[data-block-content="target"]');
  if (prefix) {
    await content.click();
    await page.keyboard.type(`${prefix}$$${FORMULA}$$`);
  }
  const equation = content.locator('[data-inline-mark="equation"]');
  await expect(equation.locator("sygma-display-equation")).toHaveAttribute("data-equation-rendered", "true");
  await content.evaluate(() => document.fonts.ready);
  await editor.evaluate((element) => Promise.all(element.closest(".resource-window").getAnimations({ subtree: true }).filter((animation) => animation.effect.getTiming().iterations !== Infinity).map((animation) => animation.finished)));
  await content.focus();
  const formulaRect = await equation.boundingBox();
  const contentRect = await content.boundingBox();
  const y = formulaRect.y + formulaRect.height / 2;
  await page.mouse.move(formulaRect.x + formulaRect.width - 1, y);
  await page.mouse.down();
  await page.mouse.move(contentRect.x + 1, y, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => getSelection().isCollapsed)).toBe(false);
  await expect(page.locator('[data-inline-equation-popover]')).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+b");
  await expect.poll(() => equation.locator(".katex").evaluate((node) => getComputedStyle(node).fontWeight)).toBe("700");
  await expect.poll(() => savedMarks(request)).toEqual(expect.arrayContaining([mark, { type: "bold", start: 0, end: text.length }]));
});
