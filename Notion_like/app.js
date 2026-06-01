const STORAGE_KEY = "sygma-local-os-state-v1";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

const views = [
  ["today", "오늘", "⌁"],
  ["inbox", "Inbox", "↧"],
  ["plan", "Plan", "◫"],
  ["tasks", "Tasks", "✓"],
  ["projects", "Projects", "▦"],
  ["goals", "Goals", "◎"],
  ["boxes", "Boxes", "□"],
  ["resources", "Resources", "≡"],
  ["journal", "Journal", "✎"],
  ["calendar", "Calendar", "◷"],
];

const blockTypes = {
  paragraph: ["텍스트", "T"],
  heading1: ["제목 1", "H1"],
  heading2: ["제목 2", "H2"],
  bullet: ["목록", "•"],
  todo: ["체크", "☑"],
  quote: ["인용", "❝"],
  code: ["코드", "</>"],
};

const taskKinds = {
  focus: "집중",
  normal: "일반",
  easy: "쉬운",
  delegated: "위임",
  event: "일정",
  someday: "나중에",
  routine: "루틴",
};

const statuses = {
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
};

let state = loadState();
let googleAccessToken = "";
let ui = {
  view: "today",
  selected: null,
  commandOpen: false,
  slash: null,
  search: "",
};

init();

function init() {
  app.addEventListener("click", handleClick);
  app.addEventListener("submit", handleSubmit);
  app.addEventListener("input", handleInput);
  app.addEventListener("change", handleChange);
  app.addEventListener("keydown", handleKeydown);
  app.addEventListener("dragstart", handleDragStart);
  app.addEventListener("dragover", handleDragOver);
  app.addEventListener("dragleave", handleDragLeave);
  app.addEventListener("drop", handleDrop);
  document.addEventListener("keydown", handleDocumentKeydown);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".command-menu") && !event.target.closest("[data-action='open-command']")) {
      if (ui.commandOpen) {
        ui.commandOpen = false;
        render();
      }
    }
    if (!event.target.closest(".slash-menu") && !event.target.closest(".block-content")) {
      if (ui.slash) {
        ui.slash = null;
        render();
      }
    }
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }

  render();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeState(JSON.parse(raw));
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  const seeded = createSeedState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  return seeded;
}

function normalizeState(next) {
  const seeded = createSeedState();
  return {
    ...seeded,
    ...next,
    settings: { ...seeded.settings, ...(next.settings || {}) },
    captures: next.captures || [],
    boxes: next.boxes || [],
    goals: next.goals || [],
    projects: next.projects || [],
    tasks: next.tasks || [],
    resources: next.resources || [],
    journals: next.journals || [],
  };
}

