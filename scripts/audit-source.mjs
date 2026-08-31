import { readFileSync } from "node:fs";
import { createStorage, normalizeAppStateForStorage } from "../server/storage.js";

const files = {
  app: read("app.js"),
  server: read("server.js"),
  storage: read("server/storage.js"),
  styles: read("styles.css"),
  index: read("index.html"),
  serviceWorker: read("service-worker.js"),
};

const checks = [
  ["browser storage never persists finance or workspace state", () => {
    const deviceSizeWrite = "localStorage.setItem(RESOURCE_WINDOW_SIZE_KEY, JSON.stringify({ width: saved.width, height: saved.height, dockWidth: saved.dockWidth }))";
    return files.app.includes('const RESOURCE_WINDOW_SIZE_KEY = "sygma-resource-window-size-v1";')
      && files.app.split(deviceSizeWrite).length === 2
      && !files.app.replace(deviceSizeWrite, "").includes("localStorage.setItem")
      && !files.app.includes("sessionStorage.");
  }],
  ["storage refuses to run without PostgreSQL", () => {
    try {
      createStorage({ databaseUrl: "" });
      return false;
    } catch (error) {
      return String(error?.message || "").includes("DATABASE_URL is required");
    }
  }],
  ["retired inline annotations preserve text, comments, and Resource links", () => {
    const text = "Legacy label and retained formatting";
    const marks = [
      { type: "bold", start: 0, end: 12 },
      { type: "comment", start: 0, end: 12, commentId: "thread", body: "Keep this comment" },
      { type: "resourceLink", start: 13, end: 16, resourceId: "target" },
      { type: "equation", start: 17, end: 25, formula: "x+y", displayMode: true },
    ];
    const block = { id: "block", type: "paragraph", text, marks: [...marks, { type: "mention", start: 0, end: 12, targetId: "legacy" }, { type: "unknown", start: 0, end: 12 }] };
    const resource = { id: "resource", blocks: [block], commentThreads: [{ id: "thread", body: "Keep this comment" }] };
    const { state } = normalizeAppStateForStorage({ resources: [resource], boxes: [{ id: "box", blocks: [block] }] });
    return state.resources[0].blocks[0].text === text
      && state.boxes[0].blocks[0].text === text
      && JSON.stringify(state.resources[0].blocks[0].marks) === JSON.stringify(marks)
      && JSON.stringify(state.boxes[0].blocks[0].marks) === JSON.stringify(marks)
      && state.resources[0].commentThreads === resource.commentThreads
      && block.marks.length === marks.length + 2
      && normalizeAppStateForStorage(state).changed === false;
  }],
  ["Google OAuth state is claimed and consumed once", () => (
    files.storage.includes("CREATE TABLE IF NOT EXISTS app_oauth_transactions")
    && files.storage.includes("ON CONFLICT (app_state_id, kind, nonce) DO NOTHING")
    && files.storage.includes("WITH consumed AS")
    && files.server.includes("storage.claimOAuthTransaction(")
    && files.server.includes("storage.consumeOAuthTransaction(")
  )],
  ["Google endpoints are rate limited and the shell is noindex", () => (
    files.server.includes('operation === "google.status" || operation === "google.calendar.read"')
    && files.server.includes('operation === "google.connect.start"')
    && files.index.includes('<meta name="robots" content="noindex,nofollow">')
  )],
  ["service worker skips API caching", () => files.serviceWorker.includes('url.pathname.startsWith("/api/")')],
  ["service worker cache-first is limited to content-hashed assets", () => (
    files.serviceWorker.includes('/^\\/assets\\/[^/]+\\.[a-f0-9]{10,}\\./')
    && !files.serviceWorker.includes("/_sygma/assets/")
    && !files.server.includes("/_sygma/assets/")
    && !files.serviceWorker.includes('url.pathname.startsWith("/assets/")')
    && !files.serviceWorker.includes('url.searchParams.has("v")')
    && !files.serviceWorker.includes('url.pathname.startsWith("/icons/")')
  )],
  ["safe service-worker updates do not replace unsaved work", () => (
    files.app.includes('if (action === "apply-app-update") return applyWaitingServiceWorkerUpdate();')
    && files.app.includes("return resourceEditorHasDraftingFocus() || hasPendingLocalWorkspaceWork();")
    && !files.app.includes("if (!hasUnsavedResourceWork())")
    && files.app.includes("activeServiceWorkerRegistration?.update().catch(() => {});")
  )],
  ["index and service worker cache the same app assets", () => cachedAssetUrlsMatchIndex()],
  ["calendar keeps its public modes, Sunday boundary, and full event lanes", () => (
    files.app.includes('calendar: [["twoWeeks", "2주"], ["week", "주간"], ["calendar", "월간"], ["agenda", "목록"]]')
    && files.app.includes("start.setDate(start.getDate() - start.getDay());")
    && files.app.includes('<details class="view-controls-shell">')
    && files.app.includes('class="calendar-month-boundary"')
    && files.app.includes("limit: Number.MAX_SAFE_INTEGER")
    && files.app.includes("return formatTime(event.start);")
  )],
  ["Today drag exposes an accessible delete target", () => (
    files.app.includes('role="dialog" aria-label="할 일 이동"')
    && files.app.includes('data-today-task-action="delete" aria-label="할 일 삭제"')
  )],
  ["native select, date, and month fields are hidden backing controls", () => nativePickerControlsAreHidden()],
  ["no apparently unused named function or arrow declarations", () => noApparentlyUnusedFunctions()],
  ["no unreferenced CSS class selectors", () => noUnreferencedCssClassSelectors()],
];

