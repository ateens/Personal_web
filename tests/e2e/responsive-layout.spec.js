import { expect, test } from "@playwright/test";
import { FIXTURE_IDS, fixtureSnapshot, resetFixture } from "./helpers.js";

const views = ["today", "tasks", "projects", "boxes", "resources", "habits", "journal", "calendar", "database"];

for (const width of [390, 768, 1440]) {
  test(`workspace layouts at ${width}px`, async ({ page, request }, testInfo) => {
    await resetFixture(request);
    const snapshot = await fixtureSnapshot(request);
    const state = structuredClone(snapshot.state);
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
    state.projects[0].startDate = date;
    state.projects[0].endDate = date;
    state.tasks = [{ id: "responsive-task", title: "모바일에서도 읽을 수 있어야 하는 긴 할 일 제목", status: "todo", boxId: FIXTURE_IDS.box, projectId: FIXTURE_IDS.project, dueDate: date, completedAt: "", blocks: [] }];
    state.captures = [{ id: "responsive-capture", title: "수집한 자료를 적절한 곳에 정리하기", url: "https://example.com/research/mobile-layout-review", createdAt: new Date().toISOString() }];
    state.journals = [{ id: "responsive-journal", title: "오늘의 기록과 다음 행동", date, satisfaction: 7, blocks: [] }];
    state.habits = [{ id: "responsive-habit", title: "꾸준히 읽고 기록하는 루틴", status: "active", target: "매일 30분", boxId: FIXTURE_IDS.box, projectId: "", blocks: [] }];
    const saved = await request.put("/api/state", {
      headers: { "If-Match": `"state-${snapshot.serverRevision}"` },
      data: { state, baseRevision: snapshot.serverRevision, e2eFixtureGeneration: snapshot.resetGeneration },
    });
    expect(saved.ok()).toBeTruthy();
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
    for (const view of views) {
      const button = page.locator(`[data-nav-key="${view}"]`);
      if (!(await page.locator(".sidebar-shell").evaluate((element) => element.classList.contains("is-open")))) await page.locator('[data-action="toggle-nav"]').click();
      await button.click();
      await expect(button).toHaveAttribute("aria-current", "page");
      await expect(button).toHaveAccessibleName(/\S/);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: testInfo.outputPath(`${view}-${width}.png`), fullPage: true });
      const layout = await page.locator("#viewRoot").evaluate((root) => {
        const viewport = document.documentElement.clientWidth;
        const overflowing = [...root.querySelectorAll("*")].filter((element) => {
          if (!element.checkVisibility() || getComputedStyle(element).position === "fixed") return false;
          const rect = element.getBoundingClientRect();
          if (rect.width < 1 || (rect.left >= -1 && rect.right <= viewport + 1)) return false;
          for (let ancestor = element.parentElement; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
            if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(ancestor).overflowX)) return false;
          }
          return true;
        }).map((element) => ({ tag: element.tagName, class: element.className, width: Math.round(element.getBoundingClientRect().width), left: Math.round(element.getBoundingClientRect().left), right: Math.round(element.getBoundingClientRect().right) }));
        return { viewport, documentWidth: document.documentElement.scrollWidth, rootWidth: root.scrollWidth, overflowing: overflowing.slice(0, 12) };
      });
      expect.soft(layout.documentWidth, `${view} viewport width`).toBeLessThanOrEqual(width);
      expect.soft(layout.overflowing, `${view} overflowing content`).toEqual([]);
      if (view === "database") {
        const wordLines = await page.locator(".view-title").evaluate((element) => {
          const text = element.firstChild;
          const start = text.textContent.indexOf("모델");
          const range = document.createRange();
          range.setStart(text, start);
          range.setEnd(text, start + 2);
          return range.getClientRects().length;
        });
        expect.soft(wordLines, "Korean heading words stay together").toBe(1);
      }
      if (view === "projects" || view === "habits") {
        const geometry = await page.locator(view === "projects" ? ".project-row" : ".habit-row").first().evaluate((row) => {
          const title = row.querySelector("h3").getBoundingClientRect();
          const actions = row.querySelector('[class$="-actions"]').getBoundingClientRect();
          const chevron = row.querySelector(".project-chevron").getBoundingClientRect();
          return { titleWidth: title.width, actionsRight: actions.right, chevronLeft: chevron.left };
        });
        expect.soft(geometry.titleWidth, `${view} title remains readable`).toBeGreaterThan(80);
        expect.soft(geometry.chevronLeft, `${view} chevron clears actions`).toBeGreaterThan(geometry.actionsRight);
        if (view === "projects") {
          const trackWidth = await page.locator(".project-progress-track").first().evaluate((element) => element.getBoundingClientRect().width);
          expect.soft(trackWidth, "project progress remains visible").toBeGreaterThan(100);
        }
      }
      if (view === "calendar") {
        const disclosure = await page.locator(".view-controls-disclosure").boundingBox();
        const switcher = await page.locator(".calendar-view-switcher").boundingBox();
        if (width <= 840) expect.soft(switcher.y).toBeGreaterThanOrEqual(disclosure.y + disclosure.height);
        await page.locator(".view-controls-disclosure").click();
        const controls = await page.locator(".view-controls").boundingBox();
        expect.soft(controls.y, "expanded filters clear their disclosure").toBeGreaterThanOrEqual(disclosure.y + disclosure.height);
      }
    }
    expect(errors).toEqual([]);
  });
}

