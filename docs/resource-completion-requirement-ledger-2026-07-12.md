# Resource completion requirement ledger

Date: 2026-07-12 (Asia/Seoul)

Source of truth: `/Users/isanghyeon/.codex/attachments/3607e616-9dec-403e-b792-338253c91f7e/pasted-text-1.txt` (850 lines, reread in full for this ledger)

Audit scope: current local worktree only. This file does not assert that the local worktree is deployed, that the latest complete E2E suite has passed, or that the product is visually identical to Notion.

## Status rules and overall result

- `Implemented`: the requested local behavior has concrete source and focused automated/static evidence. It still may need a post-fix full-suite rerun or deployment verification.
- `Partial`: a working subset exists, but at least one explicitly requested behavior remains.
- `Missing`: no current implementation or acceptance artifact was found for an explicitly requested behavior.
- `Unverified`: implementation or an isolated artifact may exist, but the required live reference, real device, assistive technology, production, or matched-state evidence does not.

Overall status: **Partial**. The current product has substantial P0 shell, persistence, editor-regression, accessibility, comment-lifecycle, standalone HTTPS URL-paste, inline-format-toolbar, cross-page block movement, exact block deep links, visual-evidence, and recovery work, but Phase A, Phase B, Phase C, and the project as a whole remain incomplete. The largest open gates are the broad slash/block catalog, columns, image/file/large-paste workflows, complete inline-link actions, page version history, remote bookmark metadata/real iframe policy, reply-level comment deletion, per-user/tenant authorization, entity-level incremental persistence, real mobile and screen-reader QA, and the matched authenticated Notion visual-state matrix.

Evidence note: test names below identify executable coverage in the current tree. The focused visual-evidence artifact records its own four-test capture run; the standalone URL chooser spec passed 7/7 and its transport-focused batch passed 16/16; the inline-toolbar spec passed 5/5 and its related focused batch passed 50/50. Cross-page block Move passed 6/6. Comment history/anchor integrity passed 4/4 and its related combined batch passed 56/56. The deep-link/read-cursor focused set passed 17 cases (deep link 3, read cursor 4, block menu 3, lock 5, read-only 2), followed by 13/13 offline/hierarchy persistence regressions. Current Playwright discovery lists 179 tests in 30 spec files; discovery is not a pass result. These are scoped results, not a complete-suite total. Because the worktree changed after the previously recorded 115-test run, that historical number is not treated as a current full-suite result. The latest Cloud postfix campaign ran all 179 tests and passed 175/179 before the final divider fix; after that fix, a clean post-fix 179/179 rerun and release gates are still required.

## 0. Input files and current inspection range

| ID | Status | Requirement and current evidence | Remaining gap and next action |
|---|---|---|---|
| 0.1 | Implemented | All requested starting files exist: `index.html`, `app.js`, `server.js`, `service-worker.js`, `styles.css`, `manifest.json`, `icons/app-icon.svg`, and `server/storage.js`. `package.json` exposes build, E2E, source, auth, PostgreSQL, and backup checks. | Keep all eight files in the release diff/source audit. Rerun `npm run check` and `npm run check:build` after the final code change. |
| 0.2 | Partial | The executable and style sources are present, so functional and product-side visual inspection is possible. `tests/e2e/resource-viewport-matrix.spec.js`, `tests/e2e/resource-visual-state-evidence.spec.js`, `output/playwright/resource-viewport-matrix/`, and the settled 19-image `output/playwright/resource-visual-state-matrix-2026-07-12/` provide a reproducible implementation checkpoint. | Product-only screenshots do not establish Notion pixel parity. The selection toolbar, selected-block menu, URL chooser, cross-page Move submenu, anchor-lost comment, and local unread/read states need current regenerated captures. Then capture matched authenticated Notion states before fixing exact visual tokens. |
| 0.3 | Implemented | `server.js` imports `server/storage.js`; the file contains PostgreSQL state/revision/backup logic. `scripts/check-postgres-state.mjs` and `scripts/check-state-migration-backups.mjs` provide isolated validation paths. | Rerun PostgreSQL and backup gates against the final source. Do not extrapolate isolated checks to production until a live deployment check is authorized and executed. |

## 1. Separate the Notion comparison surfaces

| ID | Status | Requirement and current evidence | Remaining gap and next action |
|---|---|---|---|
| 1.1 | Implemented | `docs/resource-notion-parity-final-gap-audit-2026-07-11.md` explicitly separates authenticated database Side peek, Center peek, Full page, and unauthenticated Public Notion Site. | Preserve this separation in the final report and visual filenames; never use Public Site tokens as editor/peek evidence. |
| 1.2 | Implemented | `app.js` defines Library → Center and List → Side defaults, treats Map as product-specific, and normalizes Side/Center/Full. `tests/e2e/resource-page-shell.spec.js` covers `Library defaults to Center peek and List defaults to Side peek`. | Add a direct Map-default assertion if the final acceptance suite is meant to lock the product-specific default. |
| 1.3 | Implemented | `renderResourceOpenPagesInControl` provides per-view `Open pages in`; `resource-page-shell.spec.js` covers setting every view to Full. | Add an explicit persistence assertion for all three modes and all three views if not already covered indirectly. |
| 1.4 | Implemented | `resourceAdvancedWindowModeEnabled` makes strict parity require `notionParityMode === false && advancedWindowMode === true`. Contradictory persisted flags are healed. `resource-dom-stability.spec.js` covers the strict-mode precedence and Advanced regression path. | Keep Advanced controls out of every parity screenshot and accessibility scan. |
| 1.5 | Implemented | Parity mode renders a single database-context page shell; Advanced mode retains multi-window/floating behavior. `resource-p0.spec.js` covers absence of floating/dock/split chrome; `resource-dom-stability.spec.js` covers independent Advanced editors and viewport geometry clamping. | Define and test an upper bound or lifecycle policy for many Advanced windows; current Advanced DOM growth is not bounded. |
| 1.6 | Unverified | Private authenticated 768×964 static references for Side, Center, and Full were previously inspected and described in the final gap audit. | They are dark-theme, Korean, custom-layout, and not content/theme/locale/zoom matched to the fixture. Re-capture privacy-safe matched states and do not claim exact parity from the static shell references. |

## 2. Pre-change Gap Audit

| ID | Status | Requirement and current evidence | Remaining gap and next action |
|---|---|---|---|
| 2.1 | Implemented | `docs/resource-notion-parity-gap-audit-2026-07-11.md` and `docs/resource-notion-parity-final-gap-audit-2026-07-11.md` contain P0/P1/P2 gap tables with source/test references. This ledger updates the completion interpretation against all 0–20 requirements. | Keep historical pass counts and deployment claims time-scoped; update the final audit after the post-fix 179/179 rerun. |
| 2.2 | Partial | Functional Notion claims in the audits link official Notion Help pages and label pixel behavior as needing direct reference. | Some rows in the older audit call all known P0 complete despite open security/reference gates. Use this ledger's conservative statuses in the final report. |
| 2.3 | Partial | Work has progressed in P0/P1/P2 groups and checkpoint documents exist. | The attachment asks for independently testable phase checkpoints/branches. The current worktree is dirty and newer changes are not isolated as a new checkpoint. Create a final checkpoint only after all tests and docs are synchronized. |

## 3. Preserve current product behavior

