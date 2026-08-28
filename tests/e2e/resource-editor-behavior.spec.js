import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const RESOURCE_ID = FIXTURE_IDS.bodySearchResource;

function paragraph(id, text = "", indent = 0) {
  return { id, type: "paragraph", text, marks: [], checked: false, indent, collapsed: false };
}

async function seedResource(request, blocks, commentThreads = []) {
  const before = await fixtureSnapshot(request);
  const draft = structuredClone(before.state);
  const resource = draft.resources.find((entry) => entry.id === RESOURCE_ID);
  resource.blocks = blocks;
  resource.commentThreads = commentThreads;
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
  return page.locator(`.block-editor[data-owner-type="resources"][data-owner-id="${RESOURCE_ID}"]`);
}

async function persistedResource(request) {
  const snapshot = await fixtureSnapshot(request);
  return snapshot.state.resources.find((resource) => resource.id === RESOURCE_ID);
}

async function selectTextRange(content, start, end) {
  await content.evaluate((element, offsets) => {
    element.focus();
    const point = (offset) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && offset > node.textContent.length) { offset -= node.textContent.length; node = walker.nextNode(); }
      return node ? { node, offset } : { node: element, offset: element.childNodes.length };
    };
    const start = point(offsets.start);
    const end = point(offsets.end);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, { start, end });
}

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("표 셀의 인라인 단축키와 마크다운, 코멘트는 선택 범위와 저장 위치를 보존한다", async ({ page, request }) => {
  await seedResource(request, [
    { ...paragraph("inline-table", "| 제목 | 값 |\n| --- | --- |\n| 기존 **강조** | |\n| 마지막 줄 | 보존 |\n| | |"), type: "table" },
    paragraph("table-following-text", "표 아래 본문"),
  ]);
  let editor = await openResource(page);
  const cell = (row, column) => editor.locator(`[data-block-id="inline-table"] [data-resource-table-cell][data-table-row="${row}"][data-table-column="${column}"]`);
  const saved = async () => (await persistedResource(request)).blocks.find((block) => block.id === "inline-table");
  await selectTextRange(cell(1, 0), 3, 5);
  await page.keyboard.press("Meta+b");
  await expect(cell(1, 0).locator('[data-inline-mark="bold"]')).toHaveCount(0);
  for (const [shortcut, type] of [["Meta+b", "bold"], ["Meta+i", "italic"], ["Meta+u", "underline"], ["Meta+e", "code"], ["Meta+Shift+s", "strike"]]) {
    await selectTextRange(cell(1, 0), 3, 5);
    await page.keyboard.press(shortcut);
    await expect(cell(1, 0).locator(`[data-inline-mark="${type}"]`)).toHaveText("강조");
  }
  await expect.poll(async () => (await saved()).tableCellMarks?.["1:0"]?.map((mark) => mark.type).sort()).toEqual(["bold", "code", "italic", "strike", "underline"]);
  await cell(1, 1).click();
  await page.keyboard.type("**bold** `code` ~~strike~~");
  await expect(cell(1, 1)).toHaveText("bold code strike");
  await expect(cell(1, 1).locator('[data-inline-mark="bold"]')).toHaveText("bold");
  await expect(cell(1, 1).locator('[data-inline-mark="code"]')).toHaveText("code");
  await expect(cell(1, 1).locator('[data-inline-mark="strike"]')).toHaveText("strike");
  await cell(1, 1).press("Tab");
  await selectTextRange(cell(2, 1), 2, 2);
  await page.keyboard.press("Meta+b");
  await page.keyboard.type(" BOLD");
  await page.keyboard.press("Meta+b");
  await page.keyboard.type(" plain");
  await expect(cell(2, 1).locator('[data-inline-mark="bold"]')).toHaveText(" BOLD");
  await expect(cell(2, 1)).toHaveText("보존 BOLD plain");
  const literal = " \t<https://example.com> x<br>y &lt; &#32; | \\ **literal** \t ";
  const multiline = " first\nsecond \t";
  await cell(3, 0).fill(literal);
  await selectTextRange(cell(3, 0), 0, literal.length);
  await page.keyboard.press("Meta+b");
  await expect.poll(() => cell(3, 0).textContent()).toBe(literal);
  await expect.poll(async () => (await saved()).tableCellMarks?.["3:0"]).toEqual([{ type: "bold", start: 0, end: literal.length }]);
  await cell(3, 1).fill(multiline);
  await selectTextRange(cell(3, 1), 1, multiline.length);
  await page.keyboard.press("Meta+i");
  await expect.poll(() => cell(3, 1).textContent()).toBe(multiline);
  await selectTextRange(cell(2, 0), 0, 3);
  await expect(page.locator('[data-inline-toolbar]')).toBeVisible();
  await page.locator('[data-inline-toolbar] [data-inline-mark-toggle="comment"]').click();
  await page.locator('[data-resource-comment-input]').fill("셀 코멘트");
  await page.locator('[data-resource-comment-input]').press("Meta+Enter");
  await expect(cell(2, 0).locator('[data-inline-mark="comment"]')).toHaveText("마지막");
  await expect.poll(async () => (await persistedResource(request)).commentThreads[0]?.anchor).toEqual({ blockId: "inline-table", start: 0, end: 3, tableRow: 2, tableColumn: 0 });
  await page.locator('[data-resource-comments-toggle]').click();
  await cell(2, 0).locator('[data-inline-mark="comment"]').click();
  await expect(page.locator('[data-resource-comments-toggle]')).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('.resource-comment-body')).toHaveText("셀 코멘트");
  await page.locator('[data-resource-comment-action="reply"]').click();
  await page.locator('[data-resource-comment-input]').fill("셀 답글");
  await page.locator('[data-resource-comment-input]').press("Meta+Enter");
  await expect(page.locator('.resource-comment-body')).toHaveText(["셀 코멘트", "셀 답글"]);
  await expect.poll(async () => (await persistedResource(request)).commentThreads[0]?.replies?.length).toBe(1);
  editor = await openResource(page);
  await expect(cell(1, 0).locator('[data-inline-mark="underline"]')).toHaveText("강조");
  await expect(cell(1, 1)).toHaveText("bold code strike");
  await expect.poll(() => cell(3, 0).textContent()).toBe(literal);
  await expect.poll(() => cell(3, 0).locator('[data-inline-mark="bold"]').textContent()).toBe(literal);
  await expect.poll(() => cell(3, 1).textContent()).toBe(multiline);
  await expect.poll(() => cell(3, 1).locator('[data-inline-mark="italic"]').textContent()).toBe(multiline.slice(1));
  await expect(cell(2, 0).locator('[data-inline-mark="comment"]')).toHaveText("마지막");
  await cell(1, 0).click();
  await cell(1, 0).press("Escape");
  await editor.locator('[data-resource-table-delete="row"]').click();
  await expect.poll(async () => (await persistedResource(request)).commentThreads[0]?.anchor?.tableRow).toBe(1);
  await expect(cell(1, 0).locator('[data-inline-mark="comment"]')).toHaveText("마지막");
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await persistedResource(request)).commentThreads[0]?.anchor?.tableRow).toBe(2);
  for (const axis of ["row", "column"]) {
    await cell(2, 0).click();
    await cell(2, 0).press("Escape");
    await editor.locator(`[data-resource-table-delete="${axis}"]`).click();
    await expect.poll(async () => (await persistedResource(request)).commentThreads[0]?.scope).toBe("page");
    await page.keyboard.press("Meta+z");
    await expect.poll(async () => (await persistedResource(request)).commentThreads[0]?.anchor).toEqual({ blockId: "inline-table", start: 0, end: 3, tableRow: 2, tableColumn: 0 });
    await expect(cell(2, 0).locator('[data-inline-mark="comment"]')).toHaveText("마지막");
    await expect.poll(async () => (await persistedResource(request)).commentThreads[0]?.replies?.length).toBe(1);
  }
  await expect(editor.locator('[data-block-content="table-following-text"]')).toHaveText("표 아래 본문");
});