function saveState() {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function createSeedState() {
  const today = dateKey(new Date());
  const tomorrow = dateKey(addDays(new Date(), 1));
  const weekLater = dateKey(addDays(new Date(), 7));
  const boxResearch = id();
  const boxHealth = id();
  const boxLife = id();
  const goalPaper = id();
  const goalHealth = id();
  const projectRevision = id();
  const projectRoutine = id();
  const resPaper = id();
  const resHabit = id();
  const taskRead = id();
  const taskDraft = id();
  const taskWalk = id();
  const taskPlan = id();

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: {
      appMode: "local",
      notionSyncMode: "one-time-final",
      googleClientId: "",
      googleCalendarId: "primary",
      googleConnectedAt: "",
      lastGoogleSyncAt: "",
    },
    captures: [
      {
        id: id(),
        title: "읽을 논문 링크 정리",
        url: "",
        status: "inbox",
        createdAt: new Date().toISOString(),
      },
      {
        id: id(),
        title: "주간 리뷰에 넣을 질문",
        url: "",
        status: "inbox",
        createdAt: new Date().toISOString(),
      },
    ],
    boxes: [
      { id: boxResearch, name: "연구", visibility: "pinned", color: "blue", blocks: blocks("연구와 논문 작성 흐름을 모아둔다.") },
      { id: boxHealth, name: "건강", visibility: "pinned", color: "teal", blocks: blocks("루틴과 회복을 관리한다.") },
      { id: boxLife, name: "생활", visibility: "normal", color: "violet", blocks: blocks("개인 생활 운영 영역.") },
    ],
    goals: [
      {
        id: goalPaper,
        boxId: boxResearch,
        name: "ReCoFormer 논문 완성",
        status: "active",
        targetDate: weekLater,
        year: "2026",
        quarter: "2Q",
        blocks: blocks("논문 수정, 실험 정리, 리뷰 대응을 완료한다."),
      },
      {
        id: goalHealth,
        boxId: boxHealth,
        name: "운동 루틴 안정화",
        status: "focus",
        targetDate: weekLater,
        year: "2026",
        quarter: "2Q",
        blocks: blocks("작게 반복 가능한 루틴으로 몸 상태를 끌어올린다."),
      },
    ],
    projects: [
      {
        id: projectRevision,
        goalId: goalPaper,
        boxId: boxResearch,
        name: "Revision 자료 패키지 만들기",
        status: "active",
        startDate: today,
        endDate: weekLater,
        blocks: blocks("리뷰어 코멘트별 대응 근거와 실험 결과를 묶는다."),
      },
      {
        id: projectRoutine,
        goalId: goalHealth,
        boxId: boxHealth,
        name: "아침 걷기 루틴 만들기",
        status: "planned",
        startDate: today,
        endDate: weekLater,
        blocks: blocks("매일 낮은 마찰로 시작할 수 있는 걷기 루틴을 만든다."),
      },
    ],
    tasks: [
      {
        id: taskRead,
        title: "SSL 관련 논문 2개 메모",
        status: "scheduled",
        kind: "focus",
        boxId: boxResearch,
        goalId: goalPaper,
        projectId: projectRevision,
        resourceId: resPaper,
        dueDate: today,
        scheduledStart: `${today}T10:00`,
        scheduledEnd: `${today}T11:30`,
        estimatedMinutes: 90,
        actualMinutes: 0,
        completedAt: "",
        googleEventId: "",
        blocks: blocks("핵심 contribution과 비교 실험만 먼저 정리한다."),
      },
      {
        id: taskDraft,
        title: "리뷰 대응 초안 작성",
        status: "todo",
        kind: "normal",
        boxId: boxResearch,
        goalId: goalPaper,
        projectId: projectRevision,
        resourceId: resPaper,
        dueDate: tomorrow,
        scheduledStart: "",
        scheduledEnd: "",
        estimatedMinutes: 120,
        actualMinutes: 0,
        completedAt: "",
        googleEventId: "",
        blocks: blocks("먼저 outline만 만들고 세부 문장은 다음 블록에서 다듬는다."),
      },
      {
        id: taskWalk,
        title: "20분 걷기",
        status: "scheduled",
        kind: "routine",
        boxId: boxHealth,
        goalId: goalHealth,
        projectId: projectRoutine,
        resourceId: resHabit,
        dueDate: today,
        scheduledStart: `${today}T18:30`,
        scheduledEnd: `${today}T19:00`,
        estimatedMinutes: 20,
        actualMinutes: 0,
        completedAt: "",
        googleEventId: "",
        blocks: blocks("집 앞 코스로 시작한다."),
      },
      {
        id: taskPlan,
        title: "다음 주 프로젝트 타임라인 재정렬",
        status: "todo",
        kind: "easy",
        boxId: boxLife,
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
        blocks: blocks("미계획 업무를 이번 주/다음 주로 나눈다."),
      },
    ],
    resources: [
      {
        id: resPaper,
        title: "ReCoFormer revision 노트",
        type: "note",
        importance: "important",
        pinned: true,
        readLater: false,
        url: "",
        boxId: boxResearch,
        goalId: goalPaper,
        projectId: projectRevision,
        blocks: [
          { id: id(), type: "heading1", text: "Revision 대응", checked: false },
          { id: id(), type: "paragraph", text: "리뷰어별 질문을 evidence, experiment, wording으로 나눠 관리한다.", checked: false },
          { id: id(), type: "todo", text: "추가 실험 결과 표 정리", checked: false },
        ],
      },
      {
        id: resHabit,
        title: "걷기 루틴 설계",
        type: "note",
        importance: "normal",
        pinned: true,
        readLater: false,
        url: "",
        boxId: boxHealth,
        goalId: goalHealth,
        projectId: projectRoutine,
        blocks: blocks("낮은 강도, 같은 시간, 같은 장소를 우선한다."),
      },
    ],
    journals: [
      {
        id: id(),
        title: `${today} 데일리 리뷰`,
        kind: "daily",
        date: today,
        satisfaction: 7,
        blocks: blocks("오늘은 계획과 실제 실행의 차이를 짧게 기록한다."),
      },
    ],
  };
}

function blocks(text = "") {
  return [{ id: id(), type: "paragraph", text, checked: false }];
}