| ID | Status | Requirement and current evidence | Remaining gap and next action |
|---|---|---|---|
| 3.1 | Implemented | Library/List/Map remain present. `resource-baseline.spec.js` covers `Resource preserves Library, List, and Map views`. | Retain this regression in the full suite. |
| 3.2 | Implemented | Title/body/relation search, active/important/pinned/read-later/linked/archived filters, and updated/title/importance/type/project sorts remain in `app.js`; baseline and P0 specs exercise view/search/filter/sort combinations. | Add explicit relation-target search cases for every supported relation type if full cross-entity coverage is required. |
| 3.3 | Implemented | Resource relations to Box/Goal/Project/Task are retained in the model, relation index, property controls, validation, and search document. | Server validation and E2E should keep broken relation rejection cases for every relation field. |
| 3.4 | Implemented | Database search and Full-text search have separate scope buttons, placeholder, scope description, and result logic. `resource-p0.spec.js` covers `P0 Database search and Full-text search expose and honor separate scopes`. | Keep wording aligned to current official database-search scope; do not call the full-text extension Notion-equivalent. |
| 3.5 | Implemented | Existing paragraph, H1/H2/H3, bullet, numbered, todo, toggle, quote, callout, divider, and code schemas/renderers remain. The model additionally supports validated Bookmark/Embed URL-preview blocks created through the paste chooser. `resource-baseline.spec.js` covers the original set; `resource-editor-matrix.spec.js` covers conversions; `resource-url-paste-choice.spec.js` covers the new URL types. | Broader requested slash catalog is tracked under 7.3 and 20; Bookmark/Embed are not yet direct slash candidates and must not be presented as full Notion coverage. |
| 3.6 | Implemented | Existing bold, italic, underline, strike, inline code, link, comment, mention, date/reminder mention, equation, emoji, and text/background color mark paths remain in source. The selection toolbar exposes equation plus nine text and nine background colors with keyboard and persistence coverage. | General inline-link action completeness remains under 7.5 and 8.2. |
| 3.7 | Implemented | Enter/Shift+Enter, boundary Backspace/Delete, Tab/Shift+Tab, Markdown conversion, slash/mention/page/emoji/equation commands, Arrow navigation, and Korean IME guards have focused coverage in `resource-editor-matrix.spec.js`. | Add Control-key variants on a non-macOS browser runner if cross-platform keyboard parity is in release scope. |
| 3.8 | Implemented | Multi-selection, Shift-click, marquee, pointer drag, subtree move, Alt-drag copy, insertion target, auto-scroll, keyboard move, structural undo, and cross-page Resource movement remain in editor/transport code. `resource-editor-transport.spec.js` and `resource-cross-page-block-move.spec.js` cover representative paths. | Columns, real touch drag/long press, and a broader screen-reader interaction pass remain open. |
| 3.9 | Partial | Custom MIME/HTML/plain-text clipboard priority, ID regeneration, sanitized HTML, Markdown parsing, structural undo/redo, and standalone HTTPS URL choice are tested. The chooser supports Link/Bookmark/Embed/Cancel, keyboard/clamp behavior, safe custom-block degradation, URL-block clipboard preservation, reload, and structural undo/redo. | Image/file paste/drop, remote preview metadata/real iframe policy, large-paste progress/error, and page version history remain missing. |

## 4. P0 structural defects

| ID | Status | Requirement and current evidence | Remaining gap and next action |
|---|---|---|---|
| 4.1 | Implemented | Resource search uses control/results patching rather than replacing the input. `resource-p0.spec.js` covers DOM identity, focus, caret, IME composition, result update, Escape, and clear behavior. | Rerun the focused test after final app changes and keep a real Korean IME manual smoke in release QA. |
| 4.1-A | Implemented | `patchResourceDetail`, `patchResourceDetailShell`, and owner-scoped editor patching preserve the active editor. `resource-dom-stability.spec.js` covers property, URL, relation, and comment mutations plus Advanced cross-window isolation. | Browser-native draft undo is intentionally limited to native draft inputs; session app history coverage and remaining page-version gaps are tracked in 7.8. |
| 4.1-B | Implemented | Title input is composition-aware, patches title displays, and debounces remote save instead of rebuilding the list. `resource-p0.spec.js` covers title/list/editor DOM identity. | Add an explicit list scroll/hover/open-animation preservation assertion if those are release-critical. |
| 4.2 | Implemented | `normalizeResourceRecord` and `touchResource` add `createdAt`, `updatedAt`, `lastOpenedAt`, revision, and `timestampSource`; mutation/non-mutation tests cover revision/timestamp behavior and stable sorting. | Legacy migration timestamps remain migration-time facts, not historical edit times. Preserve `timestampSource` in exports and UI/debug evidence. |
| 4.3 | Implemented | IndexedDB snapshot/operation stores, provisional first-offline workspace, immediate pagehide flush, serialized/generation-guarded writes, provisional→real workspace merge/migration, operation rebasing, queued replay, visible Saving/Saved/Offline/Conflict/Retrying states, and SW-update gating are in `app.js`. `resource-offline.spec.js` includes online durability, first-offline immediate pagehide recovery and one-time migration, offline deep-link reload, retry, conflict, and update cases. | Real OS/process crash, Safari eviction/quota behavior, long-lived offline sessions, and multi-device recovery are unverified. Add real-browser soak and storage-pressure QA. |
| 4.4 | Partial | State revision/ETag/`If-Match`, 409 conflict UI, explicit Keep local/Use remote, Resource-level incremental PUT, hierarchy-safe queue ordering, and local-operation rebasing exist. `resource-revision-conflict.spec.js`, `resource-hierarchy-persistence.spec.js`, and the provisional migration case in `resource-offline.spec.js` cover stale writes, queue rebase, and relation ordering. | Block and Comment are still embedded in Resource payloads; no payload-size/frequency telemetry proves that full serialization cost is acceptable. Add telemetry, then split entity endpoints/transactions where justified. |
| 4.5 | Partial | The deployed design documented in the audits is an authenticated, fail-closed, single-workspace bearer/proxy boundary. `server/deployment-security.js`, auth scripts, rate limiting, and audit events exist. | There is no per-user/tenant/role/Resource ACL, user session model, CSRF model, or true collaborative identity. Confirm the service classification; before multi-user/public expansion, add tenant/user/workspace keys, authorization, session/CSRF policy, and permission E2E. |
| 4.6 | Implemented | Resource cards have keyboard-openable anchors/controls with accessible names and action separation. `resource-p0.spec.js` covers Enter and Space. | Keep focus-visible and nested action propagation in axe/keyboard regression checks. |

## 5. P0 page and Peek shell

| ID | Status | Requirement and current evidence | Remaining gap and next action |
|---|---|---|---|
| 5.1 | Implemented | The v4 Resource page model includes stable ID, title, icon, cover, parent/child context, properties, blocks, comment threads, derived backlinks, timestamps/revision, deep link, read-only/lock, and trash state. Normalization and server validation cover these fields. | True user permissions and author identity are not part of this single-user model; do not label lock/read-only as collaborative authorization. |
| 5.2 | Implemented | Center uses a modal dialog sheet and backdrop, one natural scroll document, close/Escape/Back, Full expansion, and previous/next controls. `resource-page-shell.spec.js` covers focus, backdrop, history, navigation, and expansion. | Exact width/height/radius/shadow/opacity/motion against a matched authenticated Notion Center reference is unverified. |
| 5.3 | Implemented | Desktop Side is a non-modal split panel with interactive database context, persisted pointer/keyboard resize, close/expand, and previous/next. Compact/coarse Side becomes full-screen. Shell specs cover semantics, width, background interactivity, and 768px geometry. | Direct authenticated Notion evidence for backdrop/outside-click, dynamic row switching, resize bounds, and focus behavior is incomplete. Capture and compare those interactions. |
| 5.4 | Implemented | `/resources/:id` deep links, history state, Back/Forward, reload, copy link, invalid-ID state, server/Worker/SW navigation fallback, and parent/database breadcrumb are present. `#block-…` routes temporarily reveal collapsed toggle ancestors without persisting expansion, focus editable/divider/URL-preview targets, and fall back to the page shell with a truthful failure announcement for missing or malformed hashes. Shell/offline tests plus `resource-block-deep-link.spec.js` cover these paths. | Add an explicit offline missing-ID assertion and a real new-tab/window manual check; deployed fallback must be reverified after release. |
| 5.5 | Implemented | Toolbar exposes breadcrumb, save/lock status, previous/next, copy link, comments, real sub-page creation, page menu, Full expansion, and close. Unsupported share/permission/AI controls are absent. | If product favorite is meant to map to `pinned`, define and expose it consistently; otherwise document that it is intentionally not a toolbar action. |

## 6. P1 page appearance and properties

| ID | Status | Requirement and current evidence | Remaining gap and next action |
|---|---|---|---|
| 6.1 | Partial | Empty-state Add icon/Add cover, emoji icon, HTTPS external cover URL, cover position/change/remove, unsafe-URL rejection, persistence, and read-only suppression exist. `resource-page-features.spec.js` covers the supported subset. | No uploaded icon/cover image model, upload failure/progress, or robust broken-image recovery test exists. Define binary storage/security first, then add upload paths and loading/broken/read-only state tests. |
| 6.2 | Partial | `Untitled` placeholder, single-line textarea policy, title↔first-block Arrow navigation, IME-safe input, timestamps/revision, accessible H1, and document-title synchronization have focused coverage. | Session-scoped app history covers title paste/edit, page settings, properties, icon, cover, coalesced block text, comments, structural block operations, and multi-Resource moves. Native draft inputs retain browser undo, and app history intentionally clears on reload; page version history remains absent. |
| 6.3 | Partial | Boolean controls use checkbox/switch semantics; URL has Open/Copy/Edit/Clear; type labels are localized; collapse uses hidden/inert/ARIA; native property controls are keyboard operable. Feature and DOM-stability specs cover these behaviors. | Property reorder, configurable hiding/empty policy, richer select/relation popovers, roving keyboard navigation, and focus-return behavior are absent. Design a property settings model before adding UI. |
| 6.4 | Partial | The page menu has Default/Serif/Mono, Small text, Full width, Copy link, Duplicate, Lock, Move to, Markdown export, and Move to trash, with keyboard layering and short-viewport tests. | There is no dedicated Customize page surface, property customization, version history, or export format beyond Markdown. Add only backed capabilities and retain disabled/hidden honesty. |
| 6.5 | Implemented | Scope is explicitly fixed to the original/default Resource page layout; custom Notion database layout builder is documented as P2 and no decorative builder control is exposed. | If scope expands, separately specify heading/pinned properties/groups/details/Simple/Tabbed schema, migration, responsive behavior, and accessibility. |

