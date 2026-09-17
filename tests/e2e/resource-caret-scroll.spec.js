import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const resourceId = FIXTURE_IDS.bodySearchResource;
const paragraph = (id, text = "") => ({ id, type: "paragraph", text, marks: [], indent: 0, checked: false, collapsed: false });
const targetText = `${Array.from({ length: 18 }, (_, index) => `같은 문단 ${index}의 설명입니다.`).join("\n")}\n수식: `;

async function openLongDocument(page, request, width) {
  await page.setViewportSize({ width, height: 900 });
  await resetFixture(request);
  const snapshot = await fixtureSnapshot(request);
  const resource = snapshot.state.resources.find((entry) => entry.id === resourceId);
  resource.blocks = [
    ...Array.from({ length: 35 }, (_, index) => paragraph(`preceding-${index}`, `앞 문서 ${index}의 설명입니다.`)),
    paragraph("target", targetText),
  ];
  const response = await request.put("/api/state", {
    headers: { "If-Match": `"state-${snapshot.serverRevision}"` },
    data: { state: snapshot.state, baseRevision: snapshot.serverRevision },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-nav-key="resources"]').evaluate((button) => button.click());
  await page.locator(`[data-resource-open="${resourceId}"]`).click();
  const target = page.locator('[data-block-content="target"]');
  await expect.poll(() => target.evaluate((element) => element.closest(".resource-window").getAnimations().every((animation) => animation.playState !== "running"))).toBe(true);
  await target.evaluate((element) => {
    element.focus({ preventScroll: true });
    setSelectionOffsets(element, element.textContent.length);
    const document = element.closest(".resource-document");
    document.scrollTop = document.scrollHeight;
  });
  await nextPaint(page);
  return target;
}

async function nextPaint(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function geometry(content) {
  return content.evaluate((element) => {
    const document = element.closest(".resource-document");
    const rect = document.getBoundingClientRect();
    const caret = caretRectFor(element);
    return {
      scroll: document.scrollTop,
      gap: Math.min(rect.bottom, window.visualViewport?.height || innerHeight) - caret.bottom,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      padding: Number.parseFloat(getComputedStyle(document).paddingBottom),
      text: element.textContent,
    };
  });
}

for (const width of [1440, 390]) {
  test(`live dollar equation and following text retain the scroll position at ${width}px`, async ({ page, request }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const content = await openLongDocument(page, request, width);
    const before = await geometry(content);
    const samples = [before];
    for (const character of "$$x+y$$ next") {
      await content.pressSequentially(character);
      await nextPaint(page);
      samples.push(await geometry(content));
    }
    expect(samples.every((sample) => Math.abs(sample.scroll - before.scroll) <= 2), JSON.stringify(samples)).toBe(true);
    await expect(content.locator('[data-inline-mark="equation"]')).toHaveCount(1);
    expect(await content.evaluate((element) => element.textContent)).toBe(`${targetText}x+y next`);
    await expect.poll(async () => {
      const snapshot = await fixtureSnapshot(request);
      return snapshot.state.resources.find((resource) => resource.id === resourceId).blocks.find((block) => block.id === "target");
    }).toMatchObject({ text: `${targetText}x+y next`, marks: [{ type: "equation", start: targetText.length, end: targetText.length + 3, formula: "x+y" }] });
    // Consecutive key events can arrive before the scheduled caret frame.
    await content.pressSequentially(" $$z^2$$ next");
    await nextPaint(page);
    const rapid = await geometry(content);
    expect(Math.abs(rapid.scroll - before.scroll), JSON.stringify(rapid)).toBeLessThanOrEqual(2);
    await expect(content.locator('[data-inline-mark="equation"]')).toHaveCount(2);
    samples.push(rapid);
    await expect.poll(async () => {
      const snapshot = await fixtureSnapshot(request);
      return snapshot.state.resources.find((resource) => resource.id === resourceId).blocks.find((block) => block.id === "target")?.text;
    }).toBe(`${targetText}x+y next z^2 next`);
    await writeFile(testInfo.outputPath(`live-equation-scroll-${width}.json`), JSON.stringify(samples, null, 2));
    await page.screenshot({ path: testInfo.outputPath(`live-equation-scroll-${width}.png`) });
    await page.reload();
    await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
    if (!(await content.isVisible())) await page.locator(`[data-resource-open="${resourceId}"]`).click();
    await expect(content.locator('[data-inline-mark="equation"]')).toHaveCount(2);
    expect(await content.evaluate((element) => element.textContent)).toBe(`${targetText}x+y next z^2 next`);
  });

  test(`repeated bottom Enter leaves three lines below the caret at ${width}px`, async ({ page, request }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openLongDocument(page, request, width);
    const samples = [];
    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press("Enter");
      await nextPaint(page);
      const content = page.locator('[data-block-content]:focus');
      await expect(content).toBeVisible();
      await expect.poll(async () => {
        const sample = await geometry(content);
        return sample.gap - sample.lineHeight * 3;
      }).toBeGreaterThanOrEqual(-1.5);
      const sample = await geometry(content);
      samples.push(sample);
      expect(sample.gap, JSON.stringify(samples)).toBeGreaterThanOrEqual(sample.lineHeight * 3 - 1.5);
      expect(sample.padding).toBe(width === 390 ? 102 : 162);
      if (index) expect(sample.scroll).toBeGreaterThanOrEqual(samples[index - 1].scroll);
      // Native key events reproduce WebKit's first-character scroll; insertText does not.
      await page.keyboard.type(`following text ${index}`);
      await nextPaint(page);
      const typed = await geometry(content);
      await writeFile(testInfo.outputPath(`bottom-enter-typing-${width}.json`), JSON.stringify({ samples, typed }, null, 2));
      expect(Math.abs(typed.scroll - sample.scroll), JSON.stringify({ sample, typed })).toBeLessThanOrEqual(2);
      expect(typed.gap, JSON.stringify({ sample, typed })).toBeGreaterThanOrEqual(sample.gap - 2);
    }
    expect(samples.at(-1).scroll).toBeGreaterThan(samples[0].scroll + 100);
    await writeFile(testInfo.outputPath(`bottom-enter-${width}.json`), JSON.stringify(samples, null, 2));
    await page.screenshot({ path: testInfo.outputPath(`bottom-enter-${width}.png`) });
  });

  test(`bottom caret scrolling animates and settles with three lines at ${width}px`, async ({ page, request }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const content = await openLongDocument(page, request, width);
    await content.evaluate((element) => {
      const document = element.closest(".resource-document");
      const gap = document.getBoundingClientRect().bottom - caretRectFor(element).bottom;
      document.scrollTop -= gap;
      window.__caretScrollFrames = [];
      window.__caretScrollSampling = true;
      const sample = (time) => {
        window.__caretScrollFrames.push({ time, scroll: document.scrollTop });
        if (window.__caretScrollSampling) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const before = await geometry(content);
    await page.keyboard.press("Enter");
    const next = page.locator('[data-block-content]:focus');
    await expect.poll(async () => (await geometry(next)).gap).toBeGreaterThanOrEqual(before.lineHeight * 3 - 1.5);
    await page.evaluate(() => new Promise((resolve) => {
      const start = performance.now();
      const settle = (time) => time - start >= 500 ? resolve() : requestAnimationFrame(settle);
      requestAnimationFrame(settle);
    }));
    await page.evaluate(() => { window.__caretScrollSampling = false; });
    await nextPaint(page);
    const after = await geometry(next);
    const frames = await page.evaluate(() => window.__caretScrollFrames);
    const intermediate = frames.filter(({ scroll }) => scroll > before.scroll + 1 && scroll < after.scroll - 1);
    expect(after.scroll).toBeGreaterThan(before.scroll + 20);
    expect(new Set(intermediate.map(({ scroll }) => Math.round(scroll))).size, JSON.stringify({ before, after, frames })).toBeGreaterThanOrEqual(2);
    const start = frames[Math.max(0, frames.findIndex(({ scroll }) => scroll > before.scroll + 0.5) - 1)];
    const finish = frames.find(({ scroll }) => scroll >= after.scroll - 0.5);
    const curve = intermediate.map((frame) => Math.abs(
      (frame.scroll - start.scroll) / (finish.scroll - start.scroll)
      - (frame.time - start.time) / (finish.time - start.time),
    ));
    // A 12% departure from linear progress exceeds one-pixel scroll rounding.
    expect(Math.max(...curve), JSON.stringify({ before, after, frames })).toBeGreaterThan(0.12);
    await page.keyboard.type("following text");
    await nextPaint(page);
    const typed = await geometry(next);
    await writeFile(testInfo.outputPath(`smooth-enter-typing-${width}.json`), JSON.stringify({ before, after, typed, frames }, null, 2));
    expect(Math.abs(typed.scroll - after.scroll), JSON.stringify({ after, typed })).toBeLessThanOrEqual(2);
    expect(typed.gap, JSON.stringify({ after, typed })).toBeGreaterThanOrEqual(after.gap - 2);
    await writeFile(testInfo.outputPath(`smooth-enter-${width}.json`), JSON.stringify({ before, after, frames }, null, 2));
  });

  test(`typing during bottom Enter scrolling preserves reserve without reversing at ${width}px`, async ({ page, request }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const content = await openLongDocument(page, request, width);
    await content.evaluate((element) => {
      const document = element.closest(".resource-document");
      const gap = document.getBoundingClientRect().bottom - caretRectFor(element).bottom;
      document.scrollTop -= gap - Number.parseFloat(getComputedStyle(element).lineHeight) * 3;
      window.__caretScrollFrames = [];
      window.__caretScrollSampling = true;
      const sample = (time) => {
        const active = globalThis.document.querySelector("[data-block-content]:focus");
        const caret = active && caretRectFor(active);
        window.__caretScrollFrames.push({ time, scroll: document.scrollTop, gap: caret ? document.getBoundingClientRect().bottom - caret.bottom : null });
        if (window.__caretScrollSampling) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const before = await geometry(content);
    const samples = [];
    for (let index = 0; index < 5; index += 1) {
      await page.keyboard.press("Enter");
      await page.keyboard.type(`following text ${index}`, { delay: 4 });
      await page.evaluate(() => new Promise((resolve) => {
        const start = performance.now();
        const settle = (time) => time - start >= 350 ? resolve() : requestAnimationFrame(settle);
        requestAnimationFrame(settle);
      }));
      samples.push(await geometry(page.locator('[data-block-content]:focus')));
    }
    await page.evaluate(() => { window.__caretScrollSampling = false; });
    await nextPaint(page);
    const frames = await page.evaluate(() => window.__caretScrollFrames);
    await writeFile(testInfo.outputPath(`rapid-enter-typing-${width}.json`), JSON.stringify({ before, samples, frames }, null, 2));
    expect(samples.every((sample) => sample.gap >= sample.lineHeight * 3 - 1.5), JSON.stringify(samples)).toBe(true);
    expect(samples.every((sample) => sample.gap <= before.gap + 2), JSON.stringify(samples)).toBe(true);
    expect(frames.every((frame, index) => !index || frame.scroll >= frames[index - 1].scroll - 1), JSON.stringify(frames)).toBe(true);
  });
}
