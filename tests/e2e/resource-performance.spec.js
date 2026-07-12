import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, resetFixture } from "./helpers.js";

const BLOCK_COUNT = 400;

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("a 400-block Resource stays within the local render and interaction budgets", async ({ page, request }, testInfo) => {
  const stateResponse = await request.get("/api/state");
  const etag = stateResponse.headers().etag;
  const current = await stateResponse.json();
  const resource = current.state.resources.find((entry) => entry.id === FIXTURE_IDS.resource);
  resource.commentThreads = [];
  resource.blocks = Array.from({ length: BLOCK_COUNT }, (_, index) => ({
    id: `performance-block-${index}`,
    type: index % 25 === 0 ? "heading2" : index % 11 === 0 ? "bullet" : "paragraph",
    text: `Performance block ${index} with deterministic fixture content`,
    marks: [],
    checked: false,
    indent: index % 11 === 0 ? index % 3 : 0,
    collapsed: false,
  }));
  const write = await request.put("/api/state", {
    headers: { "If-Match": etag },
    data: { state: current.state, baseRevision: current.revision },
  });
  expect(write.ok()).toBeTruthy();

  await page.addInitScript(() => {
    window.__resourceLongTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__resourceLongTasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
    } catch {}
  });

  const wallStart = Date.now();
  await page.goto(`/resources/${FIXTURE_IDS.resource}`);
  const shell = page.locator(`[data-resource-note="${FIXTURE_IDS.resource}"]`);
  await expect(shell).toBeVisible();
  await expect(shell.locator(".block[data-block-id]")).toHaveCount(BLOCK_COUNT);
  const readyMs = Date.now() - wallStart;

  const metrics = await shell.evaluate(async (element) => {
    const twoFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const props = element.querySelector("[data-resource-props]");
    const propertyStart = performance.now();
    props.click();
    await twoFrames();
    const propertyPatchMs = performance.now() - propertyStart;

    const scroll = element.querySelector(".resource-note-scroll");
    const scrollStart = performance.now();
    scroll.scrollTop = scroll.scrollHeight;
    await twoFrames();
    const scrollResponseMs = performance.now() - scrollStart;
    const longTasks = [...(window.__resourceLongTasks || [])];
    return {
      shellDomNodes: element.querySelectorAll("*").length,
      propertyPatchMs,
      scrollResponseMs,
      maxLongTaskMs: longTasks.length ? Math.max(...longTasks) : 0,
      totalLongTaskMs: longTasks.reduce((sum, duration) => sum + duration, 0),
      longTaskCount: longTasks.length,
    };
  });
  metrics.readyMs = readyMs;
  console.log(`RESOURCE_PERFORMANCE ${JSON.stringify(metrics)}`);

  await testInfo.attach("resource-performance.json", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
  expect(metrics.readyMs).toBeLessThan(5_000);
  expect(metrics.shellDomNodes).toBeLessThan(10_000);
  expect(metrics.propertyPatchMs).toBeLessThan(500);
  expect(metrics.scrollResponseMs).toBeLessThan(500);
  expect(metrics.maxLongTaskMs).toBeLessThan(750);
  expect(metrics.totalLongTaskMs).toBeLessThan(2_000);
});
