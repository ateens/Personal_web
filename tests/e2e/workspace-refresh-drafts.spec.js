import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

test.beforeEach(async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
});

async function updateRemoteWorkspace(request, mutate) {
  const snapshot = await fixtureSnapshot(request);
  mutate(snapshot.state);
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${snapshot.serverRevision}"` },
    data: { state: snapshot.state, baseRevision: snapshot.serverRevision },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return snapshot.serverRevision + 1;
}

test("remote refresh preserves an uncommitted inline field and merges its change with the latest workspace", async ({ page, request }) => {
  await page.locator('[data-action="toggle-nav"]').click();
  await page.locator('[data-nav-key="projects"]').click();
  await page.locator(`[data-project-edit="${FIXTURE_IDS.project}"]`).click();
  const input = page.locator(`[data-inline-owner-type="projects"][data-inline-owner-id="${FIXTURE_IDS.project}"] [data-field="name"]`);
  await input.fill("Draft project name");
  await input.evaluate((element) => { window.__draftInput = element; });

  const revision = await updateRemoteWorkspace(request, (state) => { state.boxes[0].name = "Remote box name"; });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => page.evaluate(() => currentWorkspaceRevision())).toBe(revision);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Draft project name");
  expect(await input.evaluate((element) => element === window.__draftInput)).toBe(true);

  await input.press("Tab");
  await expect.poll(async () => {
    const snapshot = await fixtureSnapshot(request);
    return [snapshot.state.projects.find((project) => project.id === FIXTURE_IDS.project)?.name, snapshot.state.boxes[0].name];
  }).toEqual(["Draft project name", "Remote box name"]);
});

test("remote navigation order updates while a Resource keeps its drafting focus", async ({ page, request }) => {
  await page.locator('[data-action="toggle-nav"]').click();
  await page.locator('[data-nav-key="resources"]').click();
  await page.locator(`[data-resource-open="${FIXTURE_IDS.resource}"]`).evaluate((element) => element.click());
  const body = page.locator(`[data-resource-window="${FIXTURE_IDS.resource}"] [data-block-content]`).first();
  await body.focus();
  await body.evaluate((element) => { window.__draftInput = element; });
  const revision = await updateRemoteWorkspace(request, (state) => { state.settings.navOrder.reverse(); });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => page.evaluate(() => currentWorkspaceRevision())).toBe(revision);
  const expectedOrder = (await fixtureSnapshot(request)).state.settings.navOrder;
  await expect.poll(() => page.locator('[data-nav-key]:not([data-nav-fixed])').evaluateAll((buttons) => buttons.map((button) => button.dataset.navKey))).toEqual(expectedOrder);
  await expect(body).toBeFocused();
  expect(await body.evaluate((element) => element === window.__draftInput)).toBe(true);
});

for (const kind of ["link", "equation"]) {
  test(`remote refresh preserves the inline ${kind} draft through pointer Apply`, async ({ page, request }) => {
    await page.locator('[data-action="toggle-nav"]').click();
    await page.locator('[data-nav-key="resources"]').click();
    await page.locator(`[data-resource-open="${FIXTURE_IDS.resource}"]`).evaluate((element) => element.click());
    await page.locator(`[data-resource-window="${FIXTURE_IDS.resource}"] [data-block-content]`).first().evaluate((element, kind) => {
      const editor = element.closest(".block-editor");
      const open = kind === "link" ? openLinkPopover : openEquationPopover;
      open(editor.dataset.ownerType, editor.dataset.ownerId, element.dataset.blockContent, { start: 0, end: 4, collapsed: false });
    }, kind);
    const draft = kind === "link" ? "https://example.com/retained-draft" : "a+b=c";
    const input = page.locator(`[data-inline-${kind}-input]`);
    await input.fill(draft);
    const revision = await updateRemoteWorkspace(request, (state) => { state.boxes[0].name = "Remote box name"; });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => page.evaluate(() => currentWorkspaceRevision())).toBe(revision);
    await expect(input).toHaveValue(draft);
    const button = page.locator(`[data-inline-${kind}-popover] button[type="submit"]`);
    const bounds = await button.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
    await expect(input).toHaveCount(0);
    await expect.poll(async () => {
      const resource = (await fixtureSnapshot(request)).state.resources.find((entry) => entry.id === FIXTURE_IDS.resource);
      return resource.blocks[0].marks.find((mark) => mark.type === kind)?.[kind === "link" ? "href" : "formula"];
    }).toBe(draft);
  });
}

test("changing views starts at the top while soft rendering preserves the current scroll", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const revision = await updateRemoteWorkspace(request, (state) => {
    state.projects.push(...Array.from({ length: 20 }, (_, index) => ({ ...state.projects[0], id: `scroll-project-${index}`, name: `Scroll project ${index}`, blocks: [] })));
    state.boxes.push(...Array.from({ length: 20 }, (_, index) => ({ ...state.boxes[0], id: `scroll-box-${index}`, name: `Scroll box ${index}`, blocks: [] })));
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => page.evaluate(() => currentWorkspaceRevision())).toBe(revision);
  await page.locator('[data-action="toggle-nav"]').click();
  await page.locator('[data-nav-key="projects"]').click();
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  await page.locator('[data-action="toggle-nav"]').click();
  await page.locator('[data-nav-key="boxes"]').click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 600));
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(200);
  await page.evaluate(() => renderView({ soft: true }));
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});
