import { expect, test } from "@playwright/test";
import {
  FIXTURE_IDS,
  fixtureSnapshot,
  openResources,
  resetFixture,
  selectResourceMode,
} from "./helpers.js";

const RESOURCE_PATH = (resourceId) => `/resources/${encodeURIComponent(resourceId)}`;

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

function resourceShell(page, mode, resourceId = FIXTURE_IDS.resource) {
  return page.locator(
    `[data-resource-note="${resourceId}"][data-resource-shell="${mode}"]`,
  );
}

function resourceOpener(page, resourceId = FIXTURE_IDS.resource) {
  return page.locator(`#viewRoot [data-open-resource="${resourceId}"]`).first();
}

async function waitForSettledShellGeometry(shell) {
  await shell.evaluate(async (element) => {
    const waitForTwoFrames = () => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

    // Visibility becomes true during the entrance animation. Wait for every
    // active shell animation/transition, then cross a paint boundary before
    // measuring so the assertion describes the final layout geometry.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const activeAnimations = element.getAnimations().filter(
        (animation) => animation.playState === "pending" || animation.playState === "running",
      );
      if (activeAnimations.length === 0) {
        await waitForTwoFrames();
        if (!element.getAnimations().some(
          (animation) => animation.playState === "pending" || animation.playState === "running",
        )) return;
      } else {
        await Promise.all(activeAnimations.map((animation) => animation.finished.catch(() => {})));
      }
    }

    await waitForTwoFrames();
  });
}

async function expectResourcePath(page, resourceId) {
  await expect.poll(() => new URL(page.url()).pathname).toBe(RESOURCE_PATH(resourceId));
}

async function expectResourcesContext(page) {
  await expect.poll(() => new URL(page.url()).pathname).not.toMatch(/^\/resources\//);
  await expect(page.locator('[data-resource-view="library"], [data-resource-view="list"], [data-resource-view="map"]')).toBeVisible();
}

async function openFixtureResource(page, mode = "library", resourceId = FIXTURE_IDS.resource) {
  await page.goto("/");
  await openResources(page);
  if (mode !== "library") await selectResourceMode(page, mode);
  const opener = resourceOpener(page, resourceId);
  await expect(opener).toBeVisible();
  await opener.click();
  await expectResourcePath(page, resourceId);
  return opener;
}

test("Library defaults to Center peek and List defaults to Side peek", async ({ page }) => {
  await openFixtureResource(page, "library");
  await expect(resourceShell(page, "center")).toBeVisible();

  await page.locator(`[data-resource-close="${FIXTURE_IDS.resource}"]`).click();
  await expect(resourceShell(page, "center")).toHaveCount(0);
  await expectResourcesContext(page);

  await selectResourceMode(page, "list");
  await resourceOpener(page).click();
  await expectResourcePath(page, FIXTURE_IDS.resource);
  await expect(resourceShell(page, "side")).toBeVisible();
});

test("Side peek keeps the background Resource database controls readable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openFixtureResource(page, "list");

  const controls = page.locator('[data-view-controls="resources"]');
  await expect(controls).toBeVisible();
  const geometry = await controls.evaluate((root) => {
    const topline = root.querySelector(".view-control-topline");
    const logic = root.querySelector(".view-control-filter-logic");
    const openLabel = root.querySelector(".resource-open-pages-in-control > span");
    const logicStyle = getComputedStyle(logic);
    const openLabelStyle = getComputedStyle(openLabel);
    const logicRect = logic.getBoundingClientRect();
    const openLabelRect = openLabel.getBoundingClientRect();
    return {
      overflow: topline.scrollWidth - topline.clientWidth,
      logicWidth: logicRect.width,
      logicHeight: logicRect.height,
      logicLineHeight: Number.parseFloat(logicStyle.lineHeight),
      openLabelHeight: openLabelRect.height,
      openLabelLineHeight: Number.parseFloat(openLabelStyle.lineHeight),
    };
  });

  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.logicWidth).toBeGreaterThanOrEqual(240);
  expect(geometry.logicHeight).toBeLessThanOrEqual(geometry.logicLineHeight * 1.5);
  expect(geometry.openLabelHeight).toBeLessThanOrEqual(geometry.openLabelLineHeight * 1.5);
});