## 7. P1 block editor

| ID | Status | Requirement and current evidence | Remaining gap and next action |
|---|---|---|---|
| 7.1 | Implemented | Heading, list/listitem, blockquote, and pre/code semantics are rendered while preserving block/editor hooks; contenteditable elements expose named multiline textbox semantics. `resource-page-features.spec.js` covers semantic structure. | Run NVDA/VoiceOver reading-order checks because automated semantics do not prove usable announcements. |
| 7.2 | Partial | Empty placeholders, hover `+`/drag handle, insert menu, flicker guards, nested indentation, and a mobile bottom toolbar exist. Settled implementation screenshots now cover empty block hover, normal block hover, and touch-emulated mobile toolbar. | Columns do not exist; no real-touch alternative test covers long press or handle geometry with a software keyboard. Add matched Notion pairs and real-device touch QA. |
| 7.3 | Partial | Slash anchoring, search, keyboard active item, Enter/Escape, collision/scroll, IME guard, ARIA linkage, query removal, the existing 12 slash block types, mentions, emoji, inline equation, duplicate/delete, and block colors are implemented. Bookmark and Embed now have validated block schemas/renderers and are created through the standalone HTTPS paste chooser as inert previews. `resource-visual-state-evidence.spec.js` captures the earlier settled slash states; `resource-url-paste-choice.spec.js` covers the new URL block paths. | Categories/recent UX and direct slash candidates for Page, simple table, image, video, audio, file/PDF, bookmark, embed, equation block, breadcrumb, and table of contents remain absent. Bookmark/Embed still lack remote metadata and real iframe execution by design. Add only backed, sanitized, accessible catalog entries. |
| 7.4 | Implemented | The selected-block menu exposes Copy link, whole-block Comment, move up/down, cross-page Move to, Copy, Duplicate, Delete, Turn into through block-type entries, and a visible color group with nine text plus nine background colors. The searchable destination submenu excludes the source and immutable/trashed pages, clamps to short viewports, and returns focus on Back/Cancel/Escape. Cross-page movement preserves source order and nested descendants, normalizes root indents, transfers anchored inline threads, leaves an editable paragraph when every block moves, aborts ID collisions without writes, and atomically undoes/redoes both Resources with deterministic source→target persistence. `resource-block-menu-actions.spec.js`, `resource-cross-page-block-move.spec.js`, and block-deep-link coverage exercise these paths. | Suggest edits is intentionally absent because no suggestion/review model exists. Regenerate the selected-menu and Move-submenu screenshots and add matched authenticated Notion evidence before making a visual-parity claim. |
| 7.5 | Partial | The selection toolbar now exposes bold/italic/underline/strike/code/link/comment, inline equation, and a keyboard-operable color menu with nine text plus nine background colors. Marks normalize, persist, reload, and participate in structural undo/redo. Toolbar/menu semantics and an axe scan are covered; `visualViewport` positioning flips above/below and clamps every edge to a 12px inset. `resource-inline-toolbar.spec.js` passed 5/5 and the related focused batch passed 50/50; arbitrary inline color payloads receive server 422 with no mutation. | The inline-link popover still lacks a complete explicit Open/Edit/Copy/Remove action set, and the existing toolbar screenshot predates these additions. Regenerate visual evidence and add matched Notion pairs; keep page version history tracked under 7.8. |
| 7.6 | Partial | Esc selection transition, Shift+Arrow/click, marquee, visual selection, polite live-region announcements, insertion guide, subtree move/copy, auto-scroll, cancel, keyboard move, cross-page Move to, and undo/redo are implemented. `resource-editor-transport.spec.js`, `resource-cross-page-block-move.spec.js`, `resource-a11y-axe.spec.js`, and the settled drag-guide capture cover representative paths. | Horizontal drag-to-column and column-width adjustment are missing; real touch drag/long press and external drop remain unverified. Add column schema first, then pointer/keyboard/touch equivalents. |
| 7.7 | Partial | Custom MIME > sanitized HTML > Markdown/plain text priority, multi-block parsing, fresh IDs, and dangerous HTML/URL stripping are tested. A standalone credential-free HTTPS URL opens a Link/Bookmark/Embed/Cancel chooser; keyboard traversal, short-viewport clamp, safe static preview, clipboard round-trip/degradation, undo/redo, reload, and server 422/no-mutation are covered by `resource-url-paste-choice.spec.js` and the transport suite. The new spec passed 7/7 and the combined transport-focused run passed 16/16. | Image/file paste/drop, upload storage/scanning, remote bookmark metadata/real iframe behavior, and large-paste progress/cancel/error remain absent. Define those security and storage policies before implementation. |
| 7.8 | Partial | Structural split/merge/move/copy/paste/delete/duplicate transactions, tested inline formatting, and page/inline comment add/reply/resolve/reopen/thread-delete participate in editor history with Resource `commentThreads` snapshots. Cross-page Move records one multi-Resource transaction. Comment reconciliation keeps a living mark and thread anchor aligned, converts a lost inline anchor to a safe page thread with `anchorLostAt`/`formerAnchor`, removes orphan marks, transfers anchored threads during cross-page Move, and strips comment marks from duplicated/external clipboard blocks instead of reusing thread IDs. `resource-comment-history-integrity.spec.js` passed 4/4 and the related combined batch passed 56/56. | Session-scoped app history now covers coalesced block text, title paste/edit, properties, icon, cover, page settings, structural block operations, comments, and multi-Resource moves; native draft inputs intentionally retain browser undo; app history intentionally clears on reload. Reply-level delete is not exposed, and page version history remains distinct and absent. Introduce the remaining page-level command boundaries, keep the intentional reload-clears-history policy documented, and expand Cmd/Ctrl+Z/redo tests only for newly added mutation types. |

## 8. P1 page capabilities

| ID | Status | Requirement and current evidence | Remaining gap and next action |
|---|---|---|---|
| 8.1 | Implemented | `parentId`, `childOrder`, cycle prevention, real child creation for `[[`/`+` sub-page commands, root-only create-page, parent picker, Move to, and ordered durable hierarchy writes are present. URL Bookmark/Embed previews remain ordinary page-content blocks and do not masquerade as sub-pages or modify the hierarchy model. `resource-page-command-mentions.spec.js`, `resource-page-features.spec.js`, and `resource-hierarchy-persistence.spec.js` provide hierarchy coverage. | Define a product policy for parent permanent deletion if permanent delete is ever introduced; current soft trash preserves hierarchy and recovery state. |
| 8.2 | Partial | Resource, Project, Goal, Box, Task, and Habit mentions expose active/missing/trashed state where applicable and navigate by click/Enter/Space. Resource backlinks are derived from Resource page mentions; unsafe protocols are rejected. Resource block deep links reveal collapsed ancestors without persistence, focus/highlight editable, divider, and URL-preview targets, and avoid false success for missing hashes. Standalone credential-free HTTPS paste can preserve selected text as a Link or create Bookmark/Embed blocks with escaped inert previews and explicit safe new-tab Open links. `resource-page-command-mentions.spec.js`, `resource-block-deep-link.spec.js`, `resource-block-menu-actions.spec.js`, and `resource-url-paste-choice.spec.js` cover these paths. | Cross-entity backlink surfaces/indexing and a complete normal inline-link Open/Edit/Copy/Remove popover remain absent. Bookmark/Embed do not fetch remote metadata and do not execute real iframes. Add those only after explicit provider, sandbox, privacy, and permission policy. |
| 8.3 | Partial | Page and inline range threads have IDs, scope/anchor, timestamps, replies, open/resolved state, and no fabricated author. Thread soft delete records `deletedAt`; deleting an inline thread removes its mark. Comment changes are undoable with blocks and threads together. A shared reconciliation path updates anchors from living marks, demotes lost anchors to page threads with `anchorLostAt`/`formerAnchor`, removes orphan marks, and preserves/transfers valid threads through destructive edits and cross-page Move. Toolbar/mobile badges count unread threads; opening the pane writes only a workspace+Resource IndexedDB metadata cursor, survives reload for normal/locked/read-only pages, and causes zero workspace/server writes. Comment integrity passed 4/4; the deep-link/read-cursor integration set passed 17 cases. | Reply-level delete, author/permission/notification, and multi-user unread semantics remain absent. Add attributed collaboration only after real identity/authorization exists; keep the single-user read cursor local-only. |
| 8.4 | Implemented | `trashedAt`, dedicated Trash filter/view, recovery shell, Restore, immediate Undo toast, preserved orphan mention/parent states, public full-state deletion guard, and explicit operator restore/reset exception exist. Trash and deletion-guard specs cover the local behavior. | Retention is currently indefinite and user permanent delete is intentionally unavailable. If policy changes, add permission, confirmation, audit, retention, and backup requirements before exposing hard delete. |

