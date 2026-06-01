const STORAGE_KEY = "sygma-personal-web-state-v2";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

const NAV_ITEMS = [
  ["today", "오늘", "⌁"],
  ["inbox", "Inbox", "↧"],
  ["tasks", "Tasks", "✓"],
  ["projects", "Projects", "▦"],
  ["goals", "Goals", "◎"],
  ["boxes", "Boxes", "□"],
  ["resources", "Resources", "≡"],
  ["habits", "Habits", "◌"],
  ["journal", "Journal", "✎"],
  ["obstacles", "Issues", "!"],
  ["calendar", "Calendar", "◷"],
  ["database", "DB", "◇"],
];

const NAV_SHORTCUT_HOLD_MS = 500;
const NAV_SHORTCUT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "q", "w"];

const BLOCK_TYPES = {
  paragraph: ["텍스트", "T"],
  heading1: ["제목 1", "H1"],
  heading2: ["제목 2", "H2"],
  heading3: ["제목 3", "H3"],
  bullet: ["목록", "•"],
  numbered: ["번호 목록", "1."],
  todo: ["체크", "☑"],
  toggle: ["토글", "▸"],
  quote: ["인용", "❝"],
  callout: ["콜아웃", "!"],
  divider: ["구분선", "—"],
  code: ["코드", "</>"],
};

const STATUSES = {
  task: {
    todo: "할 일",
    scheduled: "예정",
    doing: "진행",
    waiting: "대기",
    someday: "나중에",
    done: "완료",
    canceled: "중단",
  },
  project: {
    unplanned: "계획 전",
    planned: "계획",
    active: "진행중",
    focus: "집중",
    paused: "중단",
    completed: "완료",
    canceled: "취소",
  },
  goal: {
    not_started: "시작 전",
    active: "진행 중",
    focus: "집중",
    paused: "중단",
    completed: "완료",
    canceled: "취소",
  },
  obstacle: {
    open: "열림",
    watching: "관찰",
    mitigated: "완화",
    resolved: "해결",
    archived: "보관",
  },
};

const DB_SCHEMA = [
  {
    key: "captures",
    label: "Captures",
    fields: ["title", "url", "status", "convertedTo", "createdAt"],
    relations: ["분류 후 Task/Project/Goal/Resource로 연결"],
  },
  {
    key: "boxes",
    label: "Boxes",
    fields: ["name", "visibility", "color", "blocks"],
    relations: ["Goals", "Projects", "Tasks", "Resources", "Habits"],
  },
  {
    key: "goals",
    label: "Goals",
    fields: ["name", "status", "year", "quarter", "targetDate", "blocks"],
    relations: ["Box", "Projects", "Tasks", "Resources"],
  },
  {
    key: "projects",
    label: "Projects",
    fields: ["name", "status", "startDate", "endDate", "blocks"],
    relations: ["Box", "Goal", "Tasks", "Resources", "Obstacles"],
  },
  {
    key: "tasks",
    label: "Tasks",
    fields: ["title", "dueDate", "completedAt", "blocks"],
    relations: ["Box", "Goal", "Project", "Resource"],
  },
  {
    key: "resources",
    label: "Resources",
    fields: ["title", "type", "importance", "url", "pinned", "readLater", "blocks"],
    relations: ["Box", "Goal", "Project", "Tasks"],
  },
  {
    key: "habits",
    label: "Habits",
    fields: ["title", "cadence", "target", "status", "blocks"],
    relations: ["Box", "Project", "Habit instances"],
  },
  {
    key: "journals",
    label: "Journals",
    fields: ["title", "date", "satisfaction", "blocks"],
    relations: ["reviewed Tasks/Projects through block references"],
  },
  {
    key: "obstacles",
    label: "Obstacles",
    fields: ["title", "status", "severity", "blocks"],
    relations: ["Box", "Project", "Task"],
  },
  {
    key: "settings",
    label: "Settings",
    fields: ["appMode", "notionSyncMode", "googleClientId", "googleCalendarId", "lastGoogleSyncAt"],
    relations: ["PWA", "Google Calendar", "final Notion export"],
  },
];

let state = loadState();
let googleAccessToken = "";
let els = {};
let navCloseTimer = 0;
let navShortcutHoldTimer = 0;
let scheduleMonthHoverTimer = 0;
let habitResizeTimer = 0;
let ui = {
  view: "today",
  selected: null,
  commandOpen: false,
  navOpen: false,
  navDocked: false,
  navShortcutHints: false,
  navOpenedByShortcut: false,
  navDragKey: "",
  slash: null,
  scheduler: null,
  resourceNotes: [],
  resourceNoteZ: 30,
  resourceDrag: null,
  activeBlockId: "",
  blockDrag: null,
  blockSelection: {
    ownerType: "",
    ownerId: "",
    ids: [],
  },
  editorMarquee: null,
  expandedProjectId: "",
  expandedTodayTaskId: "",
  expandedHabitId: "",
  habitDayCount: 0,
  search: "",
  draggedTaskId: "",
  scheduleHoldTaskId: "",
  pendingScheduleDrag: null,
  suppressTaskClickUntil: 0,
  lastScheduleDragEndedAt: 0,
  lastSchedulePointerAt: 0,
  captureDrafts: {},
};

init();

function init() {
  app.innerHTML = renderShell();
  els = {
    navTrack: app.querySelector("#navTrack"),
    sidebar: app.querySelector("[data-sidebar]"),
    navToggle: app.querySelector("[data-action='toggle-nav']"),
    navScrim: app.querySelector("[data-nav-scrim]"),
    topbar: app.querySelector("[data-capture-zone]"),
    viewRoot: app.querySelector("#viewRoot"),
    detailRoot: app.querySelector("#detailRoot"),
    overlayRoot: app.querySelector("#overlayRoot"),
  };

  decorateButtons(app);
  app.addEventListener("click", handleClick);
  app.addEventListener("submit", handleSubmit);
  app.addEventListener("input", handleInput);
  app.addEventListener("change", handleChange);
  app.addEventListener("beforeinput", handleBeforeInput);
  app.addEventListener("focusin", handleFocusIn);
  app.addEventListener("focusout", handleFocusOut);
  app.addEventListener("keydown", handleKeydown);
  app.addEventListener("pointerdown", handlePointerDown);
  app.addEventListener("mousedown", handlePointerDown);
  app.addEventListener("dragstart", handleDragStart);
  app.addEventListener("dragover", handleDragOver);
  app.addEventListener("dragleave", handleDragLeave);
  app.addEventListener("drop", handleDrop);

  document.addEventListener("keydown", handleDocumentKeydown);
  document.addEventListener("keyup", handleDocumentKeyup);
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("pointermove", handleBlockPointerMove, true);
  document.addEventListener("pointermove", handleEditorMarqueePointerMove, true);
  document.addEventListener("pointermove", handleResourcePointerMove, true);
  document.addEventListener("pointermove", handleSchedulePointerMove, true);
  document.addEventListener("mousemove", handleSchedulePointerMove, true);
  document.addEventListener("pointerup", finishBlockDrag, true);
  document.addEventListener("pointerup", finishEditorMarqueeDrag, true);
  document.addEventListener("pointerup", finishResourceDrag, true);
  document.addEventListener("pointerup", finishScheduleDrag, true);
  document.addEventListener("pointercancel", cancelBlockDrag, true);
  document.addEventListener("pointercancel", cancelEditorMarqueeDrag, true);
  document.addEventListener("pointercancel", cancelResourceDrag, true);
  document.addEventListener("pointercancel", cancelScheduleDrag, true);
  document.addEventListener("mouseup", finishScheduleDrag, true);
  document.addEventListener("mouseleave", handleSchedulePointerExit);
  document.addEventListener("dragend", cancelScheduleDrag);
  document.addEventListener("dragend", clearNavDrag);
  document.addEventListener("visibilitychange", handleScheduleVisibilityChange);
  window.addEventListener("scroll", updateTopbarStickiness, { passive: true });
  window.addEventListener("resize", updateTopbarStickiness);
  window.addEventListener("resize", handleHabitLayoutResize);
  window.addEventListener("pointerup", finishScheduleDrag, true);
  window.addEventListener("mouseup", finishScheduleDrag, true);
  window.addEventListener("blur", cancelScheduleDrag);
  window.addEventListener("blur", resetNavShortcutState);

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker
      .register("./service-worker.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {});
  }

  updateNav();
  renderView({ transition: false });
  renderDetail();
  renderOverlays();
  updateTopbarStickiness();
}

function renderShell() {
  return `
    <div class="layout">
      <button class="nav-float-toggle" type="button" data-action="toggle-nav" aria-label="목차 열기" aria-expanded="${ui.navOpen ? "true" : "false"}">
        <span></span>
        <span></span>
        <span></span>
      </button>
      <div class="sidebar-shell" data-sidebar>
        <aside class="sidebar">
          <div class="brand">
            <div class="brand-mark">S</div>
            <div>
              <div class="brand-title">SYGMA Local</div>
              <div class="brand-subtitle">Personal web OS</div>
            </div>
          </div>
          <nav class="nav-track" id="navTrack" aria-label="주요 화면">
            <span class="nav-indicator" aria-hidden="true"></span>
            ${renderNavButtons()}
          </nav>
          <div class="sidebar-footer">
            <div class="sync-chip">
              <span>${state.settings.appMode === "local" ? "Local first" : "Sync"}</span>
              <span class="sync-dot"></span>
            </div>
          </div>
        </aside>
      </div>
      <div class="sidebar-scrim" data-action="close-nav" data-nav-scrim></div>
      <main class="main">
        ${renderTopbar()}
        <section class="view-root" id="viewRoot" aria-live="polite"></section>
      </main>
    </div>
    <button class="fab" type="button" data-action="open-command" aria-label="빠른 생성">+</button>
    <div id="detailRoot"></div>
    <div id="overlayRoot"></div>
  `;
}

function renderNavButtons() {
  return orderedNavItems()
    .map(([key, label, icon], index) => {
      const shortcutKey = navShortcutKeyForIndex(index);
      return `
        <button class="nav-button" type="button" draggable="true" data-view="${key}" data-nav-key="${key}"${shortcutKey ? ` data-nav-shortcut="${shortcutKey}"` : ""}>
          <span class="nav-icon">${icon}</span>
          <span class="nav-label">${esc(label)}</span>
          ${shortcutKey ? `<span class="nav-shortcut" aria-hidden="true">${esc(shortcutKey)}</span>` : ""}
        </button>
      `;
    })
    .join("");
}

function renderNav() {
  if (!els.navTrack) return;
  els.navTrack.innerHTML = `
    <span class="nav-indicator" aria-hidden="true"></span>
    ${renderNavButtons()}
  `;
  updateNav();
}

function defaultNavOrder() {
  return NAV_ITEMS.map(([key]) => key);
}

function normalizeNavOrder(order = []) {
  const validKeys = new Set(defaultNavOrder());
  const normalized = [];
  if (Array.isArray(order)) {
    order.forEach((key) => {
      if (validKeys.has(key) && !normalized.includes(key)) normalized.push(key);
    });
  }
  defaultNavOrder().forEach((key) => {
    if (!normalized.includes(key)) normalized.push(key);
  });
  return normalized;
}

function orderedNavItems() {
  const itemsByKey = new Map(NAV_ITEMS.map((item) => [item[0], item]));
  return normalizeNavOrder(state?.settings?.navOrder).map((key) => itemsByKey.get(key)).filter(Boolean);
}

function renderTopbar() {
  return `
    <div class="topbar" data-capture-zone>
      <form class="quick-capture" data-form="quick-capture">
        <input class="input" name="title" autocomplete="off" placeholder="빠르게 수집하기">
        <button class="button" type="submit">수집</button>
      </form>
      <div class="toolbar">
        <button class="button secondary" type="button" data-action="new-task">새 할 일</button>
        <button class="button secondary" type="button" data-action="new-resource">새 자료</button>
      </div>
    </div>
  `;
}

function setView(view, options = {}) {
  if (ui.view === view) {
    if (ui.navOpen && !ui.navDocked) closeNav(options.navTarget || null);
    return;
  }
  ui.view = view;
  ui.selected = null;
  ui.search = "";
  ui.slash = null;
  ui.scheduler = null;
  ui.expandedProjectId = "";
  ui.expandedTodayTaskId = "";
  ui.expandedHabitId = "";
  if (ui.navOpen && !ui.navDocked) {
    closeNav(options.navTarget || null);
  } else {
    updateNav();
  }
  renderView({ transition: true });
  renderDetail();
  renderOverlays();
}

function openNav() {
  app.classList.remove("is-undocking-nav");
  window.clearTimeout(navCloseTimer);
  els.sidebar?.classList.remove("is-fast-closing", "is-row-closing");
  els.sidebar?.style.setProperty("--nav-close-top", "50%");
  els.sidebar?.style.setProperty("--nav-close-bottom", "50%");
  ui.navOpen = true;
  updateNav();
}

function closeNav(target = null) {
  if (ui.navDocked) {
    ui.navOpen = true;
    ui.navOpenedByShortcut = false;
    updateNav();
    return;
  }
  window.clearTimeout(navCloseTimer);
  ui.navOpenedByShortcut = false;
  if (els.sidebar && ui.navOpen) {
    els.sidebar.classList.remove("is-fast-closing", "is-row-closing");
    if (target) {
      const panel = els.sidebar.querySelector(".sidebar") || els.sidebar;
      const panelRect = panel.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const center = panelRect.height
        ? ((targetRect.top + targetRect.height / 2 - panelRect.top) / panelRect.height) * 100
        : 50;
      const clamped = Math.min(94, Math.max(6, center));
      els.sidebar.style.setProperty("--nav-close-top", `${clamped.toFixed(2)}%`);
      els.sidebar.style.setProperty("--nav-close-bottom", `${(100 - clamped).toFixed(2)}%`);
      els.sidebar.classList.add("is-row-closing");
    } else {
      els.sidebar.style.setProperty("--nav-close-top", "50%");
      els.sidebar.style.setProperty("--nav-close-bottom", "50%");
      els.sidebar.classList.add("is-fast-closing");
    }
    navCloseTimer = window.setTimeout(() => {
      els.sidebar?.classList.remove("is-fast-closing", "is-row-closing");
      els.sidebar?.style.setProperty("--nav-close-top", "50%");
      els.sidebar?.style.setProperty("--nav-close-bottom", "50%");
    }, 540);
  }
  ui.navOpen = false;
  updateNav();
}

function updateNav() {
  const activeIndex = Math.max(0, orderedNavItems().findIndex(([key]) => key === ui.view));
  els.navTrack?.style.setProperty("--active-index", String(activeIndex));
  app.querySelectorAll("[data-nav-key]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.navKey === ui.view);
  });
  if (ui.navOpen) {
    window.clearTimeout(navCloseTimer);
    els.sidebar?.classList.remove("is-fast-closing", "is-row-closing");
  }
  els.sidebar?.classList.toggle("is-open", ui.navOpen);
  app.classList.toggle("has-docked-nav", ui.navDocked);
  els.sidebar?.classList.toggle("is-shortcut-hint", ui.navShortcutHints);
  els.navTrack?.classList.toggle("is-shortcut-hint", ui.navShortcutHints);
  els.navScrim?.classList.toggle("is-visible", ui.navOpen && !ui.navDocked);
  els.navToggle?.classList.toggle("is-open", ui.navOpen);
  els.navToggle?.setAttribute("aria-expanded", String(ui.navOpen));
  els.navToggle?.setAttribute("aria-label", ui.navOpen ? "목차 닫기" : "목차 열기");
}

function updateTopbarStickiness() {
  if (!els.topbar) return;
  const top = Number.parseFloat(getComputedStyle(els.topbar).top) || 0;
  const rect = els.topbar.getBoundingClientRect();
  const isStuck = window.scrollY > 8 && rect.top <= top + 0.5;
  els.topbar.classList.toggle("is-stuck", isStuck);
}

function handleHabitLayoutResize() {
  if (ui.view !== "habits") return;
  const nextCount = habitVisibleDayCount();
  if (nextCount === ui.habitDayCount) return;
  window.clearTimeout(habitResizeTimer);
  habitResizeTimer = window.setTimeout(() => {
    if (ui.view !== "habits") return;
    const latestCount = habitVisibleDayCount();
    if (latestCount !== ui.habitDayCount) renderView({ soft: true });
  }, 80);
}

function decorateButtons(root = app) {
  root.querySelectorAll(".button, .fab").forEach((button) => {
    if (button.querySelector(":scope > .button-label")) return;
    const label = document.createElement("span");
    label.className = "button-label";
    while (button.firstChild) {
      label.appendChild(button.firstChild);
    }
    button.appendChild(label);
  });
}

function renderView({ transition = false, soft = false, animateCards = false } = {}) {
  const renderers = {
    today: renderToday,
    inbox: renderInbox,
    tasks: renderTasks,
    projects: renderProjects,
    goals: renderGoals,
    boxes: renderBoxes,
    resources: renderResources,
    habits: renderHabits,
    journal: renderJournal,
    obstacles: renderObstacles,
    calendar: renderCalendar,
    database: renderDatabase,
  };
  const cardRects = animateCards ? captureCardRects() : null;
  els.viewRoot.innerHTML = renderers[ui.view]();
  decorateButtons(els.viewRoot);
  if (cardRects) animateCardReorder(cardRects);
  const view = els.viewRoot.querySelector(".view");
  if (view && transition && !soft) {
    view.classList.add("is-entering");
    window.setTimeout(() => view.classList.remove("is-entering"), 280);
  }
}

function captureCardRects() {
  return new Map(
    Array.from(els.viewRoot.querySelectorAll(".card[data-task-id]")).map((card) => [
      card.dataset.taskId,
      card.getBoundingClientRect(),
    ])
  );
}

function animateCardReorder(previousRects) {
  const cards = Array.from(els.viewRoot.querySelectorAll(".card[data-task-id]"));
  cards.forEach((card) => {
    const previous = previousRects.get(card.dataset.taskId);
    if (!previous) return;
    const next = card.getBoundingClientRect();
    const dx = previous.left - next.left;
    const dy = previous.top - next.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

    card.classList.add("is-reordering");
    card.style.transition = "none";
    card.style.transform = `translate(${dx}px, ${dy}px)`;
    card.getBoundingClientRect();
    requestAnimationFrame(() => {
      card.style.transition = "";
      card.style.transform = "";
      window.setTimeout(() => {
        card.classList.remove("is-reordering");
      }, 420);
    });
  });
}

function renderToday() {
  const today = dateKey(new Date());
  const activeTodayTasks = state.tasks.filter((task) => isTaskOnDate(task, today) && task.status !== "done").sort(bySchedule);
  const completedTodayTasks = state.tasks
    .filter((task) => isTaskOnDate(task, today) && task.status === "done")
    .sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""));
  const todayTasks = [...activeTodayTasks, ...completedTodayTasks];
  const overdue = state.tasks.filter((task) => isOverdue(task)).sort(bySchedule);
  const doneToday = state.tasks.filter((task) => task.completedAt?.slice(0, 10) === today);
  const activeProjects = state.projects.filter((project) => ["active", "focus"].includes(project.status));
  const pinnedResources = state.resources.filter((resource) => resource.pinned && resource.importance !== "archived");
  const habits = state.habits.filter((habit) => habit.status === "active");

  return `
    <section class="view">
      ${renderViewHeader("Today", "오늘의 실행", formatLongDate(new Date()), `
        <button class="button secondary" type="button" data-action="new-journal">오늘 리뷰</button>
      `)}
      <div class="metric-grid">
        ${renderMetric("오늘 할 일", activeTodayTasks.length, "예정/날짜")}
        ${renderMetric("완료", doneToday.length, "오늘 체크")}
        ${renderMetric("지연", overdue.length, "재배치")}
        ${renderMetric("진행 프로젝트", activeProjects.length, "active/focus")}
      </div>
      <div class="grid cols-2">
        <div class="panel">
          ${panelHeader("오늘 할 일", "시간순")}
          <div class="stack">${todayTasks.length ? todayTasks.map((task) => renderTaskCard(task, false, { todayList: true, todayInline: true })).join("") : empty("오늘 할 일이 없습니다.")}</div>
        </div>
        <div class="panel">
          ${panelHeader("오늘 루틴", `${habits.length}개`)}
          <div class="stack">${habits.length ? habits.map((habit) => renderHabitCard(habit, today)).join("") : empty("활성 루틴이 없습니다.")}</div>
        </div>
        <div class="panel">
          ${panelHeader("지연 항목", "Tasks에서 재배치")}
          <div class="stack">${overdue.length ? overdue.map((task) => renderTaskCard(task, false, { todayInline: true })).join("") : empty("지연된 항목이 없습니다.")}</div>
        </div>
        <div class="panel">
          ${panelHeader("고정 자료", "빠른 참조")}
          <div class="stack">${pinnedResources.length ? pinnedResources.map(renderResourceCard).join("") : empty("고정된 자료가 없습니다.")}</div>
        </div>
      </div>
    </section>
  `;
}

function renderInbox() {
  const inbox = state.captures.filter((capture) => capture.status === "inbox");
  const processed = state.captures
    .filter((capture) => capture.status === "processed")
    .slice()
    .sort((a, b) => (b.processedAt || "").localeCompare(a.processedAt || ""))
    .slice(0, 8);

  return `
    <section class="view">
      ${renderViewHeader("Inbox", "수집과 분류", `${inbox.length}개 대기`, `
        <button class="button secondary" type="button" data-action="new-capture">수집 추가</button>
      `)}
      <div class="grid cols-2">
        <div class="panel">
          ${panelHeader("미분류", `${inbox.length}개`)}
          <div class="stack">${inbox.length ? inbox.map(renderCaptureCard).join("") : empty("분류할 수집 항목이 없습니다.")}</div>
        </div>
        <div class="panel">
          ${panelHeader("최근 처리", "변환 기록")}
          <div class="stack">${processed.length ? processed.map(renderCaptureCard).join("") : empty("처리된 항목이 없습니다.")}</div>
        </div>
      </div>
    </section>
  `;
}

function renderTasks() {
  const today = dateKey(new Date());
  const tomorrow = dateKey(addDays(new Date(), 1));
  const filtered = state.tasks.filter((task) => matchesSearch(task.title));
  const active = filtered.filter((task) => task.status !== "done" && task.status !== "canceled");
  const overdue = active.filter((task) => isOverdue(task));
  const todayTasks = active.filter((task) => isTaskOnDate(task, today)).sort(bySchedule);
  const tomorrowTasks = active.filter((task) => isTaskOnDate(task, tomorrow)).sort(bySchedule);
  const scheduled = active
    .filter((task) => (task.scheduledStart || task.dueDate) && !isTaskOnDate(task, today) && !isTaskOnDate(task, tomorrow) && !overdue.includes(task))
    .sort(bySchedule);
  const unplannedOnly = active.filter((task) => !task.scheduledStart && !task.dueDate);
  const completed = filtered
    .filter((task) => task.status === "done")
    .slice()
    .sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""))
    .slice(0, 14);

  return `
    <section class="view">
      ${renderViewHeader("Tasks", "확인과 날짜 배치", `${unplannedOnly.length}개 미계획 / ${scheduled.length + todayTasks.length + tomorrowTasks.length + overdue.length}개 배정`, `
        <input class="input" style="width:220px" data-action-input="search" value="${esc(ui.search)}" placeholder="검색">
        <button class="button secondary" type="button" data-action="new-task">새 할 일</button>
      `)}
      <div class="grid cols-3">
        ${renderTaskColumn("미계획", unplannedOnly, { scheduleHold: true, emptyText: "날짜를 정할 Task가 없습니다." })}
        ${renderTaskColumn("오늘", todayTasks, { scheduleHold: true, emptyText: "오늘 배치된 Task가 없습니다." })}
        ${renderTaskColumn("내일", tomorrowTasks, { scheduleHold: true, emptyText: "내일 배치된 Task가 없습니다." })}
      </div>
      <div class="grid cols-2" style="margin-top:46px">
        ${renderTaskColumn("예정", scheduled, { scheduleHold: true, emptyText: "이후 일정이 없습니다." })}
        ${renderTaskColumn("지연", overdue, { scheduleHold: true, emptyText: "지연된 Task가 없습니다." })}
      </div>
      <div class="panel" style="margin-top:46px">
        ${panelHeader("완료", "최근")}
        <div class="stack">${completed.length ? completed.map(renderTaskCard).join("") : empty("완료한 업무가 없습니다.")}</div>
      </div>
    </section>
  `;
}

function renderProjects() {
  const active = state.projects.filter((project) => ["active", "focus"].includes(project.status));
  const planned = state.projects.filter((project) => ["planned", "unplanned"].includes(project.status));
  const closed = state.projects.filter((project) => ["completed", "paused", "canceled"].includes(project.status));
  return `
    <section class="view">
      ${renderViewHeader("Projects", "프로젝트", `${state.projects.length}개`, `
        <button class="button secondary" type="button" data-action="new-project">새 프로젝트</button>
      `)}
      <div class="project-board">
        ${renderProjectSection("진행중", active, "움직이는 프로젝트")}
        ${renderProjectSection("계획", planned, "준비 중인 프로젝트")}
        ${renderProjectSection("완료/중단", closed, "닫힌 프로젝트")}
      </div>
    </section>
  `;
}