test("768px fine-pointer windows keep desktop Center and Side peek geometry", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 964 });
  await openFixtureResource(page, "library");

  const center = resourceShell(page, "center");
  await expect(center).toBeVisible();
  await waitForSettledShellGeometry(center);
  const centerGeometry = await center.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const toolbar = element.querySelector("[data-resource-mobile-toolbar]");
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      mobileToolbarVisible: toolbar ? getComputedStyle(toolbar).display !== "none" : false,
      scrollbarWidth: getComputedStyle(element.querySelector(".resource-note-scroll")).scrollbarWidth,
    };
  });
  expect(centerGeometry.left).toBeGreaterThanOrEqual(51);
  expect(centerGeometry.left).toBeLessThanOrEqual(55);
  // Window chrome/DPR rounding shifts the measured 80px reference by a few px.
  expect(centerGeometry.top).toBeGreaterThanOrEqual(76);
  expect(centerGeometry.top).toBeLessThanOrEqual(85);
  expect(centerGeometry.width).toBeGreaterThanOrEqual(660);
  expect(centerGeometry.width).toBeLessThanOrEqual(664);
  expect(centerGeometry.height).toBeGreaterThanOrEqual(830);
  expect(centerGeometry.height).toBeLessThanOrEqual(834);
  expect(centerGeometry.mobileToolbarVisible).toBe(false);
  expect(centerGeometry.scrollbarWidth).toBe("thin");

  for (const height of [964, 720]) {
    await page.setViewportSize({ width: 840, height });
    await waitForSettledShellGeometry(center);
    const beforeBoundary = await center.boundingBox();
    await page.setViewportSize({ width: 841, height });
    await waitForSettledShellGeometry(center);
    const afterBoundary = await center.boundingBox();
    expect(Math.abs((afterBoundary?.x || 0) - (beforeBoundary?.x || 0))).toBeLessThanOrEqual(3);
    expect(Math.abs((afterBoundary?.y || 0) - (beforeBoundary?.y || 0))).toBeLessThanOrEqual(3);
    expect(Math.abs((afterBoundary?.width || 0) - (beforeBoundary?.width || 0))).toBeLessThanOrEqual(6);
    expect(Math.abs((afterBoundary?.height || 0) - (beforeBoundary?.height || 0))).toBeLessThanOrEqual(4);
    expect((afterBoundary?.y || 0) + (afterBoundary?.height || 0)).toBeLessThanOrEqual(height);
  }
  await page.setViewportSize({ width: 768, height: 964 });

  await page.locator(`[data-resource-close="${FIXTURE_IDS.resource}"]`).click();
  await selectResourceMode(page, "list");
  await resourceOpener(page).click();

  const side = resourceShell(page, "side");
  await expect(side).toBeVisible();
  await expect(side).toHaveAttribute("aria-modal", "false");
  await expect(side.locator(`[data-resource-side-resize="${FIXTURE_IDS.resource}"]`)).toBeVisible();
  await waitForSettledShellGeometry(side);
  const sideGeometry = await side.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const toolbar = element.querySelector("[data-resource-mobile-toolbar]");
    return {
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      mobileToolbarVisible: toolbar ? getComputedStyle(toolbar).display !== "none" : false,
    };
  });
  expect(sideGeometry.left).toBeGreaterThanOrEqual(343);
  expect(sideGeometry.left).toBeLessThanOrEqual(351);
  expect(sideGeometry.width).toBeGreaterThanOrEqual(417);
  expect(sideGeometry.width).toBeLessThanOrEqual(425);
  expect(sideGeometry.height).toBe(964);
  expect(sideGeometry.mobileToolbarVisible).toBe(false);
  await expect(page.locator('[data-resource-view="list"]')).toBeVisible();

  for (const width of [768, 601]) {
    await page.setViewportSize({ width, height: 964 });
    await waitForSettledShellGeometry(side);
    const overflow = await side.evaluate((element) => {
      const shellRect = element.getBoundingClientRect();
      return [...element.querySelectorAll(".resource-page-toolbar button")]
        .filter((button) => button.getClientRects().length > 0)
        .map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            label: button.getAttribute("aria-label") || button.textContent?.trim() || "button",
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            shellLeft: Math.round(shellRect.left),
            shellRight: Math.round(shellRect.right),
          };
        })
        .filter((entry) => entry.left < entry.shellLeft || entry.right > entry.shellRight);
    });
    expect(overflow).toEqual([]);
    if (width === 601) {
      await expect(side.locator(`[data-resource-side-resize="${FIXTURE_IDS.resource}"]`)).toBeHidden();
      await expect(side.getByRole("status")).toHaveCount(1);
    }
  }

  await page.setViewportSize({ width: 590, height: 964 });
  await expect(side).toHaveAttribute("aria-modal", "true");
  await expect(side.locator(`[data-resource-side-resize="${FIXTURE_IDS.resource}"]`)).toBeHidden();
  await expect(side.locator(`[data-resource-mobile-toolbar="${FIXTURE_IDS.resource}"]`)).toBeVisible();
  await expect.poll(() => side.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await page.setViewportSize({ width: 768, height: 964 });
  await expect(side).toHaveAttribute("aria-modal", "false");
  await expect(side.locator(`[data-resource-side-resize="${FIXTURE_IDS.resource}"]`)).toBeVisible();
});

