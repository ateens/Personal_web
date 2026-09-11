import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const RESOURCE_ID = FIXTURE_IDS.bodySearchResource;
const POLICY_FORMULA = String.raw`z=E(\ell),\qquad \hat a_t=\mu_\phi(o_t,z)`;
const GALLERY = [
  ["policy", POLICY_FORMULA],
  ["real-space", String.raw`\mathbb{R}`, false],
  ["aligned", String.raw`\begin{aligned}a&=b+c\\d&=e-f\end{aligned}`],
  ["matrix", String.raw`A=\begin{pmatrix}a&b\\c&d\end{pmatrix}`],
  ["cases", String.raw`f(x)=\begin{cases}x^2&x\ge 0\\-x&x<0\end{cases}`],
  ["nested", String.raw`\frac{1}{1+\frac{x^2}{\sqrt{1+y}}}`],
  ["fonts", String.raw`\mathbb{R}\quad\mathcal{F}\quad\mathrm{rank}(A)\quad\hat{a}\quad\bar{x}\quad\vec{v}`],
  ["macro", String.raw`\newcommand{\vect}[1]{\mathbf{#1}}\vect{x}+\vect{y}`],
  ["chemistry", String.raw`\ce{2H2 + O2 -> 2H2O}`],
  ["units", String.raw`\pu{9.81 m s^-2}`],
  ["long", `p(x)=${Array.from({ length: 15 }, (_, index) => `a_{${index + 1}}x^{${index + 1}}`).join("+")}`],
];

function equationBlock(id, formula, displayMode = true, prefix = "", suffix = "", segment = formula) {
  return {
    id, type: "paragraph", text: `${prefix}${segment}${suffix}`, checked: false, indent: 0, collapsed: false,
    marks: [{ type: "equation", start: prefix.length, end: prefix.length + segment.length, formula, ...(displayMode ? { displayMode: true } : {}) }],
  };
}

async function seedBlocks(request, blocks) {
  await resetFixture(request);
  const before = await fixtureSnapshot(request);
  const state = structuredClone(before.state);
  state.resources.find((resource) => resource.id === RESOURCE_ID).blocks = blocks;
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state, baseRevision: before.serverRevision },
  });
  expect(response.ok()).toBeTruthy();
}

async function openResource(page) {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-action="toggle-nav"]').click();
  await page.locator('[data-nav-key="resources"]').click();
  await page.locator(`[data-resource-open="${RESOURCE_ID}"]`).click();
  const editor = page.locator(`.block-editor[data-owner-id="${RESOURCE_ID}"]`);
  await expect(editor).toBeVisible();
  return editor;
}

function equationHost(editor, id) {
  return editor.locator(`[data-block-content="${id}"] sygma-display-equation`);
}

async function storedBlocks(request) {
  return (await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === RESOURCE_ID).blocks;
}

test.use({ reducedMotion: "reduce" });

