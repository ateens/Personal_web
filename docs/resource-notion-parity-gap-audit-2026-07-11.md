# Resource / Notion parity gap audit

> Historical gap audit. Sites deployment and anonymous-access statements below describe the pre-2026-07-16 architecture. See `railway-access-runbook.md` for current operations.

Date: 2026-07-11 (Asia/Seoul)
Phase: pre-implementation audit for Phase A/B/C
Branch: `codex/resource-notion-parity-phase-a`

## Scope and evidence rules

This audit separates four reference surfaces instead of treating them as one UI:

1. Authenticated Notion database **Side peek**
2. Authenticated Notion database **Center peek**
3. Authenticated Notion **Full page**
4. Unauthenticated **Public Notion Site**

The default product policy for this implementation is:

- `Library` (gallery-like cards): Center peek
- `List`: Side peek
- `Map`: explicit per-view `Open pages in` setting; it is not described as a native Notion database view
- Every Resource view: Side peek / Center peek / Full page setting
- `notionParityMode=true`, `advancedWindowMode=false` after migration
- Existing floating, left dock, right dock, multi-window, and split behavior remains available only behind Advanced window mode
- Phase A implements the original/default Resource page layout. Notion's custom layout builder (pinned heading properties, modules, details panel, Simple/Tabbed structures) is P2 and will not be represented by decorative controls.

Evidence labels:

- `[Verified]`: confirmed in current source, a read-only live browser run, a live HTTP response, or current official Notion documentation.
- `[Inference]`: a reasoned consequence of verified implementation details that still needs a behavior test.
- `[Unverified]`: needs an authenticated current Notion capture, a user-provided capture, a destructive test fixture, or a capability that was not available.

No pixel, shadow, radius, color, or animation value in this audit is claimed to be a Notion value. The in-app browser had no authenticated Notion session, and Chrome reference navigation did not complete reliably. Therefore visual tuning is blocked on the required authenticated reference captures; structural and behavior work can proceed.

## Baseline

- `[Verified]` All previously reported missing files exist and are tracked: `styles.css`, `manifest.json`, `icons/app-icon.svg`, and `server/storage.js`.
- `[Verified]` The worktree was clean at audit start; `main` matched `origin/main` at `6995cae4f100`.
- `[Verified]` Node `22.16.0`, npm `10.9.2`, and `npx` are available.
- `[Verified]` `npm run check` passes (syntax checks, 161 source/static invariants, mocked Sites Worker check).
- `[Verified]` the existing build verifier passes: `910,813 -> 633,463` bytes; Brotli `112,894`, gzip `141,531`.
- `[Verified]` no committed Playwright/Vitest/Jest/Cypress E2E or visual regression suite exists.
- `[Verified]` local `http://127.0.0.1:4180/health` and Railway `/health` report PostgreSQL healthy.
- `[Verified]` production surfaces are public: `https://sygma-personal-web.ateens.chatgpt.site` and `https://personalweb-production-81a6.up.railway.app`.
- `[Verified]` anonymous `GET /api/state` returns the full state from both public surfaces. Mutating production requests were not executed.
- `[Verified]` baseline screenshots were captured at a 1440 x 1000 viewport in `output/playwright/resource-library-baseline-1440.png` and `output/playwright/resource-note-baseline-center-1440.png`.

## Verified Notion behavior baseline

Current official Notion documentation states:

