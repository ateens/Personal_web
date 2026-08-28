import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const PARAGRAPH_ID = "fixture-block-paragraph";

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

async function openResource(page, resourceId = FIXTURE_IDS.resource) {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-nav-key="resources"]').evaluate((button) => button.click());
  await page.locator(`[data-resource-open="${resourceId}"]`).click();
  await expect(page.locator(`[data-resource-document="${resourceId}"]`)).toBeVisible();
}

async function selectTextRange(content, start, end) {
  await content.evaluate((element, offsets) => {
    element.focus();
    const textNode = element.firstChild;
    const range = document.createRange();
    range.setStart(textNode, offsets.start);
    range.setEnd(textNode, offsets.end);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, { start, end });
}

async function seedParagraphText(request, text) {
  const before = await fixtureSnapshot(request);
  const incomingState = structuredClone(before.state);
  const block = incomingState.resources
    .find((resource) => resource.id === FIXTURE_IDS.resource)
    ?.blocks.find((entry) => entry.id === PARAGRAPH_ID);
  block.text = text;
  block.marks = [];
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state: incomingState, baseRevision: before.serverRevision },
  });
  expect(response.ok()).toBeTruthy();
}

test("Resource 텍스트 선택 툴바는 흰색 배경과 한글 기능 라벨을 보여준다", async ({ page, request }) => {
  await openResource(page);
  const content = page.locator(`[data-block-content="${PARAGRAPH_ID}"]`);
  await selectTextRange(content, 0, "Paragraph".length);

  const toolbar = page.locator("[data-inline-toolbar]");
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator(".inline-format-label")).toHaveText([
    "굵게",
    "기울임",
    "밑줄",
    "취소선",
    "코드",
    "댓글",
    "링크",
    "자료 인용",
    "수식",
  ]);
  const colors = await toolbar.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  expect(colors.background).toContain("255, 255, 255");
  expect(colors.color).toContain("55, 53, 47");

  await toolbar.locator('[data-inline-mark-toggle="bold"]').click();
  await expect(content.locator('[data-inline-mark="bold"]')).toHaveText("Paragraph");
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return snapshot.state.resources
      .find((resource) => resource.id === FIXTURE_IDS.resource)
      ?.blocks.find((block) => block.id === PARAGRAPH_ID)
      ?.marks.some((mark) => mark.type === "bold" && mark.start === 0 && mark.end === "Paragraph".length);
  }).toBe(true);
});

test("선택한 글자로 Resource를 추천하고 직접 검색한 Resource를 인용 링크로 저장해 연다", async ({ page, request }) => {
  const selectedText = "Body Search";
  await seedParagraphText(request, `${selectedText} 관련 메모`);
  await openResource(page);
  const content = page.locator(`[data-block-content="${PARAGRAPH_ID}"]`);
  await selectTextRange(content, 0, selectedText.length);

  await page.locator("[data-inline-resource-citation-open]").click();
  const popover = page.locator("[data-resource-citation-popover]");
  const query = popover.locator("[data-resource-citation-query]");
  await expect(popover).toBeVisible();
  await expect(query).toHaveValue(selectedText);
  await expect(popover.locator("[data-resource-citation-id]").first()).toContainText("Body Search Fixture");
  await expect(popover.locator(`[data-resource-citation-id="${FIXTURE_IDS.resource}"]`)).toHaveCount(0);

  await query.fill("Database Needle");
  await expect(popover.locator("[data-resource-citation-id]").first()).toContainText("Database Needle Resource");
  await query.press("Enter");

  const citation = content.locator(`[data-inline-mark="resourceLink"][data-resource-citation="${FIXTURE_IDS.titleSearchResource}"]`);
  await expect(content).toHaveText(`${selectedText} 관련 메모`);
  await expect(citation).toHaveText(selectedText);
  await expect(citation).toHaveCSS("text-decoration-line", "none");
  await expect(page.locator("[data-inline-toolbar]")).toHaveCount(0);
  expect(await content.evaluate((element) => {
    const selection = window.getSelection();
    return selection.isCollapsed && element.contains(selection.focusNode) && !element.querySelector("a").contains(selection.focusNode);
  })).toBe(true);
  await page.keyboard.type(" 바로");
  await expect(content).toHaveText(`${selectedText} 바로 관련 메모`);
  await expect(citation).toHaveText(selectedText);
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return snapshot.state.resources
      .find((resource) => resource.id === FIXTURE_IDS.resource)
      ?.blocks.find((block) => block.id === PARAGRAPH_ID)
      ?.marks.find((mark) => mark.type === "resourceLink");
  }).toEqual(expect.objectContaining({
    start: 0,
    end: selectedText.length,
    resourceId: FIXTURE_IDS.titleSearchResource,
  }));

  await openResource(page);
  const reloadedCitation = page.locator(`[data-block-content="${PARAGRAPH_ID}"] [data-inline-mark="resourceLink"]`);
  await expect(reloadedCitation).toHaveText(selectedText);
  await reloadedCitation.focus();
  await reloadedCitation.press("Enter");
  await expect(page.locator(`[data-resource-document="${FIXTURE_IDS.titleSearchResource}"]`)).toBeVisible();
  await expect(page.locator(`[data-resource-title="${FIXTURE_IDS.titleSearchResource}"]`)).toHaveValue("Database Needle Resource");
});

