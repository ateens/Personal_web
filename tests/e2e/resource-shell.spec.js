import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z8GQAAAAASUVORK5CYII=",
  "base64",
);

async function localResourceOperationCount(page) {
  return page.evaluate(async () => {
    const open = indexedDB.open("sygma-resource-local-v1");
    const database = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const transaction = database.transaction("operations", "readonly");
    const request = transaction.objectStore("operations").count();
    const count = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return count;
  });
}

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

async function chooseRelation(select, value) {
  const control = select.locator("..");
  await control.locator("[data-finance-select-trigger]").click();
  await control.locator(`[data-finance-select-option="${value}"]`).click();
}

async function seedResourceRelations(page, request) {
  const before = await fixtureSnapshot(request);
  const state = structuredClone(before.state);
  state.boxes.push({ ...structuredClone(state.boxes[0]), id: "fixture-second-box", name: "Second Box", blocks: [] });
  state.boxes.push({ ...structuredClone(state.boxes[0]), id: "fixture-empty-box", name: "Empty Box", blocks: [] });
  state.projects.push({ ...structuredClone(state.projects[0]), id: "fixture-no-box-project", name: "No Box Project", boxId: "", blocks: [] });
  Object.assign(state.resources.find((item) => item.id === FIXTURE_IDS.bodySearchResource), { boxId: "fixture-second-box", projectId: "" });
  Object.assign(state.resources.find((item) => item.id === FIXTURE_IDS.titleSearchResource), { boxId: "", projectId: "" });
  state.resources.find((item) => item.id === FIXTURE_IDS.archivedResource).locked = true;
  const trashed = structuredClone(state.resources[0]);
  state.resources.push({ ...trashed, id: "fixture-relations-trash", title: "Deleted Related Resource", blocks: [], commentThreads: [], trashedAt: new Date().toISOString() });
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${before.serverRevision}"` },
    data: { state, baseRevision: before.serverRevision },
  });
  expect(response.ok()).toBeTruthy();
  await page.reload();
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await openResourceList(page);
}

test("Resource 연결 변경은 Project의 Box를 맞추고 본문 DOM과 저장 내용을 유지한다", async ({ page, request }) => {
  await seedResourceRelations(page, request);
  const window = await openSettledResource(page, FIXTURE_IDS.resource);
  const relations = window.locator("[data-resource-relations]");
  const box = relations.locator('[data-field="boxId"]');
  const project = relations.locator('[data-field="projectId"]');
  const trigger = project.locator("..").locator("[data-finance-select-trigger]");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(relations.locator('[data-finance-select-options]:not([hidden])')).toBeVisible();
  await page.keyboard.press("Escape");
  const triggerStyle = await trigger.evaluate((element) => {
    const style = getComputedStyle(element);
    return { border: style.borderBottomWidth, shadow: style.boxShadow, decoration: style.textDecorationLine };
  });
  expect(triggerStyle).toEqual({ border: "0px", shadow: "none", decoration: "none" });
  const before = (await fixtureSnapshot(request)).state.resources.find((item) => item.id === FIXTURE_IDS.resource);
  await window.locator(".block-editor").evaluate((element) => { globalThis.__relationEditor = element; });
  const saved = async (boxId, projectId) => {
    await expect.poll(async () => {
      const item = (await fixtureSnapshot(request)).state.resources.find((resource) => resource.id === FIXTURE_IDS.resource);
      return [item.boxId, item.projectId];
    }).toEqual([boxId, projectId]);
    expect(await window.locator(".block-editor").evaluate((element) => element === globalThis.__relationEditor)).toBe(true);
  };
  await chooseRelation(project, "");
  await saved(FIXTURE_IDS.box, "");
  await chooseRelation(box, "fixture-second-box");
  await saved("fixture-second-box", "");
  await chooseRelation(project, FIXTURE_IDS.project);
  await expect(box).toHaveValue(FIXTURE_IDS.box);
  await saved(FIXTURE_IDS.box, FIXTURE_IDS.project);
  await chooseRelation(box, "fixture-second-box");
  await expect(project).toHaveValue("");
  await saved("fixture-second-box", "");
  await chooseRelation(project, "fixture-no-box-project");
  await saved("", "fixture-no-box-project");
  const after = (await fixtureSnapshot(request)).state.resources.find((item) => item.id === FIXTURE_IDS.resource);
  expect(after.blocks).toEqual(before.blocks);
  expect(after.commentThreads).toEqual(before.commentThreads);
  expect(after.revision).toBeGreaterThan(before.revision);
  await page.reload();
  await openResourceList(page);
  const reopened = await openSettledResource(page, FIXTURE_IDS.resource);
  await expect(reopened.locator('[data-resource-relations] [data-field="boxId"]')).toHaveValue("");
  await expect(reopened.locator('[data-resource-relations] [data-field="projectId"]')).toHaveValue("fixture-no-box-project");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => reopened.locator("[data-resource-relations]").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
});

