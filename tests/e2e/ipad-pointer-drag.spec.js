import { expect, test } from "@playwright/test";
import {
  FIXTURE_IDS,
  fixtureSnapshot,
  openMainResourceFromList,
  openResources,
  resetFixture,
} from "./helpers.js";

const IPAD_VIEWPORT = { width: 1024, height: 1366 };
const TARGET_ACTION = "readLater";

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("desktop mouse uses the custom Resource drag without native selection", async ({ page, request }) => {
  await page.goto("/");
  await openResources(page);
  await prepareDragAudit(page);

  await dragWithMouse(page);

  await expectPointerType(page, "mouse");
  await expectReadLaterCommit(page, request);
});

test("iPad trackpad mouse uses the custom Resource drag without native selection", async ({ browser, request }, testInfo) => {
  const context = await newIpadContext(browser, testInfo);
  const page = await context.newPage();

  try {
    await page.goto("/");
    await openResources(page);
    await prepareDragAudit(page);

    await dragWithMouse(page);

    await expectPointerType(page, "mouse");
    await expectReadLaterCommit(page, request);
  } finally {
    await context.close();
  }
});

test("iPad touch uses the custom Resource drag without native selection", async ({ browser, request }, testInfo) => {
  const context = await newIpadContext(browser, testInfo);
  const page = await context.newPage();

  try {
    await page.goto("/");
    await openResources(page);
    await prepareDragAudit(page);

    await dragWithCdpTouch(context, page);

    await expectPointerType(page, "touch");
    await expectReadLaterCommit(page, request);
  } finally {
    await context.close();
  }
});

test("desktop trackpad turns a block tool drag into block movement without a marquee", async ({ page }) => {
  await page.goto("/");
  const blockTool = await activeHeadingBlockTool(page);
  await beginBlockToolDragWithMouse(page, blockTool);
  await expectBlockMovementWithoutMarquee(page);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".block-drag-ghost")).toHaveCount(0);
  await expect(page.locator(".editor-marquee")).toHaveCount(0);
});

