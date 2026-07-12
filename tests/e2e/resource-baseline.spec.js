import { expect, test } from "@playwright/test";
import {
  FIXTURE_IDS,
  fixtureSnapshot,
  openMainResourceFromList,
  openResources,
  resetFixture,
  selectResourceMode,
} from "./helpers.js";

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
});

const RESOURCE_CONTROL_PATCH_CASES = [
  {
    name: "filter",
    prepareSelector: '[data-view-control-panel-toggle="resources"][data-control-panel="filter"]',
    actionSelector: '[data-view-control-choice="resources"][data-control-field="filter"][data-control-value="important"]',
    expectedSelector: '[data-view-control-choice="resources"][data-control-field="filter"][data-control-value="important"][aria-pressed="true"]',
    expectedState: (control) => control.filters.includes("important"),
  },
  {
    name: "sort",
    prepareSelector: '[data-view-control-panel-toggle="resources"][data-control-panel="sort"]',
    actionSelector: '[data-view-control-choice="resources"][data-control-field="sort"][data-control-value="title"]',
    expectedSelector: '[data-view-control-choice="resources"][data-control-field="sort"][data-control-value="title"][aria-pressed="true"]',
    expectedState: (control) => control.sort === "title",
  },
  {
    name: "mode",
    actionSelector: '[data-view-control-mode="resources"][data-control-mode="map"]',
    expectedSelector: '[data-resource-view="map"]',
    expectedState: (control) => control.mode === "map",
  },
];

async function openSideResourceDatabaseContext(page) {
  await openResources(page);
  const search = page.locator('[data-view-control-search="resources"]');
  await search.fill("Fixture");
  await selectResourceMode(page, "list");
  await page.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`).first().click();
  const side = page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"][data-resource-shell="side"]`);
  await expect(side).toBeVisible();
  return { search, side };
}