## 9. Resource-list defects

| ID | Status | Requirement and current evidence | Remaining gap and next action |
|---|---|---|---|
| 9.1 | Implemented | Base active/archive/trash scope is separated from added predicates; added filters combine with AND and the UI explains the mode. Chips/reset and Database/Full-text scope combine with filters/sorts. P0/baseline tests cover principal combinations. | Add a saved advanced filter-group model only if product scope requires user-defined nested AND/OR groups. |
| 9.2 | Implemented | `resourceDisplayBuckets` now assigns exclusive priority `pinned > readLater > normal`. `resource-p0.spec.js` covers a pinned+read-later Resource appearing once in pinned only. | Keep the section policy copy visible so exclusivity is intentional to users. |
| 9.3 | Implemented | `renderResources` now renders active/archive/trash count copy passed to the header. Baseline/P0 view assertions cover the header. | Add a count update assertion after filter/trash mutation if not covered elsewhere. |
| 9.4 | Partial | Search text is cached by Resource key in `resourceSearchTextCache`, and preview text updates after block order changes. | Card/list/map previews still flatten content and lose todo/hierarchy/format/URL context; card rendering still calls `blockText(resource)`. Define view-specific preview rules and cache computed excerpts with invalidation/telemetry. |

## 10. Responsive and mobile behavior

| ID | Status | Requirement and current evidence | Remaining gap and next action |
|---|---|---|---|
| 10.1 | Implemented | `resource-viewport-matrix.spec.js` covers Center/Side/Full at 1440, 1280, 1024, 900, 768, 390, 375, 360, and 320 widths. Shell/menu tests cover collision, Side minimum width, 768 fine-pointer behavior, and compact transitions. `resource-visual-state-evidence.spec.js` produced 19 animation-settled checkpoint screenshots at 1440×1000 and touch-emulated 390×844. | Viewport fit and product-only captures are not visual parity. Regenerate the toolbar/affected states after the latest changes and pair with authenticated Notion states. |
| 10.2 | Implemented | Advanced floating windows clamp x/y/width/height through 280/320 and desktop resize/restore. `resource-dom-stability.spec.js` covers the regression. | Bound total Advanced windows and add long-session memory/DOM-growth evidence. |
| 10.3 | Partial | Mobile uses a full-screen Resource shell, 44px controls, safe-area/visualViewport-aware layout, bottom toolbar, Back/history, durable drafts, and horizontal containment. Shell/viewport/axe tests cover Chromium geometry and semantics; a touch-emulated 390×844 settled toolbar screenshot exists. | Real iOS/Android soft keyboard open/close, title/property scroll stability, touch drag/long press, safe-area hardware, and file/table horizontal behavior are unverified. Run a device matrix and preserve video/screenshot evidence. |

## 11. Accessibility

| ID | Status | Requirement and current evidence | Remaining gap and next action |
|---|---|---|---|
| 11.1 | Implemented | Center is modal with label, initial focus, trap, close, and focus return; desktop Side is non-modal and leaves the database interactive. Shell specs and axe scans cover both. | Verify the same flows manually with VoiceOver and at least one Windows screen reader. |
| 11.2 | Implemented | Escape order is covered for slash → block selection → page, plus layered page/move menus and focus return. `resource-editor-matrix.spec.js` and `resource-page-features.spec.js` contain the state-machine tests. | Extend the explicit order to mention/emoji/equation/link/comment popovers in one consolidated keyboard test. |
| 11.3 | Implemented | Advanced windows have unique title+ID labels; active navigation, decorative glyph hiding, menus/groups, and active-descendant wiring are implemented. Keyboard resize equivalents exist for Side and block move. | Audit every drag-only affordance after future column/media work. |
| 11.4 | Implemented | `#appAnnouncements` is a separate polite live region; block-selection changes, successful block-deep-link arrival, and missing/malformed block fallback are announced. `resource-a11y-axe.spec.js` covers selection/clear announcements, while `resource-block-menu-actions.spec.js` and `resource-block-deep-link.spec.js` cover linked-block success/failure. `#viewRoot` is not used as a whole-page live region. | Manually confirm announcement timing/verbosity with VoiceOver/NVDA, marquee selection, and deep-link navigation. |
| 11.5 | Implemented | `index.html` includes a skip link and `<noscript>` fallback; Full retargets the skip link to the Resource surface. Full-docked navigation specs cover the retargeting. | Add a deliberate app initialization failure/error fallback if JavaScript loads but boot fails. |
| 11.6 | Implemented | Focus-visible, reduced motion, forced colors, and five automated accessibility tests exist: axe scans for Library, Center/page menu, desktop Side, and mobile Full plus live-region selection coverage. A checked-todo contrast defect was corrected in `styles.css`. | Axe cannot replace zoom, reflow, manual contrast/high-contrast, or screen-reader review. Add manual evidence at 200%/400% zoom and system high contrast. |
| 11.7 | Unverified | Keyboard-only automated coverage is broad. | No recorded VoiceOver, TalkBack, NVDA, or JAWS manual checklist is current. Complete and attach a major-flow screen-reader matrix before accessibility completion. |

## 12. Performance and code structure

| ID | Status | Requirement and current evidence | Remaining gap and next action |
|---|---|---|---|
| 12.1 | Partial | Owner-scoped helpers separate some state, routing, page-shell, editor, persistence, and accessibility responsibilities within `app.js`. | `app.js` remains a very large monolith; store/repository/router/views/page/editor/selection/drag/clipboard/menus/comments/a11y are not actual modules. Extract behind the existing regression suite without a framework rewrite. |
| 12.2 | Implemented | Resource search/list/detail/title mutations use targeted patching rather than full `innerHTML` replacement of active controls/editors. DOM identity tests cover the critical paths. | Track patch miss/fallback rates and prevent future render paths from reintroducing full replacement. |
| 12.3 | Partial | Parity mode limits page shells to one Resource context and a deterministic 400-block performance test exists. | Advanced mode can grow multiple windows without a cap; long documents are not virtualized. Add a lifecycle cap and measure before attempting virtualization that could break caret/selection. |
| 12.4 | Partial | `resourceSearchTextCache` avoids recomputing full text for unchanged search records; relation indexes are cached. | Card/map preview generation still flattens blocks; no production RUM or payload/query telemetry exists. Add cache invalidation tests and field telemetry. |
| 12.5 | Partial | Mutation/render/persistence helpers are more explicit and tests catch several unintended side effects. | Handler and render side effects are not fully separated in the monolith. Introduce command/store boundaries incrementally. |
| 12.6 | Implemented | New IDs use `crypto.randomUUID()` or `crypto.getRandomValues()` UUID formatting with a monotonic legacy fallback; server validation rejects duplicates. | Document legacy-ID compatibility and a no-rewrite migration policy; add a fallback collision test if non-crypto environments remain supported. |
| 12.7 | Partial | `resource-performance.spec.js` measures a 400-block local fixture and attaches metrics. | Local bundled-Chromium timing is not production RUM, mobile hardware, or sustained editing evidence. Define budgets and collect representative field/device data. |

## 13. Security and server validation

