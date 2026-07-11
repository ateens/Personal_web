# Resource / Notion parity final gap audit

Date: 2026-07-11 (Asia/Seoul)

Branch: `codex/resource-notion-parity-phase-a` at `0bb41c3`; merged to `main` at `665b237`

Audit point: tested source is partially deployed; the private signed-in Sites path and Railway DB-auth enforcement gate are not complete

## Result at a glance

- `[Verified]` Every functional P0 identified in the pre-change audit has an implementation and isolated automated coverage in the current branch: minimal Resource list/detail patching, IME-safe search/title editing, Resource v4 timestamps/revisions, durable local recovery, optimistic concurrency, keyboard-openable cards, parity/Advanced mode separation, Center/Side/Full shells, deep links, server/Worker/service-worker navigation fallback, strict state validation, semantic block structure, and client/server URL allowlists.
- `[Partially deployed]` Branch commit `0bb41c3` was merged by PR #1 to `main` at `665b237`. Railway auto-deployed the new server, migrated production state v3→v4 at revision 1, and has a manual predeploy backup. Sites version 8 was saved from `0bb41c3` and deployed owner-only/custom at <https://sygma-personal-web.ateens.chatgpt.site> with environment revision 1, `API_BEARER_TOKEN` installed, and `REQUIRE_AUTHENTICATED_PROXY=1`.
- `[Verified]` Anonymous Sites requests to `/`, `/api/state/status`, and `/health` return `401`, so the deployed Worker gate is active for anonymous traffic.
- `[Release-blocking]` Railway's DB policy is now `configured:true`, `enforced:false`, and direct anonymous `GET /api/state/status` still returns `200`. The actual owner path is `[Unverified]`: Chrome is stopped at “Continue with ChatGPT”, and performing that login action requires user confirmation. The runbook requires a signed-in private Sites `200` before DB enforcement can be enabled, so enforcement remains intentionally disabled.
- `[Verified]` Phase B's core is implemented: IndexedDB snapshot/operation stores, replay/retry/conflict behavior, truthful save states, Resource-level incremental writes, waiting service-worker update gating, migration snapshots, integrity-checked restore, and isolated database checks. Production v3→v4 migration revision 1 and the manual predeploy backup are also verified.
- `[Partial]` Phase A now covers the original/default Resource page layout and the existing editor feature set. It does not cover every current Notion block, custom database page layouts, column construction, full block action parity, unified history for every page-level operation, or real multi-user collaboration.
- `[Unverified]` Authenticated current Notion Side peek, Center peek, Full page, toolbar, menu, comment, and mobile reference captures were unavailable. The 27 viewport screenshots and four local state captures verify this product's geometry and states only; they are not a Notion pixel-diff baseline. No exact Notion pixel, shadow, radius, color, or motion claim is made.

## Reference surfaces and scope

The comparison keeps these surfaces separate:

1. authenticated database **Side peek**;
2. authenticated database **Center peek**;
3. authenticated **Full page**;
4. unauthenticated **Public Notion Site**.

The implemented opening policy is Library → Center, List → Side, and Map → Center by default, with Side/Center/Full selectable per Resource view. Map is treated as a product-specific view, not as a native Notion view. The implementation scope is the original/default Resource page layout; Notion's custom layout builder is P2.

The functional baseline comes from current official Notion documentation:

- database items are pages with properties and free page content: <https://www.notion.com/help/intro-to-databases>;
- Side peek, Center peek, Full page, opening defaults, database search, filters, and sorts: <https://www.notion.com/help/views-filters-and-sorts>;
- page fonts, small text, full width, icon, and cover behavior: <https://www.notion.com/help/customize-and-style-your-content>;
- keyboard and Markdown behavior: <https://www.notion.com/help/keyboard-shortcuts>;
- page discussions and inline comment threads: <https://www.notion.com/help/comments-mentions-and-reminders>;
- page links and backlinks: <https://www.notion.com/help/create-links-and-backlinks>;
- custom database page layouts, explicitly excluded from this checkpoint: <https://www.notion.com/help/layouts>.

Official documentation does not provide the authenticated editor's exact geometry or visual tokens. Those values remain reference-capture dependent.