async function captureResourcePatchIdentity(page) {
  await page.evaluate(() => {
    document.documentElement.style.minHeight = "2400px";
    document.body.style.minHeight = "2400px";
    const search = document.querySelector('[data-view-control-search="resources"]');
    search.focus();
    search.setSelectionRange(1, 5, "backward");
    search.__resourcePatchCompositionEnds = 0;
    search.addEventListener("compositionend", () => {
      search.__resourcePatchCompositionEnds += 1;
    });
    search.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    window.scrollTo(0, 137);
    window.__resourcePatchIdentity = {
      viewRoot: document.querySelector("#viewRoot"),
      search,
      side: document.querySelector('[data-resource-note][data-resource-shell="side"]'),
    };
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(137);
}

test("production guard uses only the isolated in-memory state", async ({ request }) => {
  const status = await request.get("/api/state/status");
  expect(status.ok()).toBeTruthy();
  expect(status.headers()["x-e2e-fixture"]).toBe("memory-only");
  expect(status.headers()["x-e2e-production-write-guard"]).toBe("active");
  expect(await status.json()).toMatchObject({
    appStateId: FIXTURE_IDS.appState,
    tokenStore: "memory",
    relationalStore: "memory",
  });

  const snapshot = await fixtureSnapshot(request);
  expect(snapshot).toMatchObject({
    backend: "memory",
    databaseAccess: false,
    productionWritesBlocked: true,
    appStateId: FIXTURE_IDS.appState,
    serverRevision: 1,
    writes: [],
  });
  expect(snapshot.appStateId).not.toBe("default");

  const stateResponse = await request.get("/api/state");
  const etag = stateResponse.headers().etag;
  expect(etag).toBe('"state-1"');
  const current = await stateResponse.json();
  const conditionalWrite = await request.put("/api/state", {
    headers: { "If-Match": etag },
    data: { state: current.state, baseRevision: 1 },
  });
  expect(conditionalWrite.status()).toBe(200);
  expect(conditionalWrite.headers().etag).toBe('"state-2"');

  const staleWrite = await request.put("/api/state", {
    headers: { "If-Match": etag },
    data: { state: current.state, baseRevision: 1 },
  });
  expect(staleWrite.status()).toBe(409);
  expect(await staleWrite.json()).toMatchObject({ code: "STATE_REVISION_CONFLICT", revision: 2 });
});

test("fixture generation rejects pre-reset stale writes before revision checks", async ({ request }) => {
  const first = await fixtureSnapshot(request);
  expect(first.serverRevision).toBe(1);
  expect(Number.isSafeInteger(first.resetGeneration)).toBeTruthy();

  await resetFixture(request);
  const reset = await fixtureSnapshot(request);
  expect(reset.serverRevision).toBe(1);
  expect(reset.resetGeneration).toBeGreaterThan(first.resetGeneration);

  const staleState = structuredClone(first.state);
  staleState.updatedAt = "2026-07-12T00:00:00.000Z";
  const staleWrite = await request.put("/api/state", {
    headers: { "If-Match": `"state-${first.serverRevision}"` },
    data: {
      state: staleState,
      baseRevision: first.serverRevision,
      e2eFixtureGeneration: first.resetGeneration,
    },
  });
  expect(staleWrite.status()).toBe(409);
  expect(await staleWrite.json()).toMatchObject({
    code: "E2E_FIXTURE_GENERATION_CONFLICT",
    revision: 1,
    resetGeneration: reset.resetGeneration,
  });

  const afterStale = await fixtureSnapshot(request);
  expect(afterStale.serverRevision).toBe(1);
  expect(afterStale.writes).toEqual([]);
  expect(afterStale.state).toEqual(reset.state);
  expect(afterStale.writeAttempts.at(-1)).toMatchObject({
    baseRevision: 1,
    suppliedGeneration: first.resetGeneration,
    resetGeneration: reset.resetGeneration,
    outcome: "generation-conflict",
  });

  const currentResource = structuredClone(reset.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource));
  currentResource.title = "Current generation write succeeds";
  const currentWrite = await request.put(`/api/resources/${encodeURIComponent(currentResource.id)}`, {
    headers: { "If-Match": `"state-${reset.serverRevision}"` },
    data: {
      resource: currentResource,
      baseRevision: reset.serverRevision,
      e2eFixtureGeneration: reset.resetGeneration,
    },
  });
  expect(currentWrite.status()).toBe(200);
  expect(await currentWrite.json()).toMatchObject({ revision: 2 });
  const afterCurrent = await fixtureSnapshot(request);
  expect(afterCurrent.serverRevision).toBe(2);
  expect(afterCurrent.state.resources.find((resource) => resource.id === FIXTURE_IDS.resource)?.title).toBe("Current generation write succeeds");
});

test("Resource preserves Library, List, and Map views", async ({ page, request }) => {
  await openResources(page);
  await expect(page.locator(`[data-select-id="${FIXTURE_IDS.resource}"]`).first()).toContainText("E2E Notion Parity Resource");
  const libraryIds = await page.locator('[data-resource-view="library"] [data-select-type="resources"][data-select-id]').evaluateAll((elements) => elements.map((element) => element.dataset.selectId));
  expect(new Set(libraryIds).size).toBe(libraryIds.length);

  await selectResourceMode(page, "list");
  await expect(page.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`)).toContainText("E2E Notion Parity Resource");

  await selectResourceMode(page, "map");
  await expect(page.locator(`[data-open-resource="${FIXTURE_IDS.resource}"]`)).toContainText("E2E Notion Parity Resource");

  await expect.poll(async () => (await fixtureSnapshot(request)).state.settings.viewControls.resources.mode).toBe("map");
});

for (const controlCase of RESOURCE_CONTROL_PATCH_CASES) {
  test(`Resource ${controlCase.name} minimally patches the open Side database context`, async ({ page, request }) => {
    const { search, side } = await openSideResourceDatabaseContext(page);
    if (controlCase.prepareSelector) {
      await page.locator(controlCase.prepareSelector).click();
      await expect(page.locator(controlCase.actionSelector)).toBeVisible();
    }
    await captureResourcePatchIdentity(page);

    await page.evaluate((selector) => document.querySelector(selector)?.click(), controlCase.actionSelector);
    await expect(page.locator(controlCase.expectedSelector)).toBeVisible();
    await expect.poll(async () => {
      const snapshot = await fixtureSnapshot(request);
      return controlCase.expectedState(snapshot.state.settings.viewControls.resources);
    }).toBe(true);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const preserved = await page.evaluate(() => {
      const refs = window.__resourcePatchIdentity;
      const currentSearch = document.querySelector('[data-view-control-search="resources"]');
      return {
        viewRoot: refs.viewRoot === document.querySelector("#viewRoot"),
        search: refs.search === currentSearch,
        side: refs.side === document.querySelector('[data-resource-note][data-resource-shell="side"]'),
        searchValue: currentSearch.value,
        selectionStart: currentSearch.selectionStart,
        selectionEnd: currentSearch.selectionEnd,
        selectionDirection: currentSearch.selectionDirection,
        compositionEnds: currentSearch.__resourcePatchCompositionEnds,
        scrollY: window.scrollY,
        pathname: window.location.pathname,
      };
    });
    expect(preserved).toEqual({
      viewRoot: true,
      search: true,
      side: true,
      searchValue: "Fixture",
      selectionStart: 1,
      selectionEnd: 5,
      selectionDirection: "backward",
      compositionEnds: 0,
      scrollY: 137,
      pathname: `/resources/${FIXTURE_IDS.resource}`,
    });
    await expect(side).toBeVisible();
    await expect(search).toHaveValue("Fixture");

    await search.evaluate((input) => {
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }));
    });
    await expect.poll(() => search.evaluate((input) => input.__resourcePatchCompositionEnds)).toBe(1);
  });
}

test("Resource opens and closes without changing fixture content", async ({ page, request }) => {
  const before = await fixtureSnapshot(request);
  const note = await openMainResourceFromList(page);
  await expect(note.locator('[data-resource-title="fixture-resource-main"]')).toHaveValue("E2E Notion Parity Resource");

  await note.locator(`[data-resource-close="${FIXTURE_IDS.resource}"]`).click();
  await expect(note).toHaveCount(0);

  const after = await fixtureSnapshot(request);
  expect(after.state.resources).toEqual(before.state.resources);
});

test("Resource renders every existing block type and inline mark", async ({ page }) => {
  const note = await openMainResourceFromList(page);
  const blockTypes = await note.locator("[data-block-id][data-type]").evaluateAll((blocks) => [...new Set(blocks.map((item) => item.dataset.type))]);
  expect(blockTypes.sort()).toEqual([
    "bullet",
    "callout",
    "code",
    "divider",
    "heading1",
    "heading2",
    "heading3",
    "numbered",
    "paragraph",
    "quote",
    "todo",
    "toggle",
  ]);

  const inline = note.locator(`[data-block-content="${FIXTURE_IDS.inlineBlock}"]`);
  for (const type of ["bold", "italic", "underline", "strike", "code", "link", "comment", "mention", "equation"]) {
    await expect(inline.locator(`[data-inline-mark="${type}"]`), `inline ${type} mark`).toHaveCount(1);
  }
});

test("unsafe inline-link schemes never become anchors in the local DOM", async ({ page, request }) => {
  const stateResponse = await request.get("/api/state");
  const etag = stateResponse.headers().etag;
  const current = await stateResponse.json();
  const resource = current.state.resources.find((entry) => entry.id === FIXTURE_IDS.resource);
  const block = resource.blocks.find((entry) => entry.id === FIXTURE_IDS.inlineBlock);
  block.marks.push(
    { type: "link", start: 0, end: 4, href: "javascript:alert(document.domain)" },
    { type: "link", start: 5, end: 11, href: "data:text/html,<script>alert(1)</script>" },
    { type: "link", start: 12, end: 21, href: "VbScRiPt:msgbox(1)" },
    { type: "link", start: 22, end: 28, href: "%6aavascript:alert(1)" },
    { type: "link", start: 29, end: 35, href: "&#106;avascript:alert(1)" },
  );
  const write = await request.put("/api/state", {
    headers: { "If-Match": etag },
    data: { state: current.state, baseRevision: current.revision },
  });
  expect(write.ok()).toBeTruthy();

  await page.reload();
  const note = await openMainResourceFromList(page);
  await expect(note.locator('a[href^="javascript:" i], a[href^="data:" i], a[href^="vbscript:" i], a[href^="%6a" i], a[href^="&" i]')).toHaveCount(0);
  await expect(note.locator(`[data-block-content="${FIXTURE_IDS.inlineBlock}"] [data-inline-mark="link"]`)).toHaveCount(1);
  await expect(note.locator(`[data-block-content="${FIXTURE_IDS.inlineBlock}"]`)).toContainText("Bold Italic");
});