| ID | Status | Requirement and current evidence | Remaining gap and next action |
|---|---|---|---|
| 13.1 | Implemented | `validateIncomingState`, `validateResourcePageFields`, `validateBlocks`, comment/hierarchy/relation validation, duplicate-ID checks, type/mark/indent/depth/size bounds, and no-mutation error paths exist in `server.js`. Resource `title`, `type`, `importance`, booleans, timestamps/order, revision, `timestampSource`, cover shape, lock/read-only, hierarchy, page settings, and comment fields are explicitly checked. `scripts/check-postgres-state.mjs` covers full-state invalid variants and an incremental missing-required-field rejection without mutation; page-lock tests cover client-facing lock validation. | Rerun isolated PostgreSQL validation after final schema changes and add fuzz/property-based cases for nested state if risk warrants. |
| 13.2 | Partial | Clipboard HTML is converted to a safe internal model; unsafe protocols are stripped or degraded to escaped paragraph text. Bookmark/Embed require credential-free HTTPS, render without iframe/script/object/embed/image/event-handler DOM, and open originals with safe new-tab relations. The server validates URL block type/url/text consistency and supported inline color keys, returning 422 without revision/state mutation for `unsafe_block_url` or `unsupported_inline_color`. `resource-url-paste-choice.spec.js` and `resource-inline-toolbar.spec.js` cover both client and server boundaries. | Image/file upload sanitization/scanning is absent. Bookmark metadata is not fetched and Embed is deliberately an inert preview, not a real sandboxed iframe. Define provider allowlists, privacy, CSP/sandbox, request limits, and binary scanning before enabling those capabilities. |
| 13.3 | Partial | Node and built static headers include CSP, frame protections, Referrer-Policy, nosniff, Permissions-Policy, and conditional HSTS; errors/audit paths avoid token echo. | Node and Sites/Worker policies are not identical, and live ingress HSTS/header behavior has not been reverified for the current candidate. Run production header probes after authorized deployment. |
| 13.4 | Implemented | API request-size limits, route-aware rate limiting, write admission control, structured errors, and audit events exist. | The limiter is process-local, not distributed/replica-wide. Move abuse controls to shared infrastructure before horizontal multi-user scale. |
| 13.5 | Missing | Google disconnect deletes the local stored token via `storage.deleteToken()`. | It does not call Google's token-revocation endpoint or document a provider-revoke choice. Add an explicit local-only versus provider-revoke policy and test both outcomes. |
| 13.6 | Partial | JSON export and Markdown Resource export exist; incoming API state is validated. | There is no user-facing import workflow, so import validation/recovery is absent. If import is added, validate schema/references/size before mutation and create a rollback snapshot. |
| 13.7 | Partial | Single-workspace bearer/proxy auth and server validation protect the current documented deployment model. | Per-user/tenant ACL and Resource-level authorization remain missing; see 4.5 and 17.3. |

## 14. PWA and updates

| ID | Status | Requirement and current evidence | Remaining gap and next action |
|---|---|---|---|
| 14.1 | Implemented | Service worker separates app-shell caching from `/api/`; user data uses IndexedDB snapshots/operations instead of API response caching. | Validate quota/eviction behavior and document recovery when browser storage is cleared. |
| 14.2 | Implemented | `index.html` is a required precache asset; manifest/icon/social preview are optional in dev, while the production build generates a hashed asset list. Optional failures do not abort install. | Add an install test with a deliberately missing optional asset and a required-asset failure state if not already part of build checks. |
| 14.3 | Implemented | Navigation-first fallback serves cached `/index.html`; server/Worker/SW exclude `/api/*` and distinguish assets/navigation. Resource routing renders explicit not-found states. | Verify hard reload/offline reload on the final deployed service worker, not only the fixture. |
| 14.4 | Implemented | Waiting updates are surfaced and blocked while pending/conflict state exists; successful save allows `SKIP_WAITING`. `resource-offline.spec.js` covers the pending-save gate. | Add a user-decline/defer path test if the UI offers a later choice. |
| 14.5 | Partial | Production builds centralize cache identity through content-hashed filenames and generated SW source. | Development `service-worker.js`, `index.html` query versions, and `CACHE_NAME` are manually duplicated. Generate the dev manifest/version from one source or remove the query-token duplication. |

## 15. Required visual comparison matrix

The implementation matrix is `tests/e2e/resource-visual-state-evidence.spec.js` plus `output/playwright/resource-visual-state-matrix-2026-07-12/`. Its README records deterministic fixture reset, 1440×1000 desktop and touch-emulated 390×844 mobile conditions, Korean locale/timezone, reduced motion, font readiness, finished animations, stable save state, two final animation frames, and a focused four-test capture result. It contains 19 implementation screenshots and a contact sheet. These captures prove that the named local state was deliberately rendered and settled at that checkpoint; the selection toolbar predates the latest equation/color/placement changes, and the matrix predates the cross-page Move submenu, exact deep-link states, anchor-lost comment state, and local unread/read-cursor tranche. Regenerate affected captures. Product-only captures still do not prove Notion parity. Older `resource-notion-live-compare/implementation-*.png` and `resource-final-visuals/center-menu-1440.png` remain stale/unsafe for current-state comparison.

| Required state | Status | Current evidence | Remaining gap and next action |
|---|---|---|---|
| 15.1 Database view | Partial | Settled implementation evidence: `01-library-database-1440x1000.png`. | Capture the authenticated Notion database with identical safe fixture content, theme, locale, zoom, and viewport. |
| 15.2 Center open | Partial | Settled implementation evidence: `02-center-settled-1440x1000.png`; a mismatched private authenticated 768×964 structural reference also exists. | Create a matched pair and measure all requested geometry/tokens. |
| 15.3 Side open | Partial | Settled implementation evidence: `07-side-settled-1440x1000.png`; a mismatched private authenticated 768×964 structural reference also exists. | Match content/theme/locale/zoom and verify interactive split behavior, not only outer bounds. |
| 15.4 Peek toolbar | Partial | Settled focused crop: `03-center-toolbar-1440x1000.png`. | Add a matched authenticated toolbar pair with hover/focus/menu states. |
| 15.5 Properties open/closed | Partial | Settled same-fixture evidence: `04-properties-closed-1440x1000.png` and `05-properties-open-1440x1000.png`. | Capture the same states in authenticated Notion and measure baseline/order/spacing. |
| 15.6 No-icon/no-cover hover | Partial | Settled implementation evidence: `06-no-icon-no-cover-hover-1440x1000.png`, with both controls asserted visible before capture. | Add matched Notion plus loading/broken/read-only variants after upload scope is decided. |
| 15.7 Empty-block hover | Partial | Settled implementation evidence: `09-empty-block-hover-1440x1000.png`. | Pair with Notion and add real-touch alternative evidence. |
| 15.8 Normal-block hover | Partial | Settled implementation evidence: `08-normal-block-hover-1440x1000.png`. | Pair with current authenticated Notion content. |
| 15.9 Slash default/search/scroll | Partial | Settled implementation evidence: `10-slash-default`, `11-slash-search-heading`, and `12-slash-scrolled-keyboard` at 1440×1000. These images predate the URL-preview block schema, which is not yet a direct slash candidate. | Regenerate after the catalog decision, pair all three with Notion, and add viewport-collision variants. |
| 15.10 Text-selection toolbar | Partial | `13-selection-toolbar-1440x1000.png` is settled evidence for the earlier toolbar. Current behavior adds equation, 18 color choices, keyboard semantics, and above/below 12px `visualViewport` clamping with focused automated coverage. | Regenerate the screenshot for the current toolbar, add above/below/color/equation states, and capture matched Notion pairs. |
| 15.11 Block menu | Partial | `14-selected-block-menu-1440x1000.png` is settled evidence for the earlier selected-block menu. Current behavior adds a searchable cross-page Move submenu with immutable-target exclusion, focus return, collision protection, thread transfer, and multi-Resource undo/redo. | Regenerate both the selected menu and Move submenu, then capture matched authenticated Notion states. |
| 15.12 Drag insertion guide | Partial | Settled active-drag evidence: `15-drag-insertion-guide-1440x1000.png`, captured only after the ghost and exactly one drop guide were asserted. | Add copy/invalid-target/auto-scroll variants and matched Notion evidence. |
| 15.13 Long-page middle/bottom | Partial | Settled 84-block evidence: `16-long-page-middle-1440x1000.png` and `17-long-page-bottom-1440x1000.png`, with scroll positions asserted. | Capture the same long content in Notion and compare sticky/scrollbar/menu anchoring. |
| 15.14 Comments pane | Partial | `18-comments-pane-1440x1000.png` is settled implementation evidence for the earlier pane. Current behavior additionally includes local-only unread/read cursors and an explicit anchor-lost page-thread state. | Regenerate and pair with authenticated Notion, including open/resolved/deleted/unread/anchor-lost/thread-depth states. |
| 15.15 Mobile toolbar + soft keyboard | Partial | `19-mobile-toolbar-touch-emulated-390x844.png` captures a focused editor and visible five-button toolbar in browser touch emulation. | Record real iOS and Android keyboard-open/closed states with safe areas and visualViewport changes. |
| 15.16 Dark mode if in scope | Unverified | A private Notion reference was dark, but the product fixture is light and unmatched. | Explicitly decide product dark-mode scope. If included, repeat every applicable state rather than reusing the unmatched private reference. |

Required measurement output is **Partial**: the implementation matrix now records reproducible capture conditions and settled local states, but no current matched table records outer bounds, max width, paddings, baselines, typography, borders/radii/shadows, colors/opacities, state colors, anchors/collision, scrollbars, and transitions for both products. Create a machine-readable measurement sheet and privacy-safe Notion/product diff images after matched references are captured.

## 16. Interaction test matrix