test("Resource 그룹 보기는 빈 그룹과 미분류를 중복 없이 표시하고 열린 본문과 저장 상태를 유지한다", async ({ page, request }) => {
  await seedResourceRelations(page, request);
  const before = await fixtureSnapshot(request);
  const list = page.locator("[data-resource-view]");
  const listed = () => list.locator("[data-resource-open]").evaluateAll((elements) => elements.map((element) => element.dataset.resourceOpen).sort());
  const allIds = await listed();
  await expect(list.locator('[data-resource-group="all"]')).toHaveCount(1);
  const floating = await openSettledResource(page, FIXTURE_IDS.resource);
  await floating.locator(".block-editor").evaluate((element) => { globalThis.__groupEditor = element; });
  await page.locator(".resource-view-toolbar").evaluate((element) => { globalThis.__groupToolbar = element; });
  for (const mode of ["boxes", "projects", "all"]) {
    await page.locator(`[data-view-control-mode="resources"][data-control-mode="${mode}"]`).evaluate((button) => button.click());
    expect(await listed()).toEqual(allIds);
    expect(new Set(await listed()).size).toBe(allIds.length);
    expect(await floating.locator(".block-editor").evaluate((element) => element === globalThis.__groupEditor)).toBe(true);
    expect(await page.locator(".resource-view-toolbar").evaluate((element) => element === globalThis.__groupToolbar)).toBe(true);
    await expect(page.locator(".resource-groups")).toHaveAttribute("data-resource-group-mode", mode);
    expect(await page.locator(".resource-view-toolbar").evaluate((element) => element.style.getPropertyValue("--resource-mode-index").trim())).toBe(String(["all", "boxes", "projects"].indexOf(mode)));
    if (mode === "boxes") {
      await expect(list.locator('[data-resource-group="fixture-empty-box"] h2')).toHaveText("Empty Box");
      await expect(list.locator('[data-resource-group="fixture-empty-box"] [data-resource-open]')).toHaveCount(0);
      await expect(list.locator('[data-resource-group="fixture-second-box"] [data-resource-open]')).toHaveCount(1);
      await expect(list.locator('[data-resource-group=""] [data-resource-open]')).toHaveAttribute("data-resource-open", FIXTURE_IDS.titleSearchResource);
    }
    if (mode === "projects") {
      await expect(list.locator('[data-resource-group="fixture-no-box-project"] h2')).toHaveText("No Box Project");
      await expect(list.locator('[data-resource-group="fixture-no-box-project"] [data-resource-open]')).toHaveCount(0);
      await expect(list.locator('[data-resource-group=""] [data-resource-open]')).toHaveCount(2);
    }
  }
  await floating.locator(".resource-document-close").click();
  await page.waitForTimeout(650);
  const filtered = await fixtureSnapshot(request);
  expect(filtered.writes).toEqual(before.writes);
  expect(filtered.state.resources).toEqual(before.state.resources);
  await page.locator('[data-nav-key="projects"]').evaluate((button) => button.click());
  const item = page.locator(`[data-project-item="${FIXTURE_IDS.project}"]`);
  const panel = item.locator(`[data-project-resources="${FIXTURE_IDS.project}"]`);
  expect(await panel.evaluate((element) => Boolean(element.closest("[inert]")))).toBe(true);
  await item.locator("[data-project-toggle]").click();
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((element) => Boolean(element.closest("[inert]")))).toBe(false);
  await expect(panel.locator('[data-resource-open="fixture-relations-trash"]')).toHaveCount(0);
  await expect(panel.locator(`[data-resource-open="${FIXTURE_IDS.bodySearchResource}"]`)).toHaveCount(0);
  await panel.locator(`[data-resource-open="${FIXTURE_IDS.resource}"]`).click();
  await expect(page.locator(`[data-resource-document="${FIXTURE_IDS.resource}"]`)).toBeVisible();
});

test("Resource 그룹은 실제 부모 너비에 맞춰 열을 배치하고 빈 목록 여백과 전환 시간을 유지한다", async ({ page, request }) => {
  await seedResourceRelations(page, request);
  await page.locator('[data-view-control-mode="resources"][data-control-mode="boxes"]').click();
  const groups = page.locator(".resource-groups");
  const toolbar = page.locator(".resource-view-toolbar");
  expect(await toolbar.locator(".view-mode-group").evaluate((element) => getComputedStyle(element, "::before").transitionDuration.split(",").map((value) => Number.parseFloat(value)))).toContain(0.22);
  expect(await groups.evaluate((element) => {
    element.classList.add("is-entering");
    return getComputedStyle(element).animationDuration;
  })).toBe("0.18s");
  for (const [width, columns] of [[1200, 3], [760, 2], [360, 1]]) {
    await groups.evaluate((element, size) => {
      element.parentElement.style.width = `${size}px`;
      element.parentElement.style.maxWidth = "none";
    }, width);
    await expect.poll(() => groups.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(/\s+/).length)).toBe(columns);
    expect(await groups.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  }
  await expect(groups.locator('[data-resource-group="fixture-empty-box"] > .panel-title + .empty')).toHaveCSS("margin-top", "24px");
  await expect(groups.locator(`[data-resource-group="${FIXTURE_IDS.box}"] > ul`)).toHaveCSS("margin-top", "24px");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await groups.evaluate((element) => {
    element.classList.add("is-entering");
    return Number.parseFloat(getComputedStyle(element).animationDuration);
  })).toBeLessThanOrEqual(0.001);
});

test("Resource 목록 드래그와 키보드 선택은 soft trash와 되돌리기를 지원하고 본문 포커스를 보호한다", async ({ page, request }) => {
  await seedResourceRelations(page, request);
  const before = await fixtureSnapshot(request);
  const groups = page.locator(".resource-groups");
  const rows = groups.locator("[data-resource-open]");
  const first = await rows.first().boundingBox();
  const last = await rows.last().boundingBox();
  await page.mouse.move(first.x - 12, first.y + 4);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 10, last.y + last.height - 4, { steps: 15 });
  await page.mouse.up();
  await expect(groups.locator('.resource-list-item.is-selected')).toHaveCount(await rows.count());
  await expect(groups.locator('[data-resource-open][aria-pressed="true"]')).toHaveCount(await rows.count());
  await expect(page.locator("[data-resource-window]")).toHaveCount(0);
  await groups.focus();
  await page.keyboard.press("Escape");
  await expect(groups.locator(".is-selected")).toHaveCount(0);
  await rows.first().focus();
  await page.keyboard.press("Space");
  await expect(rows.first()).toHaveAttribute("aria-pressed", "true");
  await rows.last().click({ modifiers: ["Meta"] });
  await expect(groups.locator('[aria-pressed="true"]')).toHaveCount(2);
  await expect(page.locator("[data-resource-window]")).toHaveCount(0);
  await page.keyboard.press("Meta+a");
  await expect(groups.locator('[aria-pressed="true"]')).toHaveCount(await rows.count());
  await page.keyboard.press("Backspace");
  const writableIds = before.state.resources.filter((item) => !item.trashedAt && !item.readOnly && !item.locked).map((item) => item.id);
  await expect.poll(async () => (await fixtureSnapshot(request)).state.resources.filter((item) => writableIds.includes(item.id) && item.trashedAt).length).toBe(writableIds.length);
  const deleted = await fixtureSnapshot(request);
  expect(deleted.state.resources.map((item) => item.id).sort()).toEqual(before.state.resources.map((item) => item.id).sort());
  for (const original of before.state.resources) {
    const actual = deleted.state.resources.find((item) => item.id === original.id);
    for (const field of ["blocks", "boxId", "projectId", "commentThreads"]) expect(actual[field]).toEqual(original[field]);
    if (original.readOnly || original.locked) expect(actual.trashedAt).toBe(original.trashedAt);
  }
  await page.locator("[data-toast-action]").filter({ hasText: "되돌리기" }).click();
  await expect.poll(async () => (await fixtureSnapshot(request)).state.resources.filter((item) => writableIds.includes(item.id) && item.trashedAt).length).toBe(0);
  const opened = await openSettledResource(page, FIXTURE_IDS.resource);
  await groups.focus();
  await page.keyboard.press("Control+a");
  await opened.locator("[data-resource-title]").focus();
  await page.keyboard.press("Backspace");
  await opened.locator("[data-block-content]").first().focus();
  await page.keyboard.press("Delete");
  await page.waitForTimeout(650);
  expect((await fixtureSnapshot(request)).state.resources.filter((item) => writableIds.includes(item.id) && item.trashedAt)).toHaveLength(0);
  await opened.locator(".resource-document-close").click();
  const beforeMove = (await fixtureSnapshot(request)).state.resources.find((item) => item.id === FIXTURE_IDS.resource);
  for (const [mode, field, targetId, expected] of [
    ["boxes", "boxId", "fixture-second-box", ["fixture-second-box", ""]],
    ["projects", "projectId", FIXTURE_IDS.project, [FIXTURE_IDS.box, FIXTURE_IDS.project]],
  ]) {
    await page.locator(`[data-view-control-mode="resources"][data-control-mode="${mode}"]`).click();
    const source = await groups.locator(`[data-resource-open="${FIXTURE_IDS.resource}"]`).boundingBox();
    const target = await groups.locator(`[data-resource-drop-field="${field}"][data-resource-drop-id="${targetId}"]`).boundingBox();
    await page.mouse.move(source.x + 20, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + 24, { steps: 16 });
    await expect(page.locator(".resource-move-ghost")).toHaveCount(1);
    await page.mouse.up();
    await expect.poll(async () => {
      const resource = (await fixtureSnapshot(request)).state.resources.find((item) => item.id === FIXTURE_IDS.resource);
      return [resource.boxId, resource.projectId];
    }).toEqual(expected);
    await expect(page.locator(".resource-move-ghost, .resource-move-stage")).toHaveCount(0);
    await expect(page.locator("[data-resource-window]")).toHaveCount(0);
  }
  const afterMove = (await fixtureSnapshot(request)).state.resources.find((item) => item.id === FIXTURE_IDS.resource);
  for (const field of ["blocks", "commentThreads", "parentId", "childOrder"]) expect(afterMove[field]).toEqual(beforeMove[field]);
});

