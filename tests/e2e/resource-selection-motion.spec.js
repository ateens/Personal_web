import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const RESOURCE_ID = FIXTURE_IDS.bodySearchResource;
const BLOCK_IDS = ["selection-motion-1", "selection-motion-2", "selection-motion-3"];

function paragraph(id, text) {
  return { id, type: "paragraph", text, marks: [], checked: false, indent: 0, collapsed: false };
}

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

async function seedBlocks(request, blocks) {
  const before = await fixtureSnapshot(request);
  const draft = structuredClone(before.state);
  draft.resources.find((resource) => resource.id === RESOURCE_ID).blocks = blocks;
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state: draft, baseRevision: before.serverRevision },
  });
  expect(response.ok()).toBeTruthy();
}

async function openResource(page) {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-nav-key="resources"]').evaluate((button) => button.click());
  await page.locator(`[data-resource-open="${RESOURCE_ID}"]`).click();
  await expect(page.locator(`[data-resource-document="${RESOURCE_ID}"]`)).toBeVisible();
  await expect.poll(() => page.locator(`[data-resource-window="${RESOURCE_ID}"]`).evaluate((element) => (
    element.getAnimations().every((animation) => animation.playState !== "running")
  ))).toBe(true);
  return page.locator(`.block-editor[data-owner-type="resources"][data-owner-id="${RESOURCE_ID}"]`);
}

async function trackInlineToolbarAnimations(page) {
  await page.evaluate(() => {
    window.__inlineToolbarAnimationStarts = 0;
    document.addEventListener("animationstart", (event) => {
      if (event.target instanceof Element && event.target.matches("[data-inline-toolbar]")) {
        window.__inlineToolbarAnimationStarts += 1;
      }
    }, true);
  });
}

async function inlineToolbarAnimationStarts(page) {
  return page.evaluate(() => window.__inlineToolbarAnimationStarts || 0);
}

async function setCaret(content, offset) {
  await content.evaluate((element, requestedOffset) => {
    element.focus();
    const textNode = element.firstChild;
    const range = document.createRange();
    range.setStart(textNode, Math.min(requestedOffset, textNode.textContent.length));
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, offset);
}

test("Resource 본문에서는 수평 드래그가 텍스트를 선택하고 세로 드래그가 연속 블록을 선택한다", async ({ page, request }) => {
  await seedBlocks(request, BLOCK_IDS.map((id, index) => paragraph(id, `가나다라마바사 아자차카타파하 선택 줄 ${index + 1}`)));
  const editor = await openResource(page);
  const firstContent = editor.locator(`[data-block-content="${BLOCK_IDS[0]}"]`);
  const thirdContent = editor.locator(`[data-block-content="${BLOCK_IDS[2]}"]`);
  const firstBox = await firstContent.boundingBox();
  const thirdBox = await thirdContent.boundingBox();
  expect(firstBox && thirdBox).toBeTruthy();

  const textY = firstBox.y + firstBox.height / 2;
  await firstContent.focus();
  await page.mouse.move(firstBox.x + 5, textY);
  await page.mouse.down();
  await page.mouse.move(firstBox.x + Math.min(140, firstBox.width / 2), textY, { steps: 8 });
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().length || 0)).toBeGreaterThan(0);
  await expect(editor.locator(".block.is-selected")).toHaveCount(0);

  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const dragX = firstBox.x + 16;
  await page.mouse.move(dragX, textY);
  await page.mouse.down();
  await page.mouse.move(dragX, thirdBox.y + thirdBox.height / 2, { steps: 8 });
  await expect(page.locator(".editor-marquee")).toBeVisible();
  await page.mouse.up();

  await expect(page.locator(".editor-marquee")).toHaveCount(0);
  await expect.poll(() => editor.locator(".block.is-selected").evaluateAll((blocks) => blocks.map((block) => block.dataset.blockId))).toEqual(BLOCK_IDS);
});

test("오른쪽에서 왼쪽 여백 끝까지 드래그한 텍스트 선택은 mouseup 뒤에도 유지된다", async ({ page, request }) => {
  const text = "오른쪽에서 시작해 왼쪽 끝까지 선택을 유지하는 한 줄 본문";
  await seedBlocks(request, [paragraph(BLOCK_IDS[0], text)]);
  const editor = await openResource(page);
  const content = editor.locator(`[data-block-content="${BLOCK_IDS[0]}"]`);
  const block = editor.locator(`[data-block-id="${BLOCK_IDS[0]}"]`);
  const textBox = await content.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rect = range.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, height: rect.height };
  });
  const blockBox = await block.boundingBox();
  expect(blockBox).toBeTruthy();

  const y = textBox.top + textBox.height / 2;
  await page.mouse.move(textBox.right - 2, y);
  await page.mouse.down();
  await page.mouse.move(blockBox.x - 12, y, { steps: 12 });
  const selectedText = () => content.evaluate((element) => {
    const selection = window.getSelection();
    return !selection?.isCollapsed && element.contains(selection.anchorNode) && element.contains(selection.focusNode)
      ? selection.toString()
      : "";
  });
  await expect.poll(selectedText).not.toBe("");
  await page.mouse.up();

  await expect.poll(selectedText).not.toBe("");
});