## Final Gap Audit

Status meanings:

- `Resolved locally`: implementation and isolated test evidence exist in this branch.
- `Partial`: the implemented subset is usable and tested, but a named requested capability remains.
- `Release-blocking`: production must not be described as secure or complete until the gate passes.
- `Deferred P2`: deliberately outside the original/default Resource page scope.

| 우선순위 | 구성요소/상태 | 현재 구현 위치 | 현재 동작 | Notion 기준 동작 | 차이 | 수정/남은 조치 | 검증 방법/결과 | 직접 확인 여부 |
|---|---|---|---|---|---|---|---|---|
| P0 · Resolved locally | Resource 목록 최소 patch, focus/caret/IME | `app.js` `renderView({soft:true})`, `patchResourceView*`; `resource-baseline.spec.js`, `resource-p0.spec.js` | 검색 input, `#viewRoot`, Side database context를 유지하고 결과/control 단위만 patch한다. 필터·정렬·mode 변경도 열린 Side editor를 교체하지 않는다. | database control 입력과 열린 Side database 문맥이 연속 조작 가능해야 한다. | 로컬 기능 차이 없음. | 배포된 source revision과 테스트 evidence를 change record에 함께 보존한다. | final same-revision run에서 input node identity, focus, caret, composition, scroll 및 filter/sort/mode identity 검사가 통과했다. | 제품 `[Verified]`; Notion 픽셀 `[Unverified]` |
| P0 · Resolved locally | Detail/property/title DOM 안정성 | `app.js` `patchResourceDetail*`, `patchBlockEditorStructure`, `renderEditorMutation`; `resource-dom-stability.spec.js` | property, URL, parent, comment soft mutation은 활성 editor node와 selection을 보존한다. 제목은 composition-aware draft 후 해당 제목 표시만 patch한다. Advanced mode의 다른 editor도 유지된다. | active page editor와 다른 열린 page의 편집 문맥이 유지돼야 한다. | 브라우저 native undo를 포함한 모든 page-level change의 단일 history는 아직 아님. | P1 history 통합은 별도 transaction 설계로 진행한다. | editor identity/selection 및 two-window non-interference 2건 통과. | 제품 `[Verified]` |
| P0 · Resolved locally and deployed | Resource v4 model, timestamp, revision | `app.js` `normalizeResourceRecord`, `touchResource`; `server/storage.js`; `check-postgres-state.mjs` | `createdAt`, `updatedAt`, `revision`, `timestampSource`, page fields를 migration한다. mutation만 timestamp/revision을 올리고 open/scroll은 올리지 않으며 updated sort에 안정적 tie-break를 사용한다. Railway deployed the server and migrated production v3→v4 at revision 1. | page 생성/수정 metadata와 실제 최근 수정 정렬이 필요하다. | legacy timestamp는 migration 시각이며 과거 실제 수정 시각으로 주장하지 않는다. | migration source label과 production backup을 보존하고 post-auth state checks를 다시 실행한다. | mutation/non-mutation E2E, isolated PostgreSQL check, production migration status 확인. | local/deployment `[Verified]` |
| P0 · Resolved locally | Durable local state, offline queue, conflict, SW update | `app.js` IndexedDB snapshot/operation stores; `service-worker.js`; `resource-offline.spec.js` | online snapshot을 먼저 저장하고 offline edit, reload, replay, transient retry, stale conflict를 durable하게 처리한다. pending/conflict 중 SW reload를 막고 성공 뒤 적용한다. | reload/network loss/update 중 draft를 잃지 않고 실제 상태를 표시해야 한다. | real OS crash, Safari storage eviction, long-lived multi-device recovery는 수동/field 검증 전이다. | production-like browser soak와 storage-eviction policy를 후속 검증한다. | 6개 offline/retry/conflict/update E2E 통과. | Chromium `[Verified]`; field behavior `[Unverified]` |
| P0 · Resolved locally | Optimistic concurrency와 증분 저장 | `server.js` `/api/state`, `/api/resources/:id`; `server/storage.js`; `resource-revision-conflict.spec.js` | ETag/`If-Match`/`baseRevision`, optional `428`, stale `409`, explicit remote reload, Resource 단위 PUT을 제공한다. | stale writer가 최신 state를 조용히 덮어쓰지 않아야 한다. | Block/Comment가 독립 endpoint/table transaction인 완전 세분화 모델은 아님. | payload/query telemetry 후 필요한 entity endpoint를 P1/P2로 분리한다. | two-writer E2E와 isolated PostgreSQL stale-write/no-mutation checks 통과. | `[Verified]` |
| P0 · Resolved locally and checkpointed | Migration backup/restore | `server/storage.js`; `scripts/manage-state-backups.mjs`; `check-state-migration-backups.mjs`; backup runbook | automatic migration/read-heal 전에 full authoritative snapshot을 같은 transaction에 저장한다. Manual create/list/restore는 workspace scope, SHA-256, revision precondition, safety backup, monotonic revision, restore history를 사용한다. A manual production predeploy backup exists. | migration 실패와 operator error에서 복구 가능한 checkpoint가 필요하다. | 같은 PostgreSQL 안의 backup이므로 DB/account loss는 막지 못하고 retention/prune도 의도적으로 없다. | backup metadata를 change record에 보존하고 별도 encrypted PITR/dump를 운영한다. | `npm run check:backups` isolated v3→v4/create/list/restore/sentinel cleanup 및 production manual checkpoint 확인. | `[Verified]` |
| P0 · Release-blocking partial production | 공개 API 인증과 workspace boundary | `server.js`; `worker/index.js`; `configure-api-proxy-auth.mjs`; API auth runbook | Railway and Sites code are deployed. Sites version 8 has the proxy secret and `REQUIRE_AUTHENTICATED_PROXY=1`; anonymous `/`, `/api/state/status`, and `/health` return `401`. DB auth is `configured:true`, `enforced:false`, so direct Railway state status remains anonymous `200`. 현재 모델은 하나의 `APP_STATE_ID`를 공유하는 single-workspace gate다. | 외부 노출 state API는 authenticated boundary 뒤에 있어야 한다. | signed-in owner Sites `200` is not verified; Chrome is at “Continue with ChatGPT” and the login action needs user confirmation. Per-user/role/tenant authorization도 없다. | owner confirmation 후 signed-in Sites state read/write를 검증하고, 그 뒤에만 DB enforcement를 enable하여 direct Railway missing/wrong `401`와 private Sites `200`을 재검증한다. | local auth/Worker checks and anonymous Sites `401` `[Verified]`; owner path `[Unverified]`; direct Railway anon `200` `[Verified]`. | production activation `Blocked on owner sign-in confirmation` |
| P0 · Resolved locally | 서버 validation, URL/paste safety, abuse controls | `server.js`, `server/storage.js`, `app.js` `normalizeInlineHref`; `check-postgres-state.mjs` | nested v4 schema, duplicate IDs, mark ranges, relation integrity, type/indent/size/depth, URL protocol을 mutation 전에 검증한다. Client는 http/https/mailto/tel 및 안전한 relative link만 anchor로 만든다. Security headers, redacted errors/audit, route rate limits, write admission control을 제공한다. | hostile state/HTML/URL이 저장·실행되지 않고 API가 bounded해야 한다. | process-local limiter는 global DDoS/replica-wide quota가 아니다. HSTS는 HTTPS ingress 운영 확인과 함께 활성화해야 한다. | deployed headers, ingress trust, 429 behavior, log redaction을 production에서 다시 확인한다. | client link E2E, four server unsafe-scheme cases, source/Worker/PostgreSQL checks 통과. | local `[Verified]` |
| P0 · Resolved locally | 검색 scope, filter logic, Library keyboard/grouping/header | `app.js` Resource controls and view renderers; `resource-baseline.spec.js`, `resource-p0.spec.js` | Database와 Full-text scope를 표시하고 분리한다. active/archive base scope와 추가 predicates는 AND로 결합한다. Library card는 stable Resource anchor이며 pinned/read-later/other bucket이 exclusive하고 header count copy를 표시한다. | database search 범위와 advanced filter logic이 명시되고 cards가 keyboard-accessible해야 한다. | cached excerpt의 view별 formatting/todo-aware preview는 제한적이다. | preview policy/index telemetry를 P1로 개선한다. | scope/filter/sort/view, Enter/Space, duplicate-ID absence, header copy tests 통과. | `[Verified]` |
| P0 · Resolved locally | Parity mode, page shells, URL/history/fallback | `app.js` router/page shell; `server.js`; `worker/index.js`; `service-worker.js`; shell specs | parity 기본값에서는 Advanced window chrome을 만들지 않는다. Center modal, desktop nonmodal Side, Full page, resize, previous/next, expand, copy link, Back/Forward, direct reload, invalid/trashed route를 제공한다. 좁은 화면의 Side는 full-screen modal로 전환된다. | view별 Side/Center/Full 동작, database context, stable URL과 history가 필요하다. | authenticated Notion의 exact bounds/backdrop/transition 값은 비교하지 못했다. | 동일 content/locale/zoom의 authenticated reference capture가 제공되면 state별 pixel diff를 추가한다. | shell/history/focus tests와 27 viewport geometry captures 통과. | behavior `[Verified]`; pixel `[Unverified]` |
| P0 · Resolved locally | Semantic blocks와 기존 editor regression | `app.js` `renderBlock*`; editor matrix/transport specs | heading/blockquote/pre/code와 list/listitem semantics, named multiline textbox, stable block hooks를 제공한다. Markdown, split/merge, indent, shortcuts, selection, drag/copy/move, clipboard priority/sanitize, undo/redo, slash/mention/emoji/equation, Escape, title arrows, IME를 보존한다. | page editor의 keyboard/selection/clipboard 동작과 semantic structure가 함께 작동해야 한다. | 모든 Notion block type, column drag, image/file paste, URL paste choice, large-paste progress는 없다. | 아래 P1/P2 편집기 항목으로 추적한다. | 15 editor-matrix + 9 transport + semantic feature tests 통과. | existing scope `[Verified]` |
| P0 · Resolved locally | Read-only enforcement | `app.js` `resourceMutationAllowed`, `editorOwnerMutationAllowed`; `resource-readonly.spec.js` | title/block/property/parent/comment/settings/trash/media/paste/cut/drag/history mutation을 UI와 handler 양쪽에서 거부한다. navigation, comments read, URL Open/Copy는 유지한다. | permission state가 보이는 UI와 실제 mutation boundary에 일치해야 한다. | shared bearer model에는 Resource별 server-side ACL이 없다. `readOnly`는 page data policy다. | future multi-user scope에서 server authorization과 분리해 설계한다. | UI disable/hide와 forced-event no-write 2건 통과. | local single-workspace `[Verified]` |
| P1 · Partial | Properties, title, icon/cover, page menu | `app.js` Resource media/property/menu renderers; `resource-page-features.spec.js` | switch/checkbox booleans, URL Open/Copy/Edit/Clear, collapsed hidden/inert properties, wrapping single-line title, emoji icon, HTTPS cover/reposition/error/remove, Default/Serif/Mono, Small text, Full width, Move to trash를 제공한다. | property-specific controls와 page media/settings가 keyboard와 read-only state를 따라야 한다. | upload icon/cover, richer property popovers/order/hide policy, Lock/Customize/Duplicate/Move/Export/history menu가 없다. 기능 없는 항목은 표시하지 않는다. | storage/export/permission model이 준비된 항목만 추가한다. | property/title/menu/media persistence and safety tests 통과. | behavior `[Verified]`; Notion visual `[Unverified]` |
| P1 · Partial | Hierarchy, mentions, backlinks | `app.js` hierarchy helpers; page feature specs | `parentId`, `childOrder`, sub-page creation, parent picker, self/descendant cycle prevention, Resource mention-derived backlinks와 navigation을 제공한다. | page hierarchy, mentions, broken targets, backlinks가 실제 대상 관계여야 한다. | Project/Goal/Box/Task/Habit mention navigation과 broken-target UI, parent delete/move orphan policy가 완전하지 않다. | cross-entity router와 orphan/broken state policy를 설계한다. | sub-page/cycle/backlink E2E 통과. | Resource scope `[Verified]` |
| P1 · Partial | Page/inline comment threads | `app.js` comment thread model/pane; page feature specs | page discussion과 inline range thread, replies, resolve/reopen을 분리한다. 실제 identity가 없어 author를 만들지 않는다. read-only는 thread 열람만 허용한다. | page/inline threads와 replies/status가 분리돼야 한다. | delete lifecycle, anchor-loss/rebase, unread/read, author/permission/notification은 없다. | identity/authorization이 실제 범위가 될 때만 collaboration fields를 추가하고 anchor rebase를 별도 구현한다. | page + inline add/reply/resolve/reopen 및 no-fake-author E2E 통과. | single-user scope `[Verified]` |
| P1 · Partial | Trash와 복구 | `app.js` trashed page shell; page feature specs | `trashedAt`, normal-view exclusion, direct trash route, full-content restore, immediate Undo를 제공한다. | soft trash/restore와 orphan handling이 필요하다. | dedicated Trash view, permanent delete, server retention, mention/backlink orphan policy가 없다. | 운영 retention 합의 뒤 permanent delete와 Trash view를 추가한다. | trash/restore/Undo E2E 통과. | current subset `[Verified]` |
| P1 · Partial | Slash/block/format actions | `app.js` menu/selection toolbar renderers; matrix specs | slash/mention/emoji/equation menus는 stable IDs와 `aria-controls`, `aria-expanded`, `aria-activedescendant`를 연결하고 keyboard select/cancel을 지원한다. Existing formatting, range toolbar, drag, keyboard move를 유지한다. | menus는 실제 지원 action만 제공하고 selection을 잃지 않아야 한다. | simple table/media/file/PDF/bookmark/embed/block equation/breadcrumb/TOC, block Copy link/Move to/Comment의 완전한 action menu, recent/category UX, column engine은 없다. | schema/storage/render/export가 있는 action부터 단계적으로 추가한다. | menu/format/Escape/transport E2E 통과. | existing actions `[Verified]` |
| P1 · Partial | Unified undo/redo와 clipboard completeness | editor transaction/history and transport code | structural block split/merge/duplicate/move/paste/delete와 tested inline formatting은 DOM/state/save와 동기화된다. | text/title/property/icon/cover/comment를 포함한 예측 가능한 page history가 필요하다. | native text undo와 structural history가 완전히 하나가 아니며 title/property/icon/comment transaction은 통합되지 않았다. image/file paste, URL bookmark/embed choice, large-paste progress도 없다. | page-level transaction boundary와 binary upload model을 먼저 정의한다. | current structural/history/clipboard E2E 통과. | current subset `[Verified]` |
| P1 · Partial | Mobile, accessibility, real-device input | `styles.css`; shell/editor specs; viewport matrix | 320–390px full-screen page flow, safe-area/visualViewport-aware layout, bottom editing toolbar, 44px controls, modal/nonmodal semantics, focus trap/return, keyboard resize, reduced motion, forced-colors focus, menu active descendant를 제공한다. | touch/keyboard/screen-reader 사용자에게 동일 기능 경로가 필요하다. | real iOS/Android soft keyboard, touch drag/long press, VoiceOver/TalkBack, contrast measurement은 자동 Chromium geometry만으로 확인할 수 없다. | device lab/manual screen-reader checklist를 실행한다. | required desktop/mobile geometry and keyboard E2E `[Verified]`; device/manual `[Unverified]` |
| P1 · Partial | Performance와 code boundaries | `app.js`; `resource-performance.spec.js` | 400-block fixture가 4,556 shell DOM nodes, 294 ms ready, 18.7 ms property patch, 9.8 ms scroll response, zero observed long tasks로 local budgets를 통과했다. Minimal view/detail patch로 unrelated DOM churn을 줄였다. | long pages와 repeated edits가 responsive해야 한다. | single-file `app.js`와 non-virtualized 400-block DOM은 유지된다. These local headless numbers are not production RUM. | state/repository/router/editor modules and virtualization are P2 after selection/caret invariants; add field telemetry first. | one deterministic 400-block performance test passed. | local Chromium `[Verified]` |
| P0 · Partial production gate | Deployment, production migration, visual hand-off | commit `0bb41c3`, merge `665b237`, Sites version 8, runbooks, `.openai/hosting.json` | PR #1 is merged; Railway server, v4 migration, manual backup, and owner-only/custom Sites deployment are complete. Anonymous Sites gating is verified. | deployed candidate must match tested source and protect state before external use. | owner signed-in Sites behavior, DB enforcement, direct Railway `401`, and authenticated end-to-end state smoke tests remain. | obtain user confirmation for the ChatGPT login step, verify owner path `200`, then execute the remaining auth runbook gates. | source/deploy/anonymous checks `[Verified]`; owner path `[Unverified]`. | production `Partial` |
| P2 · Deferred | Custom database page layout builder | not implemented by scope | original/default Resource page layout only. | current Notion can configure heading pins, property groups, details panel, and Simple/Tabbed layouts. | entire builder/data model is outside Phase A. | separate product spec, migration, responsive and accessibility suite. | no decorative controls were added. | official behavior `[Verified]`; UI `[Unverified]` |
| P2 · Deferred | Additional blocks and columns | current block schema | existing paragraph/headings/lists/todo/toggle/quote/callout/divider/code set remains. | broader Notion slash catalog and column layout exist. | simple table, image/video/audio/file/PDF, bookmark/embed, equation block, breadcrumb, TOC, database/synced/button/AI blocks, columns are absent. | add only with schema, sanitize, persistence, paste/export and accessibility support. | current block set regression-locked. | current scope `[Verified]` |
| P2 · Deferred | Multi-user identity/roles/collaboration | single-workspace bearer model | authenticated proxy design gates one workspace but has no user authorization decisions. | true collaboration requires tenant/user/role/resource permission and attributed comments/presence/unread state. | per-user authorization and collaboration are absent by design. | confirm multi-user product scope before schema/UI; do not infer authorization from forwarded email alone. | auth self-test does not claim roles. | `[Verified]` absence |
| P2 · Deferred | Full modularization, virtualization, UUID migration | `app.js`, current schema | owner-scoped render/transaction helpers reduce churn without a framework rewrite. New IDs use collision-resistant generation where migrated paths support it; legacy IDs remain accepted under duplicate validation. | maintainable subsystem boundaries and long-document scaling are product engineering requirements, not visual parity alone. | monolith and unvirtualized document remain; a repo-wide legacy-ID migration is not complete. | extract store/repository/router/page/editor/selection/clipboard/a11y boundaries after behavior tests stay green. | source audit and 400-block test cover current risk. | `[Verified]` current state |
| P2 · Unverified | Authenticated Notion pixel parity and dark mode | local screenshot artifacts only | 27 required viewport/mode captures plus Center properties/comments/menu and mobile comments were produced. | exact bounds, typography, color, border, shadow and motion require authenticated same-state references. | no lawful authenticated reference session/captures; dark mode was not in the implemented scope. | capture the required 16 reference states with the same content/locale/zoom/viewport, then run measurable state-by-state diffs. | local geometry `[Verified]`; Notion comparison `[Unverified]` |