| ID | Status | Requirement and current evidence | Remaining gap and next action |
|---|---|---|---|
| 16.1 | Implemented | Closed/Center/Side/Full, first/reopen/deep-link reload, previous/next, backdrop, Escape, Back/Forward, direct reload, invalid route, and Full expand/return have shell tests. | Add a single scenario that walks the complete prioritized state machine and records focus after every transition. |
| 16.2 | Partial | Offline, retry, conflict, read-only, locked, trash/recovery, and not-found error states have focused tests. | A unified empty/loading/error visual and keyboard matrix is absent; add deterministic fixtures for each state. |
| 16.3 | Implemented | Title and property edits, DOM stability, timestamp/revision, icon/cover subset, and page-menu settings have focused tests. | Unified undo and upload states remain separate open items. |
| 16.4 | Partial | Slash/mention/emoji/equation open/select/cancel and ARIA wiring are tested. Selected-block direct actions/18 colors/cross-page Move and inline-toolbar equation/18 colors/keyboard menu semantics/above-below clamp have dedicated suites. The toolbar spec passed 5/5 and its related focused batch passed 50/50; `resource-cross-page-block-move.spec.js` contains six focused Move cases. | Recent/category UX, the full block catalog, complete inline-link actions, current matched screenshots, and page version history remain open. |
| 16.5 | Partial | Single/multi selection, Shift-click, marquee, pointer move/cancel/copy, keyboard move, auto-scroll, cross-page multi-root/subtree Move, collision rollback, and single/multi-Resource structural undo/redo have tests. | Columns, external drop, and real touch drag/long press are missing/unverified. |
| 16.6 | Partial | Plain/custom MIME/HTML/Markdown paste and sanitizer behavior are tested. Standalone credential-free HTTPS paste now offers Link/Bookmark/Embed/Cancel with keyboard navigation, viewport clamp, inert preview, clipboard preservation/degradation, reload, undo/redo, unsafe fallback, and server 422/no-mutation coverage. The URL spec passed 7/7 and the transport-focused batch passed 16/16. | Image/file paste/drop, remote metadata/real iframe policy, and large-paste progress/cancel/error remain missing. |
| 16.7 | Partial | Page/inline comment add/reply/resolve/reopen/thread soft delete, inline-mark cleanup, comment-aware undo/redo, anchor synchronization/loss fallback, cross-page thread transfer, unread badge, and durable local-only per-Resource read cursor are covered in focused tests. Locked/read-only read-cursor reloads cause zero server writes. Comment history integrity passed 4/4 and its related combined batch passed 56/56; read-cursor/deep-link integration passed 17 focused cases. | Reply-level delete, author/permission, notifications, and multi-user unread semantics are missing. |
| 16.8 | Unverified | Mobile shell, toolbar, Back, durable draft, and a touch-emulated focused-editor screenshot exist in Chromium. | Real mobile keyboard open/close and pending-save close/back behavior need device evidence. |
| 16.9 | Implemented | Pending-save service-worker update gating has an offline E2E. | Reverify on the final built/deployed worker. |
| 16.10 | Implemented | Data-driven Markdown cases cover `#`, `##`, `###`, `-`, `*`, `+`, `1.`, todo, `>`, and `---`; inline Markdown covers bold/italic/code/strike. | Keep exact case data visible in test failure output and add locale/IME variants if parsing changes. |
| 16.11 | Implemented | Tab/Shift+Tab, Enter/Shift+Enter, boundary delete, Esc, Meta+B/I/U/K/E, Meta+Shift+M, Meta+D, undo/redo, Meta+A first/second, title arrows, and Korean IME cases have focused coverage. | Add Ctrl-key runs for Windows/Linux and a real Korean IME manual pass; synthetic composition is not a complete platform proof. |

## 17. Phase gates and implementation order

| ID | Status | Requirement and current evidence | Remaining gap and next action |
|---|---|---|---|
| 17.1 Phase A | Partial | Baseline fixture, regression tests, v4 migration, router/history, Center/Side/Full, focus/Escape, list patching, semantic blocks, selected-block actions/colors/cross-page Move/exact deep links, standalone URL choice/static previews, inline-toolbar equation/colors/placement, hierarchy, comment-aware history/anchor loss/delete/local unread, trash, responsive/axe coverage, and 19 settled product screenshots exist. | Full slash/block/media catalog, columns, image/file/large paste, complete inline-link actions, remote metadata/real iframe policy, page version history, reply-level deletion, regenerated/matched visual tuning, real device/SR QA, and final Phase A gate remain open. |
| 17.2 Phase B | Partial | IndexedDB durable snapshots/queue, provisional first-offline pagehide recovery and one-time workspace migration/rebase, revision/conflict, Resource-level incremental writes, offline/reload/update tests, migration backups, and restore runbooks exist. | Entity-level Block/Comment persistence, payload telemetry, real crash/eviction/multi-device recovery, and a post-fix complete Phase B gate remain open. |
| 17.3 Phase C | Partial | The documented service is treated as a protected single-workspace deployment with bearer/proxy auth, validation, rate limits, audit, single-user comment read cursors, and backup/auth runbooks. | Multi-user scope is not supported: no user/tenant/role/Resource authorization, attributed collaboration identity, distributed rate limit, or current production load/security E2E. Confirm scope before any public/multi-user release. |
| 17.4 Checkpoint discipline | Partial | Phase/checkpoint and runbook documents exist, and focused tests are organized by subsystem. | The newest changes share one dirty worktree and the historical full-run count is stale. Finish implementation, rerun all gates, then update checkpoint artifacts before commit/release. |

## 18. Completion criteria

| Criterion | Status | Evidence or blocker | Required closure |
|---|---|---|---|
| Notion surface types fixed | Implemented | Four surfaces and view defaults are documented. | Preserve in final report. |
| Missing source/runtime files acquired or scoped | Implemented | All named files exist. | Rerun source/build audit. |
| Every P0 gap resolved | Partial | Local focus, shell, durability, validation, and keyboard defects are addressed. | User/tenant authorization scope and matched reference-dependent P0 claims remain unresolved/unverified; do not declare P0 globally complete. |
| Center/Side/Full URL + Back/Forward | Implemented | Shell/history tests exist. | Post-fix full-suite rerun and deployed fallback verification. |
| Timestamp/revision/durable draft | Implemented | Model, IndexedDB, and offline tests exist. | Real crash/eviction field QA remains non-blocking for local implementation but required for strong reliability claims. |
| Search focus/caret/IME | Implemented | P0 focused test exists. | Real IME smoke. |
| Keyboard-openable Library card | Implemented | Enter/Space test exists. | Keep axe/focus regression. |
| Escape/focus return/popover order | Implemented | Editor/shell/page-menu tests exist. | Consolidate all popup types in one scenario. |
| Core block/format/selection/drag/paste/undo regression | Partial | Existing feature subset plus selected-block actions/colors/cross-page Move, comment-aware history/anchor loss, exact deep-link behavior, standalone URL Link/Bookmark/Embed/Cancel, inline equation/18 colors/viewport flip, and settled earlier menu/drag states have broad focused tests. URL chooser 7/7, transport-focused 16/16, inline-toolbar 5/5, and its related focused batch 50/50 passed; cross-page Move adds six focused cases. | Image/file/large paste, remote metadata/real iframe, full block catalog, columns, complete inline-link actions, and page version history remain open. |
| Mobile toolbar + soft keyboard verified | Unverified | Toolbar/geometry tests and a touch-emulated focused-editor capture exist in Chromium. | Real iOS/Android keyboard QA. |
| Keyboard-only accessibility | Partial | Automated keyboard coverage and five axe/live-region tests exist. | Manual VoiceOver/TalkBack/NVDA matrix. |
| Offline/conflict/reload | Implemented | Focused IndexedDB/queue/conflict/update tests exist. | Post-fix full run plus real browser soak. |
| Matched screenshot comparison attached | Partial | A reproducible, settled 19-screenshot implementation matrix and contact sheet cover an earlier product-state checkpoint; toolbar, cross-page Move, deep-link, and comment read/anchor states postdate it, and private Notion references remain unmatched. | Regenerate affected product states, then capture the same states in authenticated Notion with the same content/theme/locale/zoom/viewport and produce measurements/diffs. |
| Remaining gaps categorized by reason | Implemented | This ledger distinguishes missing implementation, scope deferral, private reference, and real-device/identity constraints. | Keep categories in the final ten-section handoff. |

Phase A status: **Partial**. Phase B status: **Partial**. Phase C status: **Partial**. Overall project status: **Partial**. No “Notion-identical” or pixel-parity claim is supported.

## 19. Required final deliverable format