for (const width of [1440, 390]) {
  test(`Resource equations render TeX structures in inline and display modes at ${width}px`, async ({ page, request }, testInfo) => {
    const blocks = GALLERY.map(([id, formula, displayMode = true]) => equationBlock(id, formula, displayMode,
      displayMode ? "" : "공간 ", displayMode ? "" : " 에서"));
    await seedBlocks(request, blocks);
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const editor = await openResource(page);
    for (const [id, formula, displayMode = true] of GALLERY) {
      const host = equationHost(editor, id);
      await expect(host).toHaveAttribute("data-equation-rendered", "true");
      await expect.poll(() => host.evaluate((element) => Boolean(element.shadowRoot.adoptedStyleSheets[0] || element.shadowRoot.querySelector('link[rel="stylesheet"]')?.sheet))).toBe(true);
      await expect(host.locator(".katex-html")).toBeVisible();
      await expect(host.locator('annotation[encoding="application/x-tex"]')).toHaveText(formula);
      expect(await host.evaluate((element) => element.textContent)).toBe("");
      expect(await host.locator("math").getAttribute("display") || "inline").toBe(displayMode ? "block" : "inline");
      await host.scrollIntoViewIfNeeded();
      const geometry = await host.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const math = element.shadowRoot.querySelector(".katex-html").getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, mathWidth: math.width, pageWidth: document.documentElement.scrollWidth };
      });
      expect(geometry.width).toBeGreaterThan(4);
      expect(geometry.mathWidth).toBeGreaterThan(4);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(width);
      expect(geometry.pageWidth).toBe(width);
    }
    await expect(equationHost(editor, "aligned").locator("mtable mtr")).toHaveCount(2);
    await expect(equationHost(editor, "matrix").locator("mtable mtd")).toHaveCount(4);
    await expect(equationHost(editor, "cases").locator("mtable mtr")).toHaveCount(2);
    await expect(equationHost(editor, "nested").locator("mfrac")).toHaveCount(2);
    await expect(equationHost(editor, "fonts").locator("mover")).toHaveCount(3);
    const longEquation = equationHost(editor, "long");
    await longEquation.scrollIntoViewIfNeeded();
    const overflow = await longEquation.evaluate((element) => {
      element.scrollLeft = 0;
      const host = element.getBoundingClientRect();
      const bases = element.shadowRoot.querySelectorAll(".katex-html > .katex-base");
      const htmlLeft = element.shadowRoot.querySelector(".katex-html").getBoundingClientRect().left;
      const firstLeft = bases[0].getBoundingClientRect().left;
      const scrollWidth = element.scrollWidth;
      element.scrollLeft = scrollWidth;
      const lastRight = bases[bases.length - 1].getBoundingClientRect().right;
      return { hostLeft: host.left, hostRight: host.right, htmlLeft, firstLeft, lastRight, scrollWidth, clientWidth: element.clientWidth, scrollLeft: element.scrollLeft };
    });
    await testInfo.attach("long-equation-scroll", { body: JSON.stringify(overflow, null, 2), contentType: "application/json" });
    expect(overflow.htmlLeft).toBeGreaterThanOrEqual(overflow.hostLeft - 1);
    expect(overflow.firstLeft, JSON.stringify(overflow)).toBeGreaterThanOrEqual(overflow.hostLeft - 1);
    expect(overflow.lastRight, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.hostRight + 1);
    if (width === 390) expect(overflow.scrollLeft).toBeGreaterThan(0);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => [...document.fonts].some((font) => font.family.includes("KaTeX") && font.status === "loaded"))).toBe(true);
    await equationHost(editor, "policy").scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await editor.locator('[data-block-content="policy"]').screenshot({ path: testInfo.outputPath(`policy-equation-${width}.png`) });
    await page.locator(`[data-resource-document="${RESOURCE_ID}"]`).screenshot({ path: testInfo.outputPath(`equation-gallery-${width}.png`) });
    await equationHost(editor, "units").scrollIntoViewIfNeeded();
    await page.locator(`[data-resource-document="${RESOURCE_ID}"]`).screenshot({ path: testInfo.outputPath(`equation-gallery-bottom-${width}.png`) });
    expect((await storedBlocks(request)).map(({ id, text, marks }) => ({ id, text, marks }))).toEqual(blocks.map(({ id, text, marks }) => ({ id, text, marks })));
    expect(errors).toEqual([]);
  });
}