test("멘션 제거 후 기존 글자와 @ 입력을 보존하고 페이지 링크와 이모지는 계속 동작한다", async ({ page, request }) => {
  const legacyText = "기존 연결 이름";
  await seedResource(request, [
    { ...paragraph("retired-annotation", legacyText), marks: [{ type: "mention", start: 0, end: legacyText.length, mentionType: "page", targetType: "projects", targetId: FIXTURE_IDS.project, label: legacyText }] },
    paragraph("plain-at-input"),
    paragraph("page-command-link"),
    paragraph("emoji-command"),
  ]);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let editor = await openResource(page);
  await expect(editor.locator('[data-block-content="retired-annotation"]')).toHaveText(legacyText);
  await expect(editor.locator('[data-inline-mark="mention"]')).toHaveCount(0);

  const plain = editor.locator('[data-block-content="plain-at-input"]');
  await plain.pressSequentially("@tomorrow");
  await expect(plain).toHaveText("@tomorrow");
  await expect(page.locator(".editor-command-menu, .mention-menu")).toHaveCount(0);

  let command = editor.locator('[data-block-content="page-command-link"]');
  await command.pressSequentially("[[Fixture Project");
  await expect(page.locator(".page-command-menu")).toBeVisible();
  await command.press("Enter");
  let link = command.locator('a[data-inline-mark="link"]');
  await expect(link).toHaveText("Fixture Project");
  await expect(link).toHaveAttribute("href", `#page/projects/${FIXTURE_IDS.project}`);
  await expect.poll(async () => (await persistedResource(request)).blocks.find((block) => block.id === "page-command-link")?.marks).toEqual([
    { type: "link", start: 0, end: "Fixture Project".length, href: `#page/projects/${FIXTURE_IDS.project}` },
  ]);
  await link.click();
  await expect(page.locator('[data-nav-key="projects"]')).toHaveAttribute("aria-current", "page");
  expect(page.context().pages()).toHaveLength(1);

  editor = await openResource(page);
  command = editor.locator('[data-block-content="page-command-link"]');
  link = command.locator('a[data-inline-mark="link"]');
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-nav-key="projects"]')).toHaveAttribute("aria-current", "page");
  expect(page.context().pages()).toHaveLength(1);

  editor = await openResource(page);
  command = editor.locator('[data-block-content="page-command-link"]');
  await command.fill("");
  await command.pressSequentially("+Fixture Box");
  await expect(page.locator(".page-command-menu")).toBeVisible();
  await command.press("Enter");
  link = command.locator('a[data-inline-mark="link"]');
  await expect(link).toHaveAttribute("href", `#page/boxes/${FIXTURE_IDS.box}`);
  await expect.poll(async () => (await persistedResource(request)).blocks.find((block) => block.id === "page-command-link")?.marks[0]?.href).toBe(`#page/boxes/${FIXTURE_IDS.box}`);
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator('[data-nav-key="boxes"]')).toHaveAttribute("aria-current", "page");
  expect(page.context().pages()).toHaveLength(1);

  editor = await openResource(page);
  const emoji = editor.locator('[data-block-content="emoji-command"]');
  await emoji.pressSequentially(":rocket");
  await expect(page.locator(".emoji-menu")).toBeVisible();
  await emoji.press("Enter");
  await expect(emoji).toHaveText("🚀");
  await expect.poll(async () => {
    const blocks = (await persistedResource(request)).blocks;
    return {
      legacy: blocks.find((block) => block.id === "retired-annotation"),
      plain: blocks.find((block) => block.id === "plain-at-input")?.text,
      emoji: blocks.find((block) => block.id === "emoji-command")?.text,
    };
  }).toMatchObject({ legacy: { text: legacyText, marks: [] }, plain: "@tomorrow", emoji: "🚀" });
  expect(pageErrors).toEqual([]);
});