## Automated evidence snapshot

The final same-revision bundled-Chromium run used an isolated fixture and reported **83 passed in 2.8 minutes**. The fixture server exposes an explicit production-write guard; no production state mutation is part of the suite.

| Suite | Count | Covered behavior |
|---|---:|---|
| `resource-baseline.spec.js` | 8 | production guard, Library/List/Map, minimal control patch, existing blocks/marks, link safety |
| `resource-p0.spec.js` | 7 | timestamps, IME search, search scopes, keyboard cards, title patch, revision, parity mode |
| `resource-page-shell.spec.js` | 16 | opening modes, history/routes, focus/backdrop/Escape, reduced/forced colors, Side resize, readable background controls beside Side peek, mobile shell |
| `resource-page-features.spec.js` | 15 | semantics, properties/title/menu/media, trash, hierarchy/backlinks, comment threads |
| `resource-editor-matrix.spec.js` | 15 | Markdown, keyboard commands, split/merge/indent, menus, Escape, IME |
| `resource-editor-transport.spec.js` | 9 | block selection, clipboard, drag/copy/cancel, keyboard move, sanitize/paste |
| `resource-offline.spec.js` | 6 | IndexedDB snapshot, offline reload, replay, retry, conflict, SW update |
| `resource-dom-stability.spec.js` | 2 | editor identity/selection and Advanced-window isolation |
| `resource-readonly.spec.js` | 2 | visible permission state and forced-handler no-write boundary |
| revision / performance / viewport | 3 | stale writer conflict, 400-block budgets, 27 geometry captures |

