import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

async function openSettledResource(page, id) {
  await page.locator(`[data-resource-open="${id}"]`).evaluate((button) => button.click());
  const window = page.locator(`[data-resource-window="${id}"]`);
  await expect(window).toBeVisible();
  await expect.poll(() => window.evaluate((element) => element.getAnimations().every((animation) => animation.playState !== "running"))).toBe(true);
  return window;
}

async function openResourceList(page) {
  await page.locator('[data-nav-key="resources"]').evaluate((button) => button.click());
  await expect(page.locator("[data-resource-view]")).toBeVisible();
}

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
});

test("Resource 도킹은 겹친 창의 최대 너비만 배경에서 빼고 resize와 해제 뒤 복원한다", async ({ page }) => {
  await openResourceList(page);
  const a = await openSettledResource(page, FIXTURE_IDS.resource);
  const layout = page.locator(".layout");
  const originalWidth = (await layout.boundingBox()).width;
  const drag = async (window, x, y) => {
    const bar = await window.locator("[data-resource-window-drag]").boundingBox();
    await page.mouse.move(bar.x + 100, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 12 });
    await page.mouse.up();
  };
  const expectLayout = async () => {
    await expect.poll(() => page.evaluate(() => {
      const widths = [...document.querySelectorAll('[data-resource-window][data-docked="true"]')].map((element) => element.getBoundingClientRect().width);
      return Math.abs(document.querySelector(".layout").getBoundingClientRect().width - (innerWidth - Math.max(0, ...widths)));
    })).toBeLessThanOrEqual(1);
  };
  await drag(a, page.viewportSize().width - 10, 60);
  await expect(a).toHaveAttribute("data-docked", "true");
  await expectLayout();
  expect((await layout.boundingBox()).width).toBeLessThan(originalWidth - 250);
  const b = await openSettledResource(page, FIXTURE_IDS.bodySearchResource);
  const dock = await a.boundingBox();
  await drag(b, dock.x + dock.width / 2, 60);
  await expect(b).toHaveAttribute("data-docked", "true");
  await expectLayout();
  const handle = await b.locator('[data-resource-resize="w"]').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(10, handle.y + handle.height / 2, { steps: 15 });
  await page.mouse.up();
  expect((await b.boundingBox()).width).toBeGreaterThan(dock.width + 50);
  await expectLayout();
  expect((await page.locator(".main").boundingBox()).width).toBeGreaterThanOrEqual(319);
  await drag(b, 180, 100);
  await expect(b).toHaveAttribute("data-docked", "false");
  await expectLayout();
  await a.locator(".resource-document-close").evaluate((button) => button.click());
  await expect(a).toHaveCount(0);
  await expect(b).toBeVisible();
  await expect.poll(async () => Math.abs((await layout.boundingBox()).width - originalWidth)).toBeLessThanOrEqual(1);
});

test("Resource Cmd+W는 활성 창만 닫고 배경 포커스와 반복 입력을 구분한다", async ({ page }) => {
  await openResourceList(page);
  const a = await openSettledResource(page, FIXTURE_IDS.resource);
  const b = await openSettledResource(page, FIXTURE_IDS.bodySearchResource);
  const dispatch = (options = {}) => page.evaluate((overrides) => {
    const event = new KeyboardEvent("keydown", { key: "w", code: "KeyW", metaKey: true, bubbles: true, cancelable: true, ...overrides });
    document.activeElement.dispatchEvent(event);
    return event.defaultPrevented;
  }, options);
  await b.locator("[data-resource-document]").focus();
  expect(await dispatch({ shiftKey: true })).toBe(false);
  await expect(b).toBeVisible();
  expect(await dispatch({ key: "ㅈ" })).toBe(true);
  await expect(b).toHaveCount(0);
  await expect(a).toBeVisible();
  expect(await dispatch({ repeat: true })).toBe(true);
  await expect(a).toBeVisible();
  await page.locator('[data-nav-key="resources"]').focus();
  expect(await page.evaluate(() => window.closeActiveResourceWindowFromShortcut())).toBe(false);
  expect(await dispatch()).toBe(false);
  await expect(a).toBeVisible();
  await a.locator("[data-resource-document]").focus();
  expect(await page.evaluate(() => window.closeActiveResourceWindowFromShortcut())).toBe(true);
  await expect(a).toHaveCount(0);
  expect(await page.evaluate(() => window.closeActiveResourceWindowFromShortcut())).toBe(false);
  expect(await dispatch()).toBe(false);
});