test("update notice leaves navigation and quick creation usable", async ({ page, request }, testInfo) => {
  await resetFixture(request);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.evaluate(() => {
    serviceWorkerUpdateAvailable = true;
    renderServiceWorkerUpdateNoticeIfNeeded();
  });
  await expect(page.locator(".service-worker-update")).toBeVisible();
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const nav = page.locator('[data-action="toggle-nav"]');
    const notice = await page.locator(".service-worker-update").boundingBox();
    const navBounds = await nav.boundingBox();
    expect(notice.y + notice.height).toBeLessThan(navBounds.y);
    await expect(page.locator(".topbar input")).toBeVisible();
    await expect.poll(() => nav.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return hit === element || element.contains(hit);
    })).toBe(true);
    await expect.poll(() => page.locator('[data-action="open-command"]').evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return hit === element || element.contains(hit);
    })).toBe(true);
    await nav.click();
    await expect.poll(() => page.locator(".nav-button").evaluateAll((buttons) => buttons.filter((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return hit !== element && !element.contains(hit);
    }).map((element) => element.dataset.navKey))).toEqual([]);
    await page.locator('[data-nav-key="projects"]').click();
    await expect(page.locator('[data-nav-key="projects"]')).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".sidebar-shell")).not.toHaveClass(/is-open/);
    await page.screenshot({ path: testInfo.outputPath(`update-notice-${width}.png`) });
  }
});

test("project rows remain usable beside a docked resource and when expanded", async ({ page, request }, testInfo) => {
  await resetFixture(request);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-workspace-authority", "ready");
  await page.locator('[data-action="toggle-nav"]').click();
  await page.locator('[data-nav-key="resources"]').click();
  await page.locator(`[data-resource-open="${FIXTURE_IDS.resource}"]`).click();
  const resource = page.locator(`[data-resource-window="${FIXTURE_IDS.resource}"]`);
  const bar = await resource.locator("[data-resource-window-drag]").boundingBox();
  await page.mouse.move(bar.x + 100, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(1430, 60, { steps: 12 });
  await page.mouse.up();
  await expect(resource).toHaveAttribute("data-docked", "true");
  await page.locator('[data-action="toggle-nav"]').click();
  await page.locator('[data-nav-key="projects"]').click();
  const row = page.locator(`[data-project-toggle="${FIXTURE_IDS.project}"]`);
  for (const expanded of [false, true]) {
    if (expanded) await row.click();
    await expect(row).toHaveAttribute("aria-expanded", String(expanded));
    await page.mouse.move(0, 0);
    const title = await row.locator("h3").boundingBox();
    const progress = await row.locator(".project-progress-track").boundingBox();
    expect(title.width).toBeGreaterThan(80);
    expect(progress.width).toBeGreaterThan(100);
    const bounds = await row.boundingBox();
    const dock = await resource.boundingBox();
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(dock.x + 1);
  }
  await page.screenshot({ path: testInfo.outputPath("project-docked-expanded.png"), fullPage: true });
  const resize = await resource.locator('[data-resource-resize="w"]').boundingBox();
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
  await page.mouse.down();
  await page.mouse.move(1435, resize.y + resize.height / 2, { steps: 12 });
  await page.mouse.up();
  expect((await resource.boundingBox()).width).toBe(300);
  expect(await resource.locator('[data-resource-relations]').evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("resource-relations-300px.png") });
});

for (const width of [390, 768, 1440]) {
  test(`finance layouts at ${width}px`, async ({ page, request }, testInfo) => {
    await resetFixture(request);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/finance");
    await page.getByLabel("가계부 비밀번호").fill("finance-e2e-password");
    await page.getByRole("button", { name: "가계부 열기" }).click();
    await expect(page.locator('[data-finance-screen="dashboard"]')).toBeVisible();
    for (const tab of ["overview", "entries", "accounts", "cards", "fixed", "stats"]) {
      await page.locator(`.finance-tabs [data-finance-tab="${tab}"]`).click();
      await page.mouse.move(0, 0);
      await expect(page.locator(`[data-finance-tab-panel="${tab}"]`)).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${tab}-${width}.png`), fullPage: true });
      const overflowing = await page.locator(".finance-view").evaluate((root) => [...root.querySelectorAll("*")].filter((element) => {
        if (!element.checkVisibility() || getComputedStyle(element).position === "fixed") return false;
        const rect = element.getBoundingClientRect();
        if (!rect.width || (rect.left >= -1 && rect.right <= innerWidth + 1)) return false;
        for (let ancestor = element.parentElement; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
          if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(ancestor).overflowX)) return false;
        }
        return true;
      }).map((element) => ({ tag: element.tagName, class: element.className, right: Math.round(element.getBoundingClientRect().right) })));
      expect.soft(overflowing, `${tab} finance overflow`).toEqual([]);
    }
  });
}