- A database is a collection of pages; each database item is independently editable page content with properties and free blocks: <https://www.notion.com/help/intro-to-databases>.
- Each view can choose Side peek, Center peek, or Full page. Table/Board/List/Timeline default to Side peek; Gallery/Calendar default to Center peek: <https://www.notion.com/help/views-filters-and-sorts>.
- Side peek leaves the database interactive on the left; Center peek is a focused center modal: <https://www.notion.com/help/views-filters-and-sorts>.
- Database view search matches page titles and properties; advanced filters support explicit AND/OR groups: <https://www.notion.com/help/views-filters-and-sorts>.
- Database pages expose properties followed by free page space; page customization can include comments and backlinks: <https://www.notion.com/help/intro-to-databases>.
- Keyboard/Markdown behavior includes split/new block, soft line break, inline formatting, indentation, block selection, duplication, move, comments, mentions, slash commands, and previous/next database page shortcuts: <https://www.notion.com/help/keyboard-shortcuts>.
- Top-level discussions, inline comment threads, resolve/re-open, replies, and a comments pane are distinct capabilities: <https://www.notion.com/help/comments-mentions-and-reminders>.
- Every block has an anchor link, and page mentions automatically create backlinks: <https://www.notion.com/help/create-links-and-backlinks>.
- The page menu exposes Default/Serif/Mono, Small text, and Full width; database custom layouts can add heading pins, property groups, a details panel, and Simple/Tabbed structures: <https://www.notion.com/help/customize-and-style-your-content> and <https://www.notion.com/help/layouts>.

## Gap Audit