test("Resource equation copy, multiline edit and reload preserve source segments and mark offsets", async ({ page, request }) => {
  const prefix = "앞 ";
  const suffix = " 뒤";
  const original = equationBlock("source", POLICY_FORMULA, false, prefix, suffix, "수식");
  await seedBlocks(request, [original]);
  await page.setViewportSize({ width: 390, height: 844 });
  let editor = await openResource(page);
  let content = editor.locator('[data-block-content="source"]');
  await expect(equationHost(editor, "source")).toHaveAttribute("data-equation-rendered", "true");
  expect(await content.evaluate((element) => element.textContent)).toBe(original.text);
  await content.focus();
  await content.press("Escape");
  await expect(editor.locator('[data-block-id="source"]')).toHaveClass(/is-selected/);
  const copied = await content.evaluate((element) => {
    const clipboardData = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData }));
    return { text: clipboardData.getData("text/plain"), html: clipboardData.getData("text/html"), blocks: JSON.parse(clipboardData.getData("application/x-sygma-blocks")) };
  });
  expect(copied.text).toBe(original.text);
  expect(copied.blocks.blocks[0]).toMatchObject({ text: original.text, marks: original.marks });
  expect(copied.html).toContain("data-equation-formula=");
  expect(copied.html).not.toContain("katex-html");
  await page.keyboard.press("Escape");
  await content.locator('[data-inline-mark="equation"]').click();
  const dialog = page.getByRole("dialog", { name: "수식 편집" });
  const input = dialog.getByRole("textbox", { name: "수식 입력" });
  await expect(input).toHaveValue(POLICY_FORMULA);
  const firstLine = String.raw`\frac{a}{b}  % keep the next line`;
  const lastLine = String.raw`+\mathbb{R}`;
  await input.fill(firstLine);
  await input.press("End");
  await input.press("Shift+Enter");
  await input.pressSequentially(lastLine);
  const editedFormula = `${firstLine}\n${lastLine}`;
  await expect(input).toHaveValue(editedFormula);
  await expect(dialog).toBeVisible();
  await input.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(equationHost(editor, "source")).toHaveAttribute("data-equation-rendered", "true");
  const expected = {
    text: `${prefix}${editedFormula}${suffix}`,
    marks: [{ type: "equation", start: prefix.length, end: prefix.length + editedFormula.length, formula: editedFormula }],
  };
  await expect.poll(async () => {
    const [block] = await storedBlocks(request);
    return { text: block.text, marks: block.marks };
  }).toEqual(expected);
  await content.focus();
  await content.press("Escape");
  const htmlRoundTrip = await content.evaluate((element) => {
    const copied = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: copied }));
    const htmlOnly = new DataTransfer();
    htmlOnly.setData("text/html", copied.getData("text/html"));
    return readHtmlClipboardBlocks(htmlOnly).map(({ text, marks }) => ({ text, marks }));
  });
  expect(htmlRoundTrip).toEqual([expected]);
  editor = await openResource(page);
  content = editor.locator('[data-block-content="source"]');
  await expect(equationHost(editor, "source")).toHaveAttribute("data-equation-rendered", "true");
  expect(await content.evaluate((element) => element.textContent)).toBe(expected.text);
  await expect(equationHost(editor, "source").locator("mfrac")).toHaveCount(1);
  await expect(equationHost(editor, "source").locator("mi")).toContainText(["a", "b", "R"]);
  await content.locator('[data-inline-mark="equation"]').click();
  await expect(page.getByRole("textbox", { name: "수식 입력" })).toHaveValue(editedFormula);
});

test("Resource equations keep malformed, recursive and untrusted TeX inert without losing formulas", async ({ page, request }) => {
  const failures = [
    ["unknown", String.raw`\notASupportedEquationCommand{<img src=x onerror=alert(1)>}`],
    ["malformed", String.raw`\frac{a}{`],
    ["recursive", String.raw`\def\loop{\loop}\loop`],
    ["macro-scope", String.raw`\localOnly`],
    ["oversized", "x".repeat(20_001)],
  ];
  const untrusted = [
    ["link", String.raw`\href{javascript:alert(1)}{click}`],
    ["image", String.raw`\includegraphics{https://equation-security.invalid/pixel.png}`],
    ["style", String.raw`\htmlStyle{position:fixed;inset:0}{x}`],
  ];
  const blocks = [equationBlock("local-macro", String.raw`\gdef\localOnly{x}\localOnly`), ...failures.map(([id, formula]) => equationBlock(id, formula)), ...untrusted.map(([id, formula]) => equationBlock(id, formula))];
  await seedBlocks(request, blocks);
  const externalRequests = [];
  page.on("request", (request) => { if (request.url().includes("equation-security.invalid")) externalRequests.push(request.url()); });
  const dialogs = [];
  page.on("dialog", async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  const editor = await openResource(page);
  await expect(equationHost(editor, "local-macro")).toHaveAttribute("data-equation-rendered", "true");
  for (const [id, formula] of failures) {
    const host = equationHost(editor, id);
    await expect(host).toHaveAttribute("data-equation-error", "true");
    expect(await host.evaluate((element) => element.shadowRoot.textContent.includes(element.dataset.formula))).toBe(true);
    await expect(host).toHaveAttribute("data-formula", formula);
  }
  for (const [id] of [...failures, ...untrusted]) {
    const host = equationHost(editor, id);
    await expect.poll(() => host.evaluate((element) => Boolean(element.dataset.equationRendered || element.dataset.equationError))).toBe(true);
    await expect(host.locator("script, img, iframe, a[href], [onerror], [onclick]")).toHaveCount(0);
    expect(await host.evaluate((element) => [...element.shadowRoot.querySelectorAll("*")].some((node) => getComputedStyle(node).position === "fixed"))).toBe(false);
  }
  expect(externalRequests).toEqual([]);
  expect(dialogs).toEqual([]);
  expect((await storedBlocks(request)).map(({ text, marks }) => ({ text, marks }))).toEqual(blocks.map(({ text, marks }) => ({ text, marks })));
});