Recorded non-browser checks:

- `npm run check`: passed syntax, source audit, and Sites Worker checks.
- `npm run check:build`: passed; authoritative final bundle result `1,112,382 → 779,823` bytes, Brotli `136,347`, gzip `173,007`.
- The build copies `assets/sygma-social-preview.png`; `index.html` exposes it through Open Graph and Twitter image metadata.
- `npm run check:postgres`: passed on isolated workspace `check-33b0d96e4b4d`, including strict v4 validation, preconditions, stale conflicts, incremental Resource writes, reconstruction, migration/read-heal, unsafe URL cases, and cleanup.
- `npm run check:backups`: passed on isolated workspace `migration-backup-check-83a74611bc7186b0`.
- `npm run check:api-auth`: passed the isolated DB policy and configuration self-test.

The complete browser run and build checks were executed against the final documented source revision.

## Viewport and visual evidence

`tests/e2e/resource-viewport-matrix.spec.js` exercises Center, Side, and Full at:

- 1440 × 1000
- 1280 × 900
- 1024 × 768
- 900 × 760
- 768 × 720
- 390 × 844
- 375 × 812
- 360 × 800
- 320 × 720

All 27 states stayed within the viewport and within the test's one-pixel horizontal-overflow tolerance. Narrow Side mode intentionally becomes a full-screen modal page. Additional local captures cover Center properties, Center comments, Center page menu, and mobile comments. These are product screenshots, not authenticated Notion comparisons.

