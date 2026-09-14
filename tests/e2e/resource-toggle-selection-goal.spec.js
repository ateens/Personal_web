import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const RESOURCE_ID = FIXTURE_IDS.bodySearchResource;
const paragraph = (id, text = "", indent = 0) => ({ id, text, indent, type: "paragraph", marks: [], checked: false, collapsed: false });
const toggle = (id, indent = 0) => ({ ...paragraph(id, id, indent), type: "toggle" });

test.beforeEach(async ({ request }) => { await resetFixture(request); });

async function openResource(page, request, blocks) {
  const before = await fixtureSnapshot(request);
  const state = structuredClone(before.state);
  state.resources.find((resource) => resource.id === RESOURCE_ID).blocks = blocks;
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state, baseRevision: before.serverRevision },
  });
  expect(response.ok()).toBeTruthy();
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

async function savedBlocks(request) {
  return (await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === RESOURCE_ID).blocks;
}

test("토글의 빈 줄은 반복 Enter에도 내부에 남고 Backspace는 한 줄씩 삭제한다", async ({ page, request }) => {
  const editor = await openResource(page, request, [
    toggle("outer"), { ...toggle("nested", 1), toggleHeading: "heading2" },
    paragraph("empty", "", 2), paragraph("following-child", "원래 다음 자식", 2), paragraph("outside", "바깥 문장"),
  ]);
  await editor.locator('[data-block-content="empty"]').click();
  for (let count = 0; count < 3; count += 1) {
    await page.keyboard.press("Enter");
    await expect(editor.locator(".block:has([data-block-content]:focus)")).toHaveAttribute("data-indent", "2");
  }
  await expect.poll(async () => (await savedBlocks(request)).filter((block) => block.indent === 2 && !block.text).length).toBe(4);
  for (let remaining = 3; remaining >= 0; remaining -= 1) {
    const before = await savedBlocks(request);
    const removingId = await editor.locator("[data-block-content]:focus").getAttribute("data-block-content");
    const index = before.findIndex((block) => block.id === removingId);
    await page.keyboard.press("Backspace");
    await expect(editor.locator(`[data-block-id="${removingId}"]`)).toHaveCount(0);
    await expect(editor.locator(`[data-block-content="${before[index - 1].id}"]`)).toBeFocused();
    await expect.poll(async () => (await savedBlocks(request)).filter((block) => block.indent === 2 && !block.text).length).toBe(remaining);
  }
  await expect.poll(async () => (await savedBlocks(request)).map((block) => block.id)).toEqual(["outer", "nested", "following-child", "outside"]);
  await expect(editor.locator('[data-block-id="following-child"]')).toHaveAttribute("data-indent", "2");
  await page.keyboard.press("Meta+z");
  await expect(editor.locator('[data-block-content="empty"]')).toBeFocused();
  await expect(editor.locator('[data-block-id="empty"]')).toHaveAttribute("data-indent", "2");
});

for (const type of ["bullet", "numbered", "todo"]) {
  test(`${type} 목록의 Enter 두 번 종료는 토글 변경 후에도 유지된다`, async ({ page, request }) => {
    const editor = await openResource(page, request, [
      { ...paragraph("list", "목록"), type }, toggle("list-toggle"), { ...paragraph("nested-list", "토글 안 목록", 1), type },
    ]);
    for (const id of ["list", "nested-list"]) {
      await editor.locator(`[data-block-content="${id}"]`).click();
      await page.keyboard.press("End");
      await page.keyboard.press("Meta+ArrowRight");
      await page.keyboard.press("Enter");
      await expect(editor.locator(".block:has([data-block-content]:focus)")).toHaveAttribute("data-type", type);
      await page.keyboard.press("Enter");
      await expect(editor.locator(".block:has([data-block-content]:focus)")).toHaveAttribute("data-indent", id === "list" ? "0" : "1");
      await expect(editor.locator(".block:has([data-block-content]:focus)")).toHaveAttribute("data-type", "paragraph");
      if (id === "nested-list") {
        const blank = await editor.locator("[data-block-content]:focus").getAttribute("data-block-content");
        await page.keyboard.press("Backspace");
        await expect(editor.locator(`[data-block-content="${blank}"]`)).toHaveCount(0);
        await expect(editor.locator('[data-block-content="nested-list"]')).toBeFocused();
        await expect(editor.locator('[data-block-id="nested-list"]')).toHaveAttribute("data-indent", "1");
      }
    }
  });

  test(`토글 안 ${type}의 하위 목록은 Enter와 Backspace 모두 목록만 끝내고 자리를 유지한다`, async ({ page, request }) => {
    const blocks = [toggle("list-toggle"), { ...paragraph("parent-list", "부모 목록", 1), type },
      { ...paragraph("empty-list", "", 2), type }, { ...paragraph("next-list", "다음 목록", 2), type }, paragraph("after", "토글 밖")];
    const editor = await openResource(page, request, blocks);
    const empty = editor.locator('[data-block-content="empty-list"]');
    for (const key of ["Enter", "Backspace"]) {
      await empty.click();
      await page.keyboard.press(key);
      await expect(editor.locator('[data-block-id="empty-list"]')).toHaveAttribute("data-indent", "2");
      await expect(editor.locator('[data-block-id="empty-list"]')).toHaveAttribute("data-type", "paragraph");
      await expect.poll(async () => (await savedBlocks(request)).map((block) => block.id)).toEqual(blocks.map((block) => block.id));
      await page.keyboard.press("Meta+z");
      await expect(editor.locator('[data-block-id="empty-list"]')).toHaveAttribute("data-type", type);
    }
  });
}