test("자료 슬래시 링크를 넣으면 선택 툴바 없이 링크 바로 뒤에서 입력한다", async ({ page, request }) => {
  await seedParagraphText(request, "");
  await openResource(page);
  const content = page.locator(`[data-block-content="${PARAGRAPH_ID}"]`);
  await content.fill("/자료");
  await page.locator('[data-resource-slash-id="inline-resourceLink"]').click();
  await page.locator("[data-resource-citation-query]").fill("Database Needle");
  await page.locator("[data-resource-citation-query]").press("Enter");
  const citation = content.locator('[data-inline-mark="resourceLink"]');
  await expect(citation).toHaveText("자료");
  await expect(citation).toHaveCSS("text-decoration-line", "none");
  await expect(page.locator("[data-inline-toolbar]")).toHaveCount(0);
  expect(await content.evaluate((element) => {
    const selection = window.getSelection();
    return selection.isCollapsed && selection.focusNode === element && selection.focusOffset === 1;
  })).toBe(true);
  await page.keyboard.type(" 다음 내용");
  await expect(content).toHaveText("자료 다음 내용");
  await expect(citation).toHaveText("자료");
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return snapshot.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource).blocks.find((block) => block.id === PARAGRAPH_ID).text;
  }).toBe("자료 다음 내용");
});

test("server rejects broken Resource citation targets without mutating state", async ({ request }) => {
  const before = await fixtureSnapshot(request);
  const incomingState = structuredClone(before.state);
  const block = incomingState.resources
    .find((resource) => resource.id === FIXTURE_IDS.resource)
    ?.blocks.find((entry) => entry.id === PARAGRAPH_ID);
  block.marks = [{ type: "resourceLink", start: 0, end: 5, resourceId: "missing-resource" }];

  const response = await request.put("/api/state", {
    headers: {
      "Content-Type": "application/json",
      "If-Match": `"state-${before.serverRevision}"`,
    },
    data: { state: incomingState, baseRevision: before.serverRevision },
  });
  const payload = await response.json();
  expect(response.status()).toBe(422);
  expect(payload.code).toBe("INVALID_STATE");
  expect(payload.details?.issues).toContainEqual(expect.objectContaining({
    path: expect.stringMatching(/\.marks\[0\]\.resourceId$/),
    code: "broken_resource_link",
  }));
  const after = await fixtureSnapshot(request);
  expect(after.serverRevision).toBe(before.serverRevision);
  expect(after.state).toEqual(before.state);
});

test("server rejects overlapping and non-text-block Resource citations", async ({ request }) => {
  const before = await fixtureSnapshot(request);
  const incomingState = structuredClone(before.state);
  const resource = incomingState.resources.find((entry) => entry.id === FIXTURE_IDS.resource);
  const paragraph = resource.blocks.find((entry) => entry.id === PARAGRAPH_ID);
  const code = resource.blocks.find((entry) => entry.id === "fixture-block-code");
  paragraph.marks = [
    { type: "resourceLink", start: 0, end: 9, resourceId: FIXTURE_IDS.bodySearchResource },
    { type: "resourceLink", start: 5, end: 14, resourceId: FIXTURE_IDS.titleSearchResource },
  ];
  code.marks = [{ type: "resourceLink", start: 0, end: 5, resourceId: FIXTURE_IDS.bodySearchResource }];

  const response = await request.put("/api/state", {
    headers: {
      "Content-Type": "application/json",
      "If-Match": `"state-${before.serverRevision}"`,
    },
    data: { state: incomingState, baseRevision: before.serverRevision },
  });
  const payload = await response.json();
  expect(response.status()).toBe(422);
  expect(payload.code).toBe("INVALID_STATE");
  expect(payload.details?.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "overlapping_resource_links" }),
    expect.objectContaining({ code: "resource_link_unsupported_block" }),
  ]));
  const after = await fixtureSnapshot(request);
  expect(after.serverRevision).toBe(before.serverRevision);
  expect(after.state).toEqual(before.state);
});

test("server rejects arbitrary inline color payloads without mutating state", async ({ request }) => {
  const before = await fixtureSnapshot(request);
  const incomingState = structuredClone(before.state);
  const block = incomingState.resources
    .find((resource) => resource.id === FIXTURE_IDS.resource)
    ?.blocks.find((entry) => entry.id === PARAGRAPH_ID);
  block.marks = [{ type: "textColor", start: 0, end: 5, color: "url-javascript" }];

  const response = await request.put("/api/state", {
    headers: {
      "Content-Type": "application/json",
      "If-Match": `"state-${before.serverRevision}"`,
    },
    data: { state: incomingState, baseRevision: before.serverRevision },
  });
  const payload = await response.json();
  expect(response.status()).toBe(422);
  expect(payload.code).toBe("INVALID_STATE");
  expect(payload.details?.issues).toContainEqual(expect.objectContaining({
    path: expect.stringMatching(/\.marks\[0\]\.color$/),
    code: "unsupported_inline_color",
  }));
  const after = await fixtureSnapshot(request);
  expect(after.serverRevision).toBe(before.serverRevision);
  expect(after.state).toEqual(before.state);
});