| ID | Status | Current evidence | Remaining gap and next action |
|---|---|---|---|
| 19.1 | Partial | Existing gap-audit/checkpoint/runbook documents cover many requested facts, and this ledger supplies a complete requirement map. | The final user handoff must still be regenerated in the exact ten-section order: summary; verified Notion references/surfaces; final P0/P1/P2 table; files; migration/rollback; tests; viewport visuals; a11y/perf/security; unverified items; remaining work/reasons. |
| 19.2 | Unverified | Historical test/deployment evidence exists in prior docs. | Do not report current counts, build sizes, deployment state, or release gates until rerun after all current edits. Link every remaining difference to a reproducible test or an explicit missing evidence artifact. |

## 20. Official Notion references

| ID | Status | Current evidence | Remaining gap and next action |
|---|---|---|---|
| 20.1 Functional baseline | Implemented | The attachment and final gap audit enumerate official Help references for writing/editing, keyboard shortcuts, style/customize, columns/headings/dividers, databases, views/filters/sorts, properties, sidebar navigation, comments/mentions/reminders, links/backlinks, publishing, and layouts. | Recheck each page at final-report time for changed behavior and cite the exact page next to each functional claim. |
| 20.2 Exact visual values | Unverified | Official Help documents describe features but do not supply authenticated editor/peek pixel tokens. | Measure current matched authenticated captures; never invent or label remembered values as Notion values. |
| 20.3 Reference separation | Partial | Current docs distinguish authenticated editor/peek from Public Site and identify the private 768×964 structural references. | Complete a privacy-safe same-content/theme/locale/zoom reference matrix and retain capture date, viewport, route/mode, and animation-settled state. |

Official reference list to use for the final evidence refresh:

- <https://www.notion.com/help/writing-and-editing-basics>
- <https://www.notion.com/help/keyboard-shortcuts>
- <https://www.notion.com/help/customize-and-style-your-content>
- <https://www.notion.com/help/columns-headings-and-dividers>
- <https://www.notion.com/help/intro-to-databases>
- <https://www.notion.com/help/views-filters-and-sorts>
- <https://www.notion.com/help/database-properties>
- <https://www.notion.com/help/navigate-with-the-sidebar>
- <https://www.notion.com/help/comments-mentions-and-reminders>
- <https://www.notion.com/help/create-links-and-backlinks>
- <https://www.notion.com/help/public-pages-and-web-publishing>
- <https://www.notion.com/help/layouts>

## Coverage check and ambiguities

Coverage check result: every numbered source section `0` through `20` is represented above. Every named subsection is represented: Resource list/current block/current inline/current editing; `4.1`, `4.1-A`, `4.1-B`, `4.2`–`4.6`; `5.1`–`5.5`; `6.1`–`6.5`; `7.1`–`7.8`; `8.1`–`8.4`; `9.1`–`9.4`; Desktop/tablet and Mobile; Phase A/B/C; all 14 completion bullets; all 16 requested visual categories (expanded into 19 settled implementation screenshots at the recorded checkpoint); both interaction-state and keyboard/Markdown matrices; and all 12 official links. The source's final handoff marker and code-location memo are provenance/navigation text rather than additional product requirements; the named functions are re-audited through the source/test references above.

Ambiguities that require an explicit product decision rather than silent inference:

1. Whether `pinned` is the product's toolbar “favorite” equivalent or intentionally remains a database property/filter only.
2. Whether uploaded icon/cover/media and binary storage are in the next Phase A scope or deferred with the broader media block model.
3. Whether dark mode is in product scope. The available dark Notion image does not make product dark mode implicitly required or validated.
4. Whether the externally reachable service will remain a single-owner/single-workspace app. The current bearer gate is not evidence of per-user authorization.
5. Whether user permanent delete is desired. The current explicit policy is soft trash with indefinite retention and operator-only replacement/restore.
6. Whether custom database layouts remain excluded. Current documentation selects the recommended original/default layout scope.
7. Whether Bookmark should fetch remote metadata and Embed should ever execute a sandboxed iframe. The current explicit implementation is privacy-preserving deterministic metadata and an inert preview only.

Until those decisions and the missing evidence gates are closed, this ledger must remain `Partial` and the final report must not use “Notion과 동일”, “pixel perfect”, or equivalent language.

## 2026-07-12 Codex Cloud evidence refresh after commit `2cc217d`

This refresh reread the source specification and treated this ledger plus the current worktree as authoritative. It does not change the objective and does not claim Notion-identical parity.

### Fresh commands and outcomes

| Command | Outcome | Evidence interpretation |
|---|---|---|
| `npm ci` | Passed; 47 packages installed/audited, 0 vulnerabilities. | Dependency installation is current for this cloud workspace. npm emitted the environment warning `Unknown env config "http-proxy"`. |
| `npm run check` | Passed. | Syntax/source audit and Sites worker checks passed on the current worktree. |
| `PLAYWRIGHT_CHANNEL=chromium npx playwright test tests/e2e/resource-page-command-mentions.spec.js` | Blocked before browser launch. | The focused mention rerun could not verify the scoped `fixture-page-mention-navigation-block` fix because Playwright's Chromium executable was absent at `/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`. |
| `npx playwright install chromium` | Failed due environment/network policy. | Browser installation attempted but every CDN attempt returned `403 Domain forbidden`; no system Chrome/Chromium executable was present. |
| `PLAYWRIGHT_CHANNEL=chromium npx playwright test tests/e2e/resource-a11y-axe.spec.js tests/e2e/resource-inline-toolbar.spec.js` | Blocked before browser launch. | Current Axe and inline-toolbar checks could not execute for the same missing-browser reason. |
| `npx playwright test --list` | Passed; discovered 179 tests in 30 spec files. | Discovery confirms the current suite size, but is not a pass result. |
| `npm run check:build` | Passed; latest verified build metrics `1,318,622 -> 921,298` bytes, Brotli `160,042`, gzip `206,578`. | Current build gate is refreshed for this worktree. |
| `npm run check:api-auth` | Blocked by missing environment. | `.env` was absent and `DATABASE_URL is required`; no auth gate can be claimed in this cloud workspace. |
| `npm run check:postgres` | Blocked by missing environment. | `.env` was absent and `DATABASE_URL is required`; isolated PostgreSQL validation remains unverified here. |
| `npm run check:backups` | Blocked by missing environment. | `.env` was absent and the migration-backup check requires `DATABASE_URL`; backup validation remains unverified here. |
| `git diff --check` | Passed. | No whitespace errors were reported after the documentation refresh. |

### Current gate status after this refresh

- The user-supplied **173/174** local real-Chrome checkpoint is historical, before the current 179-test discovery. Current full-run evidence is the later Cloud postfix campaign at **175/179** before the final divider fix; after focused divider verification, a clean post-fix **179/179** campaign is still required.
- The authoritative current suite count is **179 tests in 30 spec files** by Playwright discovery.
- Visual-state matrix/contact-sheet regeneration and visual inspection were attempted only to the extent that the required Playwright browser dependency was checked; they remain **blocked** in this environment for the same missing-browser reason.
- Preserve all explicit unverified gates: matched authenticated Notion state pairs, real iOS/Android touch keyboards, VoiceOver/TalkBack/NVDA, image/file/large paste, columns, broader block catalog, page version history and media history, tenant ACL, entity-level persistence, deployed fallback verification, and all requirements not proven by evidence.

## 2026-07-12 Codex Cloud continuation from branch tip `f0167ad`

This continuation first verified the checked-out commit as `f0167ad820002e3f9ca51517cf1d4a3feadacf31`. It did not use SSH, local Mac paths, external credentials, Notion credentials, API tokens, or a fabricated `DATABASE_URL`. It also does not claim Notion-identical or pixel-perfect parity.

### Browser availability and bounded install attempt

| Command | Outcome | Evidence interpretation |
|---|---|---|
| `git rev-parse HEAD` | Passed; returned `f0167ad820002e3f9ca51517cf1d4a3feadacf31`. | The cloud checkout started from the requested branch tip. |
| `command -v chromium || true; command -v chromium-browser || true; command -v google-chrome || true; command -v google-chrome-stable || true; find ~/.cache/ms-playwright -maxdepth 3 -type f \( -name chromium -o -name chrome \) -print 2>/dev/null \| head -20; find /ms-playwright -maxdepth 3 -type f \( -name chromium -o -name chrome \) -print 2>/dev/null \| head -20` | Passed; found no runnable Chrome/Chromium or cached Playwright browser executable. | Browser-backed Playwright gates needed a local browser provision step. |
| `apt-get update && apt-get install -y chromium` | Completed with warnings; Ubuntu's package installed the `chromium-browser` transitional snap package, while `mise.jdx.dev` apt metadata returned a 403 warning. | This was the single bounded system-package attempt. It did not install a runnable Chromium binary inside this non-snap environment. |
| `chromium-browser --version || true` | Returned the snap prompt: `Command '/usr/bin/chromium-browser' requires the chromium snap to be installed`. | The installed command is not a runnable browser for Playwright. No repeated Playwright CDN download was attempted. |

