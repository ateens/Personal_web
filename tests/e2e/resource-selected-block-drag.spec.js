import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const RESOURCE_ID = FIXTURE_IDS.bodySearchResource;
const IDS = Array.from({ length: 5 }, (_, index) => `selected-drag-${index + 1}`);

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
  const before = await fixtureSnapshot(request);
  const draft = structuredClone(before.state);
  draft.resources.find((resource) => resource.id === RESOURCE_ID).blocks = IDS.map((id, index) => ({
    id, type: "paragraph", text: `선택한 문장을 다시 잡아서 이동하는 본문 ${index + 1}`, marks: [], checked: false, indent: 0, collapsed: false,
  }));
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state: draft, baseRevision: before.serverRevision },
  });
  expect(response.ok()).toBeTruthy();
});

async function openResource(page) {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-nav-key="resources"]').evaluate((button) => button.click());
  await page.locator(`[data-resource-open="${RESOURCE_ID}"]`).click();
  await expect.poll(() => page.locator(`[data-resource-window="${RESOURCE_ID}"]`).evaluate((element) => (
    element.getAnimations().every((animation) => animation.playState !== "running")
  ))).toBe(true);
  return page.locator(`.block-editor[data-owner-type="resources"][data-owner-id="${RESOURCE_ID}"]`);
}

async function selectFirstThree(page, editor) {
  const panel = await page.locator(`[data-resource-document="${RESOURCE_ID}"]`).boundingBox();
  const bounds = await editor.boundingBox();
  const first = await editor.locator(`[data-block-id="${IDS[0]}"]`).boundingBox();
  const third = await editor.locator(`[data-block-id="${IDS[2]}"]`).boundingBox();
  const x = Math.max(panel.x + 8, bounds.x - 18);
  await page.mouse.move(x, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, third.y + third.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => selectedIds(editor)).toEqual(IDS.slice(0, 3));
}

const selectedIds = (editor) => editor.locator(".block.is-selected").evaluateAll((blocks) => blocks.map((block) => block.dataset.blockId));
const blockIds = (editor) => editor.locator(".block[data-block-id]").evaluateAll((blocks) => blocks.map((block) => block.dataset.blockId));
const savedIds = async (request) => (await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === RESOURCE_ID).blocks.map((block) => block.id);

test("여백에서 선택한 세 줄은 선택한 본문을 다시 잡아 연속 이동하고 저장·실행 취소된다", async ({ page, request }) => {
  const editor = await openResource(page);
  await selectFirstThree(page, editor);
  const body = await editor.locator(`[data-block-content="${IDS[1]}"]`).boundingBox();
  const last = await editor.locator(`[data-block-id="${IDS[4]}"]`).boundingBox();
  const x = body.x + 80;
  await page.mouse.move(x, body.y + body.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, last.y + last.height - 2, { steps: 10 });
  await expect(page.locator(".block-drag-ghost")).toBeVisible();
  await expect(page.locator(".editor-marquee")).toHaveCount(0);
  await page.mouse.up();
  const moved = [...IDS.slice(3), ...IDS.slice(0, 3)];
  await expect.poll(() => blockIds(editor)).toEqual(moved);
  await expect.poll(() => selectedIds(editor)).toEqual(IDS.slice(0, 3));
  await expect.poll(() => savedIds(request)).toEqual(moved);

  // Re-grab another row in the same selection and move all three back.
  const grip = await editor.locator(`[data-block-content="${IDS[2]}"]`).boundingBox();
  const first = await editor.locator(`[data-block-id="${IDS[3]}"]`).boundingBox();
  await page.mouse.move(x, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, first.y + 2, { steps: 10 });
  await expect(page.locator(".block-drag-ghost")).toBeVisible();
  await page.mouse.up();
  await expect.poll(() => blockIds(editor)).toEqual(IDS);
  await expect.poll(() => selectedIds(editor)).toEqual(IDS.slice(0, 3));
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => blockIds(editor)).toEqual(moved);
  await expect.poll(() => savedIds(request)).toEqual(moved);
  const reopened = await openResource(page);
  await expect.poll(() => blockIds(reopened)).toEqual(moved);
});

test("선택한 본문을 움직이지 않고 클릭하면 해당 위치에서 편집하고 일반 텍스트 선택도 유지된다", async ({ page, request }) => {
  const editor = await openResource(page);
  await selectFirstThree(page, editor);
  const content = editor.locator(`[data-block-content="${IDS[1]}"]`);
  const body = await content.boundingBox();
  await page.mouse.click(body.x + 80, body.y + body.height / 2);
  await expect(content).toBeFocused();
  await expect(editor.locator(".block.is-selected")).toHaveCount(0);
  await page.keyboard.type("X");
  await expect(content).toContainText("X");
  await expect.poll(() => blockIds(editor)).toEqual(IDS);
  await page.mouse.move(body.x + 4, body.y + body.height / 2);
  await page.mouse.down();
  await page.mouse.move(body.x + 140, body.y + body.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => getSelection()?.toString().length || 0)).toBeGreaterThan(0);
  await expect(page.locator(".block-drag-ghost")).toHaveCount(0);
  await expect(editor.locator(".block.is-selected")).toHaveCount(0);
  await expect.poll(() => savedIds(request)).toEqual(IDS);
});