const failures = checks.filter(([, check]) => !check()).map(([label]) => label);
if (failures.length) {
  console.error(`Source audit failed:\n${failures.map((label) => `- ${label}`).join("\n")}`);
  process.exit(1);
}

console.log("Source audit passed.");

function read(path) {
  return readFileSync(path, "utf8");
}

function cachedAssetUrlsMatchIndex() {
  return ["/styles.css", "/finance-model.js", "/app.js"].every((asset) => (
    files.index.includes(`"${asset}"`) && files.serviceWorker.includes(`"${asset}"`)
  ));
}

function nativePickerControlsAreHidden() {
  const selects = files.app.match(/<select\b[^>]*>/g) || [];
  const dates = files.app.match(/<input\b[^>]*\btype="(?:date|month)"[^>]*>/g) || [];
  const controls = [...selects, ...dates];
  if (!controls.length) return false;
  if (!selects.every((markup) => markup.includes('class="finance-select-native"'))) return false;
  if (!dates.every((markup) => markup.includes('class="finance-date-native"'))) return false;
  if (!controls.every((markup) => markup.includes('tabindex="-1"') && markup.includes('aria-hidden="true"'))) return false;
  if (!files.app.includes('aria-haspopup="listbox"') || !files.app.includes('aria-haspopup="dialog"')) return false;
  return /\.finance-select-native,\s*\.finance-date-native\s*\{[^}]*position:\s*absolute;[^}]*width:\s*1px;[^}]*height:\s*1px;[^}]*clip:/s.test(files.styles);
}

function noApparentlyUnusedFunctions() {
  const source = [files.app, files.server, files.storage].join("\n");
  const code = stripQuotedStringsAndComments(source);
  const names = new Set([
    ...code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g),
    ...code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g),
  ].map((match) => match[1]));
  const unused = [];
  for (const name of names) {
    const count = (source.match(new RegExp(`\\b${name}\\b`, "g")) || []).length;
    if (count <= 1) unused.push(name);
  }
  if (!unused.length) return true;
  console.error(`Apparently unused functions: ${unused.join(", ")}`);
  return false;
}

function stripQuotedStringsAndComments(source) {
  let output = "";
  let quote = "";
  let inLineComment = false;
  let inBlockComment = false;
  let inTemplate = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      output += char === "\n" ? "\n" : " ";
      if (char === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        output += "  ";
        index += 1;
        inBlockComment = false;
      } else {
        output += char === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (quote) {
      output += char === "\n" ? "\n" : " ";
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (inTemplate) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "`") {
        inTemplate = false;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      output += "  ";
      index += 1;
      inLineComment = true;
      continue;
    }

    if (char === "/" && next === "*") {
      output += "  ";
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (char === "\"" || char === "'") {
      output += " ";
      quote = char;
      escaped = false;
      continue;
    }

    if (char === "`") {
      output += char;
      inTemplate = true;
      escaped = false;
      continue;
    }

    output += char;
  }
  return output;
}

function noUnreferencedCssClassSelectors() {
  const source = `${files.app}\n${files.index}`;
  const classNames = new Set([...files.styles.matchAll(/\.([A-Za-z_-][\w-]*)/g)].map((match) => match[1]));
  for (const className of classNames) {
    if (!source.includes(className)) return false;
  }
  return true;
}
