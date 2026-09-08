import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const RESOURCE_ID = FIXTURE_IDS.bodySearchResource;
const FLOWCHART = 'flowchart LR\n  A[시작] --> B{검토}\n  B -->|승인| C[완료]\n  B -->|수정| A';
const GALLERY = [
  ["flowchart", FLOWCHART, ["시작", "검토", "완료"]],
  ["sequence", "sequenceDiagram\n  participant User as 사용자\n  participant App as 앱\n  User->>App: 요청\n  App-->>User: 응답", ["사용자", "앱", "요청", "응답"]],
  ["class", "classDiagram\n  class Resource {\n    +String title\n    +save()\n  }\n  class Project\n  Project --> Resource : contains", ["Resource", "Project", "title", "save"]],
  ["state", "stateDiagram-v2\n  [*] --> Draft\n  Draft --> Ready : review\n  Ready --> [*]", ["Draft", "Ready", "review"]],
  ["wide", `flowchart LR\n  ${Array.from({ length: 12 }, (_, index) => `N${index}[검토 단계 ${index + 1}]`).join(" --> ")}`, ["검토 단계 1", "검토 단계 12"]],
];

function block(id, text, language = "mermaid", type = "code") {
  return { id, type, text, marks: [], checked: false, indent: 0, collapsed: false, ...(type === "code" ? { language } : {}) };
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

async function storedBlocks(request) {
  return (await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === RESOURCE_ID).blocks;
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

function diagram(editor, id) {
  return editor.locator(`[data-block-id="${id}"] [data-mermaid-block]`);
}

async function expectDiagram(element, labels) {
  const preview = element.locator("[data-mermaid-preview]");
  await expect(preview.locator("svg")).toBeVisible();
  for (const label of labels) await expect(preview).toContainText(label);
  await expect(element.locator("[data-block-content]")).not.toBeVisible();
  expect(await preview.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(255, 255, 255)");
  expect(await element.evaluate((node) => node.matches(".code-space") || Boolean(node.querySelector(".code-space")))).toBe(false);
  return preview;
}

test.use({ reducedMotion: "reduce" });

for (const width of [1440, 390]) {
  test(`Mermaid renders Korean flowcharts and sequence, class, state diagrams on white at ${width}px`, async ({ page, request }, testInfo) => {
    const blocks = GALLERY.map(([id, source]) => block(id, source));
    await seedBlocks(request, blocks);
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const editor = await openResource(page);
    for (const [id, , labels] of GALLERY) {
      const preview = await expectDiagram(diagram(editor, id), labels);
      await preview.scrollIntoViewIfNeeded();
      await preview.locator("svg").click({ position: { x: 8, y: 8 } });
      await expect(diagram(editor, id).locator("[data-mermaid-source]")).not.toHaveAttribute("open", "");
      const geometry = await preview.evaluate((node) => {
        node.scrollLeft = 0;
        const viewport = node.getBoundingClientRect();
        const svg = node.shadowRoot.querySelector("svg");
        const left = svg.getBoundingClientRect().left;
        const firstWidth = svg.getBoundingClientRect().width;
        node.scrollLeft = node.scrollWidth;
        return {
          pageWidth: document.documentElement.scrollWidth,
          left: viewport.left, right: viewport.right, svgLeft: left,
          svgRightAtEnd: svg.getBoundingClientRect().right, svgWidth: firstWidth,
          clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, scrollLeft: node.scrollLeft,
        };
      });
      expect(geometry.pageWidth).toBe(width);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(width);
      expect(geometry.svgWidth).toBeGreaterThan(10);
      expect(geometry.svgLeft, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.left - 1);
      expect(geometry.svgRightAtEnd, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.right + 1);
      await testInfo.attach(`geometry-${id}`, { body: JSON.stringify(geometry, null, 2), contentType: "application/json" });
      await preview.evaluate((node) => { node.scrollLeft = 0; });
      await page.mouse.move(0, 0);
      await diagram(editor, id).screenshot({ path: testInfo.outputPath(`mermaid-${id}-${width}.png`) });
    }
    expect((await storedBlocks(request)).map(({ id, text, language }) => ({ id, text, language })))
      .toEqual(blocks.map(({ id, text, language }) => ({ id, text, language })));
    expect(errors).toEqual([]);
  });
}

test("Mermaid fence, language picker, source editing, copy and reload preserve the code", async ({ page, request }) => {
  await seedBlocks(request, [block("fence", "", "", "paragraph"), block("picker", FLOWCHART, "plaintext")]);
  await page.setViewportSize({ width: 390, height: 1000 });
  let editor = await openResource(page);
  const paragraph = editor.locator('[data-block-content="fence"]');
  await paragraph.pressSequentially("```mermaid");
  await paragraph.press("Enter");
  let fenced = diagram(editor, "fence");
  await expect(fenced).toBeVisible();
  let code = fenced.locator('[data-block-content="fence"]');
  await expect(code).toBeVisible();
  await expect(code).toBeFocused();
  await code.fill(FLOWCHART);
  await fenced.locator("[data-mermaid-edit]").click();
  await expectDiagram(fenced, ["시작", "완료"]);

  const languageTrigger = editor.locator('[data-code-language-trigger="picker"]');
  await languageTrigger.click();
  await editor.locator('[data-code-language-value="mermaid"][data-code-language-block="picker"]').click();
  await expectDiagram(diagram(editor, "picker"), ["시작", "완료"]);
  await expect(editor.locator('[data-code-language-trigger="picker"]')).toContainText("Mermaid");

  const edited = `${FLOWCHART}\n  %% 두 칸  공백을 보존\n  C --> D[보관]`;
  await fenced.locator("[data-mermaid-edit]").click();
  await expect(code).toHaveText(FLOWCHART);
  await code.fill(edited);
  await fenced.locator("[data-mermaid-edit]").click();
  await expectDiagram(fenced, ["시작", "보관"]);
  await page.evaluate(() => {
    window.__copiedMermaidCode = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => { window.__copiedMermaidCode.push(text); } },
    });
  });
  await fenced.locator('[data-code-copy="fence"]').click();
  expect(await page.evaluate(() => window.__copiedMermaidCode)).toEqual([edited]);
  await expect.poll(async () => (await storedBlocks(request)).map(({ id, type, text, language }) => ({ id, type, text, language })))
    .toEqual([{ id: "fence", type: "code", text: edited, language: "mermaid" }, { id: "picker", type: "code", text: FLOWCHART, language: "mermaid" }]);

  editor = await openResource(page);
  fenced = diagram(editor, "fence");
  await expectDiagram(fenced, ["시작", "보관"]);
  await expectDiagram(diagram(editor, "picker"), ["시작", "완료"]);
  await fenced.locator("[data-mermaid-edit]").click();
  code = fenced.locator('[data-block-content="fence"]');
  expect(await code.evaluate((node) => node.textContent)).toBe(edited);
  await expect(fenced.locator("[data-mermaid-source]")).toHaveAttribute("open", "");
});