| 우선순위 | 구성요소/상태 | 현재 구현 위치 | 현재 동작 | Notion 기준 동작 | 차이 | 수정 방법 | 검증 방법 | 직접 확인 여부 |
|---|---|---|---|---|---|---|---|---|
| P0 | Resource 검색 focus/caret/IME | `app.js:6309-6321`, `1878-1891`, `1026-1051` | `[Verified]` 매 `input`이 `renderView()`를 호출하고 `#viewRoot.innerHTML`을 교체한다. composition handler는 block content만 처리한다. | `[Verified]` 검색 입력은 연속 입력 가능한 database control이며 database search는 title/property 범위다. | `[Inference]` focus/caret/composition/scroll/hover가 글자마다 유실될 수 있다. | 검색 control은 유지하고 결과/count/stats만 patch한다. 검색 input용 composition state와 debounce를 추가한다. | Playwright에서 input node identity, activeElement, selectionStart/End, 한글 composition, Escape/clear, scroll을 검사한다. | 코드 `[Verified]`, 최종 동작 미검증 |
| P0 | Detail/property 전체 재렌더 | `app.js:3988-4029`, `6388-6408` | `[Verified]` property 변경이 `renderView()`와 `renderDetail()`을 호출하고 모든 열린 note DOM을 교체한다. 복원하는 것은 scroll뿐이다. | `[Verified]` 활성 페이지 편집 문맥과 Side peek의 왼쪽 database 문맥은 계속 조작 가능해야 한다. | focus, selection, IME, native undo, popover anchor, 다른 note DOM이 끊긴다. | page shell/property row/block owner 단위 patch로 분리하고 활성 `.block-editor` 노드를 유지한다. | Advanced mode에서 두 note를 열고 A property 변경 중 B selection/composition/node identity를 검사한다. | 코드 `[Verified]` |
| P0 | 남은 editor 전역 재렌더 | `app.js:6794-6807`, `7679-7730`, `8477-8644`, `9468-9510` | `[Verified]` owner-scoped helper가 있으나 undo/delete/replace/duplicate/paste 경로 일부가 전역 detail/view render를 호출한다. | `[Verified]` block transaction은 현재 page의 필요한 범위만 갱신해야 한다. | 배경 animation과 unrelated editor 상태 회귀 가능성이 남는다. | 모든 editor command를 단일 transaction/owner renderer로 라우팅하고 affected block range만 patch한다. | 각 structural command마다 `#viewRoot` mutation count=0, unrelated editor identity 유지. | 코드 `[Verified]` |
| P0 | Resource 제목 입력 | `app.js:4070`, `6323-6330` | `[Verified]` 매 input에 save 후 전체 목록을 다시 렌더한다. title IME guard가 없다. | `[Verified]` title은 page heading이며 Enter/Arrow navigation, IME, undo가 안정적이어야 한다. | 목록 scroll/hover/selection/animation과 한글 조합이 초기화될 수 있다. | local draft + composition-aware debounce + 해당 card/row/map/title만 patch한다. | compositionstart/end, node identity, list scroll, visible list title 동기화를 검사한다. | 코드 `[Verified]` |
| P0 | Resource timestamp/revision | `app.js:2399-2404`, `12220-12241`, `17109-17148`, `17281-17294`; `server/storage.js:189-205`, `647-665`, `795-813`, `879-903` | `[Verified]` sort는 timestamp를 기대하지만 생성/정규화/DB read-write에 Resource timestamp와 revision이 일관되게 없다. root state 시간만 바뀐다. | `[Verified]` page 생성/편집 시각과 안정적인 last edited 정렬이 필요하다. | 최근 수정이 실질적으로 title fallback이고 DB row 시간은 전체 rewrite마다 churn한다. | versioned migration으로 `createdAt`, `updatedAt`, `revision`, `timestampSource`를 추가하고 Resource transaction에서만 갱신한다. | title/property/block/comment/icon/cover는 갱신, open/scroll/hover는 미갱신, tie-break ID를 검사한다. | 코드/DB `[Verified]` |
| P0 | Durable draft와 저장 상태 | `app.js:17095-17107`, `16796-16901`, `17281-17300` | `[Verified]` localStorage는 legacy read/delete뿐이며 disconnected edit는 memory에만 남는다. UI 상태는 DB 화면에만 제한된다. | 제품 동작상 reload/offline/update 후 draft recovery와 truthful status가 필요하다. | crash/reload/tab close/SW reload에서 유실 가능, pending queue와 Conflict가 없다. | IndexedDB snapshot + durable operation queue + acknowledged revision을 구현하고 Saving/Saved/Offline/Retrying/Conflict를 공통 shell에 표시한다. | offline edit/reload/crash/reconnect/4xx/5xx/duplicate replay를 자동화한다. | 코드 `[Verified]`, 복구 미검증 |
| P0 | Whole-state last-write-wins | `app.js:16737-16760`, `16796-16877`; `server.js:295-319`; `server/storage.js:392-423`, `795-813` | `[Verified]` 전체 JSON을 무조건 덮어쓰며 timestamp 휴리스틱만 사용한다. DB transaction은 atomic이지만 revision 조건이 없다. | 동시 tab/device edit는 base revision 검사와 명시적 conflict가 필요하다. | stale writer가 전체 상태를 조용히 덮어쓴다. | workspace/resource revision과 `If-Match`/`baseRevision`, 409 payload, merge/conflict UI, 증분 endpoint를 도입한다. | 두 client 동시 쓰기에서 stale writer 409 및 silent overwrite 없음. | 코드/HTTP `[Verified]` |
| P0 | 공개 API 인증/tenant | `server.js:44-47`, `295-319`, `376-468`; `server/storage.js:441-504` | `[Verified]` `APP_STATE_ID=default` 하나이고 state/Google route에 인증·권한·tenant 분리가 없다. 공개 배포의 anonymous state read가 200이다. | 협업/공개 서비스는 user/workspace별 인증·권한이 필요하다. | 개인 데이터 전체 read/write와 Google action이 외부에 노출될 수 있다. | 먼저 anonymous access를 fail closed하고, authenticated session에서 server-derived user/workspace key와 CSRF/rate/audit를 적용한다. | anonymous 401, cross-tenant 403, owner success, IDOR, Google route 권한을 검사한다. | 코드/production HTTP `[Verified]` |
| P0 | 서버 state validation | `server.js:173-192`, `305-319`; `server/storage.js:1151-1237` | `[Verified]` state가 object인지와 10 MB 한도만 확인하고 nested block/mark/ID/relation/URL을 엄격히 검증하지 않는다. `{state:{}}`는 destructive sync가 가능하다. | 저장 boundary에서 schema/size/depth/type/relation을 거부해야 한다. | malformed/hostile payload가 데이터 삭제·깨진 관계·unsafe URL을 만들 수 있다. | transaction 전 strict schema validator와 deterministic 4xx를 추가한다. | duplicate ID, invalid block/mark/indent/relation/protocol/oversize가 DB 변경 없이 실패하는지 검사한다. | 코드 `[Verified]` |
| P0 | Library keyboard open | `app.js:3052-3066`, `6091-6098` | `[Verified]` Library는 unfocusable `<article>`이고 pointer click delegation으로만 열린다. List/Map은 button이다. | page/card는 keyboard로 열리고 accessible name과 deep link를 제공해야 한다. | Enter/Space/focus-visible/open semantics가 없다. | card 안에 고유 href의 `<a>` 또는 open button을 두고 nested action과 분리한다. | keyboard-only Enter/Space, tab order, focus-visible, accessible name. | 코드/브라우저 `[Verified]` |
| P0 | Parity/Advanced 정책 | `app.js:503-525`, `4050-4126`, `6754-7259`, `17151-17163` | `[Verified]` 여러 note, floating, 양쪽 dock, split, drag/resize chrome이 항상 기본 DOM에 렌더되며 feature flag가 없다. | `[Verified]` database view는 Side/Center/Full page 중 하나를 선택한다. | Advanced window chrome이 parity 기본 UI와 섞여 있다. | migration defaults와 view별 `openPagesIn`을 추가하고 parity DOM에서는 Advanced chrome을 생성하지 않는다. | parity DOM에 floating/split control 0개; Advanced regression은 기존 기능 유지. | 코드/공식 문서 `[Verified]` |
| P0 | Center/Side/Full page shell | `app.js:4050-4087`; `styles.css:6208-6505` | `[Verified]` generic section + 동일 label이며 center는 full-height sheet, side는 generic dock이다. backdrop/dialog/prev-next/full expand/breadcrumb/focus trap/return이 없다. | `[Verified]` Side는 왼쪽 database가 interactive, Center는 focused modal, Full page는 direct page다. | 독립 page entity/state machine이 없다. | page shell/peek controller를 만들고 center modal, right nonmodal side panel, full-page route, unique title IDs, toolbar, prev/next를 구현한다. | focus/Escape/backdrop/Back 우선순위, resize, same-peek item switch, full expand. | 구조 `[Verified]`, pixel `[Unverified]` |
| P0 | Router/history/deep link | `app.js:711-720`, `6754-6785`; `server.js:476-599`; `service-worker.js:40-60` | `[Verified]` Resource open/close는 history/URL을 바꾸지 않는다. `/resources/:id`는 local 403, Railway 404, Sites는 `/`로 redirect한다. | Peek와 Full page 모두 stable URL/Back/Forward/reload가 필요하다. | direct URL과 offline reload가 실패하며 context가 복원되지 않는다. | router state + server GET/HEAD SPA fallback + SW navigation fallback + invalid/trashed state를 한 checkpoint로 구현한다. | valid/invalid ID, direct/reload/hard reload/offline, Back/Forward, new tab. | 코드/live HTTP `[Verified]` |
| P0 | 검색 scope | `app.js:1411-1422`, `1762-1768`, `2254-2275` | `[Verified]` 단일 입력이 title/type/importance/relation/body를 모두 결합한다. | `[Verified]` Notion database search는 title/property를 검색한다. | 제품 full-text search와 database search가 은밀히 혼합됐다. | `database`/`fullText` scope, placeholder, scope indicator, result explanation을 추가하고 excerpt/search cache를 둔다. | 각 scope가 filter/sort와 결합될 때 대상 필드를 fixture로 검증한다. | 코드/공식 문서 `[Verified]` |
| P0 | Resource filter 논리 | `app.js:32-53`, `2319-2336`, `1947-2007` | `[Verified]` 다중 Resource filter는 OR이며 기본 active는 nonarchived 전부를 포함한다. | `[Verified]` advanced filters는 명시적 AND/OR group을 제공한다. | pinned/important/readLater 추가가 결과를 거의 좁히지 않는다. | base active scope와 user predicate를 분리하거나 explicit AND/OR group을 구현한다. | active+pinned, archived+linked, search+filter+sort 조합. | 코드/공식 문서 `[Verified]` |
| P0 | Semantic block DOM | `app.js:4222-4332` | `[Verified]` divider 외 heading/list/quote/code가 모두 generic div + contenteditable div다. accessible name/multiline/heading/list 의미가 없다. | `[Verified]` 콘텐츠는 heading/list/quote/code block으로 동작한다. | 보조기술 semantics와 block selection announcement가 없다. | stable data hooks를 보존하면서 semantic elements 또는 동등 role/level, textbox name/multiline을 추가한다. | caret/selection/clipboard regression + accessibility snapshot. | 코드/브라우저 `[Verified]` |
| P0 | URL protocol safety | `app.js:4460-4469`, `4687-4694`, `15801-15821` | `[Verified]` manual link normalizer가 모르는 protocol을 그대로 반환한다. | 외부 link는 안전한 protocol만 허용해야 한다. | `javascript:` 계열이 anchor href로 들어갈 수 있다. | client/server 공통 `http`, `https`, 필요 시 `mailto`, `tel` allowlist와 import/paste/embed sanitization. | encoded/mixed-case malicious protocol rejection. | 코드 `[Verified]` |
| P1 | Library 중복/preview/header copy | `app.js:1411-1422`, `1711-1720`, `2115-2123`, `2499-2512`, `3052-3066` | `[Verified]` pinned/readLater가 전체에도 중복되고 `normal` bucket은 unused다. header copy 인자는 렌더되지 않는다. preview는 모든 block text 112자 flatten이다. | view별 card property/preview 정책과 명확한 grouping이 필요하다. | 중복 의미가 불명확하고 context/성능이 손실된다. | exclusive/overlap 정책을 표시하고 header copy를 렌더하며 cached structured excerpt를 추가한다. | bucket counts, duplicate IDs, long document render cost, todo/format preview. | 코드/브라우저 `[Verified]` |
| P1 | Properties UI | `app.js:4129-4210`; 브라우저 accessibility snapshot | `[Verified]` Boolean은 예/아니오 select, URL은 일반 textbox, raw type이 일부 list/map/card에 노출된다. collapse는 CSS grid/opacity이고 내부 control이 snapshot에 남는다. | property-specific control, URL actions, display labels, hidden focus order, keyboard popover가 필요하다. | Notion-like property behavior와 접근성이 부족하다. | checkbox/switch, URL Open/Copy/Edit/Clear, 공통 label map, hidden/inert, keyboard relation popover를 구현한다. | keyboard-only property edit, focus return, collapsed tab order. | 코드/브라우저 `[Verified]` |
| P1 | Icon/cover/title/page menu | Resource model과 `renderResourceNote()` | `[Verified]` icon/cover/read-only/page menu/font/small/full width/customize/trash가 없다. | `[Verified]` page styling/menu와 icon/cover는 page-level capability다. | page entity가 title/properties/blocks form에 머물러 있다. | 실제 지원 범위만 구현하고 unsupported share/AI/collaboration을 숨긴다. | broken image/upload/read-only/empty title/IME/undo/menu action. | 기능 `[Verified]`, visual `[Unverified]` |
| P1 | Slash/block/format menus | `app.js:4990-5365`, `16342-16653` | `[Verified]` menus와 keyboard/clamp 기반이 있으나 categories/recent, active-descendant wiring, Move/link-to-block/consolidated actions가 부족하다. | `[Verified]` slash menu와 block menu는 search/keyboard/action을 제공한다. | 일부 동작은 여러 menu에 분산되고 accessibility relationship이 없다. | 기능이 실제 존재하는 항목만 category/recent/option ID/aria-controls/activedescendant와 함께 재구성한다. | open/search/scroll/select/cancel/composition/collision. | 코드 `[Verified]` |
| P1 | Floating text toolbar | `app.js:5030-5065`, `11758-11786` | `[Verified]` 주요 formatting/link/comment는 있으나 위쪽 clamp만 있고 below flip, inline color/background/equation button state가 불완전하다. | selection rect, flip, link lifecycle, comment/color/equation, shortcut state sync가 필요하다. | collision과 selection preservation 범위가 좁다. | collision-aware placement와 range mark transaction을 구현한다. | viewport edge, toolbar click selection persistence, shortcuts/button state. | 코드 `[Verified]` |
| P1 | Selection/drag/clipboard/undo | `app.js:7268-9510`, `8416-8511`, `11559-11576` | `[Verified]` multi-select/marquee/tree drag/Alt copy/custom clipboard/structural history가 이미 존재하지만 text native undo와 분리돼 있다. column drag와 keyboard move 대체가 불완전하다. | `[Verified]` block selection/move/duplicate/undo가 일관돼야 한다. | transaction boundary와 page metadata history가 통합되지 않았다. | 중앙 transaction log로 text/title/property/block/icon/comment를 묶고 keyboard move/column을 별도 gate로 구현한다. | prompt의 전체 keyboard/Markdown/drag/paste matrix. | 기존 기반 `[Verified]`, 통합 미검증 |
| P1 | Sub-page hierarchy/mentions/backlinks | `app.js:159-166`, `5317-5338`, `5622-5627`, `15413-15441` | `[Verified]` create-page/subpage가 top-level Resource를 만들고 non-Resource mention click navigation도 완전하지 않다. `parentId`/backlink index가 없다. | `[Verified]` page/subpage와 mentions/backlinks는 실제 target 관계다. | 계층, child order, cycle/broken target/backlink가 없다. | parent/context/order model, cycle guard, router target, derived backlink index와 broken state를 추가한다. | create/move/delete parent, cycle rejection, renamed/deleted target, backlink navigation. | 코드 `[Verified]` |
| P1 | Comments | `app.js:4468-4470`, `5058-5065`, `15707-15895` | `[Verified]` inline mark에 commentId/body 하나만 저장한다. | `[Verified]` page discussion, inline thread, replies, open/resolved, pane가 구분된다. | author/reply/status/deleted/read model이 없다. | single-user 범위에서는 author를 꾸며내지 않고 thread/reply/status model과 page discussion/pane을 구현한다. | add/reply/resolve/reopen/delete/anchor loss, no fake collaborator. | 코드/공식 문서 `[Verified]` |
| P1 | Trash/recovery | `app.js:13309-13358` | `[Verified]` 삭제는 array splice에 가깝다. | soft trash, restore, undo, retention 정책이 필요하다. | `trashedAt`, restore, permanent delete, orphan policy가 없다. | soft-delete + undo toast + trash view + explicit permanent delete/retention. | delete/undo/restore/permanent delete/mention-backlink orphan. | 코드 `[Verified]` |
| P1 | Responsive/mobile | `styles.css:8313-8593` | `[Verified]` 840px 이하에서 모든 mode가 12px inset sheet가 되고 touch control은 focus/selection 때만 보인다. visualViewport/safe-area/mobile toolbar가 없다. | mobile page flow, soft keyboard, touch alternatives가 필요하다. | full-screen mobile editor와 reliable touch workflow가 없다. | mobile full-page route, persistent editing toolbar, safe area/visualViewport/long press/touch drag를 추가한다. | 390/375/360/320 및 1440/1280/1024/900/768 matrix. | 코드 `[Verified]`, device behavior 미검증 |
| P1 | Accessibility state machine | `app.js:755-758`, `974-979`, `4050-4087`, `11430-11542` | `[Verified]` whole `#viewRoot`가 live region이고 active nav는 aria-current가 없으며 resize는 pointer-only/aria-hidden이다. Escape가 note close까지 이어지지 않는다. | modal/nonmodal semantics, focus trap/return, scoped announcements, Escape priority가 필요하다. | keyboard/screen reader path가 불완전하다. | explicit overlay stack, unique dialog labels, focus management, scoped status, keyboard resize, reduced-motion/forced-colors를 추가한다. | keyboard-only E2E + 주요 screen reader 수동 checklist. | 코드/브라우저 `[Verified]` |
| P1 | PWA offline/update | `service-worker.js:1-61`, `app.js:686-696`, `scripts/build.mjs:21-29` | `[Verified]` source precache에 index가 없고 addAll은 all-or-nothing, skipWaiting/claim 후 controllerchange 즉시 reload한다. API는 제외한다. | shell navigation fallback과 data queue를 분리하고 pending save 중 update를 연기해야 한다. | offline deep route 실패와 unsaved reload 위험이 있다. | manifest-driven assets, navigation fallback, waiting-update UI, durable queue ack 후 activate. | missing asset install, offline reload, pending/conflict 중 update. | 코드 `[Verified]` |
| P1 | Security headers/rate/error/audit | `server.js:130-142`, `305-319`, `469-470`, `521-570` | `[Verified]` nosniff 외 CSP/frame-ancestors/Referrer/HSTS/rate/audit/redacted error가 부족하다. | public app은 layered headers, limits, stable error codes, audit가 필요하다. | clickjacking/resource exhaustion/error leak/action accountability 위험. | centralized headers, per-route rate/size/concurrency, redacted logs/audit, HTTPS 확인 후 HSTS. | root/deep/API/error header tests, 429/load/error redaction. | 코드/live headers `[Verified]` |
| P1 | Incremental persistence/backups | `server/storage.js:392-423`, `795-813` | `[Verified]` 모든 save가 collection rows delete/reinsert와 JSON blob overwrite다. 독립 history/backup/rollback migration table이 없다. | small edit는 incremental이어야 하고 migration/restore가 검증돼야 한다. | O(total state)와 timestamp churn, rollback 불가. | Resource/Block/Comment upsert API, migration history, pre-migration snapshot, retention/restore runbook. | payload/query count, separate DB restore, forward/backward migration. | 코드 `[Verified]` |
| P2 | 최신 custom layout builder | 현재 없음 | `[Verified]` original Resource page만 있다. | `[Verified]` Notion은 Heading pins, property group, details panel, Simple/Tabbed layouts를 지원한다. | Phase A 기본 범위를 넘어선다. | Phase A에서는 제외하고 기능 없는 control을 만들지 않는다. 별도 data model/UX spec 후 구현한다. | 별도 P2 acceptance suite. | 공식 문서 `[Verified]`, 화면 `[Unverified]` |
| P2 | 추가 block/media/column | `app.js:76-127` | `[Verified]` 현재 schema는 기존 12 type 중심이고 simple table/media/file/bookmark/embed/block equation/breadcrumb/TOC/columns가 없다. | `[Verified]` slash menu에 다양한 block이 존재한다. | menu에 가짜 항목을 넣을 수 없다. | storage/schema/render/paste/export가 준비된 type만 단계별 추가한다. | type별 create/edit/paste/reload/export/accessibility. | 코드/공식 문서 `[Verified]` |
| P2 | 코드 경계/ID/side effect | `app.js` 18,331 lines; `app.js:4346-4357`, `17514-17516` | `[Verified]` monolith, render 중 normalization/save, Math.random+time ID다. | 제품 안정성을 위해 state/repository/router/page/editor/selection/clipboard/accessibility 경계가 필요하다. | 회귀 위험과 ID 충돌/암묵 mutation이 있다. | P0 안정화 후 모듈 경계, explicit migration, `crypto.randomUUID()` fallback/duplicate validation을 도입한다. | source audit, migration fixture, duplicate ID rejection, behavior regression. | 코드 `[Verified]` |
| P2 | Visual pixel parity | `styles.css:6208-6908`; baseline screenshots | `[Verified]` extensive current styling은 있으나 로그인된 current Notion capture가 없다. | exact values는 동일 viewport/current authenticated capture에서 측정해야 한다. | 공식 문서는 pixel spec을 제공하지 않는다. | 필요한 16개 상태 캡처를 받은 뒤 bounds/baseline/font/border/shadow/state/transition을 측정한다. | 동일 content/locale/zoom/viewport screenshot diff. | `[Unverified]` |