function renderGoals() {
  return `
    <section class="view">
      ${renderViewHeader("Goals", "목표", `${state.goals.length}개`, `
        <button class="button secondary" type="button" data-action="new-goal">새 목표</button>
      `)}
      <div class="grid cols-2">
        ${state.goals.map(renderGoalCard).join("") || empty("목표가 없습니다.")}
      </div>
    </section>
  `;
}

function renderBoxes() {
  return `
    <section class="view">
      ${renderViewHeader("Boxes", "삶의 영역", `${state.boxes.length}개`, `
        <button class="button secondary" type="button" data-action="new-box">새 박스</button>
      `)}
      <div class="grid cols-3">
        ${renderBoxColumn("고정", state.boxes.filter((box) => box.visibility === "pinned"))}
        ${renderBoxColumn("일반", state.boxes.filter((box) => box.visibility === "normal"))}
        ${renderBoxColumn("아카이브", state.boxes.filter((box) => box.visibility === "archived"))}
      </div>
    </section>
  `;
}

function renderResources() {
  const resources = state.resources.filter((resource) => matchesSearch(resource.title) && resource.importance !== "archived");
  return `
    <section class="view">
      ${renderViewHeader("Resources", "자료와 노트", `${resources.length}개`, `
        <input class="input" style="width:220px" data-action-input="search" value="${esc(ui.search)}" placeholder="검색">
        <button class="button secondary" type="button" data-action="new-resource">새 자료</button>
      `)}
      <div class="grid cols-3">
        ${renderResourceColumn("고정", resources.filter((resource) => resource.pinned))}
        ${renderResourceColumn("나중에 보기", resources.filter((resource) => resource.readLater))}
        ${renderResourceColumn("전체", resources)}
      </div>
    </section>
  `;
}

function renderHabits() {
  ui.habitDayCount = habitVisibleDayCount();
  return `
    <section class="view">
      ${renderViewHeader("Habits", "루틴", `${state.habits.filter((habit) => habit.status === "active").length}개 활성`, `
        <button class="button secondary" type="button" data-action="new-habit">새 루틴</button>
      `)}
      <div class="habit-list">
        ${state.habits.map(renderHabitItem).join("") || empty("루틴이 없습니다.")}
      </div>
    </section>
  `;
}

function renderJournal() {
  return `
    <section class="view">
      ${renderViewHeader("Journal", "회고", `${state.journals.length}개`, `
        <button class="button secondary" type="button" data-action="new-journal">새 리뷰</button>
      `)}
      <div class="grid cols-2">
        ${state.journals
          .slice()
          .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
          .map(renderJournalCard)
          .join("") || empty("회고가 없습니다.")}
      </div>
    </section>
  `;
}

function renderObstacles() {
  const open = state.obstacles.filter((obstacle) => ["open", "watching"].includes(obstacle.status));
  const closed = state.obstacles.filter((obstacle) => ["mitigated", "resolved", "archived"].includes(obstacle.status));
  return `
    <section class="view">
      ${renderViewHeader("Issues", "병목과 리스크", `${open.length}개 열림`, `
        <button class="button secondary" type="button" data-action="new-obstacle">새 이슈</button>
      `)}
      <div class="grid cols-2">
        <div class="panel">
          ${panelHeader("열림", `${open.length}개`)}
          <div class="stack">${open.length ? open.map(renderObstacleCard).join("") : empty("열린 이슈가 없습니다.")}</div>
        </div>
        <div class="panel">
          ${panelHeader("완화/해결", `${closed.length}개`)}
          <div class="stack">${closed.length ? closed.map(renderObstacleCard).join("") : empty("해결된 이슈가 없습니다.")}</div>
        </div>
      </div>
    </section>
  `;
}

function renderCalendar() {
  const localEvents = getLocalCalendarEvents();
  const googleEvents = getGoogleCalendarEvents();
  const combinedEvents = getCombinedCalendarEvents();
  const weekStart = startOfWeek(new Date());
  return `
    <section class="view">
      ${renderViewHeader("Calendar", "내부 일정과 Google Calendar", `내부 ${localEvents.length}개 / Google ${googleEvents.length}개`, `
        <button class="button secondary" type="button" data-action="connect-google">Google 연결</button>
        <button class="button secondary" type="button" data-action="fetch-google">Google 불러오기</button>
        <button class="button secondary" type="button" data-action="sync-google">내부 일정 내보내기</button>
      `)}
      <div class="calendar-layout">
        <div class="panel calendar-week-panel">
          ${panelHeader("이번 주", `${formatLongDate(weekStart)}부터`)}
          <div class="calendar-week-grid">${renderWeekDays()}</div>
        </div>

        <div class="panel calendar-google-panel">
          ${panelHeader("Google Calendar", googleCalendarStatusLabel())}
          <div class="calendar-setup-grid">
            <label class="field">
              <span>OAuth Client ID</span>
              <input class="input" data-setting="googleClientId" value="${esc(state.settings.googleClientId)}" placeholder="Google Cloud OAuth Client ID">
            </label>
            <label class="field">
              <span>Calendar ID</span>
              <input class="input" data-setting="googleCalendarId" value="${esc(state.settings.googleCalendarId)}" placeholder="primary">
            </label>
            <div class="calendar-sync-actions">
              <button class="button" type="button" data-action="connect-google">Google 연결</button>
              <button class="button secondary" type="button" data-action="fetch-google">Google 일정 불러오기</button>
              <button class="button secondary" type="button" data-action="sync-google">내부 일정 내보내기</button>
            </div>
            <div class="calendar-sync-summary">
              <strong>연동 상태</strong>
              <div class="card-meta">
                ${badge(state.settings.googleConnectedAt ? "토큰 연결됨" : "토큰 필요", state.settings.googleConnectedAt ? "teal" : "amber")}
                ${badge(state.settings.googleCalendarId || "primary", "blue")}
                ${state.settings.lastGoogleFetchAt ? badge(`불러오기 ${formatDateTime(state.settings.lastGoogleFetchAt)}`, "teal") : ""}
                ${state.settings.lastGoogleSyncAt ? badge(`내보내기 ${formatDateTime(state.settings.lastGoogleSyncAt)}`, "violet") : ""}
              </div>
            </div>
          </div>
        </div>

        <div class="panel calendar-combined-panel">
          ${panelHeader("통합 캘린더", `${monthLabel(new Date())} · ${combinedEvents.length}개 일정`)}
          <div class="calendar-source-legend" aria-label="캘린더 소스">
            <span><i class="source-dot local"></i>SYGMA</span>
            <span><i class="source-dot google"></i>Google</span>
          </div>
          ${renderCombinedCalendar()}
        </div>
      </div>
    </section>
  `;
}