test("자료 목록 위에 문서 dialog를 열고 닫아도 목록과 opener를 유지하며 열기만 해서는 저장하지 않는다", async ({ page, request }) => {
  await openResourceList(page);
  const before = await fixtureSnapshot(request);
  const list = page.locator('[aria-labelledby="resource-list-title"]');
  const opener = page.locator(`[data-resource-open="${FIXTURE_IDS.resource}"]`);

  await opener.click();

  const document = page.locator(`[data-resource-document="${FIXTURE_IDS.resource}"]`);
  const title = document.locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`);
  await expect(list).toBeVisible();
  await expect(opener).toBeVisible();
  await expect(document).toBeVisible();
  await expect(document).toHaveAttribute("role", "dialog");
  await expect(document).toHaveAttribute("aria-modal", "false");
  await expect(title).toHaveValue("E2E Notion Parity Resource");
  await expect(document).toBeFocused();
  await expect(document.locator(":scope > .resource-document-title + .resource-document-divider + .resource-document-body")).toHaveCount(1);
  await expect(document.locator('.block-editor[data-owner-type="resources"]')).toHaveAttribute("data-owner-id", FIXTURE_IDS.resource);
  await expect(document.locator("[data-block-drag], [data-block-add]")).toHaveCount(0);

  const leftEdgeDifference = await document.evaluate((dialog) => {
    const titleElement = dialog.querySelector("[data-resource-title]");
    const firstParagraph = dialog.querySelector('.block[data-type="paragraph"] [data-block-content]');
    return Math.abs(titleElement.getBoundingClientRect().left - firstParagraph.getBoundingClientRect().left);
  });
  expect(leftEdgeDifference).toBeLessThanOrEqual(1);

  await page.waitForTimeout(650);
  const afterOpen = await fixtureSnapshot(request);
  expect(afterOpen.serverRevision).toBe(before.serverRevision);
  expect(afterOpen.state.resources).toEqual(before.state.resources);
  expect(afterOpen.writes).toEqual(before.writes);

  await page.keyboard.press("Escape");
  await expect(document).toHaveCount(0);
  await expect(opener).toBeFocused();

  await opener.click();
  await expect(document).toBeVisible();
  await document.locator(".resource-document-close").click();
  await expect(document).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("기존 Resource는 비어 있는 첫 입력 위치에만 커서를 둔다", async ({ page, request }) => {
  const before = await fixtureSnapshot(request);
  const draft = structuredClone(before.state);
  const blankTitle = draft.resources.find((resource) => resource.id === FIXTURE_IDS.bodySearchResource);
  const emptyBody = draft.resources.find((resource) => resource.id === FIXTURE_IDS.titleSearchResource);
  blankTitle.title = "";
  emptyBody.blocks = [{
    id: "fixture-focus-empty-body",
    type: "paragraph",
    text: "",
    marks: [],
    checked: false,
    indent: 0,
    collapsed: false,
  }];
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state: draft, baseRevision: before.serverRevision },
  });
  expect(response.ok()).toBeTruthy();

  await page.reload();
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await openResourceList(page);

  await page.locator(`[data-resource-open="${FIXTURE_IDS.bodySearchResource}"]`).click();
  const blankTitleDocument = page.locator(`[data-resource-document="${FIXTURE_IDS.bodySearchResource}"]`);
  await expect(blankTitleDocument.locator("[data-resource-title]")).toBeFocused();
  await blankTitleDocument.locator(".resource-document-close").click();

  await page.locator(`[data-resource-open="${FIXTURE_IDS.titleSearchResource}"]`).click();
  const emptyBodyContent = page.locator('[data-block-content="fixture-focus-empty-body"]');
  await expect(emptyBodyContent).toBeFocused();
  await expect.poll(() => emptyBodyContent.evaluate((element) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed || !element.contains(selection.focusNode)) return null;
    const beforeCaret = document.createRange();
    beforeCaret.selectNodeContents(element);
    beforeCaret.setEnd(selection.focusNode, selection.focusOffset);
    return beforeCaret.toString().length;
  })).toBe(0);
});

test("새 자료 버튼은 빈 문서를 만들고 제목에서 Enter를 누르면 본문으로 이동한다", async ({ page }) => {
  await openResourceList(page);
  await page.locator('[data-resource-view] [data-action="new-resource"]').click();

  const document = page.locator("[data-resource-document]");
  const title = document.locator("[data-resource-title]");
  await expect(title).toHaveValue("새 자료");
  await expect(title).toBeFocused();

  await title.press("Enter");
  await expect(document.locator('[data-block-content]').first()).toBeFocused();
});

test("Resource 일반 링크는 새 창으로 열리고 링크 도구가 열려도 배경의 Tab 이동을 가두지 않는다", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openResourceList(page);
  const opener = page.locator(`[data-resource-open="${FIXTURE_IDS.resource}"]`);
  await opener.click();

  const document = page.locator(`[data-resource-document="${FIXTURE_IDS.resource}"]`);
  const link = document.locator('a[data-inline-mark="link"][href="https://example.com/e2e"]');
  await page.context().route("https://example.com/e2e", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>External fixture</title>",
  }));
  const popupPromise = page.waitForEvent("popup");
  await link.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL("https://example.com/e2e");
  await expect(page.locator("#overlayRoot [data-inline-link-popover]")).toHaveCount(0);
  await popup.close();

  await link.focus();
  const keyboardPopupPromise = page.waitForEvent("popup");
  await link.press("Enter");
  const keyboardPopup = await keyboardPopupPromise;
  await expect(keyboardPopup).toHaveURL("https://example.com/e2e");
  await keyboardPopup.close();

  await link.focus();
  const spacePopupPromise = page.waitForEvent("popup");
  await link.press("Space");
  const spacePopup = await spacePopupPromise;
  await expect(spacePopup).toHaveURL("https://example.com/e2e");
  await spacePopup.close();

  const content = link.locator("xpath=ancestor::*[@data-block-content][1]");
  await content.evaluate((element) => {
    const anchor = element.querySelector('a[data-inline-mark="link"]');
    const range = document.createRange();
    range.selectNodeContents(anchor);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.locator('[data-inline-mark-toggle="link"]').click();
  const popover = page.locator("#overlayRoot [data-inline-link-popover]");
  await expect(popover).toBeVisible();

  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await opener.focus();
  await expect(opener).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-resource-open]").nth(1)).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(document).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(document).toBeVisible();
  await document.focus();
  await page.keyboard.press("Escape");
  await expect(document).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(pageErrors).toEqual([]);
});

test("Resource nonmodal 창은 열린 순서로 교체하고 겹친 도킹, 원래 크기 복원과 개별 닫기를 유지한다", async ({ page }) => {
  await openResourceList(page);
  const [a, b, c, d] = [FIXTURE_IDS.resource, FIXTURE_IDS.bodySearchResource, FIXTURE_IDS.titleSearchResource, FIXTURE_IDS.archivedResource];
  const viewport = page.viewportSize();
  const windows = page.locator("[data-resource-window]");
  const windowFor = (id) => page.locator(`[data-resource-window="${id}"]`);
  const open = async (id) => {
    // The existing list remains usable; a floating window may visually cover this opener.
    await page.locator(`[data-resource-open="${id}"]`).evaluate((button) => button.click());
    await expect(windowFor(id)).toBeVisible();
    await expect(windowFor(id)).toHaveAttribute("data-active", "true");
    await expect.poll(() => windowFor(id).evaluate((element) => element.getAnimations().every((animation) => animation.playState !== "running"))).toBe(true);
  };
  const remember = async (ids) => page.evaluate((resourceIds) => {
    window.__resourceShellNodes ||= new Map();
    for (const id of resourceIds) {
      const wrapper = document.querySelector(`[data-resource-window="${id}"]`);
      window.__resourceShellNodes.set(id, { wrapper, document: wrapper.querySelector("[data-resource-document]"), editor: wrapper.querySelector(".block-editor") });
    }
  }, ids);
  const expectPreserved = async (ids) => {
    expect(await page.evaluate((resourceIds) => resourceIds.every((id) => {
      const saved = window.__resourceShellNodes.get(id);
      const wrapper = document.querySelector(`[data-resource-window="${id}"]`);
      return wrapper === saved.wrapper && wrapper.querySelector("[data-resource-document]") === saved.document && wrapper.querySelector(".block-editor") === saved.editor;
    }), ids)).toBe(true);
  };
  const geometry = async (id) => windowFor(id).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const dragTitlebar = async (id, x, y) => {
    const bar = await windowFor(id).locator(`[data-resource-window-drag="${id}"]`).boundingBox();
    expect(bar).toBeTruthy();
    await page.mouse.move(bar.x + Math.min(100, bar.width / 3), bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => windowFor(id).evaluate((element) => element.getAnimations().every((animation) => animation.playState !== "running"))).toBe(true);
  };
  const dock = async (id) => {
    await open(id);
    await dragTitlebar(id, viewport.width - 10, 60);
    await expect(windowFor(id)).toHaveAttribute("data-docked", "true");
  };

  await open(a);
  await remember([a]);
  await open(b);
  await expectPreserved([a]);
  await remember([b]);
  const originalB = await geometry(b);
  await open(c);
  await expectPreserved([a, b]);
  await remember([c]);
  await expect(windows).toHaveCount(3);
  for (const id of [a, b, c]) {
    await expect(windowFor(id).locator("[data-resource-document]")).toHaveAttribute("aria-modal", "false");
    await expect(windowFor(id).locator("[data-resource-resize]")).toHaveCount(8);
    await expect(windowFor(id).locator("[data-resource-window-drag] button")).toHaveCount(1);
  }
  const background = await page.locator("#viewRoot").evaluate((element) => {
    const ancestors = [];
    for (let node = element; node; node = node.parentElement) ancestors.push(node);
    const root = document.querySelector(".resource-document-root");
    const style = getComputedStyle(root);
    return {
      inert: ancestors.some((node) => node.inert || node.hasAttribute("inert")),
      blur: ancestors.some((node) => getComputedStyle(node).filter.includes("blur")),
      backdrop: style.backdropFilter || style.webkitBackdropFilter || "none",
      backgroundHit: Boolean(document.elementFromPoint(20, Math.min(300, window.innerHeight - 20))?.closest(".resource-document-root")),
    };
  });
  expect(background.inert).toBe(false);
  expect(background.blur).toBe(false);
  expect(background.backdrop).toBe("none");
  expect(background.backgroundHit).toBe(false);

  await dock(a);
  await open(b);
  // B is the most recently active floating window, but C was opened later.
  await open(d);
  await expect(windowFor(c)).toHaveCount(0);
  await expectPreserved([a, b]);
  await expect(windows).toHaveCount(3);
  await remember([d]);

  const oldBZ = await windowFor(b).evaluate((element) => Number(getComputedStyle(element).zIndex));
  await open(b);
  await expect(windows).toHaveCount(3);
  await expectPreserved([a, b, d]);
  expect(await windowFor(b).evaluate((element) => Number(getComputedStyle(element).zIndex))).toBeGreaterThan(oldBZ);
  const dockA = await geometry(a);
  // The whole occupied dock area is a target, not just the screen's last 64px.
  await dragTitlebar(b, dockA.x + dockA.width / 2, 60);
  await expect(windowFor(b)).toHaveAttribute("data-docked", "true");
  const dockB = await geometry(b);
  for (const key of ["x", "y", "width", "height"]) expect(Math.abs(dockA[key] - dockB[key])).toBeLessThanOrEqual(1);
  await expectPreserved([a, b, d]);

  await dragTitlebar(b, 180, 100);
  await expect(windowFor(b)).toHaveAttribute("data-docked", "false");
  const restoredB = await geometry(b);
  expect(Math.abs(restoredB.width - originalB.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(restoredB.height - originalB.height)).toBeLessThanOrEqual(1);
  const resize = await windowFor(b).locator('[data-resource-resize="se"]').boundingBox();
  expect(resize).toBeTruthy();
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
  await page.mouse.down();
  await page.mouse.move(resize.x + resize.width / 2 - 100, resize.y + resize.height / 2 - 90, { steps: 10 });
  await page.mouse.up();
  const resizedB = await geometry(b);
  expect(restoredB.width - resizedB.width).toBeGreaterThan(50);
  expect(restoredB.height - resizedB.height).toBeGreaterThan(50);
  await expectPreserved([a, b, d]);

  await windowFor(b).locator(".resource-document-close").click();
  await expect(windowFor(b)).toHaveCount(0);
  await expectPreserved([a, d]);
  await dock(d);
  await open(c);
  await dock(c);
  await remember([c]);
  await expect(windows).toHaveCount(3);
  await expect(page.locator('[data-resource-window][data-docked="true"]')).toHaveCount(3);
  await page.locator(`[data-resource-open="${b}"]`).evaluate((button) => button.click());
  await expect(windowFor(b)).toHaveCount(0);
  await expect(windows).toHaveCount(3);
  await expectPreserved([a, c, d]);
});