## Deployment and rollback gates

Do not enable database enforcement before the private Sites owner path has the matching secret and is proven to work.

Completed and verified:

1. Final checks passed for source commit `0bb41c3`; PR #1 merged it to `main` at `665b237`.
2. A production manual predeploy backup was created.
3. Railway auto-deployed the new server and migrated production state v3→v4 at revision 1.
4. The proxy credential is staged in the DB policy as `configured:true`, `enforced:false`.
5. Sites version 8 was saved from `0bb41c3` and deployed owner-only/custom with environment revision 1, `API_BEARER_TOKEN`, and `REQUIRE_AUTHENTICATED_PROXY=1`.
6. Anonymous Sites `/`, `/api/state/status`, and `/health` return `401`.

Blocked and remaining:

1. Chrome is at “Continue with ChatGPT”. That login action requires user confirmation, so the owner session has not been completed or claimed as working.
2. After confirmation, verify the signed-in owner receives `200` from Sites `/api/state/status` and that an authenticated conditional state read/write succeeds while DB enforcement is still off.
3. Only then enable the DB-backed policy, wait for cache refresh, and verify direct Railway missing/wrong credentials return `401` while the signed-in Sites path remains `200`.
4. Record the completed auth fingerprint, backup metadata, workspace revision, and smoke-test results without recording secrets or state. Separately confirm PostgreSQL PITR/dump coverage.

For code/data rollback, stop or drain writes, deploy the matching code version, and restore only with exact workspace confirmation plus the current revision. Restore creates a safety backup and writes the restored content at `current revision + 1`. For authentication rollback, prefer the verified fail-closed environment override; do not remove the DB credential as the first response. The detailed procedures and limitations are in `resource-state-migration-backup-runbook-2026-07-11.md` and `resource-api-auth-runbook-2026-07-11.md`.

## Completion statement

This branch has a verified partial production rollout, not a completed production authentication rollout and not a claim of visual identity with Notion. The remaining P0 is owner sign-in verification followed by DB-auth enforcement and direct/private path checks. Authenticated Notion screenshot comparison, real mobile soft-keyboard/screen-reader QA, and the listed P1/P2 product capabilities remain explicitly open.