test("Resource 읽기 전용과 잠긴 자료의 연결 필드는 비활성화되고 강제 change도 저장하지 않는다", async ({ page, request }) => {
  await seedResourceRelations(page, request);
  const before = await fixtureSnapshot(request);
  for (const id of [FIXTURE_IDS.readOnlyResource, FIXTURE_IDS.archivedResource]) {
    const window = await openSettledResource(page, id);
    const relations = window.locator("fieldset[data-resource-relations]");
    await expect(relations).toHaveAttribute("disabled", "");
    for (const trigger of await relations.locator("[data-finance-select-trigger]").all()) {
      await expect(trigger).toBeDisabled();
    }
    for (const field of ["boxId", "projectId"]) {
      const select = relations.locator(`[data-field="${field}"]`);
      await expect(select).toBeDisabled();
      await select.evaluate((element) => {
        element.value = "";
        element.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
  }
  await page.waitForTimeout(650);
  const after = await fixtureSnapshot(request);
  expect(after.state.resources).toEqual(before.state.resources);
  expect(after.writes).toEqual(before.writes);
});

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
});

test("Quick Editor는 기존 Quick Memo 바깥 UI 없이 공유 본문 편집기만 제공하고 로컬 메모를 서버에 저장하지 않는다", async ({ page, request }) => {
  const localPngDataURL = `data:image/png;base64,${PIXEL_PNG.toString("base64")}`;
  let resourceImageRequests = 0;
  page.on("request", (entry) => {
    if (new URL(entry.url()).pathname === "/api/resource-images") resourceImageRequests += 1;
  });
  await page.addInitScript((pngDataURL) => {
    window.__quickMemoMessages = [];
    window.__quickLocalImageIndex = 0;
    window.addEventListener("sygma:quickMemo", (event) => {
      const message = event.detail;
      window.__quickMemoMessages.push(message);
      if (message.type === "saveLocalImage") {
        const assetIndex = ++window.__quickLocalImageIndex;
        setTimeout(() => window.sygmaQuickEditor.resolveLocalImage(message.requestId, {
          path: assetIndex === 1
            ? "assets/22222222-2222-4222-8222-222222222222.png"
            : "assets/33333333-3333-4333-8333-333333333333.png",
          dataURL: pngDataURL,
        }), 0);
      }
    });
    window.__quickServiceWorkerCalls = [];
    const serviceWorker = {
      controller: {},
      addEventListener: (...args) => window.__quickServiceWorkerCalls.push(["listen", args[0]]),
      register: (...args) => {
        window.__quickServiceWorkerCalls.push(["register", args[0]]);
        return Promise.resolve({ addEventListener() {}, update: () => Promise.resolve() });
      },
    };
    try {
      Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
    } catch {}
    window.__quickServiceWorkerStubbed = navigator.serviceWorker === serviceWorker;
  }, localPngDataURL);
  await page.setViewportSize({ width: 496, height: 900 });
  await page.goto("/?surface=quick-editor");
  const app = page.locator("#app");
  await expect(app).toHaveAttribute("data-workspace-authority", "ready");
  await expect.poll(() => page.evaluate(() => window.__quickMemoMessages.filter((message) => message.type === "ready").length)).toBe(1);
  expect(await page.evaluate(() => window.__quickServiceWorkerStubbed)).toBe(true);
  expect(await page.evaluate(() => window.__quickServiceWorkerCalls)).toEqual([]);
  await expect(app).toHaveClass(/is-quick-editor-surface/);
  for (const selector of [".layout", ".nav-float-toggle", ".sidebar-shell", ".topbar", ".fab", "[data-resource-view]", ".resource-window", ".resource-document", "[data-resource-title]", "[data-resource-relations]"]) {
    await expect(page.locator(selector)).toHaveCount(0);
  }

  const existingAssetDataURL = localPngDataURL;
  await page.evaluate(({ assetDataURL }) => {
    window.sygmaQuickEditor.loadLocal({
      id: "fixture-local-note",
      markdown: "ignored when exact blocks exist",
      assets: { "assets/11111111-1111-4111-8111-111111111111.png": assetDataURL },
      blocks: [
        { id: "local-image", type: "image", text: "기존 이미지", alt: "기존 이미지", url: "assets/11111111-1111-4111-8111-111111111111.png", marks: [], checked: false, indent: 0, collapsed: false },
        { id: "local-marks", type: "paragraph", text: "굵게 기울임 링크 수식", marks: [
          { type: "bold", start: 0, end: 2 },
          { type: "italic", start: 3, end: 6 },
          { type: "link", start: 7, end: 9, href: "https://example.com" },
          { type: "equation", start: 10, end: 12, formula: "x^2" },
        ], checked: false, indent: 0, collapsed: false },
        { id: "local-body", type: "paragraph", text: "기존 내용", marks: [], checked: false, indent: 0, collapsed: false },
      ],
    });
  }, { assetDataURL: existingAssetDataURL });
  const editor = page.locator('.block-editor[data-owner-type="resources"]');
  await expect(editor).toHaveAttribute("data-owner-id", "quick-note:fixture-local-note");
  const legacyImageBlock = editor.locator('[data-block-id="local-image"]');
  await expect(legacyImageBlock.locator("img")).toHaveAttribute("src", existingAssetDataURL);
  await expect(legacyImageBlock.locator("[data-resource-image-caption]")).toHaveValue("");
  await expect(legacyImageBlock).not.toContainText("기존 이미지");
  const body = editor.locator('[data-block-content="local-body"]');
  await expect(body).toBeFocused();
  expect(await body.evaluate((element) => {
    const selection = window.getSelection();
    const range = selection.rangeCount ? selection.getRangeAt(0) : null;
    return range && element.contains(range.startContainer) ? range.startOffset : -1;
  })).toBe("기존 내용".length);

  await page.evaluate(() => window.sygmaQuickEditor.flush());
  const serialized = await page.evaluate(() => window.__quickMemoMessages.filter((message) => message.type === "localChange").at(-1));
  expect(serialized.markdown).toContain("![기존 이미지](assets/11111111-1111-4111-8111-111111111111.png)");
  expect(serialized.markdown).toContain("**굵게** *기울임* [링크](https://example.com) \\(x^2\\)");
  expect(serialized.blocks.find((block) => block.id === "local-image")).toMatchObject({ url: "assets/11111111-1111-4111-8111-111111111111.png" });
  expect(serialized.blocks.find((block) => block.id === "local-image")).not.toHaveProperty("localAssetPath");
  expect(JSON.stringify(serialized.blocks)).not.toContain("data:image");

  await body.evaluate((element) => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press("Shift+ArrowLeft");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() || "")).toBe("용");
  await expect(page.locator("#overlayRoot > *")).toHaveCount(0);
  await page.waitForTimeout(550);
  await expect(page.locator("#overlayRoot > *")).toHaveCount(0);

  await editor.evaluate((element) => { window.__localQuickEditor = element; });
  await page.evaluate(() => window.sygmaQuickEditor.openResourcePicker());
  const remoteBefore = await fixtureSnapshot(request);
  const remoteState = structuredClone(remoteBefore.state);
  const remoteResource = remoteState.resources.find((resource) => resource.id === FIXTURE_IDS.resource);
  remoteResource.title = "Remote Picker Title";
  remoteResource.updatedAt = new Date().toISOString();
  remoteResource.revision += 1;
  const remoteWrite = await request.put("/api/state", {
    headers: { "If-Match": `"state-${remoteBefore.serverRevision}"` },
    data: { state: remoteState, baseRevision: remoteBefore.serverRevision },
  });
  expect(remoteWrite.ok()).toBeTruthy();
  await expect(page.locator(`[data-quick-editor-resource="${FIXTURE_IDS.resource}"]`)).toHaveText("Remote Picker Title");
  expect(await editor.evaluate((element) => element === window.__localQuickEditor)).toBe(true);
  expect(await page.evaluate(() => window.__quickMemoMessages.filter((message) => message.type === "ready").length)).toBe(1);
  await page.keyboard.press("Escape");

  const operationsBefore = await localResourceOperationCount(page);
  const persistenceBefore = await fixtureSnapshot(request);
  await body.evaluate(async (element) => {
    element.focus();
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    canvas.getContext("2d").fillRect(0, 0, 1, 1);
    const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg"));
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([jpeg], "clipboard.jpg", { type: "image/jpeg" }));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await expect.poll(() => page.evaluate(() => window.__quickMemoMessages.filter((message) => message.type === "saveLocalImage").length)).toBe(1);
  expect(await page.evaluate(() => window.__quickMemoMessages.find((message) => message.type === "saveLocalImage").dataURL.startsWith("data:image/jpeg;base64,"))).toBe(true);
  const localImageBlock = editor.locator('[data-type="image"]').filter({ has: page.locator('img[alt="clipboard"]') });
  await expect(localImageBlock.locator('img[alt="clipboard"]')).toBeVisible();
  await expect(localImageBlock).not.toContainText("clipboard");
  await localImageBlock.locator("[data-resource-image-caption]").fill("퀵 캡션");
  await expect.poll(() => page.evaluate(() => window.__quickMemoMessages.filter((message) => message.type === "localChange").at(-1))).toMatchObject({
    type: "localChange",
    id: "fixture-local-note",
    markdown: expect.stringContaining("![퀵 캡션](assets/22222222-2222-4222-8222-222222222222.png)"),
    blocks: expect.arrayContaining([expect.objectContaining({ type: "image", caption: "퀵 캡션", url: "assets/22222222-2222-4222-8222-222222222222.png" })]),
  });

  await page.evaluate(() => window.sygmaQuickEditor.loadLocal({
    id: "fixture-local-note",
    markdown: "",
    blocks: [{ id: "slash-image", type: "paragraph", text: "", marks: [], checked: false, indent: 0, collapsed: false }],
  }));
  const slashContent = editor.locator('[data-block-content="slash-image"]');
  await slashContent.type("/image");
  const fileChooser = page.waitForEvent("filechooser");
  await page.locator('[data-resource-slash-id="image"]').click();
  await (await fileChooser).setFiles({ name: "slash.png", mimeType: "image/png", buffer: PIXEL_PNG });
  await expect.poll(() => page.evaluate(() => window.__quickMemoMessages.filter((message) => message.type === "saveLocalImage").length)).toBe(2);
  await expect(editor.locator('[data-block-id="slash-image"] img')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__quickMemoMessages.filter((message) => message.type === "localChange").at(-1))).toMatchObject({
    markdown: expect.stringContaining("assets/33333333-3333-4333-8333-333333333333.png"),
    blocks: expect.arrayContaining([expect.objectContaining({ id: "slash-image", type: "image", url: "assets/33333333-3333-4333-8333-333333333333.png" })]),
  });
  const savedImageChange = await page.evaluate(() => window.__quickMemoMessages.filter((message) => message.type === "localChange").at(-1));
  expect(JSON.stringify(savedImageChange.blocks)).not.toMatch(/localAssetPath|data:image/i);

  expect(resourceImageRequests).toBe(0);
  await page.evaluate(() => window.sygmaQuickEditor.openResourcePicker());
  const pickerQuery = page.locator("[data-quick-editor-query]");
  await pickerQuery.fill("Remote Picker");
  await pickerQuery.press("ArrowDown");
  const resourceChoice = page.locator(`[data-quick-editor-resource="${FIXTURE_IDS.resource}"]`);
  await expect(resourceChoice).toBeFocused();
  await resourceChoice.press("Enter");
  await expect(editor).toHaveAttribute("data-owner-id", FIXTURE_IDS.resource);
  await page.evaluate(() => window.sygmaQuickEditor.openLocal());
  await expect(editor).toHaveAttribute("data-owner-id", "quick-note:fixture-local-note");

  await page.waitForTimeout(650);
  const after = await fixtureSnapshot(request);
  expect(after.serverRevision).toBe(persistenceBefore.serverRevision);
  expect(after.writes).toEqual(persistenceBefore.writes);
  expect(await localResourceOperationCount(page)).toBe(operationsBefore);
  expect(new URL(page.url()).searchParams.get("surface")).toBe("quick-editor");
});