test("each Resource view can set Open pages in to Full page", async ({ page, request }) => {
  await page.goto("/");
  await openResources(page);

  const libraryOpenMode = page.locator('select[data-resource-open-pages-in="library"]');
  await expect(libraryOpenMode).toBeVisible();
  await expect(libraryOpenMode).toHaveValue("center");
  await libraryOpenMode.selectOption("full");
  await expect(libraryOpenMode).toHaveValue("full");
  await expect.poll(async () => (await fixtureSnapshot(request)).state.settings.openPagesIn.library).toBe("full");

  await resourceOpener(page).click();
  await expectResourcePath(page, FIXTURE_IDS.resource);
  await expect(resourceShell(page, "full")).toBeVisible();
});

test("Resource URL is stable and Back closes peek before Forward reopens it", async ({ page }) => {
  await openFixtureResource(page, "library");
  await expect(resourceShell(page, "center")).toBeVisible();

  await page.goBack();
  await expect(resourceShell(page, "center")).toHaveCount(0);
  await expectResourcesContext(page);

  await page.goForward();
  await expectResourcePath(page, FIXTURE_IDS.resource);
  await expect(resourceShell(page, "center")).toBeVisible();
});

test("direct Resource deep-link reload restores the Resource shell", async ({ page }) => {
  await page.goto(RESOURCE_PATH(FIXTURE_IDS.resource));
  await expectResourcePath(page, FIXTURE_IDS.resource);
  await expect(resourceShell(page, "center")).toBeVisible();
  await expect(page.locator('[data-resource-view="library"]')).toBeVisible();

  await page.reload();
  await expectResourcePath(page, FIXTURE_IDS.resource);
  await expect(resourceShell(page, "center")).toBeVisible();
});