test("---만 구분선을 만들고 바로 아래 Backspace는 문서를 닫지 않는다", async ({ page, request }) => {
  await seedResource(request, [paragraph("markdown-shortcut", "")]);
  const editor = await openResource(page);
  let content = editor.locator('[data-block-content="markdown-shortcut"]');

  await content.pressSequentially("***");
  await expect(content).toHaveText("***");
  await expect(editor.locator('.block[data-type="divider"]')).toHaveCount(0);

  await content.press("End");
  await content.press("Enter");
  content = editor.locator("[data-block-content]:focus");
  await content.pressSequentially("---");

  const divider = editor.locator('.block[data-type="divider"]');
  await expect(divider).toHaveCount(1);
  const followingParagraphId = await editor.locator("[data-block-content]:focus").getAttribute("data-block-content");
  expect(followingParagraphId).toBeTruthy();

  await page.keyboard.press("Backspace");
  await expect(divider).toHaveCount(0);
  await expect(page.locator(`[data-resource-document="${RESOURCE_ID}"]`)).toBeVisible();
  await expect(editor.locator(`[data-block-content="${followingParagraphId}"]`)).toBeFocused();
  await expect.poll(async () => (await persistedResource(request)).blocks.map((block) => ({ type: block.type, text: block.text }))).toEqual([
    { type: "paragraph", text: "***" },
    { type: "paragraph", text: "" },
  ]);
});