for (const input of ["trackpad", "touch"]) {
  test(`iPad ${input} turns a block tool drag into block movement without a marquee`, async ({ browser }, testInfo) => {
    const context = await newIpadContext(browser, testInfo);
    const page = await context.newPage();

    try {
      await page.goto("/");
      const blockTool = await activeHeadingBlockTool(page);

      const touchSession = input === "touch"
        ? await beginBlockToolDragWithTouch(context, page, blockTool)
        : null;
      if (input === "trackpad") await beginBlockToolDragWithMouse(page, blockTool);

      await expectBlockMovementWithoutMarquee(page);

      if (input === "touch") {
        await touchSession.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
        await touchSession.detach();
      } else {
        await page.keyboard.press("Escape");
        await page.mouse.up();
      }
      await expect(page.locator(".block-drag-ghost")).toHaveCount(0);
      await expect(page.locator(".editor-marquee")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

async function activeHeadingBlockTool(page) {
  const note = await openMainResourceFromList(page);
  const blockContent = note.locator('[data-block-content="fixture-block-heading-1"]');
  await blockContent.click();
  const blockTool = note.locator('[data-block-add="fixture-block-heading-1"]');
  await expect(blockTool).toBeVisible();
  await expect.poll(() => blockTool.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("auto");
  return blockTool;
}

async function expectBlockMovementWithoutMarquee(page) {
  await expect(page.locator(".block-drag-ghost")).toBeVisible();
  await expect(page.locator(".editor-marquee")).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString() || "")).toBe("");
}

async function newIpadContext(browser, testInfo) {
  return browser.newContext({
    baseURL: String(testInfo.project.use.baseURL),
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: IPAD_VIEWPORT,
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "block",
  });
}

function resourceCard(page) {
  return page.locator(
    `[data-delete-drag-type="resources"][data-delete-drag-id="${FIXTURE_IDS.resource}"]`,
  ).first();
}

function dropTarget(page) {
  return page.locator(`[data-delete-drop][data-drag-action="${TARGET_ACTION}"]`);
}

async function prepareDragAudit(page) {
  await expect(resourceCard(page)).toBeVisible();
  await page.evaluate((resourceId) => {
    window.getSelection()?.removeAllRanges();
    window.__e2ePointerDragAudit = {
      contextmenu: 0,
      dragstart: 0,
      pointerTypes: [],
      selectstart: 0,
    };
    for (const eventName of ["contextmenu", "dragstart", "selectstart"]) {
      document.addEventListener(eventName, () => {
        window.__e2ePointerDragAudit[eventName] += 1;
      }, true);
    }
    document.addEventListener("pointerdown", (event) => {
      const target = event.target instanceof Element
        ? event.target.closest(`[data-delete-drag-type="resources"][data-delete-drag-id="${resourceId}"]`)
        : null;
      if (target) window.__e2ePointerDragAudit.pointerTypes.push(event.pointerType || "unknown");
    }, true);
  }, FIXTURE_IDS.resource);
}

async function dragWithMouse(page) {
  const start = await locatorCenter(resourceCard(page));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 30, start.y + 2, { steps: 3 });

  await expectCustomDragActive(page);

  const target = await locatorCenter(dropTarget(page));
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await expect(dropTarget(page)).toHaveClass(/is-drop-target/);
  await expectNoNativeDragArtifacts(page);
  await page.mouse.up();
}

async function dragWithCdpTouch(context, page) {
  const session = await context.newCDPSession(page);
  const start = await locatorCenter(resourceCard(page));

  try {
    await dispatchTouch(session, "touchStart", start);
    await dispatchTouch(session, "touchMove", { x: start.x + 2, y: start.y + 30 });

    await expectCustomDragActive(page);

    const target = await locatorCenter(dropTarget(page));
    await dispatchTouch(session, "touchMove", target);
    await expect(dropTarget(page)).toHaveClass(/is-drop-target/);
    await expectNoNativeDragArtifacts(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}

async function beginBlockToolDragWithMouse(page, source) {
  const start = await locatorCenter(source);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 30, start.y + 2, { steps: 4 });
}

async function beginBlockToolDragWithTouch(context, page, source) {
  const session = await context.newCDPSession(page);
  const start = await locatorCenter(source);
  await dispatchTouch(session, "touchStart", start);
  await dispatchTouch(session, "touchMove", { x: start.x + 2, y: start.y + 30 });
  return session;
}

async function dispatchTouch(session, type, point) {
  await session.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: [{
      id: 1,
      x: point.x,
      y: point.y,
      radiusX: 1,
      radiusY: 1,
      force: 1,
    }],
  });
}

async function expectCustomDragActive(page) {
  await expect(page.locator(".delete-drag-stage")).toBeVisible();
  await expect(page.locator(".delete-drag-ghost")).toBeVisible();
  await expect(page.locator(".app")).toHaveClass(/is-delete-dragging/);
  await expectNoNativeDragArtifacts(page);
}

async function expectReadLaterCommit(page, request) {
  await expect(page.locator(".delete-drag-stage")).toHaveCount(0);
  await expect(page.locator(".delete-drag-ghost")).toHaveCount(0);
  await expect(page.locator(".app")).not.toHaveClass(/is-delete-dragging/);
  await expectNoNativeDragArtifacts(page);
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return snapshot.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource)?.readLater;
  }).toBe(true);
}

async function expectPointerType(page, pointerType) {
  await expect.poll(async () => page.evaluate(() => window.__e2ePointerDragAudit.pointerTypes)).toContain(pointerType);
}

async function expectNoNativeDragArtifacts(page) {
  await expect(page.locator(".editor-marquee")).toHaveCount(0);
  expect(await page.evaluate(() => ({
    audit: window.__e2ePointerDragAudit,
    selection: window.getSelection()?.toString() || "",
  }))).toEqual({
    audit: {
      contextmenu: 0,
      dragstart: 0,
      pointerTypes: expect.any(Array),
      selectstart: 0,
    },
    selection: "",
  });
}

async function locatorCenter(locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}