test("invalid Resource deep link renders an explicit not-found state without crashing", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(RESOURCE_PATH("missing-resource"));
  await expectResourcePath(page, "missing-resource");
  const notFound = page.locator('[data-resource-not-found="missing-resource"]');
  await expect(notFound).toBeVisible();
  await expect(notFound).toContainText(/찾을 수|not found/i);
  await expect(page.locator("[data-resource-note]")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("Center peek is modal, focuses inside, Escape closes, and focus returns to its opener", async ({ page }) => {
  await page.goto("/");
  await openResources(page);
  const opener = resourceOpener(page);
  await opener.focus();
  await opener.click();

  const center = resourceShell(page, "center");
  await expect(center).toBeVisible();
  await expect(center).toHaveAttribute("role", "dialog");
  await expect(center).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("[data-resource-backdrop]")).toBeVisible();
  await expect.poll(() => center.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(center).toHaveCount(0);
  await expectResourcesContext(page);
  await expect(opener).toBeFocused();
});

test("Center peek backdrop closes the Resource and restores its database context", async ({ page }) => {
  await openFixtureResource(page, "library");
  const center = resourceShell(page, "center");
  const backdrop = page.locator("[data-resource-backdrop]");
  await expect(center).toBeVisible();
  await expect(backdrop).toBeVisible();

  await backdrop.click({ position: { x: 4, y: 4 } });
  await expect(center).toHaveCount(0);
  await expectResourcesContext(page);
});

test("Resource shell honors reduced motion throughout its descendants", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openFixtureResource(page, "library");
  const center = resourceShell(page, "center");
  const moving = await center.evaluate((shell) => {
    const seconds = (value) => String(value).split(",").map((part) => {
      const token = part.trim();
      if (token.endsWith("ms")) return Number.parseFloat(token) / 1000;
      if (token.endsWith("s")) return Number.parseFloat(token);
      return 0;
    });
    return [shell, ...shell.querySelectorAll("*")].map((element) => {
      const style = getComputedStyle(element);
      return {
        element: element.tagName,
        animation: Math.max(0, ...seconds(style.animationDuration)),
        transition: Math.max(0, ...seconds(style.transitionDuration)),
      };
    }).filter((entry) => entry.animation > 0.001 || entry.transition > 0.001);
  });
  expect(moving).toEqual([]);
});

test("forced-colors mode retains a visible keyboard focus indicator", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await openFixtureResource(page, "library");
  const center = resourceShell(page, "center");
  const title = center.locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`);
  await title.focus();
  expect(await title.evaluate((element) => {
    const shellStyle = getComputedStyle(element.closest("[data-resource-note]"));
    const style = getComputedStyle(element);
    return {
      forcedColorAdjust: shellStyle.forcedColorAdjust,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  })).toEqual({ forcedColorAdjust: "auto", outlineStyle: "solid", outlineWidth: "2px" });
});

test("Side peek is non-modal, has no backdrop, and leaves the database interactive", async ({ page }) => {
  await openFixtureResource(page, "list");
  const side = resourceShell(page, "side");
  await expect(side).toBeVisible();
  await expect(side).toHaveAttribute("aria-modal", "false");
  await expect(page.locator("[data-resource-backdrop]")).toHaveCount(0);

  const nextDatabaseRow = resourceOpener(page, FIXTURE_IDS.bodySearchResource);
  await expect(nextDatabaseRow).toBeVisible();
  await nextDatabaseRow.click();
  await expectResourcePath(page, FIXTURE_IDS.bodySearchResource);
  await expect(resourceShell(page, "side", FIXTURE_IDS.bodySearchResource)).toBeVisible();
});

test("Side peek width has pointer-equivalent keyboard controls and persists across reload", async ({ page, request }) => {
  await openFixtureResource(page, "list");
  const side = resourceShell(page, "side");
  const resize = side.locator(`[data-resource-side-resize="${FIXTURE_IDS.resource}"]`);
  await expect(resize).toBeVisible();
  await expect(resize).toHaveAttribute("role", "separator");
  const before = await side.evaluate((element) => element.getBoundingClientRect().width);

  await resize.focus();
  await page.keyboard.press("ArrowLeft");
  const after = await side.evaluate((element) => element.getBoundingClientRect().width);
  expect(after).toBeGreaterThan(before);
  await expect(resize).toHaveAttribute("aria-valuenow", String(Math.round(after)));
  await expect.poll(async () => (await fixtureSnapshot(request)).state.settings.resourceSideWidth).toBe(Math.round(after));

  await page.reload();
  const reloaded = resourceShell(page, "side");
  await expect(reloaded).toBeVisible();
  await expect.poll(async () => Math.round(await reloaded.evaluate((element) => element.getBoundingClientRect().width))).toBe(Math.round(after));
});

test("Resource toolbar previous and next keep the shell mode while updating the URL", async ({ page }) => {
  await openFixtureResource(page, "list");
  await expect(resourceShell(page, "side")).toBeVisible();

  await page.locator('[data-resource-navigate="next"]').click();
  await expectResourcePath(page, FIXTURE_IDS.bodySearchResource);
  await expect(resourceShell(page, "side", FIXTURE_IDS.bodySearchResource)).toBeVisible();

  await page.locator('[data-resource-navigate="previous"]').click();
  await expectResourcePath(page, FIXTURE_IDS.resource);
  await expect(resourceShell(page, "side")).toBeVisible();
});

test("Expand opens Full page and Back returns to the originating peek", async ({ page }) => {
  await openFixtureResource(page, "list");
  await expect(resourceShell(page, "side")).toBeVisible();

  await page.locator("[data-resource-expand]").click();
  await expectResourcePath(page, FIXTURE_IDS.resource);
  await expect(resourceShell(page, "full")).toBeVisible();

  await page.goBack();
  await expectResourcePath(page, FIXTURE_IDS.resource);
  await expect(resourceShell(page, "side")).toBeVisible();
});

test("Full page survives reload and browser Back restores the Resource database", async ({ page, request }) => {
  await page.goto("/");
  await openResources(page);
  const libraryOpenMode = page.locator('select[data-resource-open-pages-in="library"]');
  await libraryOpenMode.selectOption("full");
  await expect.poll(async () => (await fixtureSnapshot(request)).state.settings.openPagesIn.library).toBe("full");

  await resourceOpener(page).click();
  await expectResourcePath(page, FIXTURE_IDS.resource);
  await expect(resourceShell(page, "full")).toBeVisible();

  await page.reload();
  await expectResourcePath(page, FIXTURE_IDS.resource);
  await expect(resourceShell(page, "full")).toBeVisible();

  await page.goBack();
  await expect(resourceShell(page, "full")).toHaveCount(0);
  await expectResourcesContext(page);
});

test.describe("mobile Resource shell", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("Side mode becomes modal full-screen with safe 44px editor controls across narrow widths", async ({ page }) => {
    await openFixtureResource(page, "list");
    let side = resourceShell(page, "side");
    await expect(side).toBeVisible();
    await expect(side).toHaveAttribute("aria-modal", "true");
    await expect(side).toHaveAttribute("data-resource-keyboard", /open|closed/);
    await expect(side.getByRole("status")).toHaveCount(1);
    await expect.poll(() => side.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    const focusableSelector = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable='true'], [tabindex]:not([tabindex='-1'])";
    await side.evaluate((shell, selector) => {
      const focusable = [...shell.querySelectorAll(selector)].filter((element) => (
        !element.hidden
        && !element.closest("[hidden], [inert]")
        && element.getClientRects().length > 0
      ));
      focusable.at(-1)?.focus();
    }, focusableSelector);
    await page.keyboard.press("Tab");
    expect(await side.evaluate((shell, selector) => {
      const focusable = [...shell.querySelectorAll(selector)].filter((element) => (
        !element.hidden
        && !element.closest("[hidden], [inert]")
        && element.getClientRects().length > 0
      ));
      return document.activeElement === focusable[0];
    }, focusableSelector)).toBe(true);
    const title = side.locator(`[data-resource-title="${FIXTURE_IDS.resource}"]`);
    await expect(title).toBeVisible();
    expect(await title.evaluate((element) => {
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
      return element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight >= lineHeight * 1.8;
    })).toBe(true);
    for (const selector of [
      `[data-resource-copy-link="${FIXTURE_IDS.resource}"]`,
      `[data-resource-comments-toggle="${FIXTURE_IDS.resource}"]`,
      `[data-resource-create-child="${FIXTURE_IDS.resource}"]`,
      `[data-resource-page-menu="${FIXTURE_IDS.resource}"]`,
    ]) {
      const action = side.locator(selector).first();
      await expect(action).toBeVisible();
      const box = await action.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(390);
    }
    const toolbar = side.locator(`[data-resource-mobile-toolbar="${FIXTURE_IDS.resource}"]`);
    await expect(toolbar).toBeVisible();
    for (const button of await toolbar.locator("button").all()) {
      const box = await button.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await toolbar.locator('[data-resource-mobile-action="properties"]').click();
    await expect(side.locator(`[data-resource-props="${FIXTURE_IDS.resource}"]`)).toHaveAttribute("aria-expanded", "true");
    const pageControlViolations = await side.evaluate((shell) => {
      const selectors = [
        ".resource-page-toolbar button",
        ".resource-props-toggle",
        ".resource-props button",
        ".resource-props a",
        ".resource-props select",
        ".resource-props input:not([type='checkbox']):not([type='range'])",
        ".resource-page-relations button",
        ".resource-page-relations select",
        ".resource-mobile-toolbar button",
      ];
      return [...shell.querySelectorAll(selectors.join(","))]
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { label: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName, width: rect.width, height: rect.height };
        })
        .filter((entry) => entry.width < 44 || entry.height < 44);
    });
    expect(pageControlViolations).toEqual([]);

    await side.locator(`[data-resource-comments-toggle="${FIXTURE_IDS.resource}"]`).first().click();
    const comments = side.locator(`[data-resource-comments-pane="${FIXTURE_IDS.resource}"]`);
    await expect(comments).toBeVisible();
    const commentControlViolations = await comments.evaluate((pane) => [...pane.querySelectorAll("button, textarea")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { label: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName, width: rect.width, height: rect.height };
      })
      .filter((entry) => entry.width < 44 || entry.height < 44));
    expect(commentControlViolations).toEqual([]);

    const commentClearance = await comments.evaluate((pane) => {
      pane.scrollTop = pane.scrollHeight;
      const shell = pane.closest("[data-resource-note]");
      const toolbar = shell.querySelector("[data-resource-mobile-toolbar]");
      const lastAction = [...pane.querySelectorAll("button")].at(-1);
      const actionRect = lastAction.getBoundingClientRect();
      const toolbarRect = toolbar.getBoundingClientRect();
      return { actionBottom: actionRect.bottom, toolbarTop: toolbarRect.top };
    });
    expect(commentClearance.actionBottom).toBeLessThanOrEqual(commentClearance.toolbarTop - 4);
    await comments.locator(`[data-resource-comments-toggle="${FIXTURE_IDS.resource}"]`).click();

    for (const width of [375, 360, 320]) {
      await page.setViewportSize({ width, height: 760 });
      side = resourceShell(page, "side");
      await expect(side).toBeVisible();
      expect(await side.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await expect(side.locator(`[data-resource-mobile-toolbar="${FIXTURE_IDS.resource}"]`)).toBeVisible();
    }
  });
});