function id() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function render() {
  app.innerHTML = `
    <div class="layout">
      ${renderSidebar()}
      <main class="main">
        ${renderTopbar()}
        ${renderCurrentView()}
      </main>
    </div>
    <button class="fab" type="button" data-action="open-command" aria-label="빠른 생성">+</button>
    ${ui.selected ? renderDetail() : ""}
    ${ui.commandOpen ? renderCommandMenu() : ""}
    ${ui.slash ? renderSlashMenu() : ""}
  `;
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">S</div>
        <div>
          <div class="brand-title">SYGMA Local</div>
          <div class="brand-subtitle">개인 로컬 운영체제</div>
        </div>
      </div>
      <nav class="nav">
        ${views
          .map(([key, label, icon]) => `
            <button class="nav-button ${ui.view === key ? "is-active" : ""}" type="button" data-view="${key}">
              <span class="nav-icon">${icon}</span>
              <span>${label}</span>
            </button>
          `)
          .join("")}
      </nav>
      <div class="sidebar-footer">
        <div class="sync-chip">
          <span>Local first</span>
          <span class="sync-dot"></span>
        </div>
      </div>
    </aside>
  `;
}

function renderTopbar() {
  return `
    <div class="topbar">
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

function renderCurrentView() {
  const map = {
    today: renderToday,
    inbox: renderInbox,
    plan: renderPlan,
    tasks: renderTasks,
    projects: renderProjects,
    goals: renderGoals,
    boxes: renderBoxes,
    resources: renderResources,
    journal: renderJournal,
    calendar: renderCalendar,
  };
  return map[ui.view]();
}

function renderViewHeader(eyebrow, title, copy, actions = "") {
  return `
    <header class="view-header">
      <div>
        <div class="eyebrow">${eyebrow}</div>
        <h1 class="view-title">${title}</h1>
        <p class="view-copy">${copy}</p>
      </div>
      <div class="toolbar">${actions}</div>
    </header>
  `;
}

function renderToday() {
  const today = dateKey(new Date());
  const todayTasks = state.tasks.filter((task) => isTaskOnDate(task, today) && task.status !== "done");
  const overdue = state.tasks.filter((task) => isOverdue(task) && task.status !== "done");
  const doneToday = state.tasks.filter((task) => task.completedAt?.slice(0, 10) === today);
  const focusProjects = state.projects.filter((project) => ["active", "focus"].includes(project.status));
  const pinnedResources = state.resources.filter((resource) => resource.pinned);

  return `
    <section class="view">
      ${renderViewHeader("Today", "오늘의 실행", "수집, 계획, 실행을 한 화면에서 처리합니다.", `
        <button class="button secondary" type="button" data-action="new-journal">오늘 리뷰</button>
      `)}
      <div class="metric-grid">
        ${renderMetric("오늘 할 일", todayTasks.length, "예정/기한 포함")}
        ${renderMetric("완료", doneToday.length, "오늘 체크한 항목")}
        ${renderMetric("지연", overdue.length, "다시 배치 필요")}
        ${renderMetric("집중 프로젝트", focusProjects.length, "진행 중")}
      </div>
      <div class="grid cols-2">
        <div class="panel">
          ${panelHeader("오늘 할 일", "시간순")}
          <div class="stack">${todayTasks.length ? todayTasks.sort(bySchedule).map(renderTaskCard).join("") : empty("오늘 할 일이 없습니다.")}</div>
        </div>
        <div class="panel">
          ${panelHeader("지연 항목", "Plan에서 재배치")}
          <div class="stack">${overdue.length ? overdue.map(renderTaskCard).join("") : empty("지연된 항목이 없습니다.")}</div>
        </div>
        <div class="panel">
          ${panelHeader("집중 프로젝트", "목표와 연결")}
          <div class="stack">${focusProjects.length ? focusProjects.map(renderProjectCard).join("") : empty("진행 중인 프로젝트가 없습니다.")}</div>
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
  const processed = state.captures.filter((capture) => capture.status === "processed").slice(-5).reverse();
  return `
    <section class="view">
      ${renderViewHeader("Inbox", "수집과 분류", "모든 입력은 먼저 Capture로 저장한 뒤 필요한 엔티티로 변환합니다.", `
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

function renderPlan() {
  const today = dateKey(new Date());
  const tomorrow = dateKey(addDays(new Date(), 1));
  const nextWeek = dateKey(addDays(new Date(), 7));
  const unplanned = state.tasks.filter((task) => !task.scheduledStart && task.status !== "done");
  const overdue = state.tasks.filter((task) => isOverdue(task) && task.status !== "done");
  const planned = state.tasks.filter((task) => task.scheduledStart && task.status !== "done").sort(bySchedule);

  return `
    <section class="view">
      ${renderViewHeader("Plan", "분류된 항목을 시간에 배치", "미계획과 지연 항목을 오늘, 내일, 다음 주로 빠르게 밀어 넣습니다.")}
      <div class="grid cols-3">
        <div class="panel">
          ${panelHeader("미계획", `${unplanned.length}개`)}
          <div class="stack">${unplanned.length ? unplanned.map((task) => renderTaskCard(task, true)).join("") : empty("미계획 업무가 없습니다.")}</div>
        </div>
        <div class="panel">
          ${panelHeader("지연", `${overdue.length}개`)}
          <div class="stack">${overdue.length ? overdue.map((task) => renderTaskCard(task, true)).join("") : empty("지연된 업무가 없습니다.")}</div>
        </div>
        <div class="panel">
          ${panelHeader("예정", `${planned.length}개`)}
          <div class="stack">${planned.length ? planned.slice(0, 8).map((task) => renderTaskCard(task, true)).join("") : empty("예정된 업무가 없습니다.")}</div>
        </div>
      </div>
      <div class="grid cols-3" style="margin-top:14px">
        ${renderDropZone("오늘", today, "오늘 오후로 배치")}
        ${renderDropZone("내일", tomorrow, "내일 오전으로 배치")}
        ${renderDropZone("다음 주", nextWeek, "다음 주 첫날로 배치")}
      </div>
      <div class="panel" style="margin-top:14px">
        ${panelHeader("프로젝트 타임라인", "진행/계획")}
        <div class="stack">${state.projects.map(renderProjectCard).join("")}</div>
      </div>
    </section>
  `;
}

function renderTasks() {
  const filtered = state.tasks.filter((task) => matchesSearch(task.title));
  return `
    <section class="view">
      ${renderViewHeader("Tasks", "실행 단위", "할 일, 일정, 위임, 나중에 항목을 한곳에서 관리합니다.", `
        <input class="input" style="width:220px" data-action-input="search" value="${esc(ui.search)}" placeholder="검색">
        <button class="button secondary" type="button" data-action="new-task">새 할 일</button>
      `)}
      <div class="grid cols-3">
        ${renderTaskColumn("집중", filtered.filter((task) => task.kind === "focus" && task.status !== "done"))}
        ${renderTaskColumn("일반/쉬운", filtered.filter((task) => ["normal", "easy"].includes(task.kind) && task.status !== "done"))}
        ${renderTaskColumn("일정/위임/나중에", filtered.filter((task) => ["event", "delegated", "somday", "someday", "routine"].includes(task.kind) && task.status !== "done"))}
      </div>
      <div class="panel" style="margin-top:14px">
        ${panelHeader("완료", "최근")}
        <div class="stack">${filtered.filter((task) => task.status === "done").slice(-10).reverse().map(renderTaskCard).join("") || empty("완료한 업무가 없습니다.")}</div>
      </div>
    </section>
  `;
}

function renderProjects() {
  return `
    <section class="view">
      ${renderViewHeader("Projects", "프로젝트", "목표를 실행 가능한 묶음으로 쪼개고 자료와 할 일을 연결합니다.", `
        <button class="button secondary" type="button" data-action="new-project">새 프로젝트</button>
      `)}
      <div class="grid cols-3">
        ${renderProjectColumn("진행 중", state.projects.filter((p) => ["active", "focus"].includes(p.status)))}
        ${renderProjectColumn("계획", state.projects.filter((p) => ["planned", "unplanned"].includes(p.status)))}
        ${renderProjectColumn("완료/중단", state.projects.filter((p) => ["completed", "paused", "canceled"].includes(p.status)))}
      </div>
    </section>
  `;
}

function renderGoals() {
  return `
    <section class="view">
      ${renderViewHeader("Goals", "목표", "연간/분기 목표를 프로젝트와 연결하고 진행률을 확인합니다.", `
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
      ${renderViewHeader("Boxes", "삶의 영역", "목표, 프로젝트, 할 일, 자료를 묶는 최상위 컨테이너입니다.", `
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
  const resources = state.resources.filter((resource) => matchesSearch(resource.title));
  return `
    <section class="view">
      ${renderViewHeader("Resources", "자료와 노트", "Block editor로 자료 본문을 작성하고 실행 맥락에 연결합니다.", `
        <input class="input" style="width:220px" data-action-input="search" value="${esc(ui.search)}" placeholder="검색">
        <button class="button secondary" type="button" data-action="new-resource">새 자료</button>
      `)}
      <div class="grid cols-3">
        ${renderResourceColumn("고정", resources.filter((r) => r.pinned))}
        ${renderResourceColumn("나중에 보기", resources.filter((r) => r.readLater))}
        ${renderResourceColumn("전체", resources)}
      </div>
    </section>
  `;
}

function renderJournal() {
  return `
    <section class="view">
      ${renderViewHeader("Journal", "회고", "일간/주간/월간 리뷰를 누적해 실행 품질을 관리합니다.", `
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

function renderCalendar() {
  return `
    <section class="view">
      ${renderViewHeader("Calendar", "내부 일정과 Google Calendar", "로컬 예정 작업을 주간 캘린더에서 보고 Google Calendar로 보낼 수 있습니다.", `
        <button class="button secondary" type="button" data-action="sync-google">Google로 내보내기</button>
      `)}
      <div class="grid cols-2">
        <div class="panel">
          ${panelHeader("이번 주", "내부 일정")}
          <div class="calendar-grid">${renderWeekDays()}</div>
        </div>
        <div class="panel">
          ${panelHeader("Google Calendar", state.settings.lastGoogleSyncAt ? `마지막 ${formatDateTime(state.settings.lastGoogleSyncAt)}` : "설정 필요")}
          <div class="stack">
            <label class="field">
              <span>OAuth Client ID</span>
              <input class="input" data-setting="googleClientId" value="${esc(state.settings.googleClientId)}" placeholder="Google Cloud OAuth Client ID">
            </label>
            <label class="field">
              <span>Calendar ID</span>
              <input class="input" data-setting="googleCalendarId" value="${esc(state.settings.googleCalendarId)}" placeholder="primary">
            </label>
            <div class="toolbar" style="justify-content:flex-start">
              <button class="button" type="button" data-action="connect-google">Google 연결</button>
              <button class="button secondary" type="button" data-action="sync-google">예정 작업 동기화</button>
            </div>
            <div class="card">
              <h3 class="card-title">동기화 방식</h3>
              <p class="resource-preview">로컬 데이터가 기준입니다. Google에는 예정 시간이 있는 미완료 작업만 이벤트로 생성합니다.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderMetric(label, value, sub) {
  return `
    <div class="metric">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}</div>
      <div class="metric-sub">${sub}</div>
    </div>
  `;
}

function panelHeader(title, subtitle = "") {
  return `
    <div class="panel-header">
      <div>
        <h2 class="panel-title">${title}</h2>
        ${subtitle ? `<div class="panel-subtitle">${subtitle}</div>` : ""}
      </div>
    </div>
  `;
}

function renderTaskColumn(title, tasks) {
  return `
    <div class="panel">
      ${panelHeader(title, `${tasks.length}개`)}
      <div class="stack">${tasks.length ? tasks.map(renderTaskCard).join("") : empty("항목이 없습니다.")}</div>
    </div>
  `;
}

function renderProjectColumn(title, projects) {
  return `
    <div class="panel">
      ${panelHeader(title, `${projects.length}개`)}
      <div class="stack">${projects.length ? projects.map(renderProjectCard).join("") : empty("프로젝트가 없습니다.")}</div>
    </div>
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

function renderTaskCard(task, draggable = false) {
  const done = task.status === "done";
  return `
    <article class="card ${done ? "done" : ""}" ${draggable ? "draggable='true'" : ""} data-task-id="${task.id}" data-select-type="tasks" data-select-id="${task.id}">
      <div class="task-row">
        <button class="check ${done ? "is-done" : ""}" type="button" data-toggle-task="${task.id}" aria-label="완료 전환">✓</button>
        <div>
          <h3 class="card-title">${esc(task.title)}</h3>
          <div class="card-meta">
            ${badge(taskKinds[task.kind] || task.kind, kindColor(task.kind))}
            ${task.scheduledStart ? badge(formatDateTime(task.scheduledStart), "blue") : ""}
            ${task.dueDate && !task.scheduledStart ? badge(`기한 ${task.dueDate}`, isOverdue(task) ? "rose" : "amber") : ""}
            ${task.projectId ? badge(nameOf("projects", task.projectId), "violet") : ""}
          </div>
        </div>
        <span class="badge">${task.estimatedMinutes || 0}m</span>
      </div>
    </article>
  `;
}

function renderProjectCard(project) {
  const tasks = state.tasks.filter((task) => task.projectId === project.id);
  const done = tasks.filter((task) => task.status === "done").length;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  return `
    <article class="card" data-select-type="projects" data-select-id="${project.id}">
      <h3 class="card-title">${esc(project.name)}</h3>
      <div class="card-meta">
        ${badge(statuses.project[project.status] || project.status, project.status === "focus" ? "blue" : "teal")}
        ${project.goalId ? badge(nameOf("goals", project.goalId), "violet") : ""}
        ${project.endDate ? badge(project.endDate, "amber") : ""}
      </div>
      <div class="progress" style="margin-top:12px"><span style="width:${progress}%"></span></div>
    </article>
  `;
}

function renderGoalCard(goal) {
  const projects = state.projects.filter((project) => project.goalId === goal.id);
  const completed = projects.filter((project) => project.status === "completed").length;
  const progress = projects.length ? Math.round((completed / projects.length) * 100) : 0;
  return `
    <article class="card" data-select-type="goals" data-select-id="${goal.id}">
      <h3 class="card-title">${esc(goal.name)}</h3>
      <div class="card-meta">
        ${badge(statuses.goal[goal.status] || goal.status, "blue")}
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
      <p class="resource-preview">${esc(blockText(resource).slice(0, 94)) || "비어 있는 자료"}</p>
      <div class="card-meta">
        ${resource.pinned ? badge("고정", "blue") : ""}
        ${resource.readLater ? badge("나중에 보기", "amber") : ""}
        ${badge(resource.type, "teal")}
      </div>
    </article>
  `;
}

function renderJournalCard(journal) {
  return `
    <article class="card" data-select-type="journals" data-select-id="${journal.id}">
      <h3 class="card-title">${esc(journal.title)}</h3>
      <p class="resource-preview">${esc(blockText(journal).slice(0, 110))}</p>
      <div class="card-meta">
        ${badge(journal.kind, "blue")}
        ${badge(journal.date || "", "teal")}
        ${badge(`${journal.satisfaction || 0}/10`, "amber")}
      </div>
    </article>
  `;
}

function renderCaptureCard(capture) {
  const processed = capture.status === "processed";
  return `
    <article class="card" data-select-type="captures" data-select-id="${capture.id}">
      <h3 class="card-title">${esc(capture.title)}</h3>
      ${capture.url ? `<p class="resource-preview">${esc(capture.url)}</p>` : ""}
      <div class="card-meta">
        ${badge(processed ? "처리됨" : "Inbox", processed ? "teal" : "blue")}
      </div>
      ${
        processed
          ? ""
          : `<div class="toolbar" style="justify-content:flex-start;margin-top:10px">
              <button class="button ghost" type="button" data-convert="tasks" data-capture-id="${capture.id}">Task</button>
              <button class="button ghost" type="button" data-convert="projects" data-capture-id="${capture.id}">Project</button>
              <button class="button ghost" type="button" data-convert="resources" data-capture-id="${capture.id}">Resource</button>
              <button class="button ghost" type="button" data-convert="goals" data-capture-id="${capture.id}">Goal</button>
            </div>`
      }
    </article>
  `;
}

function renderDropZone(title, date, subtitle) {
  const tasks = state.tasks.filter((task) => task.scheduledStart?.slice(0, 10) === date && task.status !== "done");
  return `
    <div class="drop-zone" data-drop-date="${date}">
      ${panelHeader(title, subtitle)}
      <div class="stack">${tasks.map((task) => renderTaskCard(task, true)).join("") || empty(`${date} 배치 없음`)}</div>
    </div>
  `;
}

function renderWeekDays() {
  const start = startOfWeek(new Date());
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
    .map((day) => {
      const key = dateKey(day);
      const tasks = state.tasks.filter((task) => task.scheduledStart?.slice(0, 10) === key && task.status !== "done");
      return `
        <div class="day ${key === dateKey(new Date()) ? "is-today" : ""}">
          <div class="day-title"><span>${weekday(day)}</span><span>${key.slice(5)}</span></div>
          <div class="stack">${tasks.map(renderTaskCard).join("") || `<div class="resource-preview">비어 있음</div>`}</div>
        </div>
      `;
    })
    .join("");
}

function renderDetail() {
  const { type, id: selectedId } = ui.selected;
  const item = getCollection(type).find((entry) => entry.id === selectedId);
  if (!item) return "";
  const titleField = ["tasks", "resources", "journals", "captures"].includes(type) ? "title" : "name";
  return `
    <aside class="detail" aria-label="상세 편집">
      <div class="detail-head">
        <input class="detail-title" data-detail-title="${titleField}" value="${esc(item[titleField] || "")}">
        <button class="button ghost" type="button" data-action="close-detail">닫기</button>
      </div>
      <div class="detail-body">
        ${renderDetailFields(type, item)}
        ${item.blocks ? renderBlockEditor(type, item.id, item.blocks) : ""}
      </div>
    </aside>
  `;
}

function renderDetailFields(type, item) {
  if (type === "tasks") {
    return `
      <div class="field-grid">
        ${selectField("상태", "status", item.status, statuses.task)}
        ${selectField("구분", "kind", item.kind, taskKinds)}
        ${dateTimeField("시작", "scheduledStart", item.scheduledStart)}
        ${dateTimeField("종료", "scheduledEnd", item.scheduledEnd)}
        ${dateField("기한", "dueDate", item.dueDate)}
        ${numberField("예상 분", "estimatedMinutes", item.estimatedMinutes || 0)}
        ${relationField("박스", "boxId", item.boxId, state.boxes, "name")}
        ${relationField("프로젝트", "projectId", item.projectId, state.projects, "name")}
        ${relationField("자료", "resourceId", item.resourceId, state.resources, "title")}
      </div>
    `;
  }
  if (type === "projects") {
    return `
      <div class="field-grid">
        ${selectField("상태", "status", item.status, statuses.project)}
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
        ${selectField("상태", "status", item.status, statuses.goal)}
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
        ${textField("색상", "color", item.color || "")}
      </div>
    `;
  }
  if (type === "resources") {
    return `
      <div class="field-grid">
        ${selectField("분류", "type", item.type, { quick_note: "간단한 메모", note: "노트", scrap: "스크랩", thought: "생각", reflection: "묵상" })}
        ${selectField("중요도", "importance", item.importance, { normal: "일반", important: "중요", archived: "아카이브" })}
        ${relationField("박스", "boxId", item.boxId, state.boxes, "name")}
        ${relationField("프로젝트", "projectId", item.projectId, state.projects, "name")}
        ${textField("URL", "url", item.url || "")}
        ${checkboxField("고정", "pinned", item.pinned)}
        ${checkboxField("나중에 보기", "readLater", item.readLater)}
      </div>
    `;
  }
  if (type === "journals") {
    return `
      <div class="field-grid">
        ${selectField("구분", "kind", item.kind, { daily: "데일리", weekly: "위클리", monthly: "먼슬리" })}
        ${dateField("날짜", "date", item.date)}
        ${numberField("만족도", "satisfaction", item.satisfaction || 0)}
      </div>
    `;
  }
  return "";
}

function renderBlockEditor(type, ownerId, blocksList) {
  return `
    <div class="panel" style="box-shadow:none;background:rgba(255,255,255,.48)">
      ${panelHeader("본문", "Block editor")}
      <div class="block-editor" data-owner-type="${type}" data-owner-id="${ownerId}">
        ${blocksList.map((block) => renderBlock(block)).join("")}
      </div>
    </div>
  `;
}

function renderBlock(block) {
  return `
    <div class="block" data-block-id="${block.id}" data-type="${block.type}" data-checked="${block.checked ? "true" : "false"}">
      <button class="block-tool" type="button" data-block-add="${block.id}" aria-label="블록 추가">+</button>
      <div class="block-content" contenteditable="true" spellcheck="true" data-block-content="${block.id}" data-placeholder="/ 입력">${esc(block.text || "")}</div>
    </div>
  `;
}

function renderSlashMenu() {
  const { x, y, ownerType, ownerId, blockId } = ui.slash;
  return `
    <div class="slash-menu" style="left:${x}px;top:${y}px">
      ${Object.entries(blockTypes)
        .map(([type, [label, icon]]) => `
          <button class="menu-item" type="button" data-block-type="${type}" data-owner-type="${ownerType}" data-owner-id="${ownerId}" data-block-id="${blockId}">
            <span class="menu-icon">${icon}</span>
            <span class="menu-text"><strong>${label}</strong><span>${type}</span></span>
          </button>
        `)
        .join("")}
    </div>
  `;
}

function renderCommandMenu() {
  return `
    <div class="command-menu" style="right:24px;bottom:92px">
      ${[
        ["new-task", "✓", "새 할 일", "실행 항목 추가"],
        ["new-project", "▦", "새 프로젝트", "작업 묶음 추가"],
        ["new-goal", "◎", "새 목표", "결과 목표 추가"],
        ["new-resource", "≡", "새 자료", "block editor 노트"],
        ["new-journal", "✎", "새 리뷰", "회고 작성"],
        ["new-box", "□", "새 박스", "삶의 영역 추가"],
      ]
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
  return `<label class="field"><span>${label}</span><input class="input" data-field="${field}" value="${esc(value)}"></label>`;
}

function numberField(label, field, value) {
  return `<label class="field"><span>${label}</span><input class="input" type="number" data-field="${field}" value="${Number(value) || 0}"></label>`;
}

function dateField(label, field, value) {
  return `<label class="field"><span>${label}</span><input class="input" type="date" data-field="${field}" value="${esc(value || "")}"></label>`;
}

function dateTimeField(label, field, value) {
  return `<label class="field"><span>${label}</span><input class="input" type="datetime-local" data-field="${field}" value="${esc(value || "")}"></label>`;
}

function checkboxField(label, field, value) {
  return `
    <label class="field">
      <span>${label}</span>
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
      <span>${label}</span>
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
      <span>${label}</span>
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
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    ui.view = viewButton.dataset.view;
    ui.selected = null;
    ui.search = "";
    render();
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action) {
    handleAction(action);
    return;
  }

  const toggleTask = event.target.closest("[data-toggle-task]");
  if (toggleTask) {
    event.stopPropagation();
    toggleTaskDone(toggleTask.dataset.toggleTask);
    return;
  }

  const convert = event.target.closest("[data-convert]");
  if (convert) {
    event.stopPropagation();
    convertCapture(convert.dataset.captureId, convert.dataset.convert);
    return;
  }

  const select = event.target.closest("[data-select-type]");
  if (select && !event.target.closest("button")) {
    ui.selected = { type: select.dataset.selectType, id: select.dataset.selectId };
    render();
    return;
  }

  const addBlock = event.target.closest("[data-block-add]");
  if (addBlock) {
    const editor = addBlock.closest(".block-editor");
    insertBlock(editor.dataset.ownerType, editor.dataset.ownerId, addBlock.dataset.blockAdd);
    return;
  }

  const blockType = event.target.closest("[data-block-type]");
  if (blockType) {
    changeBlockType(blockType.dataset.ownerType, blockType.dataset.ownerId, blockType.dataset.blockId, blockType.dataset.blockType);
  }
}

function handleAction(action) {
  ui.commandOpen = false;
  if (action === "open-command") {
    ui.commandOpen = true;
    render();
    return;
  }
  if (action === "close-detail") {
    ui.selected = null;
    render();
    return;
  }
  if (action === "new-task") return createTask();
  if (action === "new-project") return createProject();
  if (action === "new-goal") return createGoal();
  if (action === "new-box") return createBox();
  if (action === "new-resource") return createResource();
  if (action === "new-journal") return createJournal();
  if (action === "new-capture") return createCapture();
  if (action === "connect-google") return connectGoogle();
  if (action === "sync-google") return syncGoogleCalendar();
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
      createdAt: new Date().toISOString(),
    });
    input.value = "";
    saveState();
    showToast("Inbox에 수집했습니다.");
    if (ui.view === "inbox" || ui.view === "today") render();
  }
}

function handleInput(event) {
  const search = event.target.closest("[data-action-input='search']");
  if (search) {
    ui.search = search.value;
    render();
    return;
  }

  const titleInput = event.target.closest("[data-detail-title]");
  if (titleInput && ui.selected) {
    const item = selectedItem();
    item[titleInput.dataset.detailTitle] = titleInput.value;
    saveState();
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
  if (field && ui.selected) {
    const item = selectedItem();
    let value = field.value;
    if (value === "true") value = true;
    if (value === "false") value = false;
    if (field.type === "number") value = Number(value);
    item[field.dataset.field] = value;
    saveState();
    render();
  }
}

function handleKeydown(event) {
  const blockContent = event.target.closest("[data-block-content]");
  if (!blockContent) return;
  const editor = blockContent.closest(".block-editor");
  const ownerType = editor.dataset.ownerType;
  const ownerId = editor.dataset.ownerId;
  const blockId = blockContent.dataset.blockContent;

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    insertBlock(ownerType, ownerId, blockId);
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

function handleDocumentKeydown(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    ui.commandOpen = !ui.commandOpen;
    render();
  }
  if (event.key === "Escape" && (ui.commandOpen || ui.selected || ui.slash)) {
    ui.commandOpen = false;
    ui.slash = null;
    ui.selected = null;
    render();
  }
}

function handleDragStart(event) {
  const card = event.target.closest("[data-task-id]");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.taskId);
  event.dataTransfer.effectAllowed = "move";
}

function handleDragOver(event) {
  const zone = event.target.closest("[data-drop-date]");
  if (!zone) return;
  event.preventDefault();
  zone.classList.add("is-over");
}

function handleDragLeave(event) {
  const zone = event.target.closest("[data-drop-date]");
  if (zone) zone.classList.remove("is-over");
}

function handleDrop(event) {
  const zone = event.target.closest("[data-drop-date]");
  if (!zone) return;
  event.preventDefault();
  zone.classList.remove("is-over");
  const task = state.tasks.find((entry) => entry.id === event.dataTransfer.getData("text/plain"));
  if (!task) return;
  task.scheduledStart = `${zone.dataset.dropDate}T09:00`;
  task.scheduledEnd = `${zone.dataset.dropDate}T10:00`;
  task.dueDate = zone.dataset.dropDate;
  task.status = "scheduled";
  saveState();
  showToast("일정에 배치했습니다.");
  render();
}

function createTask(title = "새 할 일") {
  const task = {
    id: id(),
    title,
    status: "todo",
    kind: "normal",
    boxId: "",
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
  };
  state.tasks.push(task);
  ui.view = "tasks";
  ui.selected = { type: "tasks", id: task.id };
  saveState();
  render();
}

function createProject(name = "새 프로젝트") {
  const project = {
    id: id(),
    name,
    status: "unplanned",
    boxId: state.boxes[0]?.id || "",
    goalId: "",
    startDate: "",
    endDate: "",
    blocks: blocks("프로젝트의 완료 기준을 적어두세요."),
  };
  state.projects.push(project);
  ui.view = "projects";
  ui.selected = { type: "projects", id: project.id };
  saveState();
  render();
}

function createGoal(name = "새 목표") {
  const goal = {
    id: id(),
    name,
    status: "not_started",
    boxId: state.boxes[0]?.id || "",
    year: String(new Date().getFullYear()),
    quarter: `${Math.floor(new Date().getMonth() / 3) + 1}Q`,
    targetDate: "",
    blocks: blocks("SMART 기준으로 목표를 정리하세요."),
  };
  state.goals.push(goal);
  ui.view = "goals";
  ui.selected = { type: "goals", id: goal.id };
  saveState();
  render();
}

function createBox(name = "새 박스") {
  const box = {
    id: id(),
    name,
    visibility: "normal",
    color: "blue",
    blocks: blocks("이 영역이 관리하는 목표와 자료를 적어두세요."),
  };
  state.boxes.push(box);
  ui.view = "boxes";
  ui.selected = { type: "boxes", id: box.id };
  saveState();
  render();
}

function createResource(title = "새 자료") {
  const resource = {
    id: id(),
    title,
    type: "note",
    importance: "normal",
    pinned: false,
    readLater: false,
    url: "",
    boxId: "",
    goalId: "",
    projectId: "",
    blocks: [
      { id: id(), type: "heading1", text: title, checked: false },
      { id: id(), type: "paragraph", text: "", checked: false },
    ],
  };
  state.resources.push(resource);
  ui.view = "resources";
  ui.selected = { type: "resources", id: resource.id };
  saveState();
  render();
}

function createJournal(title = `${dateKey(new Date())} 리뷰`) {
  const journal = {
    id: id(),
    title,
    kind: "daily",
    date: dateKey(new Date()),
    satisfaction: 7,
    blocks: [
      { id: id(), type: "heading2", text: "오늘의 기록", checked: false },
      { id: id(), type: "paragraph", text: "", checked: false },
      { id: id(), type: "heading2", text: "배운 점", checked: false },
      { id: id(), type: "paragraph", text: "", checked: false },
    ],
  };
  state.journals.push(journal);
  ui.view = "journal";
  ui.selected = { type: "journals", id: journal.id };
  saveState();
  render();
}

function createCapture(title = "새 수집") {
  state.captures.push({
    id: id(),
    title,
    url: "",
    status: "inbox",
    createdAt: new Date().toISOString(),
  });
  ui.view = "inbox";
  saveState();
  render();
}

function convertCapture(captureId, targetType) {
  const capture = state.captures.find((entry) => entry.id === captureId);
  if (!capture) return;
  if (targetType === "tasks") createTask(capture.title);
  if (targetType === "projects") createProject(capture.title);
  if (targetType === "resources") createResource(capture.title);
  if (targetType === "goals") createGoal(capture.title);
  capture.status = "processed";
  capture.convertedTo = targetType;
  capture.processedAt = new Date().toISOString();
  saveState();
  showToast("분류했습니다.");
  render();
}

function toggleTaskDone(taskId) {
  const task = state.tasks.find((entry) => entry.id === taskId);
  if (!task) return;
  if (task.status === "done") {
    task.status = task.scheduledStart ? "scheduled" : "todo";
    task.completedAt = "";
  } else {
    task.status = "done";
    task.completedAt = new Date().toISOString();
  }
  saveState();
  render();
}

function selectedItem() {
  return getCollection(ui.selected.type).find((entry) => entry.id === ui.selected.id);
}

function getCollection(type) {
  if (type === "tasks") return state.tasks;
  if (type === "projects") return state.projects;
  if (type === "goals") return state.goals;
  if (type === "boxes") return state.boxes;
  if (type === "resources") return state.resources;
  if (type === "journals") return state.journals;
  if (type === "captures") return state.captures;
  return [];
}

function updateBlockText(blockContent) {
  const editor = blockContent.closest(".block-editor");
  const item = getCollection(editor.dataset.ownerType).find((entry) => entry.id === editor.dataset.ownerId);
  const block = item?.blocks.find((entry) => entry.id === blockContent.dataset.blockContent);
  if (!block) return;
  block.text = blockContent.textContent.replace(/^\/$/, "");
  saveState();
  if (blockContent.textContent === "/") {
    openSlashMenu(blockContent, editor.dataset.ownerType, editor.dataset.ownerId, block.id);
  }
}

function insertBlock(ownerType, ownerId, afterBlockId) {
  const item = getCollection(ownerType).find((entry) => entry.id === ownerId);
  if (!item) return;
  const index = item.blocks.findIndex((block) => block.id === afterBlockId);
  const newBlock = { id: id(), type: "paragraph", text: "", checked: false };
  item.blocks.splice(index + 1, 0, newBlock);
  saveState();
  render();
  requestAnimationFrame(() => {
    const next = document.querySelector(`[data-block-content="${newBlock.id}"]`);
    next?.focus();
  });
}

function removeBlock(ownerType, ownerId, blockId) {
  const item = getCollection(ownerType).find((entry) => entry.id === ownerId);
  if (!item || item.blocks.length <= 1) return;
  const index = item.blocks.findIndex((block) => block.id === blockId);
  item.blocks.splice(index, 1);
  saveState();
  render();
  requestAnimationFrame(() => {
    const fallback = item.blocks[Math.max(0, index - 1)];
    document.querySelector(`[data-block-content="${fallback.id}"]`)?.focus();
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
  render();
  requestAnimationFrame(() => document.querySelector(`[data-block-content="${blockId}"]`)?.focus());
}

function openSlashMenu(blockContent, ownerType, ownerId, blockId) {
  const rect = blockContent.getBoundingClientRect();
  ui.slash = {
    ownerType,
    ownerId,
    blockId,
    x: Math.min(rect.left, window.innerWidth - 440),
    y: Math.min(rect.bottom + 6, window.innerHeight - 340),
  };
  render();
}

async function connectGoogle() {
  if (!state.settings.googleClientId.trim()) {
    showToast("OAuth Client ID가 필요합니다.");
    return;
  }
  try {
    await loadScript("https://accounts.google.com/gsi/client");
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
        render();
      },
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  } catch (error) {
    showToast("Google 스크립트를 불러오지 못했습니다.");
  }
}

async function syncGoogleCalendar() {
  if (!googleAccessToken) {
    showToast("먼저 Google을 연결하세요.");
    return;
  }
  const calendarId = encodeURIComponent(state.settings.googleCalendarId || "primary");
  const tasks = state.tasks.filter((task) => task.scheduledStart && task.status !== "done" && !task.googleEventId);
  if (!tasks.length) {
    showToast("동기화할 예정 작업이 없습니다.");
    return;
  }

  let synced = 0;
  for (const task of tasks) {
    const start = new Date(task.scheduledStart);
    const end = task.scheduledEnd ? new Date(task.scheduledEnd) : new Date(start.getTime() + (task.estimatedMinutes || 30) * 60000);
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, {
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
      synced += 1;
    }
  }
  state.settings.lastGoogleSyncAt = new Date().toISOString();
  saveState();
  showToast(`${synced}개 작업을 Google Calendar로 보냈습니다.`);
  render();
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

function renderCommandSource() {
  return "";
}

function getCollectionName(type) {
  return type;
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
  return `<div class="empty">${text}</div>`;
}

function badge(text, color = "") {
  if (!text) return "";
  return `<span class="badge ${color}">${esc(text)}</span>`;
}

function kindColor(kind) {
  if (kind === "focus") return "blue";
  if (kind === "routine") return "teal";
  if (kind === "event") return "amber";
  if (kind === "delegated") return "violet";
  if (kind === "someday") return "rose";
  return "";
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
  return Boolean(compare && compare < today && task.status !== "done");
}

function matchesSearch(text) {
  return !ui.search || text.toLowerCase().includes(ui.search.toLowerCase());
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function weekday(date) {
  return new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(date);
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
