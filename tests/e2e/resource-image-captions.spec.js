import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const imageUrl = "https://example.com/caption-image.png";
const paragraph = { id: "caption-after", type: "paragraph", text: "이미지 다음 문장", marks: [], checked: false, indent: 0, collapsed: false };
const imageBlock = (id, caption = "") => ({ id, type: "image", text: "대체 텍스트", alt: "대체 텍스트", url: imageUrl, marks: [], checked: false, indent: 0, collapsed: false, ...(caption ? { caption } : {}) });

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.route(imageUrl, (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#e3e9ef"/></svg>' }));
});

async function seed(request, { caption = "", resourceId = FIXTURE_IDS.resource, locked = false } = {}) {
  const before = await fixtureSnapshot(request);
  const state = structuredClone(before.state);
  const resource = state.resources.find((entry) => entry.id === resourceId);
  resource.blocks = [imageBlock("caption-image", caption), paragraph];
  resource.commentThreads = [];
  if (locked) resource.locked = true;
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state, baseRevision: before.serverRevision },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function open(page, resourceId = FIXTURE_IDS.resource) {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-nav-key="resources"]').evaluate((node) => node.click());
  await page.locator(`[data-resource-open="${resourceId}"]`).click();
  const editor = page.locator(`.block-editor[data-owner-type="resources"][data-owner-id="${resourceId}"]`);
  await expect(editor.locator("img")).toBeVisible();
  await editor.evaluate(async (node) => {
    await Promise.all(node.closest("[data-resource-window]").getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
  });
  return editor;
}

async function editCaption(page, editor, label = "캡션 추가") {
  await editor.locator('[data-block-id="caption-image"] img').click();
  await page.keyboard.press("Meta+/");
  const action = page.locator('[data-selected-block-action="image-caption"]');
  await expect(action).toHaveAccessibleName(label);
  await page.locator("[data-selected-block-query]").press("Tab");
  await expect(action).toBeFocused();
  await action.press("Enter");
  const caption = editor.locator("[data-resource-image-caption]");
  await expect(caption).toBeFocused();
  return caption;
}

async function savedImage(request, resourceId = FIXTURE_IDS.resource) {
  return (await fixtureSnapshot(request)).state.resources.find((entry) => entry.id === resourceId).blocks.find((block) => block.id === "caption-image");
}

for (const width of [1440, 390]) test(`image captions require an explicit action and hide again when cleared at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 1000 });
  await seed(request);
  let editor = await open(page);
  await expect(editor.locator("[data-resource-image-caption]")).toHaveCount(0);
  const figureHeight = await editor.locator("figure").evaluate((node) => node.getBoundingClientRect().height);
  const initial = await savedImage(request);

  let caption = await editCaption(page, editor);
  await editor.locator('[data-block-content="caption-after"]').click();
  await expect(caption).toHaveCount(0);
  expect(await savedImage(request)).toEqual(initial);
  expect(await editor.locator("figure").evaluate((node) => node.getBoundingClientRect().height)).toBe(figureHeight);

  caption = await editCaption(page, editor);
  await caption.fill("이미지를 설명하는 캡션");
  await expect.poll(async () => (await savedImage(request)).caption).toBe("이미지를 설명하는 캡션");
  await expect(caption).toBeFocused();
  await expect(caption).toHaveValue("이미지를 설명하는 캡션");
  const bounds = await caption.evaluate((node) => ({ left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right }));
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);

  editor = await open(page);
  caption = editor.locator("[data-resource-image-caption]");
  await expect(caption).toHaveValue("이미지를 설명하는 캡션");
  await editCaption(page, editor, "캡션 편집");
  await caption.fill("");
  await expect(caption).toBeFocused();
  await expect(caption).toBeVisible();
  await editor.locator('[data-block-content="caption-after"]').click();
  await expect(caption).toHaveCount(0);
  await expect.poll(async () => (await savedImage(request)).caption ?? null).toBeNull();
  editor = await open(page);
  await expect(editor.locator("[data-resource-image-caption]")).toHaveCount(0);
  expect(await savedImage(request)).toEqual(initial);
});

test("existing image captions retain exact text through rich clipboard copy and paste", async ({ page, request }) => {
  const text = '기존 캡션 <설명> & "인용"';
  await seed(request, { caption: text });
  const editor = await open(page);
  await expect(editor.locator("[data-resource-image-caption]")).toHaveValue(text);
  await editor.locator("img").click();
  const clipboard = await editor.evaluate((node) => {
    const data = new DataTransfer();
    node.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data }));
    return Object.fromEntries([...data.types].map((type) => [type, data.getData(type)]));
  });
  expect(JSON.parse(clipboard["application/x-sygma-blocks"]).blocks[0]).toMatchObject({ type: "image", caption: text, alt: "대체 텍스트", url: imageUrl });
  expect(clipboard["text/html"]).toContain("data-block-caption=");
  const after = editor.locator('[data-block-content="caption-after"]');
  await after.click();
  await after.press("End");
  await after.press("Enter");
  await page.locator("[data-block-content]:focus").evaluate((node, dataByType) => {
    const data = new DataTransfer();
    for (const [type, value] of Object.entries(dataByType)) data.setData(type, value);
    node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  }, clipboard);
  await expect(editor.locator("[data-resource-image-caption]")).toHaveCount(2);
  for (const caption of await editor.locator("[data-resource-image-caption]").all()) await expect(caption).toHaveValue(text);
});

for (const mode of ["readOnly", "locked"]) test(`${mode} images keep existing captions readable without allowing edits`, async ({ page, request }) => {
  const resourceId = mode === "readOnly" ? FIXTURE_IDS.readOnlyResource : FIXTURE_IDS.resource;
  await seed(request, { resourceId, caption: "보존할 설명", locked: mode === "locked" });
  const editor = await open(page, resourceId);
  const caption = editor.locator("[data-resource-image-caption]");
  await expect(caption).toHaveValue("보존할 설명");
  await expect(caption).toHaveAttribute("readonly", "");
  await caption.evaluate((node) => {
    node.value = "허용하지 않는 변경";
    node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: node.value }));
  });
  await editor.locator("img").click();
  await page.keyboard.press("Meta+/");
  await expect(page.locator('[data-selected-block-action="image-caption"]')).toHaveCount(0);
  expect((await savedImage(request, resourceId)).caption).toBe("보존할 설명");
  await seed(request, { resourceId, locked: mode === "locked" });
  await open(page, resourceId);
  await expect(editor.locator("[data-resource-image-caption]")).toHaveCount(0);
});