test("토글과 제목은 적용 순서와 무관하게 함께 저장되고 접힌 상태로 복원된다", async ({ page, request }) => {
  const toggleFirstId = "toggle-then-heading";
  const toggleFirstChildId = "toggle-then-heading-child";
  const headingFirstId = "heading-then-toggle";
  const headingFirstChildId = "heading-then-toggle-child";
  await seedResource(request, [
    paragraph(toggleFirstId, "토글 다음 제목"),
    paragraph(toggleFirstChildId, "첫 번째 자식", 1),
    { ...paragraph(headingFirstId, "제목 다음 토글"), type: "heading1" },
    paragraph(headingFirstChildId, "두 번째 자식", 1),
  ]);
  let editor = await openResource(page);
  const toggleFirstContent = editor.locator(`[data-block-content="${toggleFirstId}"]`);
  const headingFirstContent = editor.locator(`[data-block-content="${headingFirstId}"]`);

  await toggleFirstContent.press("Meta+Alt+7");
  await toggleFirstContent.press("Meta+Alt+2");
  await expect(editor.locator(`[data-block-id="${toggleFirstId}"]`)).toHaveAttribute("data-type", "toggle");
  await expect(editor.locator(`[data-block-id="${toggleFirstId}"]`)).toHaveAttribute("data-toggle-heading", "heading2");
  await expect(toggleFirstContent.locator("xpath=parent::h2")).toHaveCount(1);

  await headingFirstContent.press("Meta+Alt+7");
  await expect(editor.locator(`[data-block-id="${headingFirstId}"]`)).toHaveAttribute("data-type", "toggle");
  await expect(editor.locator(`[data-block-id="${headingFirstId}"]`)).toHaveAttribute("data-toggle-heading", "heading1");
  await expect(headingFirstContent.locator("xpath=parent::h1")).toHaveCount(1);

  await editor.locator(`[data-block-toggle="${toggleFirstId}"]`).click();
  await editor.locator(`[data-block-toggle="${headingFirstId}"]`).click();
  await expect(editor.locator(`[data-block-id="${toggleFirstChildId}"]`)).toBeHidden();
  await expect(editor.locator(`[data-block-id="${headingFirstChildId}"]`)).toBeHidden();

  await expect.poll(async () => {
    const resource = await persistedResource(request);
    return [toggleFirstId, headingFirstId].map((id) => {
      const block = resource.blocks.find((entry) => entry.id === id);
      return { type: block.type, toggleHeading: block.toggleHeading, collapsed: block.collapsed };
    });
  }).toEqual([
    { type: "toggle", toggleHeading: "heading2", collapsed: true },
    { type: "toggle", toggleHeading: "heading1", collapsed: true },
  ]);

  editor = await openResource(page);
  await expect(editor.locator(`[data-block-id="${toggleFirstId}"]`)).toHaveAttribute("data-toggle-heading", "heading2");
  await expect(editor.locator(`[data-block-id="${headingFirstId}"]`)).toHaveAttribute("data-toggle-heading", "heading1");
  await expect(editor.locator(`[data-block-id="${toggleFirstChildId}"]`)).toBeHidden();
  await expect(editor.locator(`[data-block-id="${headingFirstChildId}"]`)).toBeHidden();
});

