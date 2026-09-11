import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const RESOURCE_ID = FIXTURE_IDS.bodySearchResource;
const GATHERED = String.raw`\begin{gathered}
a_t\sim\mu_\phi(\cdot\mid o_t,\ell)\\
\hat a_t=\mu_\phi(o_t,\ell)
\end{gathered}`;

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

async function storedBlocks(request) {
  return (await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === RESOURCE_ID).blocks;
}

async function paste(editor, formats) {
  await editor.locator("[data-block-content]").first().evaluate((element, data) => {
    element.focus();
    const clipboardData = new DataTransfer();
    for (const [type, text] of Object.entries(data)) clipboardData.setData(type, text);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, formats);
}

async function expectEquations(editor, expected) {
  const hosts = editor.locator("sygma-display-equation");
  await expect(hosts).toHaveCount(expected.length);
  for (const [index, [formula, display]] of expected.entries()) {
    const host = hosts.nth(index);
    await expect(host).toHaveAttribute("data-equation-rendered", "true");
    await expect(host.locator('annotation[encoding="application/x-tex"]')).toHaveText(formula);
    await expect(host.locator(".katex-html")).toBeVisible();
    expect(await host.locator("math").getAttribute("display") || "inline").toBe(display ? "block" : "inline");
  }
}

test.use({ reducedMotion: "reduce" });

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
  const before = await fixtureSnapshot(request);
  const state = structuredClone(before.state);
  state.resources.find((resource) => resource.id === RESOURCE_ID).blocks = [{
    id: "dollar-paste", type: "paragraph", text: "", marks: [], checked: false, indent: 0, collapsed: false,
  }];
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state, baseRevision: before.serverRevision },
  });
  expect(response.ok()).toBeTruthy();
});

test("Markdown paste distinguishes standalone dollar fences from same-line inline equations and reloads", async ({ page, request }) => {
  const startupErrors = [];
  page.on("pageerror", (error) => startupErrors.push(error.message));
  let editor = await openResource(page);
  const inline = String.raw`벡터 $x_t$ 와 $$ \mathbb{R}^{n} $$ 위에서`;
  await paste(editor, { "text/plain": `정책 수식\n\n$$\n${GATHERED}\n$$\n\n${inline}\n\n$$ z=E(\\ell) $$` });
  const expected = [[GATHERED, true], ["x_t", false], [String.raw`\mathbb{R}^{n}`, false], [String.raw`z=E(\ell)`, false]];
  await expectEquations(editor, expected);
  await expect(editor.locator("sygma-display-equation").first().locator("mtable mtr")).toHaveCount(2);
  await expect.poll(async () => (await storedBlocks(request)).flatMap((block) => block.marks.filter((mark) => mark.type === "equation").map((mark) => [mark.formula, Boolean(mark.displayMode)]))).toEqual(expected);
  const saved = await storedBlocks(request);
  expect(saved.map((block) => block.text)).toEqual(["정책 수식", GATHERED, String.raw`벡터 x_t 와 \mathbb{R}^{n} 위에서`, String.raw`z=E(\ell)`]);
  for (const block of saved) {
    for (const mark of block.marks.filter((entry) => entry.type === "equation")) {
      expect(block.text.slice(mark.start, mark.end)).toBe(mark.formula);
    }
  }
  editor = await openResource(page);
  expect(startupErrors, "Returning to Resources must finish startup and register renderers").toEqual([]);
  await expectEquations(editor, expected);
  expect((await storedBlocks(request)).map(({ text, marks }) => ({ text, marks }))).toEqual(saved.map(({ text, marks }) => ({ text, marks })));
});