test("세로 marquee를 움직이는 동안 선택 배경 전환이 반복 재생되지 않는다", async ({ page, request }) => {
  await seedBlocks(request, BLOCK_IDS.map((id, index) => paragraph(id, `세로 드래그 깜빡임 확인 줄 ${index + 1}`)));
  const editor = await openResource(page);
  const firstContent = editor.locator(`[data-block-content="${BLOCK_IDS[0]}"]`);
  const firstBox = await firstContent.boundingBox();
  const secondBox = await editor.locator(`[data-block-content="${BLOCK_IDS[1]}"]`).boundingBox();
  const thirdBox = await editor.locator(`[data-block-content="${BLOCK_IDS[2]}"]`).boundingBox();
  expect(firstBox && secondBox && thirdBox).toBeTruthy();
  await page.waitForTimeout(180);
  await page.evaluate(() => {
    window.__resourceMarqueeVisualRestarts = [];
    document.addEventListener("transitionrun", (event) => {
      if (event.propertyName === "background-color" && event.target instanceof Element && event.target.matches(".resource-document .block")) {
        window.__resourceMarqueeVisualRestarts.push(`${event.target.className}:${event.propertyName}`);
      }
    }, true);
  });

  const x = firstBox.x + 16;
  await page.mouse.move(x, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, secondBox.y + secondBox.height / 2, { steps: 5 });
  await expect(page.locator(".editor-marquee")).toBeVisible();
  await page.mouse.move(x, thirdBox.y + thirdBox.height / 2, { steps: 5 });
  await page.mouse.up();

  expect(await page.evaluate(() => window.__resourceMarqueeVisualRestarts || [])).toEqual([]);
});

test("활성 caret이 있어도 본문 중앙 세로 드래그로 고른 블록은 mouseup 뒤 유지된다", async ({ page, request }) => {
  await seedBlocks(request, BLOCK_IDS.map((id, index) => paragraph(id, `활성 caret 세로 선택 줄 ${index + 1}`)));
  const editor = await openResource(page);
  const firstContent = editor.locator(`[data-block-content="${BLOCK_IDS[0]}"]`);
  const thirdContent = editor.locator(`[data-block-content="${BLOCK_IDS[2]}"]`);
  await setCaret(firstContent, 5);
  await expect(firstContent).toBeFocused();
  const firstBox = await firstContent.boundingBox();
  const thirdBox = await thirdContent.boundingBox();
  expect(firstBox && thirdBox).toBeTruthy();

  const x = firstBox.x + firstBox.width / 2;
  const y = firstBox.y + firstBox.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 7, y + 2);
  await page.mouse.move(x + 7, thirdBox.y + thirdBox.height / 2, { steps: 8 });
  await expect(page.locator(".editor-marquee")).toBeVisible();
  await page.mouse.up();

  await expect(page.locator(".editor-marquee")).toHaveCount(0);
  await expect.poll(() => editor.locator(".block.is-selected").evaluateAll((blocks) => (
    blocks.map((block) => block.dataset.blockId)
  ))).toEqual(BLOCK_IDS);
});

test("Shift 방향키로 텍스트 범위를 늘려도 선택 툴바 진입 애니메이션은 한 번만 실행된다", async ({ page, request }) => {
  await seedBlocks(request, [paragraph(BLOCK_IDS[0], "Keyboard selection keeps the toolbar floating")]);
  const editor = await openResource(page);
  await trackInlineToolbarAnimations(page);
  const content = editor.locator(`[data-block-content="${BLOCK_IDS[0]}"]`);
  await setCaret(content, 0);

  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator("[data-inline-toolbar]")).toBeVisible();
  await expect.poll(() => inlineToolbarAnimationStarts(page)).toBe(1);

  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator("[data-inline-toolbar]")).not.toHaveClass(/is-entering/);
  await page.waitForTimeout(180);
  expect(await inlineToolbarAnimationStarts(page)).toBe(1);
});

test("마우스 텍스트 드래그 툴바는 500ms 뒤 한 번 떠오르고 이후 범위 변경에는 다시 움직이지 않는다", async ({ page, request }) => {
  await seedBlocks(request, [paragraph(BLOCK_IDS[0], "Mouse selection waits before showing the floating toolbar")]);
  const editor = await openResource(page);
  await trackInlineToolbarAnimations(page);
  const content = editor.locator(`[data-block-content="${BLOCK_IDS[0]}"]`);
  const box = await content.boundingBox();
  expect(box).toBeTruthy();

  const y = box.y + box.height / 2;
  await content.focus();
  await page.mouse.move(box.x + 5, y);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(180, box.width / 2), y, { steps: 10 });
  await page.mouse.up();

  await expect(page.locator("[data-inline-toolbar]")).toHaveCount(0);
  await page.waitForTimeout(350);
  await expect(page.locator("[data-inline-toolbar]")).toHaveCount(0);
  await expect(page.locator("[data-inline-toolbar]")).toBeVisible({ timeout: 800 });
  await expect.poll(() => inlineToolbarAnimationStarts(page)).toBe(1);

  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator("[data-inline-toolbar]")).not.toHaveClass(/is-entering/);
  await page.waitForTimeout(180);
  expect(await inlineToolbarAnimationStarts(page)).toBe(1);
});