test("Resource 코멘트는 문장 옆 사이드바에서 추가·수정·삭제하고 anchor를 보존한다", async ({ page, request }) => {
  const blockId = "comment-target";
  const text = "댓글 대상 텍스트";
  const selectedText = "댓글 대상";
  await seedResource(request, [paragraph("earlier-comment-target", "앞선 문장"), paragraph(blockId, text)]);
  let editor = await openResource(page);
  let content = editor.locator(`[data-block-content="${blockId}"]`);

  await selectTextRange(content, 0, selectedText.length);
  await page.locator('[data-inline-mark-toggle="comment"]').click();
  let popover = page.locator("[data-inline-comment-popover]");
  await expect(popover).toBeVisible();
  const colors = await popover.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  expect(colors.background).toContain("255, 255, 255");
  expect(colors.color).toContain("55, 53, 47");

  const commentInput = popover.locator("[data-inline-comment-input]");
  await commentInput.fill("첫 댓글");
  await expect(commentInput).toHaveCSS("border-top-width", "1px");
  await expect(commentInput).toHaveCSS("outline-width", "0px");
  await expect(commentInput).toHaveCSS("box-shadow", "none");
  await commentInput.press("Meta+Enter");
  const mark = content.locator('[data-inline-mark="comment"]');
  await expect(mark).toHaveText(selectedText);

  let commentId = "";
  await expect.poll(async () => {
    const resource = await persistedResource(request);
    const storedMark = resource.blocks.find((block) => block.id === blockId)?.marks.find((entry) => entry.type === "comment");
    const thread = resource.commentThreads.find((entry) => entry.id === storedMark?.commentId);
    commentId = storedMark?.commentId || "";
    return {
      mark: storedMark && { start: storedMark.start, end: storedMark.end, body: storedMark.body },
      thread: thread && { anchor: thread.anchor, body: thread.body, replies: thread.replies.length },
    };
  }).toEqual({
    mark: { start: 0, end: selectedText.length, body: "첫 댓글" },
    thread: { anchor: { blockId, start: 0, end: selectedText.length }, body: "첫 댓글", replies: 0 },
  });
  expect(commentId).toBeTruthy();

  for (const reply of ["두 번째 댓글", "세 번째 댓글"]) {
    await mark.click();
    const addComment = page.locator(`[data-comment-thread="${commentId}"] [data-resource-comment-action="reply"]`);
    await expect(page.locator('.resource-comments-tail [data-resource-comment-action]')).toHaveCount(0);
    await addComment.hover();
    await expect(addComment).toHaveCSS("background-color", "rgb(241, 243, 245)");
    await addComment.click();
    popover = page.locator("[data-inline-comment-popover]");
    await popover.locator("[data-inline-comment-input]").fill(reply);
    await popover.locator('button[type="submit"]').click();
  }

  await mark.click();
  const sidebar = page.locator("[data-resource-comments]");
  await expect(sidebar.locator(".resource-comment-body")).toHaveText(["첫 댓글", "두 번째 댓글", "세 번째 댓글"]);
  await expect.poll(async () => {
    const resource = await persistedResource(request);
    const thread = resource.commentThreads.find((entry) => entry.id === commentId);
    return {
      anchor: thread?.anchor,
      replies: thread?.replies.map((reply) => reply.body),
    };
  }).toEqual({
    anchor: { blockId, start: 0, end: selectedText.length },
    replies: ["두 번째 댓글", "세 번째 댓글"],
  });

  await selectTextRange(editor.locator('[data-block-content="earlier-comment-target"]'), 0, 5);
  await page.locator('[data-inline-mark-toggle="comment"]').click();
  const draftCard = sidebar.locator(".resource-comment-card").filter({ has: page.locator("[data-resource-comment-input]") });
  await expect.poll(async () => (await draftCard.boundingBox()).y < (await sidebar.locator(`[data-comment-thread="${commentId}"]`).boundingBox()).y).toBe(true);
  await draftCard.locator('[data-resource-comment-action="cancel"]').click();
  await expect(sidebar.locator(".resource-comment-body")).toHaveCount(3);

  const contentNode = await content.elementHandle();
  await page.locator("[data-resource-comments-toggle]").click();
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await expect(sidebar).toHaveCSS("height", "0px");
  await mark.click();
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  expect(await content.evaluate((element, previous) => element === previous, contentNode)).toBe(true);
  await expect(page.locator(".inline-comment-popover")).toHaveCount(0);
  const card = sidebar.locator(`[data-comment-thread="${commentId}"]`);
  await expect.poll(async () => Math.abs((await card.boundingBox()).y - (await mark.boundingBox()).y)).toBeLessThan(2);
  const commentsShortcut = (options = {}) => page.evaluate((overrides) => {
    const event = new KeyboardEvent("keydown", { key: "s", code: "KeyS", metaKey: true, bubbles: true, cancelable: true, ...overrides });
    document.activeElement.dispatchEvent(event);
    return event.defaultPrevented;
  }, options);
  await content.focus();
  expect(await commentsShortcut()).toBe(false);
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  await page.evaluate(() => { window.__sygmaNativeMutationBridge = true; });
  await page.locator(".resource-document").focus();
  expect(await commentsShortcut({ shiftKey: true })).toBe(false);
  expect(await commentsShortcut({ key: "ㄴ" })).toBe(true);
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  expect(await commentsShortcut({ repeat: true })).toBe(true);
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  expect(await commentsShortcut()).toBe(true);
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  await page.locator('[data-capture-zone] input[name="title"]').focus();
  expect(await commentsShortcut()).toBe(false);
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  await card.locator('[data-resource-comment-action="edit"]').first().click();
  await page.locator("[data-resource-comment-input]").fill("수정한 첫 댓글");
  expect(await commentsShortcut()).toBe(true);
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  expect(await commentsShortcut()).toBe(true);
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("[data-resource-comment-input]")).toHaveValue("수정한 첫 댓글");
  await page.locator("[data-resource-comment-input]").press("Meta+Enter");
  await expect(card.locator(".resource-comment-body").first()).toHaveText("수정한 첫 댓글");
  await card.locator('[data-resource-comment-action="delete"]').nth(1).click();
  await expect(card.locator(".resource-comment-body")).toHaveText(["수정한 첫 댓글", "세 번째 댓글"]);
  await expect.poll(async () => (await persistedResource(request)).commentThreads.find((entry) => entry.id === commentId)?.body).toBe("수정한 첫 댓글");
  editor = await openResource(page);
  content = editor.locator(`[data-block-content="${blockId}"]`);
  await content.locator(`[data-inline-comment-id="${commentId}"]`).click();
  await expect(page.locator(".resource-comment-body")).toHaveText(["수정한 첫 댓글", "세 번째 댓글"]);
  await page.locator('[data-resource-comment-action="delete"]').first().click();
  await expect(page.locator(".resource-comment-body")).toHaveText(["세 번째 댓글"]);
  await expect(content.locator("[data-inline-mark=comment]")).toHaveText(selectedText);
  await page.locator('[data-resource-comment-action="delete"]').first().click();
  await expect(content.locator("[data-inline-mark=comment]")).toHaveCount(0);
  await expect.poll(async () => Boolean((await persistedResource(request)).commentThreads.find((entry) => entry.id === commentId)?.deletedAt)).toBe(true);
  await editor.locator("[data-block-content]").first().click();
  await page.locator("[data-resource-back]").click();
  await page.locator(`[data-resource-open="${FIXTURE_IDS.readOnlyResource}"]`).click();
  await page.locator("[data-resource-comments-toggle]").click();
  await expect(page.locator(".resource-comment-body")).toHaveText("Read-only page discussion");
  await expect(page.locator("[data-resource-comment-action]")).toHaveCount(0);
});
