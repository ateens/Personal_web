const FIXED_TIME = "2026-07-11T00:00:00.000Z";

export const FIXTURE_IDS = Object.freeze({
  appState: "e2e-memory-fixture",
  box: "fixture-box",
  goal: "fixture-goal",
  project: "fixture-project",
  resource: "fixture-resource-main",
  readOnlyResource: "fixture-resource-read-only",
  bodySearchResource: "fixture-resource-body-search",
  titleSearchResource: "fixture-resource-title-search",
  archivedResource: "fixture-resource-archived",
  inlineBlock: "fixture-block-inline",
  pageThread: "fixture-thread-page",
  inlineThread: "fixture-thread-inline",
});

const INLINE_MARK_TEXT = "Bold Italic Underline Strike Code Link Comment Mention Equation";

const viewControls = () => ({
  today: control("date", "overview"),
  inbox: control("recent", "board"),
  tasks: control("date", "board"),
  projects: control("status", "board"),
  goals: control("target", "cards"),
  boxes: control("activity", "columns"),
  resources: {
    search: "",
    searchScope: "fullText",
    filters: ["active"],
    sort: "updated",
    mode: "library",
    panels: { filter: false, sort: false },
  },
  habits: control("progress", "list"),
  journal: control("date", "cards"),
  calendar: control("time", "calendar"),
  database: control("rows", "grid"),
});

function control(sort, mode) {
  return { filters: ["all"], sort, mode, panels: { filter: false, sort: false } };
}

function block(id, type, text = "", overrides = {}) {
  return {
    id,
    type,
    text,
    marks: [],
    checked: false,
    indent: 0,
    collapsed: false,
    ...overrides,
  };
}

function inlineFixtureBlock() {
  const text = INLINE_MARK_TEXT;
  const mark = (label, type, payload = {}) => {
    const start = text.indexOf(label);
    return { type, start, end: start + label.length, ...payload };
  };
  return block(FIXTURE_IDS.inlineBlock, "paragraph", text, {
    marks: [
      mark("Bold", "bold"),
      mark("Italic", "italic"),
      mark("Underline", "underline"),
      mark("Strike", "strike"),
      mark("Code", "code"),
      mark("Link", "link", { href: "https://example.com/e2e" }),
      mark("Comment", "comment", {
        commentId: FIXTURE_IDS.inlineThread,
        body: "Existing inline thread",
      }),
      mark("Mention", "mention", {
        mentionType: "page",
        label: "Body Search Fixture",
        targetType: "resources",
        targetId: FIXTURE_IDS.bodySearchResource,
      }),
      mark("Equation", "equation", { formula: "E=mc^2" }),
    ],
  });
}

function commentThread(id, scope, body, anchor = null) {
  return {
    id,
    scope,
    anchor,
    body,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    resolvedAt: "",
    deletedAt: "",
    replies: [],
  };
}

function mainResourceCommentThreads() {
  const inlineStart = INLINE_MARK_TEXT.indexOf("Comment");
  return [
    commentThread(FIXTURE_IDS.pageThread, "page", "Existing page discussion"),
    commentThread(
      FIXTURE_IDS.inlineThread,
      "inline",
      "Existing inline thread",
      {
        blockId: FIXTURE_IDS.inlineBlock,
        start: inlineStart,
        end: inlineStart + "Comment".length,
      },
    ),
  ];
}

function mainResourceBlocks() {
  return [
    block("fixture-block-paragraph", "paragraph", "Paragraph fixture fulltext-needle"),
    block("fixture-block-heading-1", "heading1", "Heading one"),
    block("fixture-block-heading-2", "heading2", "Heading two"),
    block("fixture-block-heading-3", "heading3", "Heading three"),
    block("fixture-block-bullet", "bullet", "Bullet item"),
    block("fixture-block-numbered", "numbered", "Numbered item"),
    block("fixture-block-todo", "todo", "Completed todo", { checked: true }),
    block("fixture-block-toggle", "toggle", "Toggle parent"),
    block("fixture-block-toggle-child", "paragraph", "Toggle child", { indent: 1 }),
    block("fixture-block-quote", "quote", "Quote fixture"),
    block("fixture-block-callout", "callout", "Callout fixture"),
    block("fixture-block-divider", "divider"),
    block("fixture-block-code", "code", "const fixture = true;"),
    inlineFixtureBlock(),
  ];
}