## Existing behavior that must be regression-locked

- Library / List / Map Resource views (`app.js:2083-2189`)
- Current full-text title/type/importance/relation/body search, renamed as Full-text search (`app.js:2254-2275`)
- Resource filters, sort choices, removable chips, reset, closed-panel inert handling (`app.js:1723-2017`)
- Current Advanced window engine: multi-note/z-order/center/floating/left/right/split/drag/resize (`app.js:4050-4126`, `6754-7259`; `styles.css:6208-6505`)
- Current block types and Markdown triggers (`app.js:76-127`, `246-259`)
- Inline marks, links, comments, mentions, equation, emoji (`app.js:208-245`, `4438-4478`, `5105-5339`)
- Block IME handling (`app.js:6500-6553`)
- Enter/Shift+Enter, boundary merge, Tab/Shift+Tab, arrow navigation (`app.js:14361-15112`, `16107-16151`)
- Single/multiple/marquee block selection and keyboard selection (`app.js:7796-8414`, `11437-11515`)
- Tree-aware drag, Alt-drag copy, insertion target, cancel, auto-scroll (`app.js:7268-7485`, `7994-8085`)
- Custom MIME/HTML/plain clipboard parsing with regenerated IDs (`app.js:8694-9510`)
- Structural undo/redo baseline (`app.js:8416-8511`)
- Slash/mention/emoji/equation menu keyboard handling and viewport clamping (`app.js:16342-16653`)
- Existing toggle group animation, editor-only mutation shield, and overlay z-index behavior that were previously browser-verified; they must be re-verified from the current branch rather than trusted from memory.