function renderDatabase() {
  return `
    <section class="view">
      ${renderViewHeader("DB", "로컬 데이터 모델", `v${state.version} · ${formatDateTime(state.updatedAt)}`, `
        <button class="button secondary" type="button" data-action="export-json">JSON 내보내기</button>
        <button class="button secondary" type="button" data-action="notion-final-sync">Notion 최종 동기화</button>
      `)}
      <div class="model-grid">
        ${DB_SCHEMA.map((node) => `
          <article class="model-node">
            <h3 class="card-title">${node.label}</h3>
            <div class="card-meta">${badge(`${countOf(node.key)} rows`, "blue")}</div>
            <ul class="model-fields">
              ${node.fields.map((field) => `<li>${esc(field)}</li>`).join("")}
            </ul>
            <p class="resource-preview">${node.relations.map(esc).join(" · ")}</p>
          </article>
        `).join("")}
      </div>
      <div class="grid cols-2" style="margin-top:46px">
        <div class="panel">
          ${panelHeader("로컬 저장소", "localStorage")}
          <div class="stack">
            ${renderMetric("Tasks", state.tasks.length, "할 일")}
            ${renderMetric("Resources", state.resources.length, "본문 blocks")}
            ${renderMetric("Blocks", totalBlocks(), "자료/회고/이슈 본문")}
          </div>
        </div>
        <div class="panel">
          ${panelHeader("설정", "PWA / 동기화")}
          <div class="stack">
            <label class="field">
              <span>Notion sync mode</span>
              <input class="input" data-setting="notionSyncMode" value="${esc(state.settings.notionSyncMode)}">
            </label>
            <label class="field">
              <span>Google Calendar ID</span>
              <input class="input" data-setting="googleCalendarId" value="${esc(state.settings.googleCalendarId)}">
            </label>
            <button class="button danger" type="button" data-action="reset-demo-data">최소 데이터 재생성</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderViewHeader(eyebrow, title, copy, actions = "") {
  return `
    <header class="view-header">
      <div class="view-heading">
        <div class="eyebrow">${esc(eyebrow)}</div>
        <h1 class="view-title">${esc(title)}</h1>
      </div>
      <div class="toolbar">${actions}</div>
    </header>
  `;
}

function renderMetric(label, value, sub) {
  return `
    <div class="metric">
      <div class="metric-label">${esc(label)}</div>
      <div class="metric-value">${esc(value)}</div>
      <div class="metric-sub">${esc(sub)}</div>
    </div>
  `;
}

function panelHeader(title, subtitle = "") {
  return `
    <div class="panel-header">
      <div>
        <h2 class="panel-title">${esc(title)}</h2>
      </div>
    </div>
  `;
}

function renderTaskColumn(title, tasks, options = {}) {
  return `
    <div class="panel">
      ${panelHeader(title, `${tasks.length}개`)}
      <div class="stack">${tasks.length ? tasks.map((task) => renderTaskCard(task, false, options)).join("") : empty(options.emptyText || "항목이 없습니다.")}</div>
    </div>
  `;
}

function renderProjectSection(title, projects, subtitle = "") {
  return `
    <section class="project-section">
      <div class="project-section-head">
        <div>
          <h2>${esc(title)}</h2>
          ${subtitle ? `<span>${esc(subtitle)}</span>` : ""}
        </div>
        <strong>${projects.length}</strong>
      </div>
      <div class="project-list">
        ${projects.length ? projects.map(renderProjectItem).join("") : empty("프로젝트가 없습니다.")}
      </div>
    </section>
  `;
}

function renderBoxColumn(title, boxes) {
  return `
    <div class="panel">
      ${panelHeader(title, `${boxes.length}개`)}
      <div class="stack">${boxes.length ? boxes.map(renderBoxCard).join("") : empty("박스가 없습니다.")}</div>
    </div>
  `;
}

function renderResourceColumn(title, resources) {
  return `
    <div class="panel">
      ${panelHeader(title, `${resources.length}개`)}
      <div class="stack">${resources.length ? resources.map(renderResourceCard).join("") : empty("자료가 없습니다.")}</div>
    </div>
  `;
}

function renderTaskCard(task, draggable = false, options = {}) {
  const done = task.status === "done";
  const classes = ["card"];
  const inline = Boolean(options.todayInline);
  const expanded = inline && ui.expandedTodayTaskId === task.id;
  const scheduleLabel = task.scheduledStart || task.dueDate ? "잡아서 날짜 옮기기" : "잡아서 날짜에 놓기";
  if (done) classes.push("done");
  if (done && options.todayList) classes.push("today-done");
  if (options.scheduleHold) classes.push("schedule-hold-card");
  if (inline) classes.push("task-inline-item");
  if (expanded) classes.push("is-expanded");
  const selectAttrs = inline
    ? `data-today-task-id="${task.id}"`
    : `data-select-type="tasks" data-select-id="${task.id}"`;
  return `
    <article class="${classes.join(" ")}" ${draggable ? "draggable='true'" : ""} ${options.scheduleHold ? `data-schedule-hold="${task.id}"` : ""} data-task-id="${task.id}" ${selectAttrs}>
      <div class="task-row" ${inline ? `data-task-inline-toggle="${task.id}" aria-expanded="${expanded ? "true" : "false"}"` : ""}>
        <button class="check ${done ? "is-done" : ""}" type="button" data-toggle-task="${task.id}" aria-label="완료 전환" aria-pressed="${done ? "true" : "false"}"></button>
        <div>
          <h3 class="card-title">${esc(task.title)}</h3>
          ${options.scheduleHold ? `<button class="schedule-hint" type="button" data-scheduler-open="${task.id}">${scheduleLabel}</button>` : ""}
          <div class="card-meta">
            ${task.scheduledStart ? badge(formatDateTime(task.scheduledStart), "blue") : ""}
            ${task.dueDate && !task.scheduledStart ? badge(`날짜 ${task.dueDate}`, isOverdue(task) ? "rose" : "amber") : ""}
            ${["waiting", "someday"].includes(task.status) ? badge(STATUSES.task[task.status] || task.status, "amber") : ""}
            ${task.projectId ? badge(nameOf("projects", task.projectId), "violet") : ""}
          </div>
        </div>
        ${inline ? `<span class="task-chevron" aria-hidden="true"></span>` : ""}
      </div>
      ${inline ? `<span class="task-inline-separator" aria-hidden="true"></span>` : ""}
      ${
        inline
          ? `<div class="task-detail-shell" aria-hidden="${expanded ? "false" : "true"}">
              <div class="task-inline-detail" data-inline-owner-type="tasks" data-inline-owner-id="${task.id}">
                ${renderTaskInlineDetail(task)}
              </div>
            </div>`
          : ""
      }
    </article>
  `;
}

function renderTaskInlineDetail(task) {
  const resource = task.resourceId ? state.resources.find((entry) => entry.id === task.resourceId) : null;
  return `
    <div class="task-inline-grid">
      <div class="task-inline-fields">
        <div class="task-inline-section-head">
          <strong>상세 정보</strong>
        </div>
        ${renderTaskPropertyFields(task, { includeTitle: true, className: "task-inline-field-grid" })}
      </div>
      <div class="task-inline-resource-panel">
        <div class="task-inline-section-head">
          <strong>관련 자료</strong>
          <span>${resource ? esc(resource.type || "resource") : "연결 없음"}</span>
        </div>
        ${
          resource
            ? `<button class="task-resource-link" type="button" data-open-resource="${resource.id}">
                <strong>${esc(resource.title)}</strong>
                <small>${esc(blockText(resource).slice(0, 80)) || "자료 열기"}</small>
              </button>`
            : `<span class="project-muted">연결된 자료 없음</span>`
        }
      </div>
    </div>
    ${renderInlineBlockEditor("tasks", task.id, task.blocks || [])}
  `;
}

function renderProjectItem(project) {
  const stats = projectStats(project);
  const expanded = ui.expandedProjectId === project.id;
  const statusColor = project.status === "focus" ? "blue" : ["completed"].includes(project.status) ? "teal" : ["paused", "canceled"].includes(project.status) ? "rose" : "violet";
  return `
    <article class="project-item ${expanded ? "is-expanded" : ""}" data-project-item="${project.id}">
      <button class="project-row" type="button" data-project-toggle="${project.id}" aria-expanded="${expanded ? "true" : "false"}">
        <div class="project-main">
          <div class="project-title-line">
            <h3>${esc(project.name)}</h3>
            <span class="project-status ${statusColor}">${esc(STATUSES.project[project.status] || project.status)}</span>
          </div>
          <div class="project-context">
            <span>${project.boxId ? esc(nameOf("boxes", project.boxId)) : "Box 없음"}</span>
            <span>${project.goalId ? esc(nameOf("goals", project.goalId)) : "Goal 없음"}</span>
          </div>
        </div>
        <div class="project-progress-wrap" aria-label="진행률 ${stats.progress}%">
          <div class="project-progress-meta">
            <span>${stats.progress}%</span>
            <span>${stats.done}/${stats.total} 완료</span>
          </div>
          <div class="project-progress-track"><span style="width:${stats.progress}%"></span></div>
        </div>
        <div class="project-task-count">
          <strong>${stats.total}</strong>
          <span>tasks</span>
        </div>
        <div class="project-end-date">
          <span>종료</span>
          <strong>${esc(projectDateLabel(project.endDate))}</strong>
        </div>
        <span class="project-chevron" aria-hidden="true"></span>
      </button>
      <div class="project-detail-shell" aria-hidden="${expanded ? "false" : "true"}">
        <div class="project-detail">
          ${renderProjectDetail(project, stats)}
        </div>
      </div>
    </article>
  `;
}

function renderProjectDetail(project, stats) {
  const boxName = project.boxId ? nameOf("boxes", project.boxId) : "";
  const goalName = project.goalId ? nameOf("goals", project.goalId) : "";
  const resources = state.resources.filter((resource) => resource.projectId === project.id);
  const remainingTasks = stats.tasks.filter((task) => task.status !== "done" && task.status !== "canceled");
  const doneTasks = stats.tasks.filter((task) => task.status === "done");
  return `
    <div class="project-detail-grid">
      <div class="project-detail-overview">
        <div class="project-relation-strip">
          ${renderProjectRelation("Box", boxName || "없음")}
          ${renderProjectRelation("Goal", goalName || "없음")}
          ${renderProjectRelation("상태", STATUSES.project[project.status] || project.status)}
          ${renderProjectRelation("기간", projectRangeLabel(project))}
        </div>
        <p>${esc(blockText(project).slice(0, 160)) || "프로젝트 설명이 없습니다."}</p>
      </div>
      <div class="project-resource-panel">
        <strong>관련 자료</strong>
        <div class="project-resource-list">
          ${resources.length ? resources.map(renderProjectResource).join("") : `<span class="project-muted">연결된 자료 없음</span>`}
        </div>
      </div>
    </div>
    <div class="project-task-detail-grid">
      ${renderProjectTaskGroup("남은 Task", remainingTasks, "remaining")}
      ${renderProjectTaskGroup("완료된 Task", doneTasks, "done")}
    </div>
  `;
}

function renderProjectRelation(label, value) {
  return `
    <span class="project-relation">
      <small>${esc(label)}</small>
      <strong>${esc(value)}</strong>
    </span>
  `;
}

function renderProjectResource(resource) {
  return `
    <button class="project-resource-chip" type="button" data-open-resource="${resource.id}">
      <strong>${esc(resource.title)}</strong>
      <small>${esc(resource.type || "resource")}</small>
    </button>
  `;
}

function renderProjectTaskGroup(title, tasks, tone) {
  return `
    <div class="project-task-panel ${tone}">
      <div class="project-task-panel-head">
        <strong>${esc(title)}</strong>
        <span>${tasks.length}</span>
      </div>
      <div class="project-task-list">
        ${tasks.length ? tasks.map(renderProjectTaskLine).join("") : `<span class="project-muted">해당 Task 없음</span>`}
      </div>
    </div>
  `;
}

function renderProjectTaskLine(task) {
  const done = task.status === "done";
  const date = task.scheduledStart ? formatDateTime(task.scheduledStart) : task.dueDate ? `날짜 ${task.dueDate}` : "";
  return `
    <div class="project-task-line ${done ? "is-done" : ""}">
      <span class="project-task-mark" aria-hidden="true"></span>
      <span class="project-task-title">${esc(task.title)}</span>
      <span class="project-task-state">${esc(STATUSES.task[task.status] || task.status)}</span>
      ${date ? `<span class="project-task-date">${esc(date)}</span>` : ""}
    </div>
  `;
}

function renderGoalCard(goal) {
  const projects = state.projects.filter((project) => project.goalId === goal.id);
  const projectTasks = state.tasks.filter((task) => task.goalId === goal.id);
  const completedTasks = projectTasks.filter((task) => task.status === "done").length;
  const progress = projectTasks.length ? Math.round((completedTasks / projectTasks.length) * 100) : projects.length ? 10 : 0;
  return `
    <article class="card" data-select-type="goals" data-select-id="${goal.id}">
      <h3 class="card-title">${esc(goal.name)}</h3>
      <div class="card-meta">
        ${badge(STATUSES.goal[goal.status] || goal.status, "blue")}
        ${goal.boxId ? badge(nameOf("boxes", goal.boxId), "teal") : ""}
        ${goal.targetDate ? badge(goal.targetDate, "amber") : ""}
      </div>
      <div class="progress" style="margin-top:12px"><span style="width:${progress}%"></span></div>
    </article>
  `;
}

function renderBoxCard(box) {
  const goals = state.goals.filter((goal) => goal.boxId === box.id).length;
  const projects = state.projects.filter((project) => project.boxId === box.id).length;
  const tasks = state.tasks.filter((task) => task.boxId === box.id && task.status !== "done").length;
  return `
    <article class="card" data-select-type="boxes" data-select-id="${box.id}">
      <h3 class="card-title">${esc(box.name)}</h3>
      <div class="card-meta">
        ${badge(box.visibility, box.visibility === "pinned" ? "blue" : "teal")}
        ${badge(`${goals} 목표`, "violet")}
        ${badge(`${projects} 프로젝트`, "amber")}
        ${badge(`${tasks} 할 일`, "teal")}
      </div>
    </article>
  `;
}

function renderResourceCard(resource) {
  return `
    <article class="card" data-select-type="resources" data-select-id="${resource.id}">
      <h3 class="card-title">${esc(resource.title)}</h3>
      <p class="resource-preview">${esc(blockText(resource).slice(0, 112)) || "비어 있는 자료"}</p>
      <div class="card-meta">
        ${resource.pinned ? badge("고정", "blue") : ""}
        ${resource.readLater ? badge("나중에 보기", "amber") : ""}
        ${resource.projectId ? badge(nameOf("projects", resource.projectId), "violet") : ""}
        ${badge(resource.type, "teal")}
      </div>
    </article>
  `;
}

function renderHabitItem(habit) {
  const today = dateKey(new Date());
  const days = habitPreviewDays(today);
  const completed = days.filter((date) => habitDone(habit.id, date)).length;
  const expanded = ui.expandedHabitId === habit.id;
  const statusLabel = { active: "활성", paused: "중단", archived: "보관" }[habit.status] || habit.status;
  const statusColor = habit.status === "active" ? "teal" : habit.status === "paused" ? "amber" : "rose";
  const relation = habit.projectId ? nameOf("projects", habit.projectId) : habit.boxId ? nameOf("boxes", habit.boxId) : "";
  const monthStats = habitMonthStats(habit.id, new Date(today));
  return `
    <article class="habit-item ${expanded ? "is-expanded" : ""}" data-habit-item="${habit.id}" data-habit-card="${habit.id}">
      <div class="habit-row" role="button" tabindex="0" data-habit-toggle="${habit.id}" aria-expanded="${expanded ? "true" : "false"}">
        <div class="habit-main">
          <div class="habit-title-line">
            <h3>${esc(habit.title)}</h3>
            <span class="habit-status ${statusColor}">${esc(statusLabel)}</span>
          </div>
          <div class="habit-context">
            <span>${esc(habit.target || "목표 기준 없음")}</span>
            ${relation ? `<span>${esc(relation)}</span>` : ""}
          </div>
        </div>
        <div class="habit-preview" aria-label="${esc(habit.title)} ${esc(habitRangeLabel(days))} 체크">
          <div class="habit-range-caption">${esc(habitRangeLabel(days))}</div>
          <div class="habit-days habit-days-inline" style="--habit-day-count:${days.length}" role="group">
            ${days.map((date) => renderHabitDayButton(habit, date)).join("")}
          </div>
        </div>
        <div class="habit-stat">
          <strong class="${completed >= Math.ceil(days.length * 0.7) ? "teal" : "amber"}" data-habit-progress="${habit.id}" data-habit-progress-total="${days.length}">${completed}/${days.length}</strong>
          <span>range</span>
        </div>
        <div class="habit-stat habit-month-stat">
          <strong class="${monthStats.completed >= Math.ceil(monthStats.total * 0.7) ? "teal" : "amber"}" data-habit-month-inline="${habit.id}" data-habit-month="${monthKey(new Date(today))}">${monthStats.completed}/${monthStats.total}</strong>
          <span>month</span>
        </div>
        <button class="habit-edit-button" type="button" data-habit-edit="${habit.id}" aria-label="루틴 상세 편집">✎</button>
        <span class="project-chevron habit-chevron" aria-hidden="true"></span>
      </div>
      <div class="habit-detail-shell" aria-hidden="${expanded ? "false" : "true"}">
        <div class="habit-detail">
          ${renderHabitCalendar(habit, today)}
        </div>
      </div>
    </article>
  `;
}

function renderHabitDayButton(habit, date) {
  return `
    <button class="habit-day ${habitDone(habit.id, date) ? "is-done" : ""} ${date === dateKey(new Date()) ? "is-today" : ""}" type="button" data-toggle-habit="${habit.id}" data-habit-date="${date}" aria-label="${date}">
      <span class="habit-day-fill" aria-hidden="true"></span>
      <span>${weekday(new Date(date))}</span>
      <strong>${date.slice(8)}</strong>
    </button>
  `;
}

function renderHabitCalendar(habit, currentDate) {
  const monthDate = new Date(currentDate);
  const currentMonth = monthKey(monthDate);
  const days = habitCalendarMonthDays(monthDate);
  const stats = habitMonthStats(habit.id, monthDate);
  return `
    <div class="habit-calendar">
      <div class="habit-calendar-head">
        <div>
          <strong>${esc(monthLabel(monthDate))}</strong>
          <span>${esc(habit.target || "루틴 체크 캘린더")}</span>
        </div>
        <span class="badge ${stats.completed >= Math.ceil(stats.total * 0.7) ? "teal" : "amber"}" data-habit-month-progress="${habit.id}" data-habit-month="${currentMonth}">${stats.completed}/${stats.total}</span>
      </div>
      <div class="habit-calendar-weekdays">
        ${Array.from({ length: 7 }, (_, index) => {
          const day = addDays(startOfSundayWeek(monthDate), index);
          return `<span class="${weekendClass(day)}">${weekday(day)}</span>`;
        }).join("")}
      </div>
      <div class="habit-calendar-grid">
        ${days.map((day) => {
          const key = dateKey(day);
          const done = habitDone(habit.id, key);
          return `
            <button class="habit-calendar-day ${weekendClass(day)} ${monthKey(day) !== currentMonth ? "is-outside" : ""} ${key === dateKey(new Date()) ? "is-today" : ""} ${done ? "is-done" : ""}" type="button" data-toggle-habit="${habit.id}" data-habit-date="${key}" aria-label="${key}">
              <span class="habit-day-fill" aria-hidden="true"></span>
              <span class="habit-calendar-date">${key.slice(8)}</span>
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderHabitCard(habit, currentDate, expanded = false) {
  const start = startOfWeek(new Date(currentDate));
  const days = Array.from({ length: 7 }, (_, index) => dateKey(addDays(start, index)));
  const completed = days.filter((date) => habitDone(habit.id, date)).length;
  return `
    <article class="card" data-select-type="habits" data-select-id="${habit.id}" data-habit-card="${habit.id}">
      <h3 class="card-title">${esc(habit.title)}</h3>
      <p class="resource-preview">${esc(habit.target || "")}</p>
      <div class="habit-days" role="group" aria-label="${esc(habit.title)} 주간 체크">
        ${days.map((date) => `
          <button class="habit-day ${habitDone(habit.id, date) ? "is-done" : ""} ${date === dateKey(new Date()) ? "is-today" : ""}" type="button" data-toggle-habit="${habit.id}" data-habit-date="${date}" aria-label="${date}">
            <span class="habit-day-fill" aria-hidden="true"></span>
            <span>${weekday(new Date(date))}</span>
            <strong>${date.slice(8)}</strong>
          </button>
        `).join("")}
      </div>
      <div class="card-meta">
        <span class="badge ${completed >= 5 ? "teal" : "amber"}" data-habit-progress="${habit.id}">${completed}/7</span>
        ${badge(habit.cadence, "blue")}
        ${expanded && habit.projectId ? badge(nameOf("projects", habit.projectId), "violet") : ""}
      </div>
    </article>
  `;
}

function renderJournalCard(journal) {
  return `
    <article class="card" data-select-type="journals" data-select-id="${journal.id}">
      <h3 class="card-title">${esc(journal.title)}</h3>
      <p class="resource-preview">${esc(blockText(journal).slice(0, 120))}</p>
      <div class="card-meta">
        ${badge(journal.date || "", "teal")}
        ${badge(`${journal.satisfaction || 0}/10`, "amber")}
      </div>
    </article>
  `;
}

function renderObstacleCard(obstacle) {
  return `
    <article class="card" data-select-type="obstacles" data-select-id="${obstacle.id}">
      <h3 class="card-title">${esc(obstacle.title)}</h3>
      <p class="resource-preview">${esc(blockText(obstacle).slice(0, 120))}</p>
      <div class="card-meta">
        ${badge(STATUSES.obstacle[obstacle.status] || obstacle.status, obstacle.status === "open" ? "rose" : "teal")}
        ${badge(`S${obstacle.severity || 1}`, obstacle.severity >= 4 ? "rose" : "amber")}
        ${obstacle.projectId ? badge(nameOf("projects", obstacle.projectId), "violet") : ""}
      </div>
    </article>
  `;
}

function renderCaptureCard(capture) {
  const processed = capture.status === "processed";
  const draft = getCaptureDraft(capture.id);
  return `
    <article class="card capture-card ${draft ? "is-configuring" : ""}" data-select-type="captures" data-select-id="${capture.id}">
      <h3 class="card-title">${esc(capture.title)}</h3>
      ${capture.url ? `<p class="resource-preview">${esc(capture.url)}</p>` : ""}
      <div class="card-meta">
        ${badge(processed ? "처리됨" : "Inbox", processed ? "teal" : "blue")}
        ${capture.convertedTo ? badge(capture.convertedTo, "violet") : ""}
      </div>
      ${
        processed
          ? ""
          : `${renderCaptureConvertActions(capture, draft)}${draft ? renderTaskCaptureFlow(capture, draft) : ""}`
      }
    </article>
  `;
}

function renderCaptureConvertActions(capture, draft) {
  const options = [
    ["tasks", "Task"],
    ["projects", "Project"],
    ["resources", "Resource"],
    ["goals", "Goal"],
    ["boxes", "Box"],
  ];
  return `
    <div class="toolbar capture-type-toolbar" aria-label="분류 유형">
      ${options.map(([type, label]) => `
        <button class="button ghost ${draft?.type === type ? "is-active" : ""}" type="button" data-convert="${type}" data-capture-id="${capture.id}" aria-pressed="${draft?.type === type ? "true" : "false"}">${label}</button>
      `).join("")}
    </div>
  `;
}

function renderTaskCaptureFlow(capture, draft) {
  const steps = getTaskCaptureSteps(draft);
  const visibleSteps = steps.slice(0, Math.min(draft.stepIndex + 1, steps.length));
  const readyToSave = draft.stepIndex >= steps.length;
  const targetLabel = captureTargetLabel(draft.type);
  return `
    <div class="capture-flow" data-task-flow="${capture.id}" aria-label="${esc(targetLabel)} 속성 선택">
      ${visibleSteps.map((step, index) => renderTaskCaptureStep(capture.id, draft, step, index)).join("")}
      ${
        readyToSave
          ? `<div class="capture-flow-save" data-flow-index="${steps.length}" style="--flow-index:${steps.length}">
              <div>
                <strong>${esc(targetLabel)}로 저장</strong>
                <span>${esc(taskCaptureSummary(draft))}</span>
              </div>
              <div class="capture-flow-save-actions">
                <button class="button ghost" type="button" data-task-flow-cancel="${capture.id}">취소</button>
                <button class="button" type="button" data-task-flow-save="${capture.id}">저장</button>
              </div>
            </div>`
          : ""
      }
    </div>
  `;
}

function renderTaskCaptureStep(captureId, draft, step, index) {
  const selectedValue = draft.values[step.key] || "";
  const active = index === draft.stepIndex;
  const selectedOption = taskStepOption(step, selectedValue);
  if (!active) {
    return `
      <div class="capture-flow-row is-complete" data-flow-index="${index}" style="--flow-index:${index}">
        <div class="capture-flow-label">
          <span>${esc(step.label)}</span>
          <small>${esc(step.hint)}</small>
        </div>
        <button class="capture-flow-summary is-selected" type="button" data-task-flow-jump="${captureId}" data-flow-step="${step.key}">
          <span>${esc(selectedOption.label)}</span>
          ${selectedOption.meta ? `<small>${esc(selectedOption.meta)}</small>` : ""}
        </button>
      </div>
    `;
  }
  return `
    <div class="capture-flow-row is-active" data-flow-index="${index}" style="--flow-index:${index}">
      <div class="capture-flow-label">
        <span>${esc(step.label)}</span>
        <small>${esc(step.hint)}</small>
      </div>
      <div class="capture-flow-options" role="group" aria-label="${esc(step.label)} 선택">
        ${step.options.map((option) => `
          <button class="capture-flow-option ${option.value === selectedValue ? "is-selected" : ""}" type="button" data-task-flow-choice="${captureId}" data-flow-step="${step.key}" data-flow-value="${esc(option.value)}">
            <span>${esc(option.label)}</span>
            ${option.meta ? `<small>${esc(option.meta)}</small>` : ""}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function getCaptureDraft(captureId) {
  return ui.captureDrafts?.[captureId] || null;
}

function getTaskCaptureSteps(draft) {
  const type = draft?.type || "tasks";
  const values = draft?.values || {};
  const boxId = values.boxId || "";
  const goalId = values.goalId || "";
  const projectId = values.projectId || "";
  const selectedGoal = state.goals.find((goal) => goal.id === goalId);
  const selectedProject = state.projects.find((project) => project.id === projectId);
  const effectiveBoxId = boxId || selectedGoal?.boxId || selectedProject?.boxId || "";

  const goals = effectiveBoxId ? state.goals.filter((goal) => goal.boxId === effectiveBoxId) : state.goals;
  const projects = effectiveBoxId ? state.projects.filter((project) => projectBelongsToBox(project, effectiveBoxId)) : state.projects;
  const resources = projectId
    ? state.resources.filter((resource) => resource.projectId === projectId)
    : goalId
      ? state.resources.filter((resource) => resource.goalId === goalId)
      : boxId
        ? state.resources.filter((resource) => resource.boxId === boxId)
        : state.resources;

  const boxStep = {
      key: "boxId",
      label: "Box",
      hint: "관리 영역",
      options: [{ value: "", label: "미지정", meta: "나중에 연결" }, ...state.boxes.map((box) => ({ value: box.id, label: box.name, meta: box.visibility === "pinned" ? "고정" : "" }))],
  };
  const goalStep = {
      key: "goalId",
      label: "Goal",
      hint: "목표 연결",
      options: [{ value: "", label: "없음", meta: type === "tasks" ? "단독 Task" : "목표 없이 연결" }, ...goals.map((goal) => ({ value: goal.id, label: goal.name, meta: STATUSES.goal[goal.status] || goal.status }))],
  };
  const projectStep = {
      key: "projectId",
      label: "Project",
      hint: "실행 맥락",
      options: [{ value: "", label: "없음", meta: type === "resources" ? "프로젝트 없이 보관" : "독립 실행" }, ...projects.map((project) => ({ value: project.id, label: project.name, meta: projectFlowMeta(project) }))],
  };
  const resourceStep = {
      key: "resourceId",
      label: "Resource",
      hint: "참고 자료",
      options: [{ value: "", label: "없음", meta: "자료 없이 진행" }, ...resources.map((resource) => ({ value: resource.id, label: resource.title, meta: resource.type || "" }))],
  };
  const resourceTypeStep = {
      key: "resourceType",
      label: "분류",
      hint: "자료 유형",
      options: [
        { value: "note", label: "노트", meta: "정리된 자료" },
        { value: "quick_note", label: "간단 메모", meta: "빠른 기록" },
        { value: "scrap", label: "스크랩", meta: "외부 자료" },
        { value: "thought", label: "생각", meta: "아이디어" },
        { value: "reflection", label: "회고", meta: "돌아보기" },
      ],
  };

  if (type === "boxes") return [];
  if (type === "goals") return [boxStep];
  if (type === "projects") return [boxStep, goalStep];
  if (type === "resources") return [boxStep, goalStep, projectStep, resourceTypeStep];
  return [boxStep, goalStep, projectStep, resourceStep];
}

function projectBelongsToBox(project, boxId) {
  if (!boxId) return true;
  if (project.boxId === boxId) return true;
  const goal = state.goals.find((entry) => entry.id === project.goalId);
  return goal?.boxId === boxId;
}

function projectFlowMeta(project) {
  const goalName = project.goalId ? nameOf("goals", project.goalId) : "";
  const status = STATUSES.project[project.status] || project.status || "";
  return [goalName, status].filter(Boolean).join(" · ");
}

function taskStepOption(step, value) {
  return step.options.find((option) => option.value === value) || step.options[0] || { label: "미지정", meta: "" };
}

function taskStepOptionLabel(step, value) {
  return taskStepOption(step, value).label || "미지정";
}

function taskCaptureSummary(draft) {
  const steps = getTaskCaptureSteps(draft);
  if (!steps.length) return "상위 연결 없음";
  return steps
    .map((step) => `${step.label}: ${taskStepOptionLabel(step, draft.values[step.key] || "")}`)
    .join(" · ");
}

function captureTargetLabel(type) {
  return {
    tasks: "Task",
    projects: "Project",
    resources: "Resource",
    goals: "Goal",
    boxes: "Box",
  }[type] || "항목";
}

function renderWeekDays() {
  const start = startOfWeek(new Date());
  const events = getLocalCalendarEvents();
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
    .map((day) => {
      const key = dateKey(day);
      const dayEvents = events.filter((event) => calendarEventOccursOn(event, key)).sort(byCalendarEventTime);
      return `
        <div class="day ${key === dateKey(new Date()) ? "is-today" : ""}">
          <div class="day-title"><span>${weekday(day)}</span><span>${key.slice(5)}</span></div>
          <div class="calendar-event-list">${dayEvents.length ? dayEvents.map(renderCalendarEvent).join("") : `<div class="resource-preview">비어 있음</div>`}</div>
        </div>
      `;
    })
    .join("");
}

function renderCombinedCalendar() {
  const today = dateKey(new Date());
  const currentMonth = monthKey(new Date());
  const events = getCombinedCalendarEvents();
  const days = monthGridDays(new Date());
  return `
    <div class="calendar-month-weekdays">
      ${Array.from({ length: 7 }, (_, index) => `<span>${weekday(addDays(startOfWeek(new Date()), index))}</span>`).join("")}
    </div>
    <div class="calendar-month-grid">
      ${days.map((day) => {
        const key = dateKey(day);
        const dayEvents = events.filter((event) => calendarEventOccursOn(event, key)).sort(byCalendarEventTime);
        const visibleEvents = dayEvents.slice(0, 4);
        const overflow = dayEvents.length - visibleEvents.length;
        return `
          <div class="calendar-month-day ${monthKey(day) !== currentMonth ? "is-outside" : ""} ${key === today ? "is-today" : ""}">
            <div class="calendar-month-date"><span>${key.slice(8)}</span><small>${weekday(day)}</small></div>
            <div class="calendar-event-list">
              ${visibleEvents.map((event) => renderCalendarEvent(event, { compact: true })).join("")}
              ${overflow > 0 ? `<span class="calendar-event-more">+${overflow}</span>` : ""}
              ${dayEvents.length ? "" : `<span class="calendar-empty-dot"></span>`}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderCalendarEvent(event, options = {}) {
  const attrs = event.selectType && event.selectId ? `data-select-type="${event.selectType}" data-select-id="${event.selectId}"` : "";
  const link = event.htmlLink ? `<a class="calendar-event-open" href="${esc(event.htmlLink)}" target="_blank" rel="noreferrer" aria-label="Google Calendar에서 열기">↗</a>` : "";
  return `
    <article class="calendar-event ${event.source === "google" ? "is-google" : "is-local"} ${options.compact ? "is-compact" : ""}" ${attrs}>
      <span class="calendar-event-time">${esc(calendarEventTimeLabel(event))}</span>
      <strong>${esc(event.title || "(제목 없음)")}</strong>
      ${link}
    </article>
  `;
}

function getLocalCalendarEvents() {
  return state.tasks
    .filter((task) => (task.scheduledStart || task.dueDate) && task.status !== "done" && task.status !== "canceled")
    .map((task) => {
      const allDay = !task.scheduledStart;
      const start = task.scheduledStart || `${task.dueDate}T00:00`;
      const end = task.scheduledEnd || (task.scheduledStart ? new Date(new Date(task.scheduledStart).getTime() + (task.estimatedMinutes || 60) * 60000).toISOString() : `${task.dueDate}T23:59`);
      return {
        id: task.id,
        source: "local",
        title: task.title,
        start,
        end,
        startDate: task.scheduledStart ? dateKey(new Date(task.scheduledStart)) : task.dueDate,
        endDate: task.scheduledStart ? dateKey(new Date(end)) : task.dueDate,
        allDay,
        selectType: "tasks",
        selectId: task.id,
      };
    });
}

function getGoogleCalendarEvents() {
  return (state.googleEvents || []).filter((event) => event.status !== "cancelled");
}

function getCombinedCalendarEvents() {
  return [...getLocalCalendarEvents(), ...getGoogleCalendarEvents()];
}

function calendarEventOccursOn(event, date) {
  const start = event.startDate || dateKey(new Date(event.start));
  const end = event.endDate || start;
  return date >= start && date <= end;
}

function byCalendarEventTime(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return (a.start || a.startDate || "").localeCompare(b.start || b.startDate || "");
}

function calendarEventTimeLabel(event) {
  if (event.allDay) return "종일";
  if (!event.start) return "";
  const start = formatTime(event.start);
  const end = event.end ? formatTime(event.end) : "";
  return end && end !== start ? `${start}-${end}` : start;
}

function googleCalendarStatusLabel() {
  if (state.settings.lastGoogleFetchAt) return `불러오기 ${formatDateTime(state.settings.lastGoogleFetchAt)}`;
  if (state.settings.lastGoogleSyncAt) return `내보내기 ${formatDateTime(state.settings.lastGoogleSyncAt)}`;
  return state.settings.googleConnectedAt ? "연결됨" : "미연결";
}

function combinedCalendarRange() {
  const days = monthGridDays(new Date());
  return {
    start: dateKey(days[0]),
    endExclusive: dateKey(addDays(days[days.length - 1], 1)),
  };
}

function renderDetail(options = {}) {
  updateTaskSchedulingMode();
  const resourceNotes = renderResourceNotes(options);
  if (!ui.selected) {
    els.detailRoot.innerHTML = resourceNotes;
    decorateButtons(els.detailRoot);
    return;
  }
  const { type, id: selectedId } = ui.selected;
  const item = getCollection(type).find((entry) => entry.id === selectedId);
  if (!item) {
    ui.selected = null;
    els.detailRoot.innerHTML = resourceNotes;
    decorateButtons(els.detailRoot);
    return;
  }

  const titleField = titleFieldFor(type);
  els.detailRoot.innerHTML = `
    <aside class="detail" aria-label="상세 편집">
      <div class="detail-head">
        <input class="detail-title" data-detail-title="${titleField}" value="${esc(item[titleField] || "")}" aria-label="제목">
        <div class="toolbar">
          <button class="button ghost" type="button" data-action="delete-selected">삭제</button>
          <button class="button ghost" type="button" data-action="close-detail">닫기</button>
        </div>
      </div>
      <div class="detail-body">
        ${renderDetailFields(type, item)}
        ${item.blocks ? renderBlockEditor(type, item.id, item.blocks) : ""}
      </div>
    </aside>
    ${resourceNotes}
  `;
  decorateButtons(els.detailRoot);
}

function renderResourceNotes(options = {}) {
  return ui.resourceNotes
    .map((note) => {
      const resource = state.resources.find((entry) => entry.id === note.id);
      return resource ? renderResourceNote(resource, note, options) : "";
    })
    .join("");
}

function renderResourceNote(resource, note, options = {}) {
  const blockCount = resource.blocks?.length || 0;
  const noteStyle =
    note.mode === "floating"
      ? `left:${Math.round(note.x || 0)}px;top:${Math.round(note.y || 0)}px;z-index:${note.z || 30}`
      : `z-index:${note.z || 30}`;
  return `
    <section class="resource-note is-${note.mode} ${options.soft ? "is-soft-render" : ""}" data-resource-note="${resource.id}" style="${noteStyle}" aria-label="Resource 노트">
      <header class="resource-note-chrome" data-resource-drag="${resource.id}">
        <div class="resource-note-grip" aria-hidden="true"></div>
        <div class="resource-note-mode">
          <button class="resource-note-icon" type="button" data-resource-mode="${resource.id}" data-mode="center" aria-label="중앙 고정">□</button>
          <button class="resource-note-icon" type="button" data-resource-mode="${resource.id}" data-mode="floating" aria-label="플로팅">◇</button>
          <button class="resource-note-icon" type="button" data-resource-mode="${resource.id}" data-mode="docked" aria-label="우측 고정">▣</button>
        </div>
        <button class="resource-note-icon" type="button" data-resource-close="${resource.id}" aria-label="닫기">×</button>
      </header>
      <div class="resource-note-scroll">
        <div class="resource-note-page">
          <input class="resource-note-title" data-resource-title="${resource.id}" value="${esc(resource.title || "")}" aria-label="자료 제목">
          <div class="resource-note-subline">
            <span>Resource page</span>
            <span>${blockCount} blocks</span>
          </div>
          <button class="resource-props-toggle ${note.showProps ? "is-open" : ""}" type="button" data-resource-props="${resource.id}" aria-expanded="${note.showProps ? "true" : "false"}">
            <span>속성</span>
            <strong>${note.showProps ? "숨기기" : "보기"}</strong>
          </button>
          <div class="resource-props ${note.showProps ? "is-open" : ""}">
            ${renderDetailFields("resources", resource)}
          </div>
          ${renderBlockEditor("resources", resource.id, resource.blocks || [])}
        </div>
      </div>
    </section>
  `;
}

function renderDetailFields(type, item) {
  if (type === "tasks") {
    return renderTaskPropertyFields(item);
  }
  if (type === "projects") {
    return `
      <div class="field-grid">
        ${selectField("상태", "status", item.status, STATUSES.project)}
        ${relationField("박스", "boxId", item.boxId, state.boxes, "name")}
        ${relationField("목표", "goalId", item.goalId, state.goals, "name")}
        ${dateField("시작일", "startDate", item.startDate)}
        ${dateField("종료일", "endDate", item.endDate)}
      </div>
    `;
  }
  if (type === "goals") {
    return `
      <div class="field-grid">
        ${selectField("상태", "status", item.status, STATUSES.goal)}
        ${relationField("박스", "boxId", item.boxId, state.boxes, "name")}
        ${textField("연도", "year", item.year || "")}
        ${textField("분기", "quarter", item.quarter || "")}
        ${dateField("목표일", "targetDate", item.targetDate)}
      </div>
    `;
  }
  if (type === "boxes") {
    return `
      <div class="field-grid">
        ${selectField("구분", "visibility", item.visibility, { pinned: "고정", normal: "일반", archived: "아카이브" })}
        ${selectField("색상", "color", item.color, { blue: "Blue", teal: "Teal", amber: "Amber", violet: "Violet", rose: "Rose" })}
      </div>
    `;
  }
  if (type === "resources") {
    return `
      <div class="field-grid">
        ${selectField("분류", "type", item.type, { quick_note: "간단 메모", note: "노트", scrap: "스크랩", thought: "생각", reflection: "회고" })}
        ${selectField("중요도", "importance", item.importance, { normal: "일반", important: "중요", archived: "아카이브" })}
        ${relationField("박스", "boxId", item.boxId, state.boxes, "name")}
        ${relationField("목표", "goalId", item.goalId, state.goals, "name")}
        ${relationField("프로젝트", "projectId", item.projectId, state.projects, "name")}
        ${textField("URL", "url", item.url || "")}
        ${checkboxField("고정", "pinned", item.pinned)}
        ${checkboxField("나중에 보기", "readLater", item.readLater)}
      </div>
    `;
  }
  if (type === "habits") {
    return `
      <div class="field-grid">
        ${selectField("상태", "status", item.status, { active: "활성", paused: "중단", archived: "보관" })}
        ${selectField("주기", "cadence", item.cadence, { daily: "매일", weekdays: "평일", weekly: "주간" })}
        ${textField("목표", "target", item.target || "")}
        ${relationField("박스", "boxId", item.boxId, state.boxes, "name")}
        ${relationField("프로젝트", "projectId", item.projectId, state.projects, "name")}
      </div>
    `;
  }
  if (type === "journals") {
    return `
      <div class="field-grid">
        ${dateField("날짜", "date", item.date)}
        ${numberField("만족도", "satisfaction", item.satisfaction || 0)}
      </div>
    `;
  }
  if (type === "obstacles") {
    return `
      <div class="field-grid">
        ${selectField("상태", "status", item.status, STATUSES.obstacle)}
        ${numberField("심각도", "severity", item.severity || 1)}
        ${relationField("박스", "boxId", item.boxId, state.boxes, "name")}
        ${relationField("프로젝트", "projectId", item.projectId, state.projects, "name")}
        ${relationField("할 일", "taskId", item.taskId, state.tasks, "title")}
      </div>
    `;
  }
  if (type === "captures") {
    return `
      <div class="field-grid">
        ${selectField("상태", "status", item.status, { inbox: "Inbox", processed: "처리됨", archived: "보관" })}
        ${textField("URL", "url", item.url || "")}
        ${textField("변환 대상", "convertedTo", item.convertedTo || "")}
      </div>
    `;
  }
  return "";
}

function renderTaskPropertyFields(task, options = {}) {
  const className = options.className ? ` ${options.className}` : "";
  return `
    <div class="field-grid${className}">
      ${options.includeTitle ? textField("제목", "title", task.title || "") : ""}
      ${dateField("날짜", "dueDate", task.dueDate)}
      ${relationField("박스", "boxId", task.boxId, state.boxes, "name")}
      ${relationField("목표", "goalId", task.goalId, state.goals, "name")}
      ${relationField("프로젝트", "projectId", task.projectId, state.projects, "name")}
      ${relationField("자료", "resourceId", task.resourceId, state.resources, "title")}
    </div>
  `;
}

function renderBlockEditor(type, ownerId, blocksList) {
  const owner = getCollection(type).find((entry) => entry.id === ownerId);
  const safeBlocks = ensureEditableBlocks(owner || { blocks: blocksList });
  return `
    <div class="panel" style="box-shadow:none;background:rgba(255,255,255,.48)">
      ${panelHeader("본문", "Block editor")}
      <div class="block-editor" data-owner-type="${type}" data-owner-id="${ownerId}">
        ${safeBlocks.map((block) => renderBlock(block, type, ownerId)).join("")}
      </div>
    </div>
  `;
}

function renderInlineBlockEditor(type, ownerId, blocksList) {
  const owner = getCollection(type).find((entry) => entry.id === ownerId);
  const safeBlocks = ensureEditableBlocks(owner || { blocks: blocksList });
  return `
    <div class="task-inline-notes">
      <div class="task-inline-section-head">
        <strong>추가 메모</strong>
        <span>Block editor</span>
      </div>
      <div class="block-editor" data-owner-type="${type}" data-owner-id="${ownerId}">
        ${safeBlocks.map((block) => renderBlock(block, type, ownerId)).join("")}
      </div>
    </div>
  `;
}

function renderBlock(block, ownerType = "", ownerId = "") {
  const isSelected =
    ui.blockSelection.ownerType === ownerType &&
    ui.blockSelection.ownerId === ownerId &&
    ui.blockSelection.ids.includes(block.id);
  if (block.type === "divider") {
    return `
      <div class="block ${isSelected ? "is-selected" : ""}" data-block-id="${block.id}" data-type="divider" data-checked="false">
        <button class="block-drag-handle" type="button" data-block-drag="${block.id}" aria-label="블록 이동">::</button>
        <button class="block-tool" type="button" data-block-add="${block.id}" aria-label="블록 추가">+</button>
        <div class="block-divider" role="separator"></div>
      </div>
    `;
  }
  return `
    <div class="block ${isSelected ? "is-selected" : ""}" data-block-id="${block.id}" data-type="${block.type}" data-checked="${block.checked ? "true" : "false"}">
      <button class="block-drag-handle" type="button" data-block-drag="${block.id}" aria-label="블록 이동">::</button>
      <button class="block-tool" type="button" data-block-add="${block.id}" aria-label="블록 추가">+</button>
      ${block.type === "todo" ? `<button class="block-check ${block.checked ? "is-done" : ""}" type="button" data-block-check="${block.id}" aria-label="체크" aria-pressed="${block.checked ? "true" : "false"}"></button>` : ""}
      ${block.type === "toggle" ? `<button class="block-toggle" type="button" aria-label="토글 열기" aria-expanded="false">▸</button>` : ""}
      <div class="block-content ${block.text ? "" : "is-empty"}" contenteditable="true" spellcheck="true" data-block-content="${block.id}" data-placeholder="/ 입력">${esc(block.text || "")}</div>
    </div>
  `;
}

function ensureEditableBlocks(item) {
  if (!item.blocks) item.blocks = [];
  if (!item.blocks.length || item.blocks.every((block) => block.type === "divider")) {
    item.blocks.push({ id: id(), type: "paragraph", text: "", checked: false });
    saveState();
  }
  return item.blocks;
}

function renderOverlays() {
  updateTaskSchedulingMode();
  els.overlayRoot.innerHTML = `
    ${ui.commandOpen ? renderCommandMenu() : ""}
    ${ui.slash ? renderSlashMenu() : ""}
    ${ui.scheduler ? renderTaskScheduler() : ""}
  `;
  decorateButtons(els.overlayRoot);
}

function updateTaskSchedulingMode() {
  app.classList.toggle("is-task-scheduling", Boolean(ui.scheduler?.dragging && ui.view === "tasks"));
  app.classList.toggle("has-docked-resource", ui.resourceNotes.some((note) => note.mode === "docked"));
}

function renderTaskScheduler() {
  const scheduler = ui.scheduler;
  const task = state.tasks.find((entry) => entry.id === scheduler?.taskId);
  if (!scheduler || !task) return "";
  const monthDate = parseMonthKey(scheduler.month);
  const today = dateKey(new Date());
  const scheduledDate = task.scheduledStart?.slice(0, 10) || task.dueDate || "";
  const days = monthGridDays(monthDate);
  const laneTargets = schedulerLaneTargets(task.id);
  const prevMonth = addMonths(monthDate, -1);
  const nextMonth = addMonths(monthDate, 1);
  return `
    <div class="task-scheduler-backdrop" aria-hidden="true"></div>
    <div class="task-scheduler-stage ${scheduler.monthEdge ? `is-edge-${scheduler.monthEdge}` : ""}" role="dialog" aria-label="Task 날짜 배치">
      <div class="task-scheduler-lanes" aria-label="Task 배치 칸">
        ${laneTargets.map((lane) => `
          <button class="task-scheduler-lane ${lane.targetKey === scheduler.dragOverTarget ? "is-drop-target" : ""}" type="button" ${lane.date ? `data-scheduler-date="${lane.date}"` : ""} ${lane.action ? `data-scheduler-action="${lane.action}"` : ""} data-scheduler-lane="${lane.key}">
            <span>
              <strong>${esc(lane.title)}</strong>
              <em>${esc(lane.meta)}</em>
            </span>
            <small>${lane.count}</small>
          </button>
        `).join("")}
      </div>
      <div class="task-scheduler-month-zone is-prev" aria-hidden="true">
        <span>${esc(monthSideLabel(prevMonth))}</span>
      </div>
      <div class="task-scheduler">
        <div class="task-scheduler-head">
          <div>
            <strong>${esc(monthLabel(monthDate))}</strong>
            <span>${esc(task.title)}</span>
          </div>
          <div class="task-scheduler-nav">
            <button class="task-scheduler-nav-button" type="button" data-scheduler-month="${monthKey(addMonths(monthDate, -1))}" aria-label="이전 달">‹</button>
            <button class="task-scheduler-nav-button" type="button" data-scheduler-month="${monthKey(new Date())}">오늘</button>
            <button class="task-scheduler-nav-button" type="button" data-scheduler-month="${monthKey(addMonths(monthDate, 1))}" aria-label="다음 달">›</button>
            <button class="task-scheduler-nav-button" type="button" data-scheduler-close aria-label="닫기">닫기</button>
          </div>
        </div>
        <div class="task-scheduler-weekdays">
          ${["월", "화", "수", "목", "금", "토", "일"].map((day) => `<span>${day}</span>`).join("")}
        </div>
        <div class="task-scheduler-grid">
          ${days.map((day) => {
            const key = dateKey(day);
            const outside = day.getMonth() !== monthDate.getMonth();
            const count = state.tasks.filter((entry) => isTaskOnDate(entry, key) && entry.status !== "done" && entry.id !== task.id).length;
            return `
              <button class="task-scheduler-day ${outside ? "is-outside" : ""} ${key === today ? "is-today" : ""} ${key === scheduledDate ? "is-selected" : ""} ${`date:${key}` === scheduler.dragOverTarget ? "is-drop-target" : ""}" type="button" data-scheduler-date="${key}">
                <span>${day.getDate()}</span>
                ${count ? `<small>${count}</small>` : ""}
              </button>
            `;
          }).join("")}
        </div>
      </div>
      <div class="task-scheduler-month-zone is-next" aria-hidden="true">
        <span>${esc(monthSideLabel(nextMonth))}</span>
      </div>
    </div>
    ${
      scheduler.dragging
        ? `<div class="schedule-drag-ghost" style="left:${scheduler.dragX}px;top:${scheduler.dragY}px;width:${scheduler.dragWidth}px">
            <strong>${esc(task.title)}</strong>
            <span>날짜 칸에 놓기</span>
          </div>`
        : ""
    }
  `;
}

function renderSlashMenu() {
  const { x, y, ownerType, ownerId, blockId, selectedIndex = 0 } = ui.slash;
  const entries = Object.entries(BLOCK_TYPES);
  return `
    <div class="slash-menu" style="left:${x}px;top:${y}px" role="menu" aria-label="블록 서식">
      ${entries
        .map(([type, [label, icon]], index) => `
          <button class="menu-item ${index === selectedIndex ? "is-active" : ""}" type="button" role="menuitem" data-slash-index="${index}" data-block-type="${type}" data-owner-type="${ownerType}" data-owner-id="${ownerId}" data-block-id="${blockId}" ${index === selectedIndex ? `aria-current="true"` : ""}>
            <span class="menu-icon">${icon}</span>
            <span class="menu-text"><strong>${esc(label)}</strong><span>${esc(type)}</span></span>
          </button>
        `)
        .join("")}
    </div>
  `;
}

function renderCommandMenu() {
  const commands = [
    ["new-task", "✓", "새 할 일", "실행 항목"],
    ["new-project", "▦", "새 프로젝트", "작업 묶음"],
    ["new-goal", "◎", "새 목표", "결과 목표"],
    ["new-resource", "≡", "새 자료", "block editor 노트"],
    ["new-habit", "◌", "새 루틴", "반복 관리"],
    ["new-journal", "✎", "새 리뷰", "회고"],
    ["new-obstacle", "!", "새 이슈", "병목/리스크"],
    ["new-box", "□", "새 박스", "삶의 영역"],
  ];
  return `
    <div class="command-menu" style="right:24px;bottom:92px">
      ${commands
        .map(([action, icon, title, desc]) => `
          <button class="menu-item" type="button" data-action="${action}">
            <span class="menu-icon">${icon}</span>
            <span class="menu-text"><strong>${title}</strong><span>${desc}</span></span>
          </button>
        `)
        .join("")}
    </div>
  `;
}

function textField(label, field, value) {
  return `<label class="field"><span>${esc(label)}</span><input class="input" data-field="${field}" value="${esc(value)}"></label>`;
}

function numberField(label, field, value) {
  return `<label class="field"><span>${esc(label)}</span><input class="input" type="number" data-field="${field}" value="${Number(value) || 0}"></label>`;
}

function dateField(label, field, value) {
  return `<label class="field"><span>${esc(label)}</span><input class="input" type="date" data-field="${field}" value="${esc(value || "")}"></label>`;
}

function checkboxField(label, field, value) {
  return `
    <label class="field">
      <span>${esc(label)}</span>
      <select class="select" data-field="${field}">
        <option value="true" ${value ? "selected" : ""}>예</option>
        <option value="false" ${!value ? "selected" : ""}>아니오</option>
      </select>
    </label>
  `;
}

function selectField(label, field, value, options) {
  return `
    <label class="field">
      <span>${esc(label)}</span>
      <select class="select" data-field="${field}">
        ${Object.entries(options)
          .map(([key, text]) => `<option value="${esc(key)}" ${value === key ? "selected" : ""}>${esc(text)}</option>`)
          .join("")}
      </select>
    </label>
  `;
}

function relationField(label, field, value, items, nameField) {
  return `
    <label class="field">
      <span>${esc(label)}</span>
      <select class="select" data-field="${field}">
        <option value="">없음</option>
        ${items
          .map((item) => `<option value="${item.id}" ${value === item.id ? "selected" : ""}>${esc(item[nameField])}</option>`)
          .join("")}
      </select>
    </label>
  `;
}

function handleClick(event) {
  const clickedBlockContent = event.target.closest("[data-block-content]");
  if (clickedBlockContent) activateBlockContent(clickedBlockContent);

  if (
    event.target.closest("[data-schedule-hold], [data-scheduler-open]") &&
    (ui.suppressTaskClickUntil > Date.now() || Date.now() - ui.lastScheduleDragEndedAt < 1200)
  ) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  const captureZone = event.target.closest("[data-capture-zone]");
  if (captureZone) {
    if (!event.target.closest("button")) {
      captureZone.querySelector("input")?.focus();
    }
  }

  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    setView(viewButton.dataset.view, { navTarget: viewButton });
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    handleAction(actionButton.dataset.action);
    return;
  }

  const toggleTask = event.target.closest("[data-toggle-task]");
  if (toggleTask) {
    event.stopPropagation();
    toggleTaskDone(toggleTask.dataset.toggleTask, toggleTask);
    return;
  }

  const toggleHabit = event.target.closest("[data-toggle-habit]");
  if (toggleHabit) {
    event.stopPropagation();
    toggleHabitDone(toggleHabit.dataset.toggleHabit, toggleHabit.dataset.habitDate, toggleHabit);
    return;
  }

  const resourceNote = event.target.closest("[data-resource-note]");
  if (resourceNote) {
    bringResourceNote(resourceNote.dataset.resourceNote);
  }

  const resourceClose = event.target.closest("[data-resource-close]");
  if (resourceClose) {
    event.preventDefault();
    event.stopPropagation();
    closeResourceNote(resourceClose.dataset.resourceClose);
    return;
  }

  const resourceMode = event.target.closest("[data-resource-mode]");
  if (resourceMode) {
    event.preventDefault();
    event.stopPropagation();
    setResourceNoteMode(resourceMode.dataset.resourceMode, resourceMode.dataset.mode);
    return;
  }

  const resourceProps = event.target.closest("[data-resource-props]");
  if (resourceProps) {
    event.preventDefault();
    event.stopPropagation();
    toggleResourceProps(resourceProps.dataset.resourceProps);
    return;
  }

  const openResource = event.target.closest("[data-open-resource]");
  if (openResource) {
    event.preventDefault();
    event.stopPropagation();
    openResourceNote(openResource.dataset.openResource);
    return;
  }

  const todayTaskToggle = event.target.closest("[data-task-inline-toggle]");
  if (todayTaskToggle && ui.view === "today" && !event.target.closest("button")) {
    event.preventDefault();
    event.stopPropagation();
    toggleTodayTaskDetail(todayTaskToggle.dataset.taskInlineToggle);
    return;
  }

  const projectToggle = event.target.closest("[data-project-toggle]");
  if (projectToggle) {
    event.preventDefault();
    event.stopPropagation();
    toggleProjectDetail(projectToggle.dataset.projectToggle);
    return;
  }

  const habitEdit = event.target.closest("[data-habit-edit]");
  if (habitEdit) {
    event.preventDefault();
    event.stopPropagation();
    openHabitEditor(habitEdit.dataset.habitEdit);
    return;
  }

  const habitToggle = event.target.closest("[data-habit-toggle]");
  if (habitToggle) {
    event.preventDefault();
    event.stopPropagation();
    toggleHabitDetail(habitToggle.dataset.habitToggle);
    return;
  }

  const taskFlowSurface = event.target.closest("[data-task-flow]");
  const taskFlowControl = event.target.closest("[data-task-flow-choice], [data-task-flow-jump], [data-task-flow-save], [data-task-flow-cancel]");
  if (taskFlowSurface && !taskFlowControl) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  const taskFlowChoice = event.target.closest("[data-task-flow-choice]");
  if (taskFlowChoice) {
    event.stopPropagation();
    selectTaskFlowChoice(taskFlowChoice.dataset.taskFlowChoice, taskFlowChoice.dataset.flowStep, taskFlowChoice.dataset.flowValue || "");
    return;
  }

  const taskFlowJump = event.target.closest("[data-task-flow-jump]");
  if (taskFlowJump) {
    event.stopPropagation();
    jumpTaskFlowStep(taskFlowJump.dataset.taskFlowJump, taskFlowJump.dataset.flowStep);
    return;
  }

  const taskFlowSave = event.target.closest("[data-task-flow-save]");
  if (taskFlowSave) {
    event.stopPropagation();
    saveTaskFlow(taskFlowSave.dataset.taskFlowSave);
    return;
  }

  const taskFlowCancel = event.target.closest("[data-task-flow-cancel]");
  if (taskFlowCancel) {
    event.stopPropagation();
    cancelTaskFlow(taskFlowCancel.dataset.taskFlowCancel);
    return;
  }

  const schedulerOpen = event.target.closest("[data-scheduler-open]");
  if (schedulerOpen) {
    event.preventDefault();
    event.stopPropagation();
    cancelScheduleDrag();
    const rect = schedulerOpen.getBoundingClientRect();
    openTaskScheduler(schedulerOpen.dataset.schedulerOpen, rect.left + rect.width / 2, rect.bottom + 8);
    return;
  }

  const schedulerDate = event.target.closest("[data-scheduler-date]");
  if (schedulerDate) {
    event.stopPropagation();
    scheduleTaskFromScheduler(schedulerDate.dataset.schedulerDate);
    return;
  }

  const schedulerAction = event.target.closest("[data-scheduler-action]");
  if (schedulerAction) {
    event.stopPropagation();
    scheduleTaskActionFromScheduler(schedulerAction.dataset.schedulerAction);
    return;
  }

  const schedulerMonth = event.target.closest("[data-scheduler-month]");
  if (schedulerMonth) {
    event.stopPropagation();
    if (ui.scheduler) {
      ui.scheduler.month = schedulerMonth.dataset.schedulerMonth;
      renderOverlays();
    }
    return;
  }

  const schedulerClose = event.target.closest("[data-scheduler-close]");
  if (schedulerClose) {
    event.stopPropagation();
    closeTaskScheduler();
    return;
  }

  const scheduleCard = event.target.closest("[data-schedule-hold]");
  if (scheduleCard && !event.target.closest("[data-toggle-task]")) {
    event.preventDefault();
    event.stopPropagation();
    const rect = scheduleCard.getBoundingClientRect();
    openTaskScheduler(scheduleCard.dataset.scheduleHold, event.clientX || rect.left + rect.width / 2, event.clientY || rect.top + rect.height / 2);
    return;
  }

  const convert = event.target.closest("[data-convert]");
  if (convert) {
    event.stopPropagation();
    if (["tasks", "projects", "resources", "goals", "boxes"].includes(convert.dataset.convert)) {
      startTaskFlow(convert.dataset.captureId, convert.dataset.convert);
    } else {
      convertCapture(convert.dataset.captureId, convert.dataset.convert);
    }
    return;
  }

  const select = event.target.closest("[data-select-type]");
  if (select && !event.target.closest("button")) {
    if (select.dataset.selectType === "resources") {
      openResourceNote(select.dataset.selectId);
      return;
    }
    ui.selected = { type: select.dataset.selectType, id: select.dataset.selectId };
    ui.commandOpen = false;
    ui.slash = null;
    renderDetail();
    renderOverlays();
    return;
  }

  const addBlock = event.target.closest("[data-block-add]");
  if (addBlock) {
    const editor = addBlock.closest(".block-editor");
    insertBlock(editor.dataset.ownerType, editor.dataset.ownerId, addBlock.dataset.blockAdd);
    return;
  }

  const blockCheck = event.target.closest("[data-block-check]");
  if (blockCheck) {
    event.preventDefault();
    event.stopPropagation();
    const editor = blockCheck.closest(".block-editor");
    toggleBlockChecked(editor.dataset.ownerType, editor.dataset.ownerId, blockCheck.dataset.blockCheck, blockCheck);
    return;
  }

  const blockType = event.target.closest("[data-block-type]");
  if (blockType) {
    event.preventDefault();
    event.stopPropagation();
    changeBlockType(blockType.dataset.ownerType, blockType.dataset.ownerId, blockType.dataset.blockId, blockType.dataset.blockType);
    return;
  }
}

function handleAction(action) {
  if (action === "toggle-nav") {
    resetNavShortcutState({ closeAutoOpened: false });
    if (ui.navOpen) {
      closeNav();
    } else {
      openNav();
    }
    return;
  }
  if (action === "close-nav") {
    resetNavShortcutState({ closeAutoOpened: false });
    closeNav();
    return;
  }
  if (action === "open-command") {
    ui.commandOpen = !ui.commandOpen;
    ui.slash = null;
    renderOverlays();
    return;
  }
  ui.commandOpen = false;
  renderOverlays();

  if (action === "close-detail") {
    ui.selected = null;
    renderDetail();
    return;
  }
  if (action === "delete-selected") return deleteSelected();
  if (action === "new-task") return createTask();
  if (action === "new-project") return createProject();
  if (action === "new-goal") return createGoal();
  if (action === "new-box") return createBox();
  if (action === "new-resource") return createResource();
  if (action === "new-habit") return createHabit();
  if (action === "new-journal") return createJournal();
  if (action === "new-obstacle") return createObstacle();
  if (action === "new-capture") return createCapture();
  if (action === "connect-google") return connectGoogle();
  if (action === "fetch-google") return fetchGoogleCalendarEvents();
  if (action === "sync-google") return syncGoogleCalendar();
  if (action === "export-json") return exportJson();
  if (action === "notion-final-sync") return showToast("최종 1회 Notion 동기화 지점입니다. 지금은 로컬 DB가 기준입니다.");
  if (action === "reset-demo-data") return resetDemoData();
}

function handleSubmit(event) {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  if (form.dataset.form === "quick-capture") {
    const input = form.elements.title;
    const title = input.value.trim();
    if (!title) return;
    state.captures.push({
      id: id(),
      title,
      url: extractUrl(title),
      status: "inbox",
      convertedTo: "",
      convertedId: "",
      createdAt: new Date().toISOString(),
      processedAt: "",
    });
    input.value = "";
    saveState();
    showToast("Inbox에 수집했습니다.");
    if (["inbox", "today", "database"].includes(ui.view)) renderView({ soft: true });
  }
}

function handleInput(event) {
  const search = event.target.closest("[data-action-input='search']");
  if (search) {
    ui.search = search.value;
    renderView({ soft: true });
    return;
  }

  const resourceTitle = event.target.closest("[data-resource-title]");
  if (resourceTitle) {
    const resource = state.resources.find((entry) => entry.id === resourceTitle.dataset.resourceTitle);
    if (!resource) return;
    resource.title = resourceTitle.value;
    saveState();
    renderView({ soft: true });
    return;
  }

  const titleInput = event.target.closest("[data-detail-title]");
  if (titleInput && ui.selected) {
    const item = selectedItem();
    if (!item) return;
    item[titleInput.dataset.detailTitle] = titleInput.value;
    saveState();
    renderView({ soft: true });
    return;
  }

  const blockContent = event.target.closest("[data-block-content]");
  if (blockContent) {
    updateBlockText(blockContent);
    return;
  }

  const setting = event.target.closest("[data-setting]");
  if (setting) {
    state.settings[setting.dataset.setting] = setting.value;
    saveState();
  }
}

function handleChange(event) {
  const field = event.target.closest("[data-field]");
  if (!field) return;
  const resourceNote = field.closest("[data-resource-note]");
  const inlineOwner = field.closest("[data-inline-owner-type][data-inline-owner-id]");
  const inlineType = inlineOwner?.dataset.inlineOwnerType || "";
  const item = resourceNote
    ? state.resources.find((entry) => entry.id === resourceNote.dataset.resourceNote)
    : inlineOwner
      ? getCollection(inlineType).find((entry) => entry.id === inlineOwner.dataset.inlineOwnerId)
    : ui.selected
      ? selectedItem()
      : null;
  if (!item) return;
  let value = field.value;
  if (value === "true") value = true;
  if (value === "false") value = false;
  if (field.type === "number") value = Number(value);
  const ownerType = resourceNote ? "resources" : inlineType || ui.selected?.type || "";
  applyFieldValue(ownerType, item, field.dataset.field, value);
  saveState();
  renderView({ soft: true });
  renderDetail({ soft: Boolean(resourceNote) });
}

function applyFieldValue(ownerType, item, fieldName, value) {
  if (ownerType === "tasks") {
    applyTaskFieldValue(item, fieldName, value);
    return;
  }
  item[fieldName] = value;
}

function applyTaskFieldValue(task, fieldName, value) {
  if (fieldName === "dueDate") {
    setTaskDate(task, value);
    return;
  }

  task[fieldName] = value;

  if (fieldName === "status") {
    task.completedAt = value === "done" ? task.completedAt || new Date().toISOString() : "";
  }

  if (["boxId", "goalId", "projectId", "resourceId"].includes(fieldName)) {
    normalizeTaskRelations(task, fieldName);
  }
}

function handleBeforeInput(event) {
  const blockContent = event.target.closest("[data-block-content]");
  if (!blockContent) return;
  if (event.inputType === "insertParagraph" && !event.shiftKey) {
    event.preventDefault();
    const editor = blockContent.closest(".block-editor");
    insertBlockFromCaret(editor.dataset.ownerType, editor.dataset.ownerId, blockContent.dataset.blockContent, blockContent);
    return;
  }
  if (event.inputType === "insertText" && event.data === "/" && blockContent.textContent === "") {
    const editor = blockContent.closest(".block-editor");
    requestAnimationFrame(() => openSlashMenu(blockContent, editor.dataset.ownerType, editor.dataset.ownerId, blockContent.dataset.blockContent));
  }
}

function handleFocusIn(event) {
  const blockContent = event.target.closest("[data-block-content]");
  if (!blockContent) return;
  activateBlockContent(blockContent);
}

function handleFocusOut(event) {
  const blockContent = event.target.closest("[data-block-content]");
  if (!blockContent) return;
  blockContent.classList.remove("is-active");
  if (ui.activeBlockId === blockContent.dataset.blockContent) ui.activeBlockId = "";
}

function activateBlockContent(blockContent) {
  clearBlockSelection();
  ui.activeBlockId = blockContent.dataset.blockContent;
  app.querySelectorAll(".block-content.is-active").forEach((entry) => entry.classList.remove("is-active"));
  blockContent.classList.toggle("is-empty", (blockContent.textContent || "") === "");
  blockContent.classList.add("is-active");
}

function deactivateActiveBlockContent() {
  ui.activeBlockId = "";
  app.querySelectorAll(".block-content.is-active").forEach((entry) => entry.classList.remove("is-active"));
}

function openResourceNote(resourceId, options = {}) {
  const resource = state.resources.find((entry) => entry.id === resourceId);
  if (!resource) return;
  const existing = ui.resourceNotes.find((note) => note.id === resourceId);
  if (existing) {
    existing.z = ++ui.resourceNoteZ;
    if (options.mode) existing.mode = options.mode;
  } else {
    ui.resourceNotes.push({
      id: resourceId,
      mode: options.mode || "center",
      x: Math.round(window.innerWidth / 2 - 390),
      y: Math.max(48, Math.round(window.innerHeight / 2 - 330)),
      z: ++ui.resourceNoteZ,
      showProps: false,
    });
  }
  ui.selected = null;
  ui.commandOpen = false;
  ui.slash = null;
  renderDetail();
}

function closeResourceNote(resourceId) {
  ui.resourceNotes = ui.resourceNotes.filter((note) => note.id !== resourceId);
  if (ui.resourceDrag?.id === resourceId) ui.resourceDrag = null;
  renderDetail();
}

function bringResourceNote(resourceId) {
  const note = ui.resourceNotes.find((entry) => entry.id === resourceId);
  if (!note) return;
  note.z = ++ui.resourceNoteZ;
  const element = document.querySelector(`[data-resource-note="${resourceId}"]`);
  if (element) element.style.zIndex = note.z;
}

function setResourceNoteMode(resourceId, mode, position = {}) {
  const note = ui.resourceNotes.find((entry) => entry.id === resourceId);
  if (!note) return;
  if (mode === "docked") {
    ui.resourceNotes.forEach((entry) => {
      if (entry.id !== resourceId && entry.mode === "docked") {
        entry.mode = "floating";
        entry.x = Math.max(40, window.innerWidth * 0.08);
        entry.y = 80;
      }
    });
  }
  note.mode = mode;
  if (position.x !== undefined) note.x = position.x;
  if (position.y !== undefined) note.y = position.y;
  note.z = ++ui.resourceNoteZ;
  renderDetail();
}

function toggleResourceProps(resourceId) {
  const note = ui.resourceNotes.find((entry) => entry.id === resourceId);
  if (!note) return;
  note.showProps = !note.showProps;
  const element = document.querySelector(`[data-resource-note="${resourceId}"]`);
  const toggle = element?.querySelector(`[data-resource-props="${resourceId}"]`);
  const props = element?.querySelector(".resource-props");
  if (!toggle || !props) {
    renderDetail({ soft: true });
    return;
  }
  toggle.classList.toggle("is-open", note.showProps);
  toggle.setAttribute("aria-expanded", note.showProps ? "true" : "false");
  toggle.querySelector("strong").textContent = note.showProps ? "숨기기" : "보기";
  props.classList.toggle("is-open", note.showProps);
}

function beginResourceDrag(resourceId, event) {
  const note = ui.resourceNotes.find((entry) => entry.id === resourceId);
  const element = document.querySelector(`[data-resource-note="${resourceId}"]`);
  if (!note || !element) return;
  bringResourceNote(resourceId);
  const rect = element.getBoundingClientRect();
  ui.resourceDrag = {
    id: resourceId,
    pointerId: event.pointerId ?? "mouse",
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
  };
  note.mode = "floating";
  note.x = rect.left;
  note.y = rect.top;
  try {
    element.setPointerCapture?.(event.pointerId);
  } catch (_) {}
  element.classList.add("is-dragging");
  event.preventDefault();
  syncResourceNoteElement(note);
}

function handleResourcePointerMove(event) {
  const drag = ui.resourceDrag;
  if (!drag) return;
  if (event.pointerId !== undefined && drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  const note = ui.resourceNotes.find((entry) => entry.id === drag.id);
  if (!note) return;
  const nextX = event.clientX - drag.offsetX;
  const nextY = event.clientY - drag.offsetY;
  const shouldDock = event.clientX > window.innerWidth * 0.72;
  if (shouldDock) {
    if (note.mode !== "docked") {
      note.mode = "docked";
      ui.resourceNotes.forEach((entry) => {
        if (entry.id !== note.id && entry.mode === "docked") {
          entry.mode = "floating";
          entry.x = Math.max(40, window.innerWidth * 0.08);
          entry.y = 80;
        }
      });
    }
  } else {
    note.mode = "floating";
    note.x = Math.min(window.innerWidth - 360, Math.max(24, nextX));
    note.y = Math.min(window.innerHeight - 180, Math.max(24, nextY));
  }
  ui.resourceNotes.forEach(syncResourceNoteElement);
}

function finishResourceDrag(event) {
  if (!ui.resourceDrag) return;
  if (event.pointerId !== undefined && ui.resourceDrag.pointerId !== event.pointerId) return;
  document.querySelector(`[data-resource-note="${ui.resourceDrag.id}"]`)?.classList.remove("is-dragging");
  ui.resourceDrag = null;
}

function cancelResourceDrag() {
  if (ui.resourceDrag) {
    document.querySelector(`[data-resource-note="${ui.resourceDrag.id}"]`)?.classList.remove("is-dragging");
  }
  ui.resourceDrag = null;
}

function syncResourceNoteElement(note) {
  const element = document.querySelector(`[data-resource-note="${note.id}"]`);
  if (!element) return;
  element.classList.toggle("is-center", note.mode === "center");
  element.classList.toggle("is-floating", note.mode === "floating");
  element.classList.toggle("is-docked", note.mode === "docked");
  element.style.zIndex = note.z || 30;
  if (note.mode === "floating") {
    element.style.left = `${Math.round(note.x || 0)}px`;
    element.style.top = `${Math.round(note.y || 0)}px`;
  } else {
    element.style.left = "";
    element.style.top = "";
  }
  updateTaskSchedulingMode();
}

function beginBlockDrag(blockId, event) {
  const block = event.target.closest(".block");
  const editor = event.target.closest(".block-editor");
  if (!block || !editor) return;
  const ownerType = editor.dataset.ownerType;
  const ownerId = editor.dataset.ownerId;
  const existingSelection =
    ui.blockSelection.ownerType === ownerType &&
    ui.blockSelection.ownerId === ownerId &&
    ui.blockSelection.ids.includes(blockId)
      ? orderedSelectedBlockIds(editor)
      : [];
  const dragIds = existingSelection.length ? existingSelection : [blockId];
  if (!existingSelection.length) clearBlockSelection();
  ui.blockDrag = {
    ownerType,
    ownerId,
    blockId,
    dragIds,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    targetId: "",
    position: "after",
  };
  dragIds.forEach((id) => {
    editor.querySelector(`[data-block-id="${id}"]`)?.classList.add("is-block-drag-source");
  });
  try {
    event.target.setPointerCapture?.(event.pointerId);
  } catch (_) {}
  event.preventDefault();
  event.stopPropagation();
}

function handleBlockPointerMove(event) {
  const drag = ui.blockDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  if (!drag.active && distance < 5) return;
  drag.active = true;
  event.preventDefault();
  event.stopPropagation();
  const target = blockDragTargetFromPoint(drag.ownerType, drag.ownerId, event.clientX, event.clientY);
  setBlockDropTarget(target);
}

function finishBlockDrag(event) {
  const drag = ui.blockDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  cleanupBlockDragClasses();
  ui.blockDrag = null;
  if (!drag.active || !drag.targetId) return;
  moveBlocks(drag.ownerType, drag.ownerId, drag.dragIds || [drag.blockId], drag.targetId, drag.position);
}

function cancelBlockDrag(event) {
  if (event?.pointerId !== undefined && ui.blockDrag?.pointerId !== event.pointerId) return;
  cleanupBlockDragClasses();
  ui.blockDrag = null;
}

function blockDragTargetFromPoint(ownerType, ownerId, clientX, clientY) {
  const editor = document.querySelector(`.block-editor[data-owner-type="${ownerType}"][data-owner-id="${ownerId}"]`);
  if (!editor) return {};
  const dragIds = ui.blockDrag?.dragIds || [ui.blockDrag?.blockId].filter(Boolean);
  const blocksList = Array.from(editor.querySelectorAll(".block")).filter((block) => !dragIds.includes(block.dataset.blockId));
  if (!blocksList.length) return {};
  const editorRect = editor.getBoundingClientRect();
  const editorGutter = Number.parseFloat(getComputedStyle(editor).getPropertyValue("--resource-editor-gutter")) || 112;
  if (clientX < editorRect.left - editorGutter || clientX > editorRect.right + editorGutter || clientY < editorRect.top - 80 || clientY > editorRect.bottom + 120) {
    return {};
  }
  const matched = blocksList.find((entry) => {
    const rect = entry.getBoundingClientRect();
    return clientY >= rect.top && clientY <= rect.bottom;
  });
  const targetBlock = matched || (clientY < blocksList[0].getBoundingClientRect().top ? blocksList[0] : blocksList[blocksList.length - 1]);
  const rect = targetBlock.getBoundingClientRect();
  return {
    element: targetBlock,
    targetId: targetBlock.dataset.blockId,
    position: clientY < rect.top + rect.height / 2 ? "before" : "after",
  };
}

function setBlockDropTarget(target = {}) {
  if (!ui.blockDrag) return;
  if (ui.blockDrag.targetId === target.targetId && ui.blockDrag.position === target.position) return;
  cleanupBlockDropClasses();
  ui.blockDrag.targetId = target.targetId || "";
  ui.blockDrag.position = target.position || "after";
  if (!target.element || (ui.blockDrag.dragIds || [ui.blockDrag.blockId]).includes(target.targetId)) return;
  target.element.classList.add(target.position === "before" ? "is-block-drop-before" : "is-block-drop-after");
}

function cleanupBlockDropClasses() {
  document.querySelectorAll(".is-block-drop-before, .is-block-drop-after").forEach((entry) => {
    entry.classList.remove("is-block-drop-before", "is-block-drop-after");
  });
}

function cleanupBlockDragClasses() {
  cleanupBlockDropClasses();
  document.querySelectorAll(".is-block-drag-source").forEach((entry) => entry.classList.remove("is-block-drag-source"));
}

function moveBlocks(ownerType, ownerId, blockIds, targetId, position) {
  if (!blockIds.length || blockIds.includes(targetId)) return;
  const item = getCollection(ownerType).find((entry) => entry.id === ownerId);
  if (!item?.blocks) return;
  const moveSet = new Set(blockIds);
  const moving = item.blocks.filter((block) => moveSet.has(block.id));
  if (!moving.length) return;
  item.blocks = item.blocks.filter((block) => !moveSet.has(block.id));
  const targetIndex = item.blocks.findIndex((entry) => entry.id === targetId);
  if (targetIndex < 0) {
    item.blocks.push(...moving);
  } else {
    item.blocks.splice(position === "before" ? targetIndex : targetIndex + 1, 0, ...moving);
  }
  ui.blockSelection = moving.length > 1 ? { ownerType, ownerId, ids: moving.map((block) => block.id) } : { ownerType: "", ownerId: "", ids: [] };
  saveState();
  renderDetail({ soft: true });
  renderView({ soft: true });
  requestAnimationFrame(() => {
    if (moving.length > 1) {
      restoreBlockSelection(ownerType, ownerId, moving.map((block) => block.id));
    } else {
      focusBlockContent(moving[0].id);
    }
  });
}

function orderedSelectedBlockIds(editor) {
  return Array.from(editor.querySelectorAll(".block"))
    .map((block) => block.dataset.blockId)
    .filter((id) => ui.blockSelection.ids.includes(id));
}

function restoreBlockSelection(ownerType, ownerId, ids) {
  ui.blockSelection = { ownerType, ownerId, ids };
  const editor = document.querySelector(`.block-editor[data-owner-type="${ownerType}"][data-owner-id="${ownerId}"]`);
  if (!editor) return;
  editor.querySelectorAll(".block").forEach((block) => {
    block.classList.toggle("is-selected", ids.includes(block.dataset.blockId));
  });
  document.activeElement?.blur();
}

function beginEditorMarqueeDrag(editorPage, event) {
  const editor = editorPage.querySelector(".block-editor");
  if (!editor) return;
  clearBlockSelection();
  ui.editorMarquee = {
    ownerType: editor.dataset.ownerType,
    ownerId: editor.dataset.ownerId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
  };
  try {
    editorPage.setPointerCapture?.(event.pointerId);
  } catch (_) {}
  event.preventDefault();
}

function handleEditorMarqueePointerMove(event) {
  const marquee = ui.editorMarquee;
  if (!marquee || marquee.pointerId !== event.pointerId) return;
  const distance = Math.hypot(event.clientX - marquee.startX, event.clientY - marquee.startY);
  if (!marquee.active && distance < 5) return;
  marquee.active = true;
  event.preventDefault();
  const rect = normalizedRect(marquee.startX, marquee.startY, event.clientX, event.clientY);
  updateEditorMarqueeElement(rect);
  updateBlocksInMarquee(marquee.ownerType, marquee.ownerId, rect);
}

function finishEditorMarqueeDrag(event) {
  const marquee = ui.editorMarquee;
  if (!marquee || marquee.pointerId !== event.pointerId) return;
  removeEditorMarqueeElement();
  ui.editorMarquee = null;
}

function cancelEditorMarqueeDrag(event) {
  if (event?.pointerId !== undefined && ui.editorMarquee?.pointerId !== event.pointerId) return;
  removeEditorMarqueeElement();
  ui.editorMarquee = null;
}

function normalizedRect(x1, y1, x2, y2) {
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
  };
}

function updateEditorMarqueeElement(rect) {
  let element = document.querySelector(".editor-marquee");
  if (!element) {
    element = document.createElement("div");
    element.className = "editor-marquee";
    document.body.append(element);
  }
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.top}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

function removeEditorMarqueeElement() {
  document.querySelector(".editor-marquee")?.remove();
}

function updateBlocksInMarquee(ownerType, ownerId, rect) {
  const editor = document.querySelector(`.block-editor[data-owner-type="${ownerType}"][data-owner-id="${ownerId}"]`);
  if (!editor) return;
  const pageRect = editor.closest(".resource-note-page")?.getBoundingClientRect();
  const editorGutter = Number.parseFloat(getComputedStyle(editor).getPropertyValue("--resource-editor-gutter")) || 112;
  const ids = [];
  editor.querySelectorAll(".block").forEach((block) => {
    const blockRect = block.getBoundingClientRect();
    const hitLeft = pageRect ? Math.min(blockRect.left, pageRect.left - editorGutter) : blockRect.left;
    const hitRight = pageRect ? Math.max(blockRect.right, pageRect.right + editorGutter) : blockRect.right;
    const selected = rect.left <= hitRight && rect.right >= hitLeft && rect.top <= blockRect.bottom && rect.bottom >= blockRect.top;
    block.classList.toggle("is-selected", selected);
    if (selected) ids.push(block.dataset.blockId);
  });
  ui.blockSelection = { ownerType, ownerId, ids };
}

function handleBlockSelectAll(blockContent, ownerType, ownerId) {
  if (!isEntireBlockContentSelected(blockContent) && (blockContent.textContent || "")) {
    clearBlockSelection();
    selectBlockContent(blockContent);
    return;
  }
  selectAllBlocks(ownerType, ownerId);
}

function isEntireBlockContentSelected(blockContent) {
  const range = selectionRangeInside(blockContent);
  if (!range || !range.toString()) return false;
  return range.toString() === (blockContent.textContent || "");
}

function selectBlockContent(blockContent) {
  const range = document.createRange();
  range.selectNodeContents(blockContent);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectAllBlocks(ownerType, ownerId) {
  const editor = document.querySelector(`.block-editor[data-owner-type="${ownerType}"][data-owner-id="${ownerId}"]`);
  if (!editor) return;
  const ids = [];
  editor.querySelectorAll(".block").forEach((block) => {
    block.classList.add("is-selected");
    ids.push(block.dataset.blockId);
  });
  ui.blockSelection = { ownerType, ownerId, ids };
  const selection = window.getSelection();
  selection?.removeAllRanges();
  deactivateActiveBlockContent();
  document.activeElement?.blur();
}

function clearBlockSelection() {
  if (!ui.blockSelection.ids.length) return;
  document.querySelectorAll(".block.is-selected").forEach((block) => block.classList.remove("is-selected"));
  ui.blockSelection = { ownerType: "", ownerId: "", ids: [] };
}

function deleteSelectedBlocks() {
  const selection = ui.blockSelection;
  if (!selection.ids.length) return;
  const item = getCollection(selection.ownerType).find((entry) => entry.id === selection.ownerId);
  if (!item?.blocks) return;
  item.blocks = item.blocks.filter((block) => !selection.ids.includes(block.id));
  ensureEditableBlocks(item);
  clearBlockSelection();
  saveState();
  renderDetail({ soft: true });
  renderView({ soft: true });
}

function canStartEditorMarqueeDrag(resourceNote, event) {
  if (event.target.closest("button, input, select, textarea, a, [contenteditable='true'], .resource-note-chrome")) return false;
  const scroll = resourceNote.querySelector(".resource-note-scroll");
  const editor = resourceNote.querySelector(".block-editor");
  if (!scroll || !editor) return false;
  const scrollRect = scroll.getBoundingClientRect();
  if (
    event.clientX < scrollRect.left ||
    event.clientX > scrollRect.right ||
    event.clientY < scrollRect.top ||
    event.clientY > scrollRect.bottom
  ) {
    return false;
  }
  const editorRect = editor.getBoundingClientRect();
  return event.clientY >= editorRect.top - 28;
}

function handlePointerDown(event) {
  const resourceDragHandle = event.target.closest("[data-resource-drag]");
  if (resourceDragHandle && !event.target.closest("button, input, select, textarea, [contenteditable='true']")) {
    if (ui.resourceDrag && event.type === "mousedown") return;
    if ((event.pointerType === "mouse" || event.type === "mousedown") && event.button !== 0) return;
    beginResourceDrag(resourceDragHandle.dataset.resourceDrag, event);
    return;
  }

  const blockDragHandle = event.target.closest("[data-block-drag]");
  if (blockDragHandle) {
    if (event.type === "mousedown") return;
    if ((event.pointerType === "mouse" || event.type === "mousedown") && event.button !== 0) return;
    beginBlockDrag(blockDragHandle.dataset.blockDrag, event);
    return;
  }

  const resourceNote = event.target.closest("[data-resource-note]");
  if (resourceNote && canStartEditorMarqueeDrag(resourceNote, event)) {
    if (event.type === "mousedown") return;
    if ((event.pointerType === "mouse" || event.type === "mousedown") && event.button !== 0) return;
    beginEditorMarqueeDrag(resourceNote, event);
    return;
  }

  const schedulerButton = event.target.closest("[data-scheduler-open]");
  if (schedulerButton) {
    if ((event.pointerType === "mouse" || event.type === "mousedown") && event.button !== 0) return;
    const card = schedulerButton.closest("[data-schedule-hold]");
    const task = state.tasks.find((entry) => entry.id === schedulerButton.dataset.schedulerOpen);
    if (!card || !task || ["done", "canceled"].includes(task.status)) return;
    ui.pendingScheduleDrag = {
      taskId: task.id,
      pointerId: event.pointerId ?? "mouse",
      startX: event.clientX,
      startY: event.clientY,
    };
    return;
  }

  const card = event.target.closest("[data-schedule-hold]");
  if (!card || event.target.closest("[data-toggle-task]")) return;
  if (event.type === "mousedown" && Date.now() - ui.lastSchedulePointerAt < 500) return;
  if (event.type === "pointerdown") ui.lastSchedulePointerAt = Date.now();
  if ((event.pointerType === "mouse" || event.type === "mousedown") && event.button !== 0) return;
  const task = state.tasks.find((entry) => entry.id === card.dataset.scheduleHold);
  if (!task || ["done", "canceled"].includes(task.status)) return;
  event.preventDefault();
  event.stopPropagation();
  beginScheduleDrag(task, card, event);
}

function beginScheduleDrag(task, card, event) {
  cancelScheduleDrag();
  ui.selected = null;
  renderDetail();
  ui.scheduleHoldTaskId = task.id;
  ui.suppressTaskClickUntil = Date.now() + 1600;
  card.classList.add("is-holding");
  try {
    if (event.pointerId !== undefined && card.setPointerCapture) card.setPointerCapture(event.pointerId);
  } catch (_) {}
  const rect = card.getBoundingClientRect();
  const clientX = event.clientX || card.getBoundingClientRect().left + card.getBoundingClientRect().width / 2;
  const clientY = event.clientY || card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2;
  openTaskScheduler(task.id, clientX, clientY, {
    dragging: true,
    pointerId: event.pointerId ?? "mouse",
    dragX: clientX + 14,
    dragY: clientY + 14,
    dragWidth: Math.min(300, Math.max(220, rect.width)),
  });
  updateScheduleDragPosition(clientX, clientY);
}

function cancelScheduleDrag() {
  const hadDrag = Boolean(ui.scheduler?.dragging || ui.scheduleHoldTaskId);
  ui.pendingScheduleDrag = null;
  if (ui.scheduleHoldTaskId) {
    document.querySelector(`[data-schedule-hold="${ui.scheduleHoldTaskId}"]`)?.classList.remove("is-holding");
  }
  ui.scheduleHoldTaskId = "";
  stopSchedulerMonthHover();
  document.querySelectorAll(".task-scheduler-day.is-drop-target, .task-scheduler-lane.is-drop-target").forEach((target) => target.classList.remove("is-drop-target"));
  if (hadDrag) markScheduleDragEnded();
  if (ui.scheduler?.dragging) {
    closeTaskScheduler();
  }
}

function markScheduleDragEnded() {
  ui.lastScheduleDragEndedAt = Date.now();
  ui.suppressTaskClickUntil = Math.max(ui.suppressTaskClickUntil, ui.lastScheduleDragEndedAt + 1400);
}

function handleSchedulePointerExit(event) {
  if (!ui.scheduler?.dragging || event.relatedTarget) return;
  cancelScheduleDrag();
}

function handleScheduleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    cancelScheduleDrag();
    resetNavShortcutState({ closeAutoOpened: true });
  }
}

function handleSchedulePointerMove(event) {
  maybeStartPendingScheduleDrag(event);
  if (!ui.scheduler) return;
  if (ui.scheduler.dragging) {
    if (isReleasedSchedulePointer(event)) {
      cancelScheduleDrag();
      return;
    }
    if (!isActiveSchedulePointer(event)) return;
    event.preventDefault();
  }
  updateScheduleDragPosition(event.clientX, event.clientY);
}

function finishScheduleDrag(event) {
  if (!ui.scheduler?.dragging) {
    clearPendingScheduleDrag(event);
    return;
  }
  if (!isActiveSchedulePointer(event)) return;
  event.preventDefault();
  event.stopPropagation();
  const pointTarget = schedulerTargetFromPoint(event.clientX, event.clientY);
  const action = pointTarget.action || "";
  const date = pointTarget.date || "";
  if (ui.scheduleHoldTaskId) {
    document.querySelector(`[data-schedule-hold="${ui.scheduleHoldTaskId}"]`)?.classList.remove("is-holding");
  }
  ui.scheduleHoldTaskId = "";
  markScheduleDragEnded();
  stopSchedulerMonthHover();
  if (action) {
    scheduleTaskActionFromScheduler(action, { animateDrop: true });
    return;
  }
  if (date) {
    scheduleTaskFromScheduler(date, { animateDrop: true });
    return;
  }
  closeTaskScheduler();
}

function isActiveSchedulePointer(event) {
  if (!ui.scheduler?.dragging) return false;
  if (event.pointerId !== undefined) return ui.scheduler.pointerId === event.pointerId;
  if (event.type === "mouseup") return true;
  return ui.scheduler.pointerId === "mouse";
}

function isReleasedSchedulePointer(event) {
  if (event.buttons === undefined || event.buttons !== 0) return false;
  return event.type === "mousemove" || event.pointerType === "mouse" || ui.scheduler?.pointerId === "mouse";
}

function maybeStartPendingScheduleDrag(event) {
  const pending = ui.pendingScheduleDrag;
  if (!pending) return;
  if (event.pointerId !== undefined && pending.pointerId !== event.pointerId) return;
  if (event.buttons !== undefined && event.buttons === 0) {
    ui.pendingScheduleDrag = null;
    return;
  }
  const dx = event.clientX - pending.startX;
  const dy = event.clientY - pending.startY;
  if (Math.hypot(dx, dy) < 8) return;
  const task = state.tasks.find((entry) => entry.id === pending.taskId);
  const card = document.querySelector(`[data-schedule-hold="${pending.taskId}"]`);
  ui.pendingScheduleDrag = null;
  if (!task || !card) return;
  event.preventDefault();
  event.stopPropagation();
  beginScheduleDrag(task, card, event);
}

function clearPendingScheduleDrag(event) {
  if (!ui.pendingScheduleDrag) return;
  if (event?.pointerId !== undefined && ui.pendingScheduleDrag.pointerId !== event.pointerId) return;
  ui.pendingScheduleDrag = null;
}

function updateScheduleDragPosition(clientX, clientY) {
  if (!ui.scheduler) return;
  if (ui.scheduler.dragging) {
    ui.scheduler.dragX = clientX + 14;
    ui.scheduler.dragY = clientY + 14;
    const ghost = document.querySelector(".schedule-drag-ghost");
    if (ghost) {
      ghost.style.left = `${ui.scheduler.dragX}px`;
      ghost.style.top = `${ui.scheduler.dragY}px`;
    }
    setScheduleDropTarget(schedulerTargetFromPoint(clientX, clientY));
  }
  updateSchedulerMonthHover(clientX, clientY);
}

function schedulerTargetFromPoint(clientX, clientY) {
  return schedulerTargetFromElement(document.elementFromPoint(clientX, clientY)?.closest("[data-scheduler-date], [data-scheduler-action]"));
}

function schedulerTargetFromElement(element) {
  if (!element) return {};
  const action = element.dataset.schedulerAction || "";
  const date = element.dataset.schedulerDate || "";
  return {
    action,
    date,
    element,
    targetKey: action ? `action:${action}` : date ? `date:${date}` : "",
  };
}

function setScheduleDropTarget(target = {}) {
  if (!ui.scheduler || (ui.scheduler.dragOverTarget === target.targetKey && (!target.element || target.element.classList.contains("is-drop-target")))) return;
  document.querySelectorAll(".task-scheduler-day.is-drop-target, .task-scheduler-lane.is-drop-target").forEach((entry) => entry.classList.remove("is-drop-target"));
  if (target.targetKey) target.element?.classList.add("is-drop-target");
  ui.scheduler.dragOverDate = target.date || "";
  ui.scheduler.dragOverAction = target.action || "";
  ui.scheduler.dragOverTarget = target.targetKey || "";
}

function updateSchedulerMonthHover(clientX, clientY) {
  const calendar = document.querySelector(".task-scheduler");
  const stage = document.querySelector(".task-scheduler-stage");
  if (!calendar || !ui.scheduler) {
    stopSchedulerMonthHover();
    return;
  }
  ui.scheduler.monthHoverX = clientX;
  ui.scheduler.monthHoverY = clientY;
  const prevZone = document.querySelector(".task-scheduler-month-zone.is-prev");
  const nextZone = document.querySelector(".task-scheduler-month-zone.is-next");
  const prevRect = prevZone?.getBoundingClientRect();
  const nextRect = nextZone?.getBoundingClientRect();
  const inLeftZone =
    prevRect &&
    prevRect.width > 0 &&
    clientX >= prevRect.left &&
    clientX <= prevRect.right &&
    clientY >= prevRect.top &&
    clientY <= prevRect.bottom;
  const inRightZone =
    nextRect &&
    nextRect.width > 0 &&
    clientX >= nextRect.left &&
    clientX <= nextRect.right &&
    clientY >= nextRect.top &&
    clientY <= nextRect.bottom;
  if (!inLeftZone && !inRightZone) {
    stopSchedulerMonthHover();
    return;
  }
  const edge = inLeftZone ? "prev" : "next";
  if (ui.scheduler.monthEdge === edge && scheduleMonthHoverTimer) return;
  stopSchedulerMonthHover();
  ui.scheduler.monthEdge = edge;
  stage?.classList.add(edge === "prev" ? "is-edge-prev" : "is-edge-next");
  scheduleMonthHoverTimer = window.setTimeout(() => advanceSchedulerMonth(edge), 680);
}

function advanceSchedulerMonth(edge) {
  if (!ui.scheduler) {
    stopSchedulerMonthHover();
    return;
  }
  const current = parseMonthKey(ui.scheduler.month);
  ui.scheduler.month = monthKey(addMonths(current, edge === "prev" ? -1 : 1));
  ui.scheduler.dragOverDate = "";
  ui.scheduler.dragOverTarget = "";
  ui.scheduler.dragOverAction = "";
  ui.scheduler.monthEdge = "";
  window.clearTimeout(scheduleMonthHoverTimer);
  scheduleMonthHoverTimer = 0;
  renderOverlays();
  window.setTimeout(() => {
    if (ui.scheduler) updateSchedulerMonthHover(ui.scheduler.monthHoverX, ui.scheduler.monthHoverY);
  }, 40);
}

function stopSchedulerMonthHover() {
  window.clearTimeout(scheduleMonthHoverTimer);
  scheduleMonthHoverTimer = 0;
  if (ui.scheduler) ui.scheduler.monthEdge = "";
  document.querySelector(".task-scheduler-stage")?.classList.remove("is-edge-prev", "is-edge-next");
  document.querySelector(".task-scheduler")?.classList.remove("is-edge-prev", "is-edge-next");
}

function handleKeydown(event) {
  const habitToggle = event.target.closest("[data-habit-toggle]");
  if (
    habitToggle &&
    !event.target.closest("[data-toggle-habit], button, input, textarea, select, [contenteditable='true']") &&
    (event.key === "Enter" || event.key === " ")
  ) {
    event.preventDefault();
    toggleHabitDetail(habitToggle.dataset.habitToggle);
    return;
  }

  const blockContent = event.target.closest("[data-block-content]");
  if (!blockContent) return;
  const editor = blockContent.closest(".block-editor");
  const ownerType = editor.dataset.ownerType;
  const ownerId = editor.dataset.ownerId;
  const blockId = blockContent.dataset.blockContent;

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
    event.preventDefault();
    handleBlockSelectAll(blockContent, ownerType, ownerId);
    return;
  }

  if (ui.slash?.blockId === blockId) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSlashSelection(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      applySlashSelection();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSlashMenu();
      return;
    }
  }

  if ((event.key === "ArrowUp" || event.key === "ArrowDown") && moveCaretBetweenBlocks(blockContent, event.key)) {
    event.preventDefault();
    return;
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    insertBlockFromCaret(ownerType, ownerId, blockId, blockContent);
    return;
  }

  if (event.key === "Backspace" && blockContent.textContent === "") {
    event.preventDefault();
    removeBlock(ownerType, ownerId, blockId);
    return;
  }

  if (event.key === "/" && blockContent.textContent === "") {
    requestAnimationFrame(() => openSlashMenu(blockContent, ownerType, ownerId, blockId));
  }
}

function handleNavShortcutKeydown(event) {
  if (isEditableShortcutTarget(event.target)) return false;

  if (isOptionKey(event)) {
    if (!event.repeat) scheduleNavShortcutHints();
    return false;
  }

  if (!event.altKey) return false;

  if (isDockedNavShortcut(event)) {
    event.preventDefault();
    event.stopPropagation();
    toggleDockedNav();
    return true;
  }

  const shortcutKey = navShortcutKeyFromEvent(event);
  if (!shortcutKey) return false;

  event.preventDefault();
  event.stopPropagation();
  window.clearTimeout(navShortcutHoldTimer);
  navShortcutHoldTimer = 0;

  return navigateNavShortcut(shortcutKey);
}

function toggleDockedNav() {
  window.clearTimeout(navShortcutHoldTimer);
  navShortcutHoldTimer = 0;
  ui.navShortcutHints = false;
  ui.navOpenedByShortcut = false;
  ui.navDocked = !ui.navDocked;
  app.classList.remove("is-undocking-nav");
  if (ui.navDocked) {
    ui.navOpen = true;
    els.sidebar?.classList.remove("is-fast-closing", "is-row-closing");
    els.sidebar?.style.setProperty("--nav-close-top", "50%");
    els.sidebar?.style.setProperty("--nav-close-bottom", "50%");
    updateNav();
    return;
  }
  app.classList.add("is-undocking-nav");
  ui.navOpen = false;
  updateNav();
}

function handleDocumentKeyup(event) {
  if (!isOptionKey(event)) return;
  resetNavShortcutState({ closeAutoOpened: true });
}

function scheduleNavShortcutHints() {
  window.clearTimeout(navShortcutHoldTimer);
  navShortcutHoldTimer = window.setTimeout(() => {
    ui.navShortcutHints = true;
    if (!ui.navOpen) {
      ui.navOpenedByShortcut = true;
      openNav();
    } else {
      ui.navOpenedByShortcut = false;
      updateNav();
    }
  }, NAV_SHORTCUT_HOLD_MS);
}

function resetNavShortcutState(options = {}) {
  const { closeAutoOpened = true } = options;
  window.clearTimeout(navShortcutHoldTimer);
  navShortcutHoldTimer = 0;
  const shouldClose = closeAutoOpened && ui.navOpenedByShortcut && ui.navOpen;
  ui.navShortcutHints = false;
  ui.navOpenedByShortcut = false;
  if (shouldClose) {
    closeNav();
  } else {
    updateNav();
  }
}

function navigateNavShortcut(shortcutKey) {
  const index = NAV_SHORTCUT_KEYS.indexOf(shortcutKey);
  if (index < 0) return false;
  const navItem = orderedNavItems()[index];
  if (!navItem) return false;
  window.clearTimeout(navShortcutHoldTimer);
  navShortcutHoldTimer = 0;
  ui.navShortcutHints = false;
  const target = app.querySelector(`[data-nav-shortcut="${shortcutKey}"]`);
  setView(navItem[0], { navTarget: target });
  ui.navOpenedByShortcut = false;
  updateNav();
  return true;
}

function navShortcutKeyForIndex(index) {
  return NAV_SHORTCUT_KEYS[index] || "";
}

function navShortcutKeyFromEvent(event) {
  if (event.code === "KeyQ" || event.key.toLowerCase() === "q") return "q";
  if (event.code === "KeyW" || event.key.toLowerCase() === "w") return "w";
  const digitMatch = event.code?.match(/^(?:Digit|Numpad)([0-9])$/);
  if (digitMatch && NAV_SHORTCUT_KEYS.includes(digitMatch[1])) return digitMatch[1];
  if (/^[0-9]$/.test(event.key) && NAV_SHORTCUT_KEYS.includes(event.key)) return event.key;
  return "";
}

function isDockedNavShortcut(event) {
  return event.code === "KeyE" || event.key.toLowerCase() === "e";
}

function isOptionKey(event) {
  return event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight";
}

function isEditableShortcutTarget(target) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function handleDocumentKeydown(event) {
  if (handleNavShortcutKeydown(event)) return;

  if (ui.blockSelection.ids.length && event.key === "Escape") {
    event.preventDefault();
    clearBlockSelection();
    return;
  }
  if (ui.blockSelection.ids.length && ["Backspace", "Delete"].includes(event.key) && !event.target.closest("input, textarea, select, [contenteditable='true']")) {
    event.preventDefault();
    deleteSelectedBlocks();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    ui.commandOpen = !ui.commandOpen;
    ui.slash = null;
    renderOverlays();
  }
  if (event.key === "Escape") {
    if (ui.scheduler) {
      closeTaskScheduler();
      return;
    }
    if (ui.navOpen && !ui.navDocked) {
      closeNav();
      return;
    }
    if (ui.commandOpen || ui.slash) {
      ui.commandOpen = false;
      ui.slash = null;
      renderOverlays();
      return;
    }
    if (ui.selected) {
      ui.selected = null;
      renderDetail();
    }
  }
}

function handleDocumentClick(event) {
  if (!event.target.closest("[data-block-content]") && !event.target.closest(".slash-menu")) {
    deactivateActiveBlockContent();
  }
  if (
    ui.navOpen &&
    !ui.navDocked &&
    !event.target.closest(".sidebar") &&
    !event.target.closest("[data-action='toggle-nav']")
  ) {
    closeNav();
    return;
  }
  if (!event.target.closest(".command-menu") && !event.target.closest("[data-action='open-command']") && ui.commandOpen) {
    ui.commandOpen = false;
    renderOverlays();
  }
  if (!event.target.closest(".slash-menu") && !event.target.closest(".block-content") && ui.slash) {
    ui.slash = null;
    renderOverlays();
  }
  if (ui.scheduler && !event.target.closest(".task-scheduler") && !event.target.closest("[data-schedule-hold]")) {
    closeTaskScheduler();
  }
}

function handleDragStart(event) {
  if (handleNavDragStart(event)) return;
  const card = event.target.closest("[data-task-id]");
  if (!card) return;
  ui.draggedTaskId = card.dataset.taskId;
  event.dataTransfer.setData("text/plain", card.dataset.taskId);
  event.dataTransfer.effectAllowed = "move";
}

function handleDragOver(event) {
  if (handleNavDragOver(event)) return;
  const zone = event.target.closest("[data-drop-date]");
  if (!zone) return;
  event.preventDefault();
  zone.classList.add("is-over");
}

function handleDragLeave(event) {
  if (handleNavDragLeave(event)) return;
  const zone = event.target.closest("[data-drop-date]");
  if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("is-over");
}

function handleDrop(event) {
  if (handleNavDrop(event)) return;
  const zone = event.target.closest("[data-drop-date]");
  if (!zone) return;
  event.preventDefault();
  zone.classList.remove("is-over");
  const taskId = event.dataTransfer.getData("text/plain") || ui.draggedTaskId;
  const task = state.tasks.find((entry) => entry.id === taskId);
  if (!task) return;
  scheduleTask(task, zone.dataset.dropDate);
  saveState();
  showToast("일정에 배치했습니다.");
  renderView({ soft: true });
  renderDetail();
}

function handleNavDragStart(event) {
  const button = event.target.closest("[data-nav-key]");
  if (!button) return false;
  if (!ui.navShortcutHints) {
    event.preventDefault();
    return true;
  }
  ui.navDragKey = button.dataset.navKey;
  button.classList.add("is-nav-dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-sygma-nav-key", ui.navDragKey);
    event.dataTransfer.setData("text/plain", ui.navDragKey);
  }
  return true;
}

function handleNavDragOver(event) {
  if (!ui.navDragKey) return false;
  const button = event.target.closest("[data-nav-key]");
  const track = event.target.closest("#navTrack");
  if (!button && !track) return false;
  event.preventDefault();
  if (button && button.dataset.navKey !== ui.navDragKey) {
    setNavDropMarker(button, navDropPositionForEvent(event, button));
  } else {
    clearNavDropMarkers();
  }
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  return true;
}

function handleNavDragLeave(event) {
  if (!ui.navDragKey) return false;
  const track = event.target.closest("#navTrack");
  if (track && !track.contains(event.relatedTarget)) clearNavDropMarkers();
  return Boolean(track);
}

function handleNavDrop(event) {
  if (!ui.navDragKey) return false;
  const button = event.target.closest("[data-nav-key]");
  const track = event.target.closest("#navTrack");
  if (!button && !track) return false;
  event.preventDefault();
  if (button && button.dataset.navKey !== ui.navDragKey) {
    reorderNav(ui.navDragKey, button.dataset.navKey, navDropPositionForEvent(event, button));
  }
  clearNavDrag();
  return true;
}

function navDropPositionForEvent(event, button) {
  const rect = button.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
}

function setNavDropMarker(button, position) {
  clearNavDropMarkers();
  button.classList.toggle("is-nav-drop-before", position === "before");
  button.classList.toggle("is-nav-drop-after", position === "after");
}

function clearNavDropMarkers() {
  app.querySelectorAll(".is-nav-drop-before, .is-nav-drop-after").forEach((button) => {
    button.classList.remove("is-nav-drop-before", "is-nav-drop-after");
  });
}

function clearNavDrag() {
  ui.navDragKey = "";
  app.querySelectorAll(".is-nav-dragging").forEach((button) => button.classList.remove("is-nav-dragging"));
  clearNavDropMarkers();
}

function reorderNav(dragKey, targetKey, position = "before") {
  const order = normalizeNavOrder(state.settings.navOrder);
  if (!dragKey || !targetKey || dragKey === targetKey) return false;
  const fromIndex = order.indexOf(dragKey);
  if (fromIndex < 0 || !order.includes(targetKey)) return false;
  order.splice(fromIndex, 1);
  const targetIndex = order.indexOf(targetKey);
  const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
  order.splice(insertIndex, 0, dragKey);
  state.settings.navOrder = normalizeNavOrder(order);
  saveState();
  renderNav();
  showToast("목차 순서를 변경했습니다.");
  return true;
}

function createTask(title = "새 할 일", options = {}) {
  const task = {
    id: id(),
    title,
    status: "todo",
    boxId: state.boxes[0]?.id || "",
    goalId: "",
    projectId: "",
    resourceId: "",
    dueDate: "",
    scheduledStart: "",
    scheduledEnd: "",
    estimatedMinutes: 30,
    actualMinutes: 0,
    completedAt: "",
    googleEventId: "",
    blocks: blocks(""),
    ...(options.initial || {}),
  };
  state.tasks.push(task);
  if (!options.deferCreate) {
    afterCreate("tasks", task.id, options.navigate === false ? ui.view : "tasks");
  }
  return task;
}

function createProject(name = "새 프로젝트", options = {}) {
  const project = {
    id: id(),
    name,
    status: "unplanned",
    boxId: state.boxes[0]?.id || "",
    goalId: "",
    startDate: "",
    endDate: "",
    blocks: blocks("완료 기준과 다음 행동을 적어두세요."),
    ...(options.initial || {}),
  };
  state.projects.push(project);
  if (!options.deferCreate) {
    afterCreate("projects", project.id, options.navigate === false ? ui.view : "projects");
  }
  return project;
}

function createGoal(name = "새 목표", options = {}) {
  const goal = {
    id: id(),
    name,
    status: "not_started",
    boxId: state.boxes[0]?.id || "",
    year: String(new Date().getFullYear()),
    quarter: `${Math.floor(new Date().getMonth() / 3) + 1}Q`,
    targetDate: "",
    blocks: blocks("SMART 기준으로 목표를 정리하세요."),
    ...(options.initial || {}),
  };
  state.goals.push(goal);
  if (!options.deferCreate) {
    afterCreate("goals", goal.id, options.navigate === false ? ui.view : "goals");
  }
  return goal;
}

function createBox(name = "새 박스", options = {}) {
  const box = {
    id: id(),
    name,
    visibility: "normal",
    color: "blue",
    blocks: blocks("이 영역이 관리하는 목표와 자료를 적어두세요."),
    ...(options.initial || {}),
  };
  state.boxes.push(box);
  if (!options.deferCreate) {
    afterCreate("boxes", box.id, options.navigate === false ? ui.view : "boxes");
  }
  return box;
}

function createResource(title = "새 자료", options = {}) {
  const resource = {
    id: id(),
    title,
    type: "note",
    importance: "normal",
    pinned: false,
    readLater: false,
    url: "",
    boxId: state.boxes[0]?.id || "",
    goalId: "",
    projectId: "",
    blocks: [
      { id: id(), type: "heading1", text: title, checked: false },
      { id: id(), type: "paragraph", text: "", checked: false },
    ],
    ...(options.initial || {}),
  };
  state.resources.push(resource);
  if (!options.deferCreate) {
    afterCreate("resources", resource.id, options.navigate === false ? ui.view : "resources");
  }
  return resource;
}

function createHabit(title = "새 루틴", options = {}) {
  const habit = {
    id: id(),
    title,
    cadence: "daily",
    target: "작게 반복 가능한 단위",
    status: "active",
    boxId: state.boxes[0]?.id || "",
    projectId: "",
    blocks: blocks("루틴의 트리거와 성공 기준을 적어두세요."),
  };
  state.habits.push(habit);
  afterCreate("habits", habit.id, options.navigate === false ? ui.view : "habits");
  return habit;
}

function createJournal(title = `${dateKey(new Date())} 리뷰`, options = {}) {
  const journal = {
    id: id(),
    title,
    date: dateKey(new Date()),
    satisfaction: 7,
    blocks: [
      { id: id(), type: "heading2", text: "오늘의 기록", checked: false },
      { id: id(), type: "paragraph", text: "", checked: false },
      { id: id(), type: "heading2", text: "다음 행동", checked: false },
      { id: id(), type: "todo", text: "", checked: false },
    ],
  };
  state.journals.push(journal);
  afterCreate("journals", journal.id, options.navigate === false ? ui.view : "journal");
  return journal;
}

function createObstacle(title = "새 이슈", options = {}) {
  const obstacle = {
    id: id(),
    title,
    status: "open",
    severity: 2,
    boxId: state.boxes[0]?.id || "",
    projectId: "",
    taskId: "",
    blocks: blocks("원인, 영향, 다음 조치를 정리하세요."),
  };
  state.obstacles.push(obstacle);
  afterCreate("obstacles", obstacle.id, options.navigate === false ? ui.view : "obstacles");
  return obstacle;
}

function createCapture(title = "새 수집", options = {}) {
  const capture = {
    id: id(),
    title,
    url: "",
    status: "inbox",
    convertedTo: "",
    convertedId: "",
    createdAt: new Date().toISOString(),
    processedAt: "",
  };
  state.captures.push(capture);
  afterCreate("captures", capture.id, options.navigate === false ? ui.view : "inbox");
  return capture;
}

function afterCreate(type, itemId, view) {
  ui.selected = { type, id: itemId };
  if (type === "projects") ui.expandedProjectId = itemId;
  if (type === "habits") ui.expandedHabitId = itemId;
  if (type === "resources") {
    ui.selected = null;
    openResourceNote(itemId);
  }
  if (ui.view !== view) {
    ui.view = view;
    updateNav();
  }
  saveState();
  renderView({ transition: false, soft: true });
  renderDetail();
  renderOverlays();
}

function toggleProjectDetail(projectId) {
  const nextExpandedId = ui.expandedProjectId === projectId ? "" : projectId;
  if (ui.view === "projects") {
    app.querySelectorAll("[data-project-item]").forEach((item) => {
      const expanded = nextExpandedId === item.dataset.projectItem;
      item.classList.toggle("is-expanded", expanded);
      const row = item.querySelector("[data-project-toggle]");
      const detail = item.querySelector(".project-detail-shell");
      row?.setAttribute("aria-expanded", String(expanded));
      detail?.setAttribute("aria-hidden", String(!expanded));
    });
    ui.expandedProjectId = nextExpandedId;
    ui.selected = null;
    renderDetail();
    return;
  }
  ui.expandedProjectId = nextExpandedId;
  ui.selected = null;
  renderView({ soft: true });
  renderDetail();
}

function toggleTodayTaskDetail(taskId) {
  const nextExpandedId = ui.expandedTodayTaskId === taskId ? "" : taskId;
  if (ui.view === "today") {
    app.querySelectorAll("[data-today-task-id]").forEach((item) => {
      const expanded = nextExpandedId === item.dataset.todayTaskId;
      item.classList.toggle("is-expanded", expanded);
      const row = item.querySelector("[data-task-inline-toggle]");
      const detail = item.querySelector(".task-detail-shell");
      row?.setAttribute("aria-expanded", String(expanded));
      detail?.setAttribute("aria-hidden", String(!expanded));
    });
    ui.expandedTodayTaskId = nextExpandedId;
    ui.selected = null;
    renderDetail();
    return;
  }
  ui.expandedTodayTaskId = nextExpandedId;
  ui.selected = null;
  renderView({ soft: true });
  renderDetail();
}

function toggleHabitDetail(habitId) {
  const nextExpandedId = ui.expandedHabitId === habitId ? "" : habitId;
  if (ui.view === "habits") {
    app.querySelectorAll("[data-habit-item]").forEach((item) => {
      const expanded = nextExpandedId === item.dataset.habitItem;
      item.classList.toggle("is-expanded", expanded);
      const row = item.querySelector("[data-habit-toggle]");
      const detail = item.querySelector(".habit-detail-shell");
      row?.setAttribute("aria-expanded", String(expanded));
      detail?.setAttribute("aria-hidden", String(!expanded));
    });
    ui.expandedHabitId = nextExpandedId;
    ui.selected = null;
    renderDetail();
    return;
  }
  ui.expandedHabitId = nextExpandedId;
  ui.selected = null;
  renderView({ soft: true });
  renderDetail();
}

function openHabitEditor(habitId) {
  ui.selected = { type: "habits", id: habitId };
  ui.commandOpen = false;
  ui.slash = null;
  renderDetail();
  renderOverlays();
}

function convertCapture(captureId, targetType) {
  const capture = state.captures.find((entry) => entry.id === captureId);
  if (!capture) return;
  const createOptions = { navigate: false };
  let created;
  if (targetType === "tasks") created = createTask(capture.title, createOptions);
  if (targetType === "projects") created = createProject(capture.title, createOptions);
  if (targetType === "resources") created = createResource(capture.title, createOptions);
  if (targetType === "goals") created = createGoal(capture.title, createOptions);
  if (targetType === "boxes") created = createBox(capture.title, createOptions);
  capture.status = "processed";
  capture.convertedTo = targetType;
  capture.convertedId = created?.id || "";
  capture.processedAt = new Date().toISOString();
  ui.selected = created && targetType !== "resources" ? { type: targetType, id: created.id } : null;
  if (created && targetType === "resources") openResourceNote(created.id);
  saveState();
  showToast("분류했습니다.");
  renderView({ soft: true });
  renderDetail();
}

function startTaskFlow(captureId, targetType = "tasks") {
  const existing = getCaptureDraft(captureId);
  ui.captureDrafts[captureId] = existing?.type === targetType
    ? existing
    : {
        type: targetType,
        stepIndex: 0,
        values: {
          boxId: "",
          goalId: "",
          projectId: "",
          resourceId: "",
          resourceType: "note",
        },
      };
  refreshCaptureCard(captureId, { flowDirection: "forward" });
  focusTaskFlow(captureId);
}

function selectTaskFlowChoice(captureId, stepKey, value) {
  const draft = getCaptureDraft(captureId);
  if (!draft) return;
  if (isTaskFlowAnimating(captureId)) return;
  const previousStepIndex = draft.stepIndex;
  const steps = getTaskCaptureSteps(draft);
  const index = steps.findIndex((step) => step.key === stepKey);
  const applyChoice = () => {
    const latestDraft = getCaptureDraft(captureId);
    if (!latestDraft) return;
    latestDraft.values[stepKey] = value;
    clearTaskFlowDependents(latestDraft, stepKey);
    syncTaskFlowRelations(latestDraft, stepKey);
    const latestSteps = getTaskCaptureSteps(latestDraft);
    const latestIndex = latestSteps.findIndex((step) => step.key === stepKey);
    latestDraft.stepIndex = Math.min(latestIndex + 1, latestSteps.length);
    const flowDirection = latestDraft.stepIndex > previousStepIndex ? "forward" : latestDraft.stepIndex < previousStepIndex ? "backward" : "steady";
    refreshCaptureCard(captureId, { flowDirection });
    focusTaskFlow(captureId);
  };
  if (index === previousStepIndex && animateTaskFlowChoiceCommit(captureId, stepKey, value, applyChoice)) return;
  applyChoice();
}

function jumpTaskFlowStep(captureId, stepKey) {
  const draft = getCaptureDraft(captureId);
  if (!draft) return;
  if (isTaskFlowAnimating(captureId)) return;
  const steps = getTaskCaptureSteps(draft);
  const index = steps.findIndex((step) => step.key === stepKey);
  if (index < 0) return;
  if (index < draft.stepIndex && collapseTaskFlowToStep(captureId, index, () => {
    const selectionOriginRect = getTaskFlowSelectionRect(captureId, stepKey);
    draft.stepIndex = index;
    refreshCaptureCard(captureId, { flowDirection: "backward", revealStepKey: stepKey, selectionOriginRect });
    focusTaskFlow(captureId);
  })) {
    return;
  }
  draft.stepIndex = index;
  refreshCaptureCard(captureId, { flowDirection: "steady" });
  focusTaskFlow(captureId);
}

function cancelTaskFlow(captureId) {
  delete ui.captureDrafts[captureId];
  refreshCaptureCard(captureId, { flowDirection: "backward" });
}

function saveTaskFlow(captureId) {
  const capture = state.captures.find((entry) => entry.id === captureId);
  const draft = getCaptureDraft(captureId);
  if (!capture || !draft) return;
  const targetType = draft.type || "tasks";
  const createOptions = {
    navigate: false,
    deferCreate: true,
    initial: buildTaskFlowInitialValues(draft, capture),
  };
  let created;
  if (targetType === "tasks") created = createTask(capture.title, createOptions);
  if (targetType === "projects") created = createProject(capture.title, createOptions);
  if (targetType === "resources") created = createResource(capture.title, createOptions);
  if (targetType === "goals") created = createGoal(capture.title, createOptions);
  if (targetType === "boxes") created = createBox(capture.title, createOptions);
  if (!created) return;
  capture.status = "processed";
  capture.convertedTo = targetType;
  capture.convertedId = created.id;
  capture.processedAt = new Date().toISOString();
  delete ui.captureDrafts[captureId];
  ui.view = targetType;
  ui.selected = targetType === "resources" ? null : { type: targetType, id: created.id };
  if (targetType === "projects") ui.expandedProjectId = created.id;
  updateNav();
  saveState();
  showToast(`${captureTargetLabel(targetType)}로 저장했습니다.`);
  renderView({ soft: true });
  if (targetType === "resources") {
    openResourceNote(created.id);
  } else {
    renderDetail();
  }
  renderOverlays();
}

function buildTaskFlowInitialValues(draft, capture = null) {
  const values = draft.values || {};
  if (draft.type === "projects") {
    return {
      boxId: values.boxId || "",
      goalId: values.goalId || "",
    };
  }
  if (draft.type === "goals") {
    return {
      boxId: values.boxId || "",
    };
  }
  if (draft.type === "resources") {
    return {
      boxId: values.boxId || "",
      goalId: values.goalId || "",
      projectId: values.projectId || "",
      type: values.resourceType || "note",
      url: capture?.url || "",
    };
  }
  if (draft.type === "boxes") {
    return {};
  }
  return {
    boxId: values.boxId || "",
    goalId: values.goalId || "",
    projectId: values.projectId || "",
    resourceId: values.resourceId || "",
  };
}

function clearTaskFlowDependents(draft, stepKey) {
  if (stepKey === "boxId") {
    draft.values.goalId = "";
    draft.values.projectId = "";
    draft.values.resourceId = "";
  }
  if (stepKey === "goalId") {
    draft.values.projectId = "";
    draft.values.resourceId = "";
  }
  if (stepKey === "projectId") {
    draft.values.resourceId = "";
  }
}

function syncTaskFlowRelations(draft, changedField) {
  const values = draft.values || {};
  const goal = state.goals.find((entry) => entry.id === values.goalId);
  const project = state.projects.find((entry) => entry.id === values.projectId);
  const resource = state.resources.find((entry) => entry.id === values.resourceId);
  const projectGoal = state.goals.find((entry) => entry.id === project?.goalId);

  if (changedField === "goalId" && goal?.boxId) {
    values.boxId = goal.boxId;
  }
  if (changedField === "projectId" && project) {
    if (project.boxId || projectGoal?.boxId) values.boxId = project.boxId || projectGoal.boxId;
  }
  if (changedField === "resourceId" && resource) {
    if (resource.boxId) values.boxId = resource.boxId;
  }
}

function isTaskFlowAnimating(captureId) {
  return Boolean(document.querySelector(`[data-task-flow="${captureId}"]`)?.classList.contains("is-flow-animating"));
}

function refreshCaptureCard(captureId, options = {}) {
  const capture = state.captures.find((entry) => entry.id === captureId);
  const current = document.querySelector(`[data-select-type="captures"][data-select-id="${captureId}"]`);
  if (!capture || !current) {
    renderView({ soft: true });
    return;
  }
  const previousFlowHeight = current.querySelector(".capture-flow")?.getBoundingClientRect().height || 0;
  const template = document.createElement("template");
  template.innerHTML = renderCaptureCard(capture).trim();
  const next = template.content.firstElementChild;
  const flow = next.querySelector(".capture-flow");
  const flowDirection = options.flowDirection || "steady";
  if (flow && flowDirection) {
    flow.classList.add(`is-flow-${flowDirection}`);
    if (["forward", "backward"].includes(flowDirection)) flow.classList.add("is-flow-measuring");
  }
  current.replaceWith(next);
  decorateButtons(next);
  animateCaptureFlowResize(next, previousFlowHeight, flowDirection);
  if (options.revealStepKey) animateTaskFlowOptionReveal(next, options);
}

function animateCaptureFlowResize(card, previousHeight, direction) {
  const flow = card.querySelector(".capture-flow");
  if (!flow || !["forward", "backward"].includes(direction)) {
    if (flow) flow.classList.remove("is-flow-measuring");
    return;
  }
  flow.classList.add("is-flow-animating");
  const nextHeight = flow.getBoundingClientRect().height;
  if (Math.abs(nextHeight - previousHeight) < 1 && previousHeight > 0) {
    flow.classList.remove("is-flow-measuring");
    window.setTimeout(() => clearCaptureFlowAnimationState(flow), 780);
    return;
  }
  flow.style.overflow = "hidden";
  flow.style.height = `${Math.max(0, previousHeight)}px`;
  flow.getBoundingClientRect();
  flow.classList.add("is-flow-resizing");
  flow.classList.remove("is-flow-measuring");
  requestAnimationFrame(() => {
    let completed = false;
    let timer = 0;
    const finish = (event) => {
      if (event && (event.target !== flow || event.propertyName !== "height")) return;
      if (completed) return;
      completed = true;
      window.clearTimeout(timer);
      flow.removeEventListener("transitionend", finish);
      clearCaptureFlowAnimationState(flow);
    };
    flow.addEventListener("transitionend", finish);
    flow.style.height = `${nextHeight}px`;
    timer = window.setTimeout(finish, 920);
  });
}

function clearCaptureFlowAnimationState(flow) {
  if (flow.classList.contains("is-flow-collapsing")) return;
  flow.style.height = "";
  flow.style.overflow = "";
  flow.classList.add("is-flow-settled");
  flow.classList.remove("is-flow-resizing", "is-flow-measuring", "is-flow-forward", "is-flow-backward", "is-flow-steady", "is-flow-collapsing");
  if (!flow.querySelector(".is-revealing-options")) flow.classList.remove("is-flow-animating");
}

function animateTaskFlowChoiceCommit(captureId, stepKey, value, onComplete) {
  const flow = document.querySelector(`[data-task-flow="${captureId}"]`);
  const row = flow?.querySelector(`.capture-flow-row.is-active[data-flow-index]`);
  if (!flow || !row || flow.classList.contains("is-flow-animating")) return false;
  const options = Array.from(row.querySelectorAll(".capture-flow-option"));
  const selected = options.find((option) => option.dataset.flowStep === stepKey && option.dataset.flowValue === value);
  const optionGroup = row.querySelector(".capture-flow-options");
  if (!selected || !optionGroup) return false;
  const selectedRect = selected.getBoundingClientRect();
  const groupRect = optionGroup.getBoundingClientRect();
  selected.style.setProperty("--choice-slide-x", `${Math.round((groupRect.left - selectedRect.left) * 100) / 100}px`);
  flow.classList.add("is-flow-animating");
  row.classList.add("is-selecting-choice");
  selected.classList.add("is-choice-sliding", "is-selected");
  options.forEach((option) => {
    if (option !== selected) option.classList.add("is-choice-fading");
  });
  let done = false;
  const finish = (event) => {
    if (event && event.propertyName !== "transform") return;
    if (done) return;
    done = true;
    onComplete();
  };
  selected.addEventListener("transitionend", finish);
  window.setTimeout(finish, 460);
  return true;
}

function getTaskFlowSelectionRect(captureId, stepKey) {
  const summary = document.querySelector(`[data-task-flow="${captureId}"] [data-task-flow-jump="${captureId}"][data-flow-step="${stepKey}"]`);
  if (!summary) return null;
  const rect = summary.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function animateTaskFlowOptionReveal(card, options = {}) {
  const { revealStepKey, selectionOriginRect } = options;
  const flow = card.querySelector(".capture-flow");
  const row = flow?.querySelector(`.capture-flow-row.is-active`);
  if (!flow || !row || !revealStepKey) return;
  const selected = Array.from(row.querySelectorAll(".capture-flow-option")).find((option) => {
    return option.dataset.flowStep === revealStepKey && option.classList.contains("is-selected");
  });
  const hiddenOptions = Array.from(row.querySelectorAll(".capture-flow-option")).filter((option) => option !== selected);
  flow.classList.add("is-flow-animating");
  row.classList.add("is-revealing-options", "is-reveal-prep");
  const revealOriginRect = selected?.getBoundingClientRect() || selectionOriginRect;
  const selectedCenter = revealOriginRect ? revealOriginRect.left + revealOriginRect.width / 2 : 0;
  const orderedOptions = hiddenOptions
    .map((option) => {
      const rect = option.getBoundingClientRect();
      return { option, rect, distance: Math.abs(rect.left + rect.width / 2 - selectedCenter) };
    })
    .sort((a, b) => a.distance - b.distance);
  orderedOptions.forEach(({ option, rect: optionRect }, index) => {
    const originLeft = revealOriginRect ? revealOriginRect.left : optionRect.left - 10;
    const originTop = revealOriginRect ? revealOriginRect.top : optionRect.top - 6;
    option.style.setProperty("--choice-reveal-index", String(index));
    option.style.setProperty("--choice-reveal-x", `${Math.round((originLeft - optionRect.left) * 0.62 * 100) / 100}px`);
    option.style.setProperty("--choice-reveal-y", `${Math.round((originTop - optionRect.top) * 0.46 * 100) / 100}px`);
    option.classList.add("is-choice-reappearing");
  });
  if (selected && selectionOriginRect) {
    const selectedRect = selected.getBoundingClientRect();
    selected.style.transition = "none";
    selected.style.transform = `translate(${selectionOriginRect.left - selectedRect.left}px, ${selectionOriginRect.top - selectedRect.top}px)`;
  }
  row.getBoundingClientRect();
  requestAnimationFrame(() => {
    row.classList.remove("is-reveal-prep");
    row.getBoundingClientRect();
    requestAnimationFrame(() => {
      row.classList.add("is-revealed");
      if (selected) {
        selected.style.transition = "";
        selected.style.transform = "";
      }
    });
  });
  const revealDuration = 1120 + hiddenOptions.length * 74;
  window.setTimeout(() => {
    flow.classList.remove("is-flow-animating");
    row.classList.remove("is-revealing-options", "is-reveal-prep", "is-revealed");
    hiddenOptions.forEach((option) => {
      option.classList.remove("is-choice-reappearing");
      option.style.removeProperty("--choice-reveal-index");
      option.style.removeProperty("--choice-reveal-x");
      option.style.removeProperty("--choice-reveal-y");
    });
    if (selected) {
      selected.style.transition = "";
      selected.style.transform = "";
    }
  }, revealDuration);
}

function collapseTaskFlowToStep(captureId, targetIndex, onComplete) {
  const flow = document.querySelector(`[data-task-flow="${captureId}"]`);
  if (!flow) return false;
  const rows = Array.from(flow.querySelectorAll(":scope > .capture-flow-row, :scope > .capture-flow-save"));
  const collapsing = rows.filter((row) => {
    return Number(row.dataset.flowIndex || 0) > targetIndex;
  });
  if (!collapsing.length) return false;
  const flowRect = flow.getBoundingClientRect();
  const keepRows = rows.filter((row) => Number(row.dataset.flowIndex || 0) <= targetIndex);
  const targetRow = keepRows.at(-1);
  const targetHeight = targetRow ? Math.max(0, targetRow.getBoundingClientRect().bottom - flowRect.top) : 0;
  flow.style.overflow = "hidden";
  flow.style.height = `${flowRect.height}px`;
  collapsing.forEach((row) => {
    row.style.boxSizing = "border-box";
    row.style.height = `${row.getBoundingClientRect().height}px`;
    row.style.overflow = "hidden";
  });
  flow.getBoundingClientRect();
  flow.classList.add("is-flow-animating", "is-flow-resizing", "is-flow-collapsing");
  collapsing.forEach((row) => row.classList.add("is-collapsing"));
  flow.getBoundingClientRect();
  requestAnimationFrame(() => {
    let completed = false;
    let timer = 0;
    const finish = (event) => {
      if (event && (event.target !== flow || event.propertyName !== "height")) return;
      if (completed) return;
      completed = true;
      window.clearTimeout(timer);
      flow.removeEventListener("transitionend", finish);
      onComplete();
    };
    flow.addEventListener("transitionend", finish);
    flow.style.height = `${targetHeight}px`;
    collapsing.forEach((row) => {
      row.style.height = "0px";
      row.style.paddingTop = "0px";
      row.style.paddingBottom = "0px";
      row.style.opacity = "0";
      row.style.transform = "translateY(-10px)";
      row.style.borderTopColor = "transparent";
    });
    timer = window.setTimeout(finish, 920);
  });
  return true;
}

function focusTaskFlow(captureId) {
  requestAnimationFrame(() => {
    const flow = document.querySelector(`[data-task-flow="${captureId}"]`);
    const target = flow?.querySelector(".capture-flow-row.is-active .capture-flow-option, [data-task-flow-save]");
    target?.focus();
  });
}

function setTaskDate(task, date) {
  task.dueDate = date || "";
  if (!date) {
    task.scheduledStart = "";
    task.scheduledEnd = "";
    if (!["done", "canceled"].includes(task.status)) task.status = "todo";
    return;
  }

  if (task.scheduledStart) task.scheduledStart = replaceDatePart(task.scheduledStart, date, "09:00");
  if (task.scheduledEnd) task.scheduledEnd = replaceDatePart(task.scheduledEnd, date, "10:00");
  if (task.scheduledStart && !["done", "canceled"].includes(task.status)) task.status = "scheduled";
}

function replaceDatePart(dateTime, date, fallbackTime) {
  const time = String(dateTime || "").split("T")[1] || fallbackTime;
  return `${date}T${time}`;
}

function normalizeTaskRelations(task, changedField) {
  const goal = state.goals.find((entry) => entry.id === task.goalId);
  const project = state.projects.find((entry) => entry.id === task.projectId);
  const resource = state.resources.find((entry) => entry.id === task.resourceId);

  if (changedField === "boxId") {
    if (goal?.boxId && goal.boxId !== task.boxId) task.goalId = "";
    if (project?.boxId && project.boxId !== task.boxId) task.projectId = "";
    if (resource?.boxId && task.boxId && resource.boxId !== task.boxId) task.resourceId = "";
  }

  if (changedField === "goalId") {
    if (goal?.boxId) task.boxId = goal.boxId;
    if (project?.goalId && task.goalId && project.goalId !== task.goalId) task.projectId = "";
    if (resource?.goalId && task.goalId && resource.goalId !== task.goalId) task.resourceId = "";
  }

  if (changedField === "projectId") {
    if (project?.goalId) task.goalId = project.goalId;
    if (project?.boxId) task.boxId = project.boxId;
    if (resource?.projectId && task.projectId && resource.projectId !== task.projectId) task.resourceId = "";
  }

  if (changedField === "resourceId" && resource) {
    if (resource.projectId) task.projectId = resource.projectId;
    if (resource.goalId) task.goalId = resource.goalId;
    if (resource.boxId) task.boxId = resource.boxId;
  }
}

function deleteSelected() {
  if (!ui.selected) return;
  const collection = getCollection(ui.selected.type);
  const index = collection.findIndex((entry) => entry.id === ui.selected.id);
  if (index < 0) return;
  collection.splice(index, 1);
  ui.selected = null;
  saveState();
  renderView({ soft: true });
  renderDetail();
  showToast("삭제했습니다.");
}

function toggleTaskDone(taskId, button) {
  const task = state.tasks.find((entry) => entry.id === taskId);
  if (!task) return;
  const nextDone = task.status !== "done";
  if (nextDone) {
    task.status = "done";
    task.completedAt = new Date().toISOString();
  } else {
    task.status = task.scheduledStart ? "scheduled" : "todo";
    task.completedAt = "";
  }
  saveState();

  const card = button?.closest(".card");
  if (card) {
    card.classList.add("is-updating");
    card.classList.toggle("done", nextDone);
    button.classList.toggle("is-done", nextDone);
    button.setAttribute("aria-pressed", nextDone ? "true" : "false");
  }
  window.setTimeout(() => {
    renderView({ soft: true, animateCards: ui.view === "today" });
    if (ui.selected?.type === "tasks" && ui.selected.id === taskId) renderDetail();
  }, 220);
}

function toggleHabitDone(habitId, date, button) {
  let instance = state.habitInstances.find((entry) => entry.habitId === habitId && entry.date === date);
  if (!instance) {
    instance = { id: id(), habitId, date, completed: false, completedAt: "" };
    state.habitInstances.push(instance);
  }
  instance.completed = !instance.completed;
  instance.completedAt = instance.completed ? new Date().toISOString() : "";
  setHabitDayVisualState(button, instance.completed);
  saveState();
  const card = button?.closest("[data-habit-card]");
  if (card) {
    card.querySelectorAll("[data-toggle-habit]").forEach((dayButton) => {
      if (dayButton.dataset.toggleHabit === habitId && dayButton.dataset.habitDate === date) {
        setHabitDayVisualState(dayButton, instance.completed);
      }
    });
    const progress = card.querySelector("[data-habit-progress]");
    if (progress) {
      const rangeDays = Array.from(card.querySelectorAll(".habit-day"));
      const total = Number(progress.dataset.habitProgressTotal) || rangeDays.length || 7;
      const doneCount = rangeDays.filter((entry) => entry.classList.contains("is-done")).length;
      progress.textContent = `${doneCount}/${total}`;
      progress.classList.toggle("teal", doneCount >= Math.ceil(total * 0.7));
      progress.classList.toggle("amber", doneCount < Math.ceil(total * 0.7));
    }
    card.querySelectorAll("[data-habit-month-progress], [data-habit-month-inline]").forEach((monthProgress) => {
      const stats = habitMonthStats(habitId, parseMonthKey(monthProgress.dataset.habitMonth));
      monthProgress.textContent = `${stats.completed}/${stats.total}`;
      monthProgress.classList.toggle("teal", stats.completed >= Math.ceil(stats.total * 0.7));
      monthProgress.classList.toggle("amber", stats.completed < Math.ceil(stats.total * 0.7));
    });
  }
  if (ui.selected?.type === "habits" && ui.selected.id === habitId) renderDetail();
}

function setHabitDayVisualState(dayButton, completed) {
  if (!dayButton) return;
  if (completed) {
    dayButton.classList.remove("is-removing");
    dayButton.classList.add("is-done");
    return;
  }
  if (dayButton.classList.contains("is-done")) {
    dayButton.classList.add("is-removing");
  }
  dayButton.classList.remove("is-done");
  window.setTimeout(() => {
    if (!dayButton.classList.contains("is-done")) dayButton.classList.remove("is-removing");
  }, 280);
}

function scheduleTask(task, date) {
  setTaskDate(task, date);
  task.scheduledStart = `${date}T09:00`;
  task.scheduledEnd = `${date}T10:00`;
  task.status = "scheduled";
  task.completedAt = "";
}

function openTaskScheduler(taskId, pointerX = window.innerWidth / 2, pointerY = window.innerHeight / 2, options = {}) {
  stopSchedulerMonthHover();
  ui.scheduler = {
    taskId,
    month: monthKey(new Date()),
    dragging: Boolean(options.dragging),
    pointerId: options.pointerId ?? null,
    dragX: options.dragX ?? pointerX + 14,
    dragY: options.dragY ?? pointerY + 14,
    dragWidth: options.dragWidth ?? 260,
    dragOverDate: "",
    dragOverAction: "",
    dragOverTarget: "",
    monthEdge: "",
  };
  renderOverlays();
}

function closeTaskScheduler() {
  stopSchedulerMonthHover();
  if (ui.scheduleHoldTaskId) {
    document.querySelector(`[data-schedule-hold="${ui.scheduleHoldTaskId}"]`)?.classList.remove("is-holding");
  }
  ui.scheduleHoldTaskId = "";
  ui.scheduler = null;
  renderOverlays();
}

function scheduleTaskFromScheduler(date, options = {}) {
  const task = state.tasks.find((entry) => entry.id === ui.scheduler?.taskId);
  if (!task) return;
  if (options.animateDrop) {
    animateSchedulerDrop(() => commitScheduledTask(task, date));
    return;
  }
  commitScheduledTask(task, date);
}

function scheduleTaskActionFromScheduler(action, options = {}) {
  const task = state.tasks.find((entry) => entry.id === ui.scheduler?.taskId);
  if (!task) return;
  if (options.animateDrop) {
    animateSchedulerDrop(() => commitTaskScheduleAction(task, action));
    return;
  }
  commitTaskScheduleAction(task, action);
}

function commitScheduledTask(task, date) {
  scheduleTask(task, date);
  stopSchedulerMonthHover();
  ui.scheduler = null;
  saveState();
  showToast(`${date.slice(5)}에 배치했습니다.`);
  renderView({ soft: true, animateCards: ui.view === "tasks" });
  if (ui.selected?.type === "tasks" && ui.selected.id === task.id) renderDetail();
  renderOverlays();
}

function commitTaskScheduleAction(task, action) {
  if (action === "unplanned") {
    setTaskDate(task, "");
    task.status = "todo";
    task.completedAt = "";
    stopSchedulerMonthHover();
    ui.scheduler = null;
    saveState();
    showToast("미계획으로 옮겼습니다.");
    renderView({ soft: true, animateCards: ui.view === "tasks" });
    if (ui.selected?.type === "tasks" && ui.selected.id === task.id) renderDetail();
    renderOverlays();
    return;
  }
  if (action === "done") {
    task.status = "done";
    task.completedAt = task.completedAt || new Date().toISOString();
    stopSchedulerMonthHover();
    ui.scheduler = null;
    saveState();
    showToast("완료로 옮겼습니다.");
    renderView({ soft: true, animateCards: ui.view === "tasks" });
    if (ui.selected?.type === "tasks" && ui.selected.id === task.id) renderDetail();
    renderOverlays();
  }
}

function animateSchedulerDrop(done) {
  const ghost = document.querySelector(".schedule-drag-ghost");
  const target = document.querySelector(".task-scheduler-lane.is-drop-target, .task-scheduler-day.is-drop-target");
  if (!ghost || !target) {
    done();
    return;
  }
  const ghostRect = ghost.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const translateX = targetRect.left + targetRect.width / 2 - ghostRect.left - ghostRect.width / 2;
  const translateY = targetRect.top + targetRect.height / 2 - ghostRect.top - ghostRect.height / 2;
  ghost.classList.add("is-dropping");
  ghost.style.left = `${ghostRect.left}px`;
  ghost.style.top = `${ghostRect.top}px`;
  ghost.style.width = `${ghostRect.width}px`;
  ghost.style.transform = `translate(${translateX}px, ${translateY}px) scale(0.58)`;
  ghost.style.opacity = "0";
  target.classList.add("is-receiving");
  window.setTimeout(() => {
    target.classList.remove("is-receiving");
    done();
  }, 260);
}

function selectedItem() {
  if (!ui.selected) return null;
  return getCollection(ui.selected.type).find((entry) => entry.id === ui.selected.id);
}

function getCollection(type) {
  if (type === "captures") return state.captures;
  if (type === "boxes") return state.boxes;
  if (type === "goals") return state.goals;
  if (type === "projects") return state.projects;
  if (type === "tasks") return state.tasks;
  if (type === "resources") return state.resources;
  if (type === "habits") return state.habits;
  if (type === "journals") return state.journals;
  if (type === "obstacles") return state.obstacles;
  return [];
}

function titleFieldFor(type) {
  return ["projects", "goals", "boxes"].includes(type) ? "name" : "title";
}

function updateBlockText(blockContent) {
  const editor = blockContent.closest(".block-editor");
  const item = getCollection(editor.dataset.ownerType).find((entry) => entry.id === editor.dataset.ownerId);
  const block = item?.blocks.find((entry) => entry.id === blockContent.dataset.blockContent);
  if (!block) return;
  const rawText = blockContent.textContent || "";
  blockContent.classList.toggle("is-empty", rawText === "");
  if (/[\r\n]/.test(rawText)) {
    splitBlockFromNativeLineBreak(editor.dataset.ownerType, editor.dataset.ownerId, block.id, rawText);
    return;
  }
  if (applyMarkdownShortcut(blockContent, block, rawText)) {
    ui.slash = null;
    saveState();
    renderDetail({ soft: true });
    renderView({ soft: true });
    renderOverlays();
    if (block.type !== "divider") {
      requestAnimationFrame(() => focusBlockContent(block.id));
    }
    return;
  }
  block.text = rawText.replace(/^\/$/, "");
  saveState();
  renderView({ soft: true });
  if (rawText === "/") {
    openSlashMenu(blockContent, editor.dataset.ownerType, editor.dataset.ownerId, block.id);
  } else if (ui.slash?.blockId === block.id) {
    closeSlashMenu();
  }
}

function splitBlockFromNativeLineBreak(ownerType, ownerId, blockId, rawText) {
  const item = getCollection(ownerType).find((entry) => entry.id === ownerId);
  if (!item?.blocks) return;
  const index = item.blocks.findIndex((entry) => entry.id === blockId);
  if (index < 0) return;
  const parts = rawText.split(/\r\n|\n|\r/);
  item.blocks[index].text = parts.shift() || "";
  item.blocks[index].checked = false;
  const inserted = parts.map((text) => ({ id: id(), type: "paragraph", text, checked: false }));
  item.blocks.splice(index + 1, 0, ...inserted);
  saveState();
  renderDetail({ soft: true });
  renderView({ soft: true });
  requestAnimationFrame(() => {
    const targetId = inserted[0]?.id || blockId;
    focusBlockContent(targetId);
  });
}

function toggleBlockChecked(ownerType, ownerId, blockId, button) {
  const item = getCollection(ownerType).find((entry) => entry.id === ownerId);
  const block = item?.blocks.find((entry) => entry.id === blockId);
  if (!block) return;
  block.checked = !block.checked;
  const blockElement = button.closest(".block");
  blockElement?.setAttribute("data-checked", String(block.checked));
  button.classList.toggle("is-done", block.checked);
  button.setAttribute("aria-pressed", block.checked ? "true" : "false");
  saveState();
  renderView({ soft: true });
}

function applyMarkdownShortcut(blockContent, block, rawText) {
  const shortcuts = [
    [/^#\s$/, "heading1", ""],
    [/^##\s$/, "heading2", ""],
    [/^###\s$/, "heading3", ""],
    [/^[-*]\s$/, "bullet", ""],
    [/^1[.)]\s$/, "numbered", ""],
    [/^\[\s?\]\s$/, "todo", ""],
    [/^>\s$/, "toggle", ""],
    [/^!\s$/, "callout", ""],
    [/^```$/, "code", ""],
    [/^---$/, "divider", ""],
  ];
  const match = shortcuts.find(([pattern]) => pattern.test(rawText));
  if (!match) return false;
  block.type = match[1];
  block.text = match[2];
  block.checked = false;
  const blockElement = blockContent.closest(".block");
  blockElement.dataset.type = block.type;
  blockElement.dataset.checked = "false";
  blockContent.textContent = block.text;
  placeCaretAtEnd(blockContent);
  if (block.type === "divider") blockContent.blur();
  return true;
}

function placeCaretAtEnd(element) {
  element.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretAtStart(element) {
  element.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectionRangeInside(element) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !element.contains(selection.anchorNode)) return null;
  return selection.getRangeAt(0);
}

function splitTextAtSelection(element) {
  const text = element.textContent || "";
  const range = selectionRangeInside(element);
  if (!range) return { before: text, after: "" };
  const beforeRange = range.cloneRange();
  beforeRange.selectNodeContents(element);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const afterRange = range.cloneRange();
  afterRange.selectNodeContents(element);
  afterRange.setStart(range.endContainer, range.endOffset);
  return {
    before: beforeRange.toString(),
    after: afterRange.toString(),
  };
}

function insertBlockFromCaret(ownerType, ownerId, blockId, blockContent) {
  const item = getCollection(ownerType).find((entry) => entry.id === ownerId);
  if (!item) return;
  if (!item.blocks) item.blocks = [];
  const index = item.blocks.findIndex((block) => block.id === blockId);
  if (index < 0) return;
  const current = item.blocks[index];
  const split = splitTextAtSelection(blockContent);
  current.text = split.before;
  current.checked = false;
  const continuedTypes = ["bullet", "numbered", "todo"];
  const newBlock = {
    id: id(),
    type: continuedTypes.includes(current.type) && split.before ? current.type : "paragraph",
    text: split.after,
    checked: false,
  };
  item.blocks.splice(index + 1, 0, newBlock);
  saveState();
  renderDetail({ soft: true });
  renderView({ soft: true });
  requestAnimationFrame(() => {
    const target = focusBlockContent(newBlock.id);
    if (target && split.after) placeCaretAtStart(target);
  });
}

function insertBlock(ownerType, ownerId, afterBlockId) {
  const item = getCollection(ownerType).find((entry) => entry.id === ownerId);
  if (!item) return;
  if (!item.blocks) item.blocks = [];
  const index = item.blocks.findIndex((block) => block.id === afterBlockId);
  const newBlock = { id: id(), type: "paragraph", text: "", checked: false };
  item.blocks.splice(index + 1, 0, newBlock);
  saveState();
  renderDetail({ soft: true });
  renderView({ soft: true });
  requestAnimationFrame(() => {
    focusBlockContent(newBlock.id);
  });
}

function removeBlock(ownerType, ownerId, blockId) {
  const item = getCollection(ownerType).find((entry) => entry.id === ownerId);
  if (!item || item.blocks.length <= 1) return;
  const index = item.blocks.findIndex((block) => block.id === blockId);
  item.blocks.splice(index, 1);
  saveState();
  renderDetail({ soft: true });
  renderView({ soft: true });
  requestAnimationFrame(() => {
    const fallback = item.blocks[Math.max(0, index - 1)];
    focusBlockContent(fallback.id);
  });
}

function changeBlockType(ownerType, ownerId, blockId, type) {
  const item = getCollection(ownerType).find((entry) => entry.id === ownerId);
  const block = item?.blocks.find((entry) => entry.id === blockId);
  if (!block) return;
  block.type = type;
  if (block.text === "/") block.text = "";
  ui.slash = null;
  saveState();
  renderDetail({ soft: true });
  renderView({ soft: true });
  renderOverlays();
  requestAnimationFrame(() => focusBlockContent(blockId));
}

function focusBlockContent(blockId) {
  const target = document.querySelector(`[data-block-content="${blockId}"]`);
  if (!target) return null;
  target.focus();
  activateBlockContent(target);
  placeCaretAtEnd(target);
  return target;
}

function moveCaretBetweenBlocks(blockContent, key) {
  const range = selectionRangeInside(blockContent);
  if (!range || !range.collapsed) return false;
  const direction = key === "ArrowUp" ? -1 : 1;
  if (!isCaretOnVerticalEdge(blockContent, direction)) return false;
  const target = adjacentBlockContent(blockContent, direction);
  if (!target) return false;
  const caretRect = caretRectFor(blockContent);
  requestAnimationFrame(() => focusBlockAtPoint(target, direction, caretRect?.left || 0));
  return true;
}

function adjacentBlockContent(blockContent, direction) {
  let block = blockContent.closest(".block");
  while (block) {
    block = direction < 0 ? block.previousElementSibling : block.nextElementSibling;
    const target = block?.querySelector("[data-block-content]");
    if (target) return target;
  }
  return null;
}

function isCaretOnVerticalEdge(element, direction) {
  if (!(element.textContent || "")) return true;
  const caretRect = caretRectFor(element);
  if (!caretRect) return true;
  const lineRects = textLineRectsFor(element);
  if (lineRects.length <= 1) return true;
  const caretMiddle = caretRect.top + caretRect.height / 2;
  if (direction < 0) {
    const first = lineRects[0];
    return caretMiddle <= first.top + first.height * 0.75;
  }
  const last = lineRects[lineRects.length - 1];
  return caretMiddle >= last.bottom - last.height * 0.75;
}

function caretRectFor(element) {
  const range = selectionRangeInside(element);
  if (!range) return null;
  const rect = Array.from(range.getClientRects()).find((entry) => entry.width || entry.height) || range.getBoundingClientRect();
  if (rect && (rect.width || rect.height)) return rect;
  const elementRect = element.getBoundingClientRect();
  return {
    left: elementRect.left + 4,
    right: elementRect.left + 4,
    top: elementRect.top + 4,
    bottom: Math.min(elementRect.bottom, elementRect.top + 24),
    width: 0,
    height: Math.min(20, Math.max(1, elementRect.height - 8)),
  };
}

function textLineRectsFor(element) {
  if (!(element.textContent || "")) return [];
  const range = document.createRange();
  range.selectNodeContents(element);
  return Array.from(range.getClientRects()).filter((entry) => entry.width || entry.height);
}

function focusBlockAtPoint(target, direction, x) {
  target.focus();
  activateBlockContent(target);
  if (!(target.textContent || "")) {
    placeCaretAtStart(target);
    return;
  }
  if (placeCaretNearPoint(target, direction, x)) return;
  if (direction < 0) {
    placeCaretAtEnd(target);
  } else {
    placeCaretAtStart(target);
  }
}

function placeCaretNearPoint(element, direction, x) {
  const rect = element.getBoundingClientRect();
  const targetX = Math.max(rect.left + 2, Math.min(x || rect.left + 2, rect.right - 2));
  const targetY = direction < 0 ? rect.bottom - Math.min(8, rect.height / 2) : rect.top + Math.min(8, rect.height / 2);
  let range = null;
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(targetX, targetY);
    if (position && element.contains(position.offsetNode)) {
      range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
    }
  } else if (document.caretRangeFromPoint) {
    const pointRange = document.caretRangeFromPoint(targetX, targetY);
    if (pointRange && element.contains(pointRange.startContainer)) {
      range = pointRange;
    }
  }
  if (!range) return false;
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function openSlashMenu(blockContent, ownerType, ownerId, blockId) {
  const rect = blockContent.getBoundingClientRect();
  ui.slash = {
    ownerType,
    ownerId,
    blockId,
    selectedIndex: ui.slash?.blockId === blockId ? ui.slash.selectedIndex || 0 : 0,
    x: Math.max(12, Math.min(rect.left, window.innerWidth - 440)),
    y: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 340)),
  };
  renderOverlays();
}

function closeSlashMenu() {
  ui.slash = null;
  renderOverlays();
}

function moveSlashSelection(offset) {
  if (!ui.slash) return;
  const count = Object.keys(BLOCK_TYPES).length;
  ui.slash.selectedIndex = ((ui.slash.selectedIndex || 0) + offset + count) % count;
  renderOverlays();
  requestAnimationFrame(() => document.querySelector(".slash-menu .menu-item.is-active")?.scrollIntoView({ block: "nearest" }));
}

function applySlashSelection() {
  if (!ui.slash) return;
  const types = Object.keys(BLOCK_TYPES);
  const selectedIndex = Math.max(0, Math.min(ui.slash.selectedIndex || 0, types.length - 1));
  const slash = ui.slash;
  changeBlockType(slash.ownerType, slash.ownerId, slash.blockId, types[selectedIndex]);
}

async function connectGoogle() {
  if (!state.settings.googleClientId.trim()) {
    showToast("OAuth Client ID가 필요합니다.");
    return;
  }
  try {
    await loadScript(GOOGLE_SCRIPT_SRC);
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: state.settings.googleClientId.trim(),
      scope: GOOGLE_SCOPE,
      callback: (response) => {
        if (response.error) {
          showToast(`Google 연결 실패: ${response.error}`);
          return;
        }
        googleAccessToken = response.access_token;
        state.settings.googleConnectedAt = new Date().toISOString();
        saveState();
        showToast("Google Calendar 연결 완료");
        renderView({ soft: true });
      },
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  } catch {
    showToast("Google 스크립트를 불러오지 못했습니다.");
  }
}

async function fetchGoogleCalendarEvents(options = {}) {
  if (!googleAccessToken) {
    showToast("먼저 Google을 연결하세요.");
    return;
  }
  const calendarId = state.settings.googleCalendarId || "primary";
  const encodedCalendarId = encodeURIComponent(calendarId);
  const range = combinedCalendarRange();
  const params = new URLSearchParams({
    timeMin: new Date(`${range.start}T00:00:00`).toISOString(),
    timeMax: new Date(`${range.endExclusive}T00:00:00`).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "2500",
  });

  try {
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodedCalendarId}/events?${params}`, {
      headers: { Authorization: `Bearer ${googleAccessToken}` },
    });
    if (!response.ok) {
      showToast("Google 일정을 불러오지 못했습니다.");
      return;
    }
    const payload = await response.json();
    state.googleEvents = (payload.items || []).map((event) => normalizeGoogleApiEvent(event, calendarId)).filter(Boolean);
    state.settings.lastGoogleFetchAt = new Date().toISOString();
    saveState();
    if (!options.silent) showToast(`${state.googleEvents.length}개 Google 일정을 불러왔습니다.`);
    renderView({ soft: true });
  } catch {
    showToast("Google Calendar API 요청에 실패했습니다.");
  }
}

async function syncGoogleCalendar() {
  if (!googleAccessToken) {
    showToast("먼저 Google을 연결하세요.");
    return;
  }
  const calendarId = state.settings.googleCalendarId || "primary";
  const encodedCalendarId = encodeURIComponent(calendarId);
  const tasks = state.tasks.filter((task) => task.scheduledStart && task.status !== "done" && !task.googleEventId);
  if (!tasks.length) {
    showToast("동기화할 예정 작업이 없습니다.");
    return;
  }

  let synced = 0;
  for (const task of tasks) {
    const start = new Date(task.scheduledStart);
    const end = task.scheduledEnd ? new Date(task.scheduledEnd) : new Date(start.getTime() + (task.estimatedMinutes || 30) * 60000);
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodedCalendarId}/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${googleAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: task.title,
        description: blockText(task),
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      }),
    });
    if (response.ok) {
      const event = await response.json();
      task.googleEventId = event.id;
      const normalized = normalizeGoogleApiEvent(event, calendarId);
      if (normalized) {
        state.googleEvents = [...(state.googleEvents || []).filter((entry) => entry.id !== normalized.id), normalized];
      }
      synced += 1;
    }
  }
  state.settings.lastGoogleSyncAt = new Date().toISOString();
  saveState();
  showToast(`${synced}개 작업을 Google Calendar로 보냈습니다.`);
  renderView({ soft: true });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `sygma-local-${dateKey(new Date())}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("JSON을 내보냈습니다.");
}

function resetDemoData() {
  state = createSeedState();
  googleAccessToken = "";
  ui.selected = null;
  ui.resourceNotes = [];
  ui.resourceDrag = null;
  ui.blockDrag = null;
  ui.editorMarquee = null;
  ui.expandedTodayTaskId = "";
  ui.blockSelection = { ownerType: "", ownerId: "", ids: [] };
  ui.activeBlockId = "";
  ui.search = "";
  saveState();
  renderView({ soft: true });
  renderDetail();
  renderOverlays();
  showToast("최소 데이터로 재생성했습니다.");
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const normalized = normalizeState(JSON.parse(raw));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      return normalized;
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  const seeded = createSeedState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  return seeded;
}

function normalizeState(next) {
  const seeded = createSeedState();
  const tasks = (next.tasks || seeded.tasks).map(({ kind, ...task }) => task);
  const journals = (next.journals || seeded.journals).map(({ kind, ...journal }) => journal);
  const settings = { ...seeded.settings, ...(next.settings || {}) };
  settings.navOrder = normalizeNavOrder(settings.navOrder);
  return {
    ...seeded,
    ...next,
    version: 3,
    settings,
    captures: next.captures || seeded.captures,
    boxes: next.boxes || seeded.boxes,
    goals: next.goals || seeded.goals,
    projects: next.projects || seeded.projects,
    tasks,
    resources: next.resources || seeded.resources,
    habits: next.habits || seeded.habits,
    habitInstances: next.habitInstances || seeded.habitInstances,
    journals,
    obstacles: next.obstacles || seeded.obstacles,
    googleEvents: next.googleEvents || seeded.googleEvents,
    links: next.links || seeded.links,
  };
}

function saveState() {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function createSeedState() {
  return createMinimalSeedState();
}

function createMinimalSeedState() {
  const now = new Date();
  const createdAt = new Date().toISOString();
  const boxId = id();
  const goalId = id();
  const projectId = id();
  const resourceId = id();

  return {
    version: 3,
    createdAt,
    updatedAt: createdAt,
    settings: {
      appMode: "local",
      notionSyncMode: "one-time-final",
      navOrder: defaultNavOrder(),
      googleClientId: "",
      googleCalendarId: "primary",
      googleConnectedAt: "",
      lastGoogleFetchAt: "",
      lastGoogleSyncAt: "",
    },
    captures: [
      {
        id: id(),
        title: "Task로 옮길 수집 항목",
        url: "",
        status: "inbox",
        convertedTo: "",
        convertedId: "",
        createdAt,
        processedAt: "",
      },
    ],
    boxes: [
      { id: boxId, name: "기본 Box", visibility: "pinned", color: "blue", blocks: blocks("Task 분류 흐름 검증용 최소 Box.") },
    ],
    goals: [
      {
        id: goalId,
        boxId,
        name: "기본 Goal",
        status: "active",
        targetDate: "",
        year: String(now.getFullYear()),
        quarter: `${Math.floor(now.getMonth() / 3) + 1}Q`,
        blocks: blocks("Task 분류 흐름 검증용 최소 Goal."),
      },
    ],
    projects: [
      {
        id: projectId,
        goalId,
        boxId,
        name: "기본 Project",
        status: "active",
        startDate: "",
        endDate: "",
        blocks: blocks("Task 분류 흐름 검증용 최소 Project."),
      },
    ],
    tasks: [],
    resources: [
      {
        id: resourceId,
        title: "기본 Resource",
        type: "note",
        importance: "normal",
        pinned: false,
        readLater: false,
        url: "",
        boxId,
        goalId,
        projectId,
        blocks: blocks("Task 분류 흐름 검증용 최소 Resource."),
      },
    ],
    habits: [],
    habitInstances: [],
    journals: [],
    obstacles: [],
    googleEvents: [],
    links: [],
  };
}

function blocks(text = "") {
  return [{ id: id(), type: "paragraph", text, checked: false }];
}

function id() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function projectStats(project) {
  const tasks = state.tasks.filter((task) => task.projectId === project.id);
  const done = tasks.filter((task) => task.status === "done").length;
  const total = tasks.length;
  return {
    tasks,
    done,
    total,
    progress: total ? Math.round((done / total) * 100) : 0,
  };
}

function projectDateLabel(date) {
  if (!date) return "미정";
  return compactDateLabel(date);
}

function projectRangeLabel(project) {
  const start = project.startDate ? compactDateLabel(project.startDate) : "시작 미정";
  const end = project.endDate ? compactDateLabel(project.endDate) : "종료 미정";
  return `${start} - ${end}`;
}

function compactDateLabel(value) {
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return String(value);
  const currentYear = new Date().getFullYear();
  return year === currentYear ? `${month}월 ${day}일` : `${year}.${month}.${day}`;
}

function nameOf(type, itemId) {
  const item = getCollection(type).find((entry) => entry.id === itemId);
  if (!item) return "";
  return item.name || item.title || "";
}

function blockText(item) {
  return (item.blocks || []).map((block) => block.text).filter(Boolean).join(" ");
}

function empty(text) {
  return `<div class="empty">${esc(text)}</div>`;
}

function badge(text, color = "") {
  if (!text) return "";
  return `<span class="badge ${color}">${esc(text)}</span>`;
}

function bySchedule(a, b) {
  return (a.scheduledStart || a.dueDate || "").localeCompare(b.scheduledStart || b.dueDate || "");
}

function isTaskOnDate(task, date) {
  return task.scheduledStart?.slice(0, 10) === date || task.dueDate === date;
}

function isOverdue(task) {
  const today = dateKey(new Date());
  const compare = task.dueDate || task.scheduledStart?.slice(0, 10);
  return Boolean(compare && compare < today && task.status !== "done" && task.status !== "canceled");
}

function schedulerLaneTargets(excludedTaskId = "") {
  const today = dateKey(new Date());
  const tomorrow = dateKey(addDays(new Date(), 1));
  const nextScheduled = dateKey(addDays(new Date(), 2));
  const late = dateKey(addDays(new Date(), -1));
  const active = state.tasks.filter((task) => task.id !== excludedTaskId && task.status !== "done" && task.status !== "canceled");
  const scheduled = active.filter((task) => (task.scheduledStart || task.dueDate) && !isTaskOnDate(task, today) && !isTaskOnDate(task, tomorrow) && !isOverdue(task));
  const unplanned = active.filter((task) => !task.scheduledStart && !task.dueDate);
  const done = state.tasks.filter((task) => task.id !== excludedTaskId && task.status === "done");
  return [
    { key: "unplanned", title: "미계획", action: "unplanned", targetKey: "action:unplanned", meta: "날짜 제거", count: unplanned.length },
    { key: "today", title: "오늘", date: today, targetKey: `date:${today}`, meta: shortDateLabel(today), count: active.filter((task) => isTaskOnDate(task, today)).length },
    { key: "tomorrow", title: "내일", date: tomorrow, targetKey: `date:${tomorrow}`, meta: shortDateLabel(tomorrow), count: active.filter((task) => isTaskOnDate(task, tomorrow)).length },
    { key: "scheduled", title: "예정", date: nextScheduled, targetKey: `date:${nextScheduled}`, meta: `${shortDateLabel(nextScheduled)}로`, count: scheduled.length },
    { key: "overdue", title: "지연", date: late, targetKey: `date:${late}`, meta: `${shortDateLabel(late)}로`, count: active.filter(isOverdue).length },
    { key: "done", title: "완료", action: "done", targetKey: "action:done", meta: "완료 처리", count: done.length },
  ];
}

function shortDateLabel(date) {
  const [, month, day] = String(date).split("-").map(Number);
  return `${month}월 ${day}일`;
}

function monthSideLabel(date) {
  return `${date.getMonth() + 1}월`;
}

function matchesSearch(text) {
  return !ui.search || String(text).toLowerCase().includes(ui.search.toLowerCase());
}

function habitVisibleDayCount() {
  const width = Math.round(els.viewRoot?.getBoundingClientRect().width || window.innerWidth || 0);
  if (width >= 1180) return 14;
  if (width >= 900) return 10;
  if (width >= 620) return 7;
  return 5;
}

function habitPreviewDays(currentDate) {
  const count = habitVisibleDayCount();
  const current = new Date(currentDate);
  const start = count < 7 ? addDays(current, -Math.floor(count / 2)) : startOfWeek(current);
  return Array.from({ length: count }, (_, index) => dateKey(addDays(start, index)));
}

function habitRangeLabel(days) {
  if (!days.length) return "";
  return `${compactDateLabel(days[0])} - ${compactDateLabel(days[days.length - 1])}`;
}

function habitMonthStats(habitId, monthDate) {
  const month = monthKey(monthDate);
  const total = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const completed = state.habitInstances.filter((entry) => entry.habitId === habitId && entry.completed && entry.date.startsWith(month)).length;
  return { completed, total };
}

function habitDone(habitId, date) {
  return Boolean(state.habitInstances.find((entry) => entry.habitId === habitId && entry.date === date && entry.completed));
}

function countOf(key) {
  if (Array.isArray(state[key])) return state[key].length;
  if (key === "settings") return Object.keys(state.settings).length;
  return 0;
}

function totalBlocks() {
  return [...state.boxes, ...state.goals, ...state.projects, ...state.tasks, ...state.resources, ...state.habits, ...state.journals, ...state.obstacles].reduce(
    (sum, item) => sum + (item.blocks?.length || 0),
    0
  );
}

function dateKey(date) {
  const target = new Date(date);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKey(date) {
  const target = new Date(date);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function parseMonthKey(key) {
  const [year, month] = String(key || monthKey(new Date())).split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function monthLabel(date) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(date);
}

function monthGridDays(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function habitCalendarMonthDays(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = startOfSundayWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date) {
  const start = new Date(date);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  start.setHours(0, 0, 0, 0);
  return start;
}

function startOfSundayWeek(date) {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  return start;
}

function weekendClass(date) {
  const day = date.getDay();
  if (day === 0) return "is-sunday";
  if (day === 6) return "is-saturday";
  return "";
}

function weekday(date) {
  return new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(date);
}

function formatLongDate(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function parseDateOnly(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function normalizeGoogleApiEvent(event, calendarId = state.settings.googleCalendarId || "primary") {
  const startValue = event?.start?.dateTime || event?.start?.date || "";
  if (!startValue) return null;
  const endValue = event.end?.dateTime || event.end?.date || startValue;
  const allDay = Boolean(event.start?.date);
  const startDate = allDay ? event.start.date : dateKey(new Date(startValue));
  let endDate = allDay ? dateKey(addDays(parseDateOnly(endValue), -1)) : dateKey(new Date(endValue));
  if (endDate < startDate) endDate = startDate;
  return {
    id: event.id || `${calendarId}:${startValue}:${event.summary || ""}`,
    calendarId,
    source: "google",
    title: event.summary || "(제목 없음)",
    start: startValue,
    end: endValue,
    startDate,
    endDate,
    allDay,
    htmlLink: event.htmlLink || "",
    status: event.status || "",
    updated: event.updated || "",
  };
}

function extractUrl(text) {
  return text.match(/https?:\/\/\S+/)?.[0] || "";
}

function esc(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}