test("Quick Editor는 로컬 이미지 응답 전 Resource 전환 시 paste와 /image 삽입을 취소한다", async ({ page, request }) => {
  const pngDataURL = `data:image/png;base64,${PIXEL_PNG.toString("base64")}`;
  let resourceImageRequests = 0;
  page.on("request", (entry) => {
    if (new URL(entry.url()).pathname === "/api/resource-images") resourceImageRequests += 1;
  });
  await page.addInitScript(() => {
    window.__quickMemoMessages = [];
    window.addEventListener("sygma:quickMemo", (event) => window.__quickMemoMessages.push(event.detail));
  });
  await page.goto("/?surface=quick-editor");
  await page.evaluate(() => window.sygmaQuickEditor.loadLocal({
    id: "race-local",
    blocks: [{ id: "paste-race", type: "paragraph", text: "", marks: [], indent: 0 }],
  }));
  const before = await fixtureSnapshot(request);
  const operationsBefore = await localResourceOperationCount(page);
  const editor = page.locator('.block-editor[data-owner-type="resources"]');
  const pasteBlock = editor.locator('[data-block-content="paste-race"]');
  await pasteBlock.evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([bytes], "race.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, PIXEL_PNG.toString("base64"));
  await expect.poll(() => page.evaluate(() => window.__quickMemoMessages.filter((message) => message.type === "saveLocalImage").length)).toBe(1);
  await page.evaluate((resourceId) => window.sygmaQuickEditor.openResource(resourceId), FIXTURE_IDS.resource);
  await expect(editor).toHaveAttribute("data-owner-id", FIXTURE_IDS.resource);
  expect(await page.evaluate(({ path, dataURL }) => {
    const request = window.__quickMemoMessages.find((message) => message.type === "saveLocalImage");
    return window.sygmaQuickEditor.resolveLocalImage(request.requestId, { path, dataURL });
  }, { path: "assets/44444444-4444-4444-8444-444444444444.png", dataURL: pngDataURL })).toBe(false);
  await page.evaluate(() => window.sygmaQuickEditor.openLocal());
  await expect(editor.locator('[data-block-id="paste-race"]')).toHaveAttribute("data-type", "paragraph");
  await expect(editor.locator('[data-block-id="paste-race"] img')).toHaveCount(0);

  await page.evaluate(() => window.sygmaQuickEditor.loadLocal({
    id: "race-local",
    blocks: [{ id: "slash-race", type: "paragraph", text: "", marks: [], indent: 0 }],
  }));
  const slashBlock = editor.locator('[data-block-content="slash-race"]');
  await slashBlock.type("/image");
  const fileChooser = page.waitForEvent("filechooser");
  await page.locator('[data-resource-slash-id="image"]').click();
  await (await fileChooser).setFiles({ name: "race.png", mimeType: "image/png", buffer: PIXEL_PNG });
  await expect.poll(() => page.evaluate(() => window.__quickMemoMessages.filter((message) => message.type === "saveLocalImage").length)).toBe(2);
  expect(await page.evaluate(({ resourceId, path, dataURL }) => {
    const request = window.__quickMemoMessages.filter((message) => message.type === "saveLocalImage").at(-1);
    const resolved = window.sygmaQuickEditor.resolveLocalImage(request.requestId, { path, dataURL });
    const opened = window.sygmaQuickEditor.openResource(resourceId);
    return { resolved, opened };
  }, {
    resourceId: FIXTURE_IDS.resource,
    path: "assets/55555555-5555-4555-8555-555555555555.png",
    dataURL: pngDataURL,
  })).toEqual({ resolved: true, opened: true });
  await expect(editor).toHaveAttribute("data-owner-id", FIXTURE_IDS.resource);
  await page.evaluate(() => window.sygmaQuickEditor.openLocal());
  await expect(editor.locator('[data-block-id="slash-race"]')).toHaveAttribute("data-type", "paragraph");
  await expect(editor.locator('[data-block-id="slash-race"] img')).toHaveCount(0);

  await page.waitForTimeout(650);
  const after = await fixtureSnapshot(request);
  expect(after.serverRevision).toBe(before.serverRevision);
  expect(after.writes).toEqual(before.writes);
  expect(await localResourceOperationCount(page)).toBe(operationsBefore);
  expect(resourceImageRequests).toBe(0);
});

test("Quick Editor는 오프라인 로컬 snapshot의 Resource도 선택해 연다", async ({ page }) => {
  await page.route(/\/api\/state(?:\/.*)?(?:\?.*)?$/, (route) => route.abort());
  await page.addInitScript(() => {
    window.__quickMemoMessages = [];
    window.addEventListener("sygma:quickMemo", (event) => window.__quickMemoMessages.push(event.detail));
  });
  await page.goto("/?surface=quick-editor");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await expect.poll(() => page.evaluate((resourceId) => window.__quickMemoMessages
    .filter((message) => message.type === "ready")
    .at(-1)?.resources?.some((resource) => resource.id === resourceId), FIXTURE_IDS.resource)).toBe(true);
  expect(await page.evaluate((resourceId) => window.sygmaQuickEditor.openResource(resourceId), FIXTURE_IDS.resource)).toBe(true);
  await expect(page.locator(`.block-editor[data-owner-id="${FIXTURE_IDS.resource}"]`)).toBeVisible();
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
  const smallHandle = await a.locator('[data-resource-resize="w"]').boundingBox();
  await page.mouse.move(smallHandle.x + smallHandle.width / 2, smallHandle.y + smallHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(page.viewportSize().width - 5, smallHandle.y + smallHandle.height / 2, { steps: 12 });
  await page.mouse.up();
  expect((await a.boundingBox()).width).toBe(300);
  await expect.poll(() => a.locator("[data-resource-relations]").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  const b = await openSettledResource(page, FIXTURE_IDS.bodySearchResource);
  const dock = await a.boundingBox();
  await drag(b, dock.x + dock.width / 2, 60);
  await expect(b).toHaveAttribute("data-docked", "true");
  await expectLayout();
  const handle = await b.locator('[data-resource-resize="w"]').boundingBox();
  expect(handle.width).toBe(20);
  expect(await b.locator('[data-resource-resize="w"]').evaluate((element) => ["::before", "::after"].every((pseudo) => {
    const style = getComputedStyle(element, pseudo);
    return style.content !== "none" && style.display !== "none" && Number(style.opacity) > 0;
  }))).toBe(true);
  // Start in the newly widened outer half, outside the former 10px hit target.
  await page.mouse.move(handle.x + 2, handle.y + handle.height / 2);
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

test("Resource 창 크기는 다시 열기와 새로고침 후에도 기억하고 도킹과 화면 축소가 덮어쓰지 않는다", async ({ page, request }) => {
  await openResourceList(page);
  const before = await fixtureSnapshot(request);
  let window = await openSettledResource(page, FIXTURE_IDS.resource);
  const size = async () => {
    const { width, height } = await window.boundingBox();
    return { width, height };
  };
  const settled = () => expect.poll(() => window.evaluate((element) => element.getAnimations().every((animation) => animation.playState !== "running"))).toBe(true);
  const close = () => window.locator(".resource-document-close").click();
  const resize = async (direction, dx, dy, cancel = false) => {
    const handle = await window.locator(`[data-resource-resize="${direction}"]`).boundingBox();
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up();
    await settled();
  };
  const drag = async (x, y) => {
    const bar = await window.locator("[data-resource-window-drag]").boundingBox();
    await page.mouse.move(bar.x + 100, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.up();
    await settled();
  };
  const original = await size();
  await resize("se", -180, -120);
  const resized = await size();
  expect(resized).toEqual({ width: original.width - 180, height: original.height - 120 });
  await close();
  window = await openSettledResource(page, FIXTURE_IDS.bodySearchResource);
  expect(await size()).toEqual(resized);
  await window.locator("[data-resource-window-drag]").focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowDown");
  await settled();
  const floating = await size();
  expect(floating).toEqual({ width: resized.width - 16, height: resized.height + 16 });
  await resize("se", -80, -60, true);
  expect(await size()).toEqual(floating);
  await drag(page.viewportSize().width - 10, 60);
  await expect(window).toHaveAttribute("data-docked", "true");
  await resize("w", 84, 0);
  const dockWidth = (await size()).width;
  expect(dockWidth).toBe(476);
  await close();
  await page.reload();
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await openResourceList(page);
  window = await openSettledResource(page, FIXTURE_IDS.resource);
  expect(await size()).toEqual(floating);
  await drag(page.viewportSize().width - 10, 60);
  await expect(window).toHaveAttribute("data-docked", "true");
  expect((await size()).width).toBe(dockWidth);
  await drag(200, 100);
  await expect(window).toHaveAttribute("data-docked", "false");
  expect(await size()).toEqual(floating);
  await close();
  await page.setViewportSize({ width: 390, height: 520 });
  window = await openSettledResource(page, FIXTURE_IDS.resource);
  expect(await size()).toEqual({ width: 390, height: 520 });
  await close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  window = await openSettledResource(page, FIXTURE_IDS.resource);
  expect(await size()).toEqual(floating);
  const after = await fixtureSnapshot(request);
  expect(after.state).toEqual(before.state);
  expect(after.writes).toEqual(before.writes);
});

test("표 행·열 선택 손잡이는 가로 스크롤과 열 너비 변경 후에도 정렬과 셀 이동을 유지한다", async ({ page, request }, testInfo) => {
  const before = await fixtureSnapshot(request);
  const state = structuredClone(before.state);
  const resource = state.resources.find((item) => item.id === FIXTURE_IDS.resource);
  resource.blocks = [
    { id: "table-selection-handles", type: "table", text: ["| A | B | C |", "| --- | --- | --- |", ...Array.from({ length: 8 }, (_, row) => `| ${row === 2 ? "높이가 다른 긴 내용 ".repeat(16) : `row ${row}`} | value ${row} | end ${row} |`)].join("\n"), columnWidths: [330, 330, 330], marks: [], indent: 0 },
    { id: "after-table-handles", type: "paragraph", text: "다음 문장", marks: [], indent: 0 },
    { id: "table-narrow-frame", type: "table", text: "| Left | Right |\n| --- | --- |\n| A | B |", columnWidths: [180, 180], marks: [], indent: 0 },
  ].map((block) => ({ ...block, checked: false, collapsed: false }));
  resource.commentThreads = [];
  const response = await request.put("/api/state", { headers: { "If-Match": `"state-${before.serverRevision}"` }, data: { state, baseRevision: before.serverRevision } });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.reload();
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await openResourceList(page);
  const window = await openSettledResource(page, FIXTURE_IDS.resource);
  const block = window.locator('[data-block-id="table-selection-handles"]');
  const narrow = window.locator('[data-block-id="table-narrow-frame"]');
  const rowHandle = (row) => block.locator(`[data-resource-table-scope="row"][data-table-row="${row}"]`);
  const columnHandle = (column) => block.locator(`[data-resource-table-scope="column"][data-table-column="${column}"]`);
  const selected = block.locator("[data-resource-table-cell].is-cell-selected");
  const visibleHandles = () => block.locator("[data-resource-table-scope]").evaluateAll((buttons) => buttons
    .filter((button) => Number(getComputedStyle(button).opacity) > 0.99)
    .map((button) => `${button.dataset.resourceTableScope}:${button.dataset.tableRow ?? button.dataset.tableColumn ?? "all"}`));
  const aligned = () => expect.poll(() => block.evaluate((element) => [...element.querySelectorAll('[data-resource-table-scope="row"]')].every((button, row) => {
    const handle = button.getBoundingClientRect();
    const bounds = element.querySelector("table").rows[row].getBoundingClientRect();
    return Math.abs(handle.y + handle.height / 2 - bounds.y - bounds.height / 2) < 1;
  }))).toBe(true);
  await expect(block.locator("table tr")).toHaveCount(9);
  await expect(block.locator("table :is(td, th)")).toHaveCount(27);
  await expect(block.locator('[data-resource-table-scope="row"]')).toHaveCount(9);
  await expect(block.locator('[data-resource-table-scope="column"]')).toHaveCount(3);
  await narrow.locator('[data-resource-table-scope="all"]').click();
  const narrowFrame = await narrow.evaluate((element) => {
    const scroll = element.querySelector(".resource-table-scroll");
    const table = element.querySelector(".resource-markdown-table");
    const scrollStyle = getComputedStyle(scroll);
    const tableStyle = getComputedStyle(table);
    const rowEdge = element.querySelector('[data-resource-table-edge="rows"]').getBoundingClientRect();
    const columnEdge = element.querySelector('[data-resource-table-edge="columns"]').getBoundingClientRect();
    const tableBounds = table.getBoundingClientRect();
    const corners = [
      table.tHead.rows[0].cells[0],
      table.tHead.rows[0].cells[table.tHead.rows[0].cells.length - 1],
      table.tBodies[0].rows[table.tBodies[0].rows.length - 1].cells[0],
      table.tBodies[0].rows[table.tBodies[0].rows.length - 1].cells[table.tBodies[0].rows[table.tBodies[0].rows.length - 1].cells.length - 1],
    ].map((cell) => getComputedStyle(cell));
    return {
      tableNarrowerThanScroller: table.getBoundingClientRect().width < scroll.getBoundingClientRect().width,
      scrollBorders: [scrollStyle.borderTopWidth, scrollStyle.borderRightWidth, scrollStyle.borderBottomWidth, scrollStyle.borderLeftWidth],
      scrollBackground: scrollStyle.backgroundColor,
      tableBorders: [tableStyle.borderTopWidth, tableStyle.borderRightWidth, tableStyle.borderBottomWidth, tableStyle.borderLeftWidth],
      tableBorderColors: [tableStyle.borderTopColor, tableStyle.borderRightColor, tableStyle.borderBottomColor, tableStyle.borderLeftColor],
      tableRadius: parseFloat(tableStyle.borderTopLeftRadius),
      rowEdgeWidthDelta: Math.abs(rowEdge.width - tableBounds.width),
      columnEdgeLeftDelta: Math.abs(columnEdge.left - tableBounds.right - 2),
      columnEdgeHeightDelta: Math.abs(columnEdge.height - tableBounds.height),
      cornerRadii: [
        parseFloat(corners[0].borderTopLeftRadius),
        parseFloat(corners[1].borderTopRightRadius),
        parseFloat(corners[2].borderBottomLeftRadius),
        parseFloat(corners[3].borderBottomRightRadius),
      ],
    };
  });
  expect(narrowFrame).toMatchObject({
    tableNarrowerThanScroller: true,
    scrollBorders: ["0px", "0px", "0px", "0px"],
    scrollBackground: "rgba(0, 0, 0, 0)",
    tableBorders: ["1px", "1px", "1px", "1px"],
    tableBorderColors: ["rgb(35, 131, 226)", "rgb(35, 131, 226)", "rgb(35, 131, 226)", "rgb(35, 131, 226)"],
  });
  expect(narrowFrame.tableRadius).toBeGreaterThan(0);
  expect(narrowFrame.rowEdgeWidthDelta).toBeLessThan(1);
  expect(narrowFrame.columnEdgeLeftDelta).toBeLessThan(1);
  expect(narrowFrame.columnEdgeHeightDelta).toBeLessThan(1);
  expect(narrowFrame.cornerRadii.every((radius) => radius > 0)).toBe(true);
  await aligned();
  await block.hover();
  await expect.poll(visibleHandles).toEqual([]);
  await rowHandle(2).hover();
  await expect.poll(visibleHandles).toEqual(["row:2"]);
  await columnHandle(1).hover();
  await expect.poll(visibleHandles).toEqual(["column:1"]);
  const handleGeometry = await block.evaluate((element) => {
    const row = element.querySelector('[data-resource-table-scope="row"][data-table-row="2"]');
    const column = element.querySelector('[data-resource-table-scope="column"][data-table-column="1"]');
    const header = column.closest("th");
    const rowBounds = row.getBoundingClientRect();
    const columnBounds = column.getBoundingClientRect();
    const headerBounds = header.getBoundingClientRect();
    const tableBounds = element.querySelector(".resource-markdown-table").getBoundingClientRect();
    return {
      rowWidth: rowBounds.width,
      rowHeight: rowBounds.height,
      columnWidth: columnBounds.width,
      columnHeight: columnBounds.height,
      columnCenter: columnBounds.left + columnBounds.width / 2,
      headerCenter: headerBounds.left + headerBounds.width / 2,
      rowIcon: row.querySelector("span").textContent,
      rowIconTransform: getComputedStyle(row.querySelector("span")).transform,
      transition: getComputedStyle(row).transitionProperty,
      rowGap: tableBounds.left - rowBounds.right,
      columnGap: tableBounds.top - columnBounds.bottom,
    };
  });
  expect(handleGeometry.rowWidth).toBe(handleGeometry.columnHeight);
  expect(handleGeometry.rowHeight).toBe(handleGeometry.columnWidth);
  expect(handleGeometry.rowGap).toBeGreaterThan(1);
  expect(Math.abs(handleGeometry.rowGap - handleGeometry.columnGap)).toBeLessThan(1);
  expect(Math.abs(handleGeometry.columnCenter - handleGeometry.headerCenter)).toBeLessThan(1);
  expect(handleGeometry.rowIcon).toBe("");
  expect(handleGeometry.rowIconTransform).not.toBe("none");
  expect(handleGeometry.transition).toContain("opacity");
  await rowHandle(2).click();
  await expect(selected).toHaveCount(3);
  expect(await selected.evaluateAll((cells) => cells.every((cell) => cell.dataset.tableRow === "2"))).toBe(true);
  const rowSelection = await selected.evaluateAll((cells) => cells.map((cell) => {
    const style = getComputedStyle(cell.parentElement);
    return {
      borderRightColor: style.borderRightColor,
      topLeft: parseFloat(style.borderTopLeftRadius),
      bottomLeft: parseFloat(style.borderBottomLeftRadius),
      topRight: parseFloat(style.borderTopRightRadius),
      bottomRight: parseFloat(style.borderBottomRightRadius),
    };
  }));
  const tableRadius = await block.locator(".resource-markdown-table").evaluate((table) => parseFloat(getComputedStyle(table).borderTopLeftRadius));
  expect(rowSelection[0].topLeft).toBe(tableRadius);
  expect(rowSelection[0].bottomLeft).toBe(tableRadius);
  expect(rowSelection[1]).toMatchObject({ borderRightColor: "rgba(0, 0, 0, 0)", topLeft: 0, bottomLeft: 0, topRight: 0, bottomRight: 0 });
  expect(rowSelection[2].topRight).toBe(tableRadius);
  expect(rowSelection[2].bottomRight).toBe(tableRadius);
  await expect(block.locator(".resource-table-format")).toBeVisible();
  await block.locator('[data-resource-table-format="tableBold"]').click();
  await expect(block.locator(".resource-table-format")).toBeVisible();
  await block.locator(".resource-table-scroll").evaluate((element) => { element.scrollLeft = 390; });
  const scrolledLeft = await block.locator(".resource-table-scroll").evaluate((element) => element.scrollLeft);
  expect(scrolledLeft).toBeGreaterThan(0);
  await aligned();
  await columnHandle(1).click();
  expect(await block.locator(".resource-table-scroll").evaluate((element) => element.scrollLeft)).toBe(scrolledLeft);
  await expect(selected).toHaveCount(9);
  expect(await selected.evaluateAll((cells) => cells.every((cell) => cell.dataset.tableColumn === "1"))).toBe(true);
  const columnSelection = await selected.evaluateAll((cells) => cells.map((cell) => {
    const style = getComputedStyle(cell.parentElement);
    return {
      borderBottomColor: style.borderBottomColor,
      topLeft: parseFloat(style.borderTopLeftRadius),
      topRight: parseFloat(style.borderTopRightRadius),
      bottomLeft: parseFloat(style.borderBottomLeftRadius),
      bottomRight: parseFloat(style.borderBottomRightRadius),
    };
  }));
  expect(columnSelection[0].topLeft).toBe(tableRadius);
  expect(columnSelection[0].topRight).toBe(tableRadius);
  expect(columnSelection[1]).toMatchObject({ borderBottomColor: "rgba(0, 0, 0, 0)", topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 });
  expect(columnSelection.at(-1).bottomLeft).toBe(tableRadius);
  expect(columnSelection.at(-1).bottomRight).toBe(tableRadius);
  await expect(block.locator('[data-resource-table-scope][aria-pressed="true"]')).toHaveCount(1);
  await expect(block.locator('[data-resource-table-scope][aria-pressed="true"]')).toHaveAttribute("data-resource-table-scope", "column");
  await page.screenshot({ path: testInfo.outputPath("table-selection-handles.png") });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(selected).toHaveCount(0);
  const cell = block.locator('[data-resource-table-cell][data-table-row="1"][data-table-column="1"]');
  await expect(cell).toBeFocused();
  expect(await cell.evaluate((element) => {
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(selection.focusNode, selection.focusOffset);
    return range.toString().length === element.textContent.length && selection.isCollapsed;
  })).toBe(true);
  await cell.press("Escape");
  await expect(selected).toHaveCount(1);
  const singleSelection = await selected.evaluate((content) => {
    const cellElement = content.parentElement;
    const table = content.closest(".resource-markdown-table");
    const probe = document.createElement("span");
    probe.style.boxShadow = "0 0 0 1px #2383e2";
    document.body.append(probe);
    const expectedShadow = getComputedStyle(probe).boxShadow;
    probe.remove();
    const style = getComputedStyle(cellElement);
    const tableStyle = getComputedStyle(table);
    return {
      shadow: style.boxShadow,
      expectedShadow,
      borderRightColor: style.borderRightColor,
      borderBottomColor: style.borderBottomColor,
      radii: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius],
      tableRadii: [tableStyle.borderTopLeftRadius, tableStyle.borderTopRightRadius, tableStyle.borderBottomRightRadius, tableStyle.borderBottomLeftRadius],
    };
  });
  expect(singleSelection.shadow).toBe(singleSelection.expectedShadow);
  expect(singleSelection.borderRightColor).toBe("rgba(0, 0, 0, 0)");
  expect(singleSelection.borderBottomColor).toBe("rgba(0, 0, 0, 0)");
  expect(singleSelection.radii).toEqual(singleSelection.tableRadii);
  await cell.press("ArrowRight");
  await expect(selected).toHaveAttribute("data-table-column", "2");
  await block.locator('[data-resource-table-scope="all"]').click();
  await expect(block).toHaveClass(/is-selected/);
  await expect(selected).toHaveCount(0);
  const all = await block.locator('[data-resource-table-scope="all"]').boundingBox();
  const scroll = await block.locator(".resource-table-scroll").boundingBox();
  expect(all.x + all.width).toBeLessThan(scroll.x);
  await block.locator(".resource-table-scroll").evaluate((element) => { element.scrollLeft = 0; });
  const width = block.locator('[data-resource-table-width="0"]');
  await width.focus();
  await page.keyboard.press("ArrowLeft");
  await aligned();
  await block.locator('[data-resource-table-edge="rows"]').click();
  await expect(block.locator('[data-resource-table-scope="row"]')).toHaveCount(10);
  await aligned();
  for (let row = 0; row < 12; row += 1) await block.locator('[data-resource-table-edge="rows"]').click();
  await block.locator('[data-resource-table-scope="row"]').last().click();
  const document = window.locator("[data-resource-document]");
  const visibleToolbar = () => expect.poll(async () => {
    const bounds = await document.boundingBox();
    const titlebar = await window.locator("[data-resource-window-drag]").boundingBox();
    const toolbar = await block.locator(".resource-table-format").boundingBox();
    return toolbar.y >= titlebar.y + titlebar.height && toolbar.y + toolbar.height <= bounds.y + bounds.height;
  }).toBe(true);
  expect((await block.locator("table").boundingBox()).y).toBeLessThan((await document.boundingBox()).y);
  await visibleToolbar();
  await rowHandle(14).click();
  await document.evaluate((element) => {
    const row = element.querySelector('[data-resource-table-cell][data-table-row="14"]');
    const titlebar = element.querySelector("[data-resource-window-drag]");
    element.scrollTop += row.getBoundingClientRect().top - titlebar.getBoundingClientRect().bottom - 4;
  });
  await visibleToolbar();
  await block.locator('[data-resource-table-format="tableBold"]').click();
  await visibleToolbar();
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
  const list = page.locator('[data-resource-group="all"]');
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
  await expect(document.locator(":scope > .resource-document-title + [data-resource-relations] + .resource-document-divider + .resource-document-layout > .resource-document-body")).toHaveCount(1);
  await expect(document.locator(".resource-document-layout > [data-resource-comments]")).toHaveAttribute("aria-hidden", "true");
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
    await expect(windowFor(id).locator("[data-resource-window-drag] button")).toHaveCount(2);
    await expect(windowFor(id).locator("[data-resource-comments-toggle]")).toHaveCount(1);
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