## Implementation order and gates

### Phase A — user-visible page parity

1. Add a committed isolated regression harness that never writes the default production state.
2. Migrate Resource timestamps/revisions/settings and add rollback fixtures.
3. Stop search/title/property/detail whole-tree rerenders.
4. Add parity/advanced flags and Library/List/Map opening policy.
5. Ship router + Center/Side/Full shell + server/SW deep-link fallback together.
6. Add focus/Escape/backdrop/Back state machine and accessible Library cards.
7. Convert block semantics incrementally while preserving editor selection/caret hooks.
8. Consolidate slash/block/format menu accessibility and owner-scoped transactions.
9. Add hierarchy, backlinks, comment threads, trash, icon/cover, property UI.
10. Finish responsive/mobile/accessibility/performance and Phase A E2E.
11. Apply screenshot-based visual tuning only after authenticated Notion references exist.

Gate: each step must leave `npm run check`, build checks, relevant E2E, and no-production-write guard passing.

### Phase B — persistence/offline

1. IndexedDB snapshot/operation queue.
2. Server/workspace/resource revisions and conflict responses.
3. Incremental endpoints and migration.
4. Offline/reload/close/crash recovery.
5. Waiting service-worker update flow.
6. Rollback/restore and two-client conflict tests.

### Phase C — deployment and user scope

The live service is currently public, not a purely local single-user app. Anonymous state access is therefore a release-blocking P0. Phase C must establish authenticated user/workspace ownership before claiming collaboration or production safety. Fake authors, share controls, presence, and unread collaboration UI will not be added before the actual identity model exists.

## Reference captures still required

The following authenticated current Notion captures remain `[Unverified]`: database view, Center peek, Side peek, toolbar, properties expanded/collapsed, no-icon/no-cover hover, empty/normal block hover, slash menu default/search/scroll, selection toolbar, block menu, drag insertion guide, long-page scroll, comments pane, mobile editor/keyboard, and equivalent dark-mode states if dark mode is in scope.

Until they are supplied or captured in an authenticated legal test environment, this project may report structural/behavior improvements but not pixel identity or “Notion과 동일”.