test("Mermaid syntax errors preserve the source and recover after editing", async ({ page, request }) => {
  const invalid = "flowchart LR\n  A[열린 괄호 --> B";
  await seedBlocks(request, [block("invalid", invalid)]);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const editor = await openResource(page);
  const element = diagram(editor, "invalid");
  const preview = element.locator("[data-mermaid-preview]");
  await expect(preview).toHaveAttribute("data-mermaid-state", "error");
  expect(await element.locator("[data-block-content]").evaluate((node) => node.textContent)).toBe(invalid);
  expect((await storedBlocks(request))[0].text).toBe(invalid);
  const code = element.locator("[data-block-content]");
  if (!(await code.isVisible())) await element.locator("[data-mermaid-edit]").click();
  await code.fill(FLOWCHART);
  await element.locator("[data-mermaid-edit]").click();
  await expectDiagram(element, ["시작", "완료"]);
  await expect(preview).toHaveAttribute("data-mermaid-state", "ready");
  await expect.poll(async () => (await storedBlocks(request))[0].text).toBe(FLOWCHART);
  expect(errors).toEqual([]);
});

test("Mermaid retries a failed lazy engine download without losing the source", async ({ page, request }) => {
  await seedBlocks(request, [block("download", FLOWCHART)]);
  let downloads = 0;
  await page.route("**/assets/mermaid/mermaid.min.js", async (route) => {
    downloads += 1;
    if (downloads === 1) await route.abort("failed");
    else await route.continue();
  });
  const editor = await openResource(page);
  const element = diagram(editor, "download");
  const preview = element.locator("[data-mermaid-preview]");
  await expect(preview).toHaveAttribute("data-mermaid-state", "error");
  expect(downloads).toBe(1);
  expect(await element.locator("[data-block-content]").evaluate((node) => node.textContent)).toBe(FLOWCHART);
  expect((await storedBlocks(request))[0].text).toBe(FLOWCHART);
  await preview.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expectDiagram(element, ["시작", "검토", "완료"]);
  await expect(preview).toHaveAttribute("data-mermaid-state", "ready");
  expect(downloads).toBe(2);
  await preview.locator("svg").click({ position: { x: 8, y: 8 } });
  await expect(element.locator("[data-mermaid-source]")).not.toHaveAttribute("open", "");
  expect((await storedBlocks(request))[0].text).toBe(FLOWCHART);
});