function resource(id, title, overrides = {}) {
  return {
    id,
    title,
    type: "note",
    importance: "normal",
    pinned: false,
    readLater: false,
    url: "",
    boxId: FIXTURE_IDS.box,
    goalId: FIXTURE_IDS.goal,
    projectId: FIXTURE_IDS.project,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    revision: 7,
    timestampSource: "fixture",
    parentId: "",
    childOrder: [],
    pageSettings: {
      font: "default",
      smallText: false,
      fullWidth: false,
    },
    icon: "",
    cover: { url: "", position: 50 },
    readOnly: false,
    locked: false,
    trashedAt: "",
    commentThreads: [],
    blocks: [block(`${id}-paragraph`, "paragraph", `${title} body`)],
    ...overrides,
  };
}

export function createFixtureState() {
  return {
    version: 4,
    revision: 1,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    settings: {
      navOrder: ["today", "inbox", "tasks", "projects", "goals", "boxes", "resources", "habits", "journal", "calendar", "database"],
      googleCalendarId: "primary",
      googleConnectedAt: "",
      lastGoogleFetchAt: "",
      lastGoogleSyncAt: "",
      calendarSources: { tasks: true, projects: true, google: true },
      visibleGoogleCalendars: {},
      viewControls: viewControls(),
      statsDemoDataSeeded: true,
      notionParityMode: true,
      advancedWindowMode: false,
      openPagesIn: { library: "center", list: "side", map: "center" },
    },
    captures: [],
    boxes: [
      { id: FIXTURE_IDS.box, name: "Fixture Box", visibility: "pinned", color: "blue", blocks: [block("fixture-box-block", "paragraph", "Fixture box")] },
    ],
    goals: [
      { id: FIXTURE_IDS.goal, boxId: FIXTURE_IDS.box, name: "Fixture Goal", status: "active", targetDate: "", year: "2026", quarter: "3Q", blocks: [block("fixture-goal-block", "paragraph", "Fixture goal")] },
    ],
    projects: [
      { id: FIXTURE_IDS.project, boxId: FIXTURE_IDS.box, goalId: FIXTURE_IDS.goal, name: "Fixture Project", status: "active", startDate: "", endDate: "", blocks: [block("fixture-project-block", "paragraph", "Fixture project")] },
    ],
    tasks: [],
    resources: [
      resource(FIXTURE_IDS.resource, "E2E Notion Parity Resource", {
        importance: "important",
        pinned: true,
        url: "https://example.com/resource",
        commentThreads: mainResourceCommentThreads(),
        blocks: mainResourceBlocks(),
      }),
      resource(FIXTURE_IDS.bodySearchResource, "Body Search Fixture", {
        blocks: [block("fixture-body-search-block", "paragraph", "body-only-secret-token")],
      }),
      resource(FIXTURE_IDS.titleSearchResource, "Database Needle Resource", {
        type: "scrap",
        readLater: true,
        blocks: [block("fixture-title-search-block", "paragraph", "ordinary body")],
      }),
      resource(FIXTURE_IDS.archivedResource, "Archived Fixture Resource", {
        importance: "archived",
        blocks: [block("fixture-archived-block", "paragraph", "archived body")],
      }),
      resource(FIXTURE_IDS.readOnlyResource, "Read-only Fixture Resource", {
        readOnly: true,
        url: "https://example.com/read-only-resource",
        icon: "🔒",
        commentThreads: [
          commentThread("fixture-thread-read-only-page", "page", "Read-only page discussion"),
        ],
        blocks: [
          block("fixture-read-only-paragraph", "paragraph", "Read-only body text"),
          block("fixture-read-only-todo", "todo", "Read-only completed todo", { checked: true }),
        ],
      }),
    ],
    habits: [],
    habitInstances: [],
    journals: [],
    googleCalendars: [],
    googleEvents: [],
    links: [],
  };
}