test("Cmd Shift 위는 가까운 토글을 접고 아래는 현재 토글과 제목 토글을 편다", async ({ page, request }) => {
  const editor = await openResource(page, request, [
    toggle("outer"), { ...toggle("nested", 1), toggleHeading: "heading2" },
    paragraph("child", "토글 안 문장", 2), { ...paragraph("child-table", "| 머리 |\n| --- |\n| 셀 |", 2), type: "table" },
    paragraph("outer-child", "상위 토글 문장", 1), paragraph("outside", "바깥 문장"),
  ]);
  await editor.locator('[data-block-content="child"]').click();
  await page.keyboard.press("Meta+Shift+ArrowUp");
  await expect(editor.locator('[data-block-id="nested"]')).toHaveAttribute("data-toggle-collapsed", "true");
  await expect(editor.locator('[data-block-id="child"]')).toBeHidden();
  await expect(editor.locator('[data-block-content="nested"]')).toBeFocused();
  await expect(editor.locator('[data-block-id="outer"]')).toHaveAttribute("data-toggle-collapsed", "false");
  await page.keyboard.press("Meta+Shift+ArrowUp");
  await expect(editor.locator('[data-block-id="nested"]')).toHaveAttribute("data-toggle-collapsed", "true");
  await page.keyboard.press("Meta+Shift+ArrowDown");
  await expect(editor.locator('[data-block-id="child"]')).toBeVisible();
  await page.keyboard.press("Meta+Shift+ArrowDown");
  await expect(editor.locator('[data-block-id="nested"]')).toHaveAttribute("data-toggle-collapsed", "false");
  await editor.locator('[data-block-id="child-table"] [data-resource-table-cell]').last().click();
  await page.keyboard.press("Meta+Shift+ArrowUp");
  await expect(editor.locator('[data-block-id="child-table"]')).toBeHidden();
  await expect(editor.locator('[data-block-content="nested"]')).toBeFocused();
  await page.keyboard.press("Meta+Shift+ArrowDown");
  await expect(editor.locator('[data-block-id="child-table"]')).toBeVisible();
  await editor.locator('[data-block-content="outer-child"]').click();
  await page.keyboard.press("Meta+Shift+ArrowUp");
  await expect(editor.locator('[data-block-id="nested"]')).toBeHidden();
  await expect(editor.locator('[data-block-content="outer"]')).toBeFocused();
  await page.keyboard.press("Meta+Shift+ArrowDown");
  await expect(editor.locator('[data-block-id="child"]')).toBeVisible();
  await expect.poll(async () => (await savedBlocks(request)).filter((block) => block.type === "toggle").map((block) => block.collapsed)).toEqual([false, false]);
});

test("위아래로 방향을 바꾸는 세로 드래그는 caret 재진입 없이 선택을 유지한다", async ({ page, request }) => {
  const blocks = Array.from({ length: 9 }, (_, index) => ({ ...paragraph(`drag-${index}`, `선택할 문장 ${index}과 인라인 코드 경계`), marks: [{ type: "code", start: 0, end: 6 }] }));
  const editor = await openResource(page, request, blocks);
  const content = (index) => editor.locator(`[data-block-content="drag-${index}"]`);
  await content(4).click();
  const rects = await Promise.all([1, 4, 7].map((index) => content(index).boundingBox()));
  const [top, middle, bottom] = rects;
  const x = middle.x + 36;
  const middleY = middle.y + middle.height / 2;
  await page.mouse.move(x, middleY);
  await page.mouse.down();
  await page.mouse.move(x + 2, bottom.y + bottom.height / 2, { steps: 16 });
  await expect(page.locator(".editor-marquee")).toBeVisible();
  await expect(content(4)).not.toBeFocused();
  // A delayed browser/editor focus must not turn an active drag back into a caret.
  await content(4).focus();
  await expect(editor.locator(".block.is-selected")).toHaveCount(4);
  await expect(content(4)).not.toBeFocused();
  await page.mouse.move(x - 2, top.y + top.height / 2, { steps: 16 });
  await expect(editor.locator(".block.is-selected")).toHaveCount(4);
  await expect(editor.locator("[data-block-content]:focus")).toHaveCount(0);
  await page.mouse.move(x + 3, bottom.y + bottom.height / 2, { steps: 16 });
  await expect(editor.locator(".block.is-selected")).toHaveCount(4);
  await page.mouse.up();
  await expect(editor.locator(".block.is-selected")).toHaveCount(4);
  await expect(editor.locator("[data-block-content]:focus")).toHaveCount(0);
  expect(await savedBlocks(request)).toEqual(blocks);
});

test("원격 변경은 마우스 선택이 끝날 때 반영되어 드래그 중 본문을 교체하지 않는다", async ({ page, request }) => {
  const blocks = [paragraph("remote-first", "원래 첫 줄"), paragraph("remote-second", "둘째 줄"), paragraph("remote-last", "마지막 줄")];
  const editor = await openResource(page, request, blocks);
  const first = editor.locator('[data-block-content="remote-first"]');
  await first.click();
  const a = await first.boundingBox();
  const b = await editor.locator('[data-block-content="remote-last"]').boundingBox();
  await page.mouse.move(a.x + 18, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 18, b.y + b.height / 2, { steps: 12 });
  await expect(page.locator(".editor-marquee")).toBeVisible();
  const before = await fixtureSnapshot(request);
  before.state.resources.find((resource) => resource.id === RESOURCE_ID).blocks[0].text = "원격에서 바뀐 첫 줄";
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state: before.state, baseRevision: before.serverRevision },
  });
  expect(response.ok()).toBeTruthy();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(350);
  await expect(first).toHaveText("원래 첫 줄");
  await expect(editor.locator(".block.is-selected")).toHaveCount(3);
  await page.mouse.up();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(first).toHaveText("원격에서 바뀐 첫 줄");
  await expect(editor.locator(".block.is-selected")).toHaveCount(3);
});