test("Mermaid discards an older asynchronous render after the source changes", async ({ page, request }) => {
  await seedBlocks(request, [block("race", FLOWCHART)]);
  const editor = await openResource(page);
  const element = diagram(editor, "race");
  await expectDiagram(element, ["시작", "완료"]);
  await page.evaluate(() => {
    const render = window.mermaid.render.bind(window.mermaid);
    window.__mermaidDelayed = false;
    window.__mermaidReleased = false;
    window.mermaid.render = async (...args) => {
      const result = await render(...args);
      if (args[1].includes("이전 결과")) {
        window.__mermaidDelayed = true;
        await new Promise((resolve) => { window.__releaseMermaidRender = resolve; });
        window.__mermaidReleased = true;
      }
      return result;
    };
  });
  await element.locator("[data-mermaid-edit]").click();
  const code = element.locator("[data-block-content]");
  await code.fill("flowchart LR\n A[이전 결과] --> B[먼저 요청]");
  await expect.poll(() => page.evaluate(() => window.__mermaidDelayed)).toBe(true);
  const latest = "flowchart LR\n A[최신 결과] --> B[나중 요청]";
  await code.fill(latest);
  await expect(element.locator("[data-mermaid-preview]")).toHaveAttribute("data-source", latest);
  await element.locator("[data-mermaid-edit]").click();
  await expectDiagram(element, ["최신 결과", "나중 요청"]);
  await page.evaluate(() => window.__releaseMermaidRender());
  await expect.poll(() => page.evaluate(() => window.__mermaidReleased)).toBe(true);
  await expectDiagram(element, ["최신 결과", "나중 요청"]);
  await expect(element.locator("[data-mermaid-preview]")).not.toContainText("이전 결과");
  await expect.poll(async () => (await storedBlocks(request))[0].text).toBe(latest);
});

test("Mermaid keeps directives, HTML labels and script links inert", async ({ page, request }) => {
  const unsafe = [
    ["directive", '%%{init: {"securityLevel":"loose","flowchart":{"htmlLabels":true},"themeVariables":{"background":"#111111"}}}%%\nflowchart LR\n A["<img src=x onerror=window.__mermaidXss=1>"] --> B[안전]\n click B "javascript:window.__mermaidXss=2" "실행"'],
    ["frontmatter", '---\nconfig:\n  securityLevel: loose\n  htmlLabels: true\n---\nflowchart LR\n A["<script>window.__mermaidXss=3</script>"] --> B[보존]'],
    ["font-family", '---\nconfig: {fontFamily: "Arial; background-image:url(/font-family-injection)"}\n---\nflowchart TD\nA[Safe] --> B[Result]'],
    ["alt-font-family", '---\nconfig: {altFontFamily: "Arial; background-image:url(/alt-font-family-injection)"}\n---\nflowchart TD\nA[Safe] --> B[Result]'],
  ];
  await seedBlocks(request, unsafe.map(([id, source]) => block(id, source)));
  await page.addInitScript(() => { window.__mermaidXss = 0; });
  const injectedRequests = [];
  await page.route("**/*font-family-injection", async (route) => {
    injectedRequests.push(new URL(route.request().url()).pathname);
    await route.abort();
  });
  const dialogs = [];
  const errors = [];
  page.on("dialog", async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  page.on("pageerror", (error) => errors.push(error.message));
  const editor = await openResource(page);
  for (const [id, source] of unsafe) {
    const element = diagram(editor, id);
    const preview = element.locator("[data-mermaid-preview]");
    await expect(preview).toHaveAttribute("data-mermaid-state", /^(ready|error)$/);
    if (id.endsWith("font-family")) {
      await expect(preview).toHaveAttribute("data-mermaid-state", "ready");
      expect(await preview.evaluate((node) => node.shadowRoot.innerHTML)).not.toContain("font-family-injection");
    }
    expect(await element.locator("[data-block-content]").evaluate((node) => node.textContent)).toBe(source);
    const executable = await preview.evaluate((node) => [...node.shadowRoot.querySelectorAll("*")].flatMap((child) => {
      const bad = [];
      if (/^(script|iframe|object|embed|img)$/i.test(child.localName)) bad.push(child.localName);
      for (const attribute of child.attributes) {
        if (/^on/i.test(attribute.name) || (/href|src/i.test(attribute.name) && /^\s*(javascript|data):/i.test(attribute.value))) bad.push(`${attribute.name}=${attribute.value}`);
      }
      return bad;
    }));
    expect(executable).toEqual([]);
    expect(await preview.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(255, 255, 255)");
  }
  expect(await page.evaluate(() => window.__mermaidXss)).toBe(0);
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
  expect(injectedRequests).toEqual([]);
  expect((await storedBlocks(request)).map(({ id, text }) => [id, text])).toEqual(unsafe);
});