### Fresh commands and outcomes

| Command | Outcome | Evidence interpretation |
|---|---|---|
| `npm install` | Passed; added the missing `@axe-core/playwright` and `axe-core` packages already declared in the lockfile; 0 vulnerabilities. | The pre-existing `node_modules` cache was incomplete before this step, causing Playwright discovery to fail on missing Axe imports. No package manifest or lockfile diff resulted. |
| `PLAYWRIGHT_CHANNEL=chromium npx playwright test tests/e2e/resource-page-command-mentions.spec.js` | Blocked before browser launch; both tests failed with `Executable doesn't exist at /root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`. | The required focused mention test could not execute because no runnable browser exists. This is an environment blocker, not a reproduced product or test defect. |
| `PLAYWRIGHT_CHANNEL=chromium npx playwright test --list` | Passed; discovered 179 tests in 30 spec files. | Discovery confirms the current full-suite size but is not a pass result. |
| `npm run check` | Passed. | Static syntax checks, source audit, and Sites worker checks passed on this checkout. |
| `npm run check:build` | Passed; latest verified build metrics `1,318,622 -> 921,298` bytes, Brotli `160,042`, gzip `206,578`. | The build gate passed without credentials. |
| `npm run check:postgres` | Blocked; `.env` was absent and `DATABASE_URL is required`. | PostgreSQL persistence cannot be verified without a caller-provided ephemeral or real database URL. None was invented. |
| `npm run check:api-auth` | Blocked; `.env` was absent and `DATABASE_URL is required`. | Database-backed API proxy auth cannot be verified without a caller-provided database URL. None was invented. |
| `npm run check:backups` | Blocked; `.env` was absent and `Migration backup check requires DATABASE_URL`. | Migration-backup validation remains externally blocked in this cloud workspace. |

### Current gate status after this continuation

- Earlier Cloud browser attempts were blocked by the absence of a runnable browser after one bounded system-package attempt; later Cloud postfix evidence supersedes that for the full 179-test campaign at 175/179 before the final divider fix, with a post-fix 179/179 rerun still required.
- Non-browser gates that do not require secrets passed: `npm run check` and `npm run check:build`.
- Secret-free server/persistence checks were inspected through the package scripts. The available PostgreSQL, API-auth, and backup checks explicitly require `DATABASE_URL`; they were run to confirm the blocker and no fake connection string or production credential was supplied.
- No reproduced product or test defect was found in this continuation, so no product code was changed.

## 2026-07-12 Codex Cloud browser and PostgreSQL evidence supersession for commit 29d28569

This section supersedes the earlier Cloud statements that every browser and database gate was blocked. Those attempts remain above as historical diagnostics. Overall status remains **Partial**; this is not a Notion-identical, pixel-perfect, or release-ready claim.

- An isolated loopback PostgreSQL 16.14 instance with ephemeral unprinted credentials passed check:postgres, check:api-auth, and check:backups, then was removed. This is disposable-database evidence, not production DB, PITR, dump, or deployed-service evidence.
- check and check:build passed. Latest verified build metrics are 1,318,622 to 921,298 bytes, Brotli 160,042, gzip 206,578.
- Node 22.23.1 plus temporary Sparticuz Chromium 149.0.7827.0, with graphics off and minimal launch arguments, passed an eight-context smoke 8/8 with zero disconnects, crashes, OOM events, or abnormal exits.
- resource-page-command-mentions passed 2/2 in 29.1 seconds, proving the scoped selector fix only under this Cloud headless-shell route.
- A fresh-browser-per-file campaign ran all then-discovered 174 tests in 29 files: 170 passed, 4 failed (historical pre-179 discovery), 0 skipped, 0 infrastructure failures, in 24m21s. No Target-closed, SIGKILL, crash, disconnect, or OOM occurred.
- The four campaign assertions were divider continuation focus, inline-toolbar viewport inset, 400-block performance, and visual-state settle evidence. The divider probe actually focused the generated continuation block; the toolbar was one headless pixel outside the bound, bottom 289 versus 288; performance measured 4,557 DOM nodes, property patch 874.9ms, scroll response 1690.5ms, max long task 299ms, total long tasks 1039ms, seven long tasks, and ready 1944ms; visual capture timed out with fonts loaded and animations still present.
- Prior local real-Chrome property and scroll values were about 23.6ms and 16.2ms. The headless-shell measurements must not relax product budgets or be called a product regression by themselves. A diagnostic rerun also produced nondeterministic headless timing around Backspace and visual settle.

This is not a clean 179/179 real-Chrome run. It does not prove CSP or cross-origin browser security, real mobile or soft-keyboard behavior, VoiceOver, TalkBack, NVDA, matched authenticated Notion visuals, pixel parity, production persistence, or deployed fallback behavior.
## 2026-07-12 latest-branch reconciliation

This reconciliation was written after inspecting the current code/test tree and the 2026-07-12 Cloud report set. It supersedes stale current-count wording while preserving older figures as historical diagnostics. Project status remains **Partial** for Phase A, **Partial** for Phase B, **Partial** for Phase C, and **Partial** overall. There is no Notion-identical, pixel-perfect, release-ready, or fully passing claim.

### Current discovery versus pass counts

- Current Playwright discovery is **179 tests in 30 spec files**. Discovery is inventory only and is not a pass count.
- The latest full Cloud postfix first-run evidence is **175/179 passing**, split as shard A **63/65**, shard B **66/66**, and shard C **46/48**. This was not a clean full run.
- Shard A first-run failures were a comment clipboard/mark-selection flake that passed rerun and a divider-continuation focus failure that repeated on rerun.
- Shard C first-run and rerun failures were limited to `resource-performance.spec.js` and `resource-visual-state-evidence.spec.js`.
- After the postfix full run, divider focus was fixed and verified separately: focused divider **10/10**, full editor matrix **15/15 twice**, page features **19/19**, and DOM stability **4/4**. A clean post-fix 179/179 rerun is still required after that final divider fix.
- Focused fixes already verified outside the full run remain scoped evidence only: toolbar/history/comment/page-feature batch **45/45**; comment history twice **6/6** each; Trash focused **10/10**, full Trash **6/6 twice**, and delete guard **3/3**.

### Current build evidence

- Historical build values such as `1,162,032 -> 815,222` and `1,299,160 -> 908,347` are retained only as historical checkpoints.
- Latest verified build evidence in the inspected Cloud reports is `npm run check:build` passing with `1,318,622 -> 921,298` bytes, Brotli `160,042`, gzip `206,578`.

### Unified history reconciliation

- Session-scoped app history now covers coalesced block text, title paste/edit, properties, icon, cover, page settings, structural block operations, comments, and multi-Resource moves.
- Native draft inputs intentionally retain browser undo.
- Session-scoped app history intentionally clears on reload.
- Page version history is distinct from undo/redo history and remains absent.

### Evidence report filenames

- [Postfix full shard A](resource-postfix-full-cloud-verification-2026-07-12-shard-a.md): 63/65 first-run; comment clipboard flake passed rerun; divider focus repeated on rerun.
- [Postfix full shard B](resource-postfix-full-cloud-verification-2026-07-12-shard-b.md): 66/66 first-run.
- [Postfix full shard C](resource-postfix-full-cloud-verification-2026-07-12-shard-c.md): 46/48 first-run, with performance and visual-evidence failures repeated on rerun.
- [Divider focus diagnosis](resource-divider-focus-cloud-diagnosis-2026-07-12.md): divider fix verified 10/10 focused, 15/15 twice, page features 19/19, DOM stability 4/4, and latest build metrics `1,318,622 -> 921,298` bytes.
- [Toolbar/history postfix verification](resource-toolbar-history-postfix-cloud-verification-2026-07-12.md): toolbar/history/comment/page-feature batch 45/45.
- [Comment/Trash postfix verification](resource-comment-trash-postfix-cloud-verification-2026-07-12.md): comment history twice 6/6, delete guard 3/3, and earlier Trash evidence with one unresolved Trash drag flake later superseded by the Trash drag diagnosis.
- [Trash drag flake diagnosis](resource-trash-drag-flake-cloud-diagnosis-2026-07-12.md): Trash focused 10/10, full Trash 6/6 twice, and delete guard 3/3 after the drag fix.

### Preserved open gaps

The following remain real gaps or unverified gates: performance failure, visual-evidence failure, full slash/media/file/PDF/table/block catalog, image/file/large-paste flow, columns, complete inline-link actions, matched authenticated Notion comparisons, real-device and screen-reader QA, entity-level Block/Comment persistence, tenant ACL/RBAC, page version history, and deployment-only verification. Historical successful focused results do not close these gates.