test("Pasted HTML paragraphs and line breaks retain TeX and render dollar equations on mobile", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const editor = await openResource(page);
  const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<p>$$</p>${GATHERED.split("\n").map((line) => `<p>${escapeHtml(line)}</p>`).join("")}<p>$$</p><p>문장 $$ \\mathbb{R} $$ 끝</p><div>$$<br>\\frac{a}{b}<br>$$</div>`;
  const plain = `$$\n${GATHERED}\n$$\n\n문장 $$ \\mathbb{R} $$ 끝\n\n$$\n\\frac{a}{b}\n$$`;
  await paste(editor, { "text/html": html, "text/plain": plain });
  await expectEquations(editor, [[GATHERED, true], [String.raw`\mathbb{R}`, false], [String.raw`\frac{a}{b}`, true]]);
  await expect.poll(async () => (await storedBlocks(request)).flatMap((block) => block.marks.filter((mark) => mark.type === "equation")).length).toBe(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await editor.locator("sygma-display-equation").first().scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await page.locator(`[data-resource-document="${RESOURCE_ID}"]`).screenshot({ path: testInfo.outputPath("dollar-equations-mobile.png") });
});

test("Markdown clipboard MIME and live typing preserve inline and multiline equations", async ({ page }) => {
  const editor = await openResource(page);
  const markdown = String.raw`**공간** $\mathbb{R}$ 에서 $$ x^2 $$ 계산`;
  await paste(editor, { "text/markdown": markdown, "text/html": "<p><strong>공간</strong> $\\mathbb{R}$ 에서 $$ x^2 $$ 계산</p>" });
  await expectEquations(editor, [[String.raw`\mathbb{R}`, false], ["x^2", false]]);
  await expect(editor.locator('[data-inline-mark="bold"]')).toHaveText("공간");
  expect(await editor.locator("[data-block-content]").first().evaluate((element) => element.textContent)).toBe(String.raw`공간 \mathbb{R} 에서 x^2 계산`);
  // A Markdown-only clipboard is used by source editors and must not require text/plain.
  const last = editor.locator("[data-block-content]").last();
  await last.press("End");
  await last.press("Enter");
  await editor.locator("[data-block-content]:focus").evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/markdown", "$y_i$");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await expectEquations(editor, [[String.raw`\mathbb{R}`, false], ["x^2", false], ["y_i", false]]);

  await editor.locator("[data-block-content]").last().press("End");
  await editor.locator("[data-block-content]").last().press("Enter");
  await editor.locator("[data-block-content]:focus").pressSequentially("$$x$$");
  await expectEquations(editor, [[String.raw`\mathbb{R}`, false], ["x^2", false], ["y_i", false], ["x", false]]);
  await editor.locator("[data-block-content]").last().press("End");
  await editor.locator("[data-block-content]").last().press("Enter");
  const live = editor.locator("[data-block-content]:focus");
  const lines = ["$$", ...GATHERED.split("\n"), "$$"];
  for (let index = 0; index < lines.length; index += 1) {
    if (index) await live.press("Shift+Enter");
    await live.pressSequentially(lines[index]);
  }
  await expectEquations(editor, [[String.raw`\mathbb{R}`, false], ["x^2", false], ["y_i", false], ["x", false], [GATHERED, true]]);
});

test("Escaped dollars, currencies and code remain literal while adjacent dollar math renders", async ({ page, request }) => {
  const editor = await openResource(page);
  const escaped = String.raw`리터럴 \$x\$ 및 \$\$ y \$\$ / 비용 $5 또는 $10`;
  const inlineCode = '`$x$` 와 `$$ y $$` 옆 $z$';
  const fenced = '$$\n\\mathbb{R}\n$$\nprice = "$5"';
  await paste(editor, { "text/plain": `${escaped}\n\n${inlineCode}\n\n\`\`\`latex\n${fenced}\n\`\`\`` });
  await expectEquations(editor, [["z", false]]);
  await expect(editor.locator('[data-inline-mark="code"]')).toHaveText(["$x$", "$$ y $$"]);
  await expect(editor.locator('pre[data-code-language="latex"] [data-block-content]')).toHaveText(fenced);
  const codeSentence = editor.locator("[data-block-content]").filter({ has: page.locator('[data-inline-mark="code"]') });
  await codeSentence.evaluate((element) => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await codeSentence.pressSequentially("!");
  await expectEquations(editor, [["z", false]]);
  await expect(editor.locator('[data-inline-mark="code"]')).toHaveText(["$x$", "$$ y $$"]);
  await expect.poll(async () => (await storedBlocks(request)).length).toBe(3);
  const saved = await storedBlocks(request);
  expect(saved[0].text).toBe("리터럴 $x$ 및 $$ y $$ / 비용 $5 또는 $10");
  expect(saved[0].marks).toEqual([]);
  expect(saved[2]).toMatchObject({ type: "code", text: fenced, marks: [] });
  expect(await page.evaluate((formula) => {
    const code = [{ type: "code", start: 2, end: 5 }];
    const nested = parseMarkdownFormattedText("**$x$**", null, code);
    const display = parseMarkdownFormattedText(`$$\n${formula}\n$$\n\n`);
    return {
      text: nested.text, equations: nested.marks.filter((mark) => mark.type === "equation"),
      code: remapInlineMarksThroughMarkdown(nested, code), lastOffset: display.sourceToOutput.at(-1),
    };
  }, GATHERED)).toEqual({ text: "$x$", equations: [], code: [{ type: "code", start: 0, end: 3 }], lastOffset: GATHERED.length });
});

test("Unmatched dollar delimiters preserve the document without creating equations", async ({ page, request }) => {
  const editor = await openResource(page);
  const source = String.raw`앞 $x 와 뒤

$$ 닫히지 않은 인라인

$$
\mathbb{R}
마지막 문장`;
  await paste(editor, { "text/plain": source });
  await expect(editor.locator("sygma-display-equation")).toHaveCount(0);
  await expect.poll(async () => (await storedBlocks(request)).map((block) => block.text).join("\n\n")).toBe(source);
  expect((await storedBlocks(request)).every((block) => !block.marks.length)).toBe(true);
});
