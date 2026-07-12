# Resource parity implementation checkpoint

Date: 2026-07-12 (Asia/Seoul)

Implementation: PR #1 merged the parity rebuild at `665b237`; PR #2 merged production auth hardening at `617f44e`; the current workspace additionally contains undeployed local Trash/recovery safety, docked-Full chrome, Lock/Move/Duplicate/Markdown export, hierarchy-queue corrections, URL Link/Bookmark/Embed paste choice, inline equation/colors, cross-page block Move, comment-aware history/anchor repair, exact block deep links, and local-only comment read cursors

Checkpoint type: verified production access-control rollout plus newer undeployed local functionality with focused subsystem evidence. The recorded 115/115 full bundled-Chromium run and build metrics predate the newest editor/comment tranche and are historical until the root task reruns the complete candidate gates.

This checkpoint records the implemented/tested behavior and completed production access-control rollout. It does not claim pixel parity with authenticated current Notion.

## Phase status

| Phase | Status | Evidence | Open gate |
|---|---|---|---|
| Phase A — page/editor parity | No known functional P0 implementation gap in the defined single-workspace scope; post-fix aggregate/manual/visual gates remain open | focused URL/toolbar/block-Move/comment/deep-link/read-cursor suites, historical 115-test checkpoint, historical 27 viewport captures, authenticated private 768×964 Side/Center/Full static references | post-fix full 179/179 E2E/release gates, regenerated/matched state-by-state diff, real mobile keyboard/screen-reader QA, named P1/P2 features |
| Phase B — persistence/offline | Core implemented/tested and production migration checkpoint created | IndexedDB snapshot/queue/replay/conflict, incremental Resource writes, SW update gate, v3→v4 production revision 1, current revision 2, manual predeploy backup | disaster-recovery coverage outside the application DB |
| Phase C — deployment/access control | Production gate complete for the current single-workspace scope | Railway active deployment, exact-target one-way verifier, direct `401/401/200`, required state preconditions, anonymous Sites `401`, signed-in Sites status/Resources/Center peek `200` | per-user/RBAC/tenant scope remains P2; ID drift, token rotation, and external PITR are operational follow-ups |

There is no remaining P0 production-access blocker. Sites rejects anonymous `/`, `/api/state/status`, and `/health` with `401`; the signed-in owner path returns `200`; direct Railway rejects missing and wrong bearer credentials with `401 AUTH_REQUIRED` and accepts only the matching Sites credential. Authenticated state reads reported revision 2, `ETag: "state-2"`, and `X-State-Concurrency: required`, while `/health` remained public `200` for Railway health checks.

Authenticated Notion desktop-app inspection added direct static shell evidence at 768×964: Side peek used `pm=s`, Center peek used `pm=c`, and Full used its page route. This exposed a P0 in the prior breakpoint policy: at 768px with a fine pointer, this product collapsed Center and Side into the same compact full-screen shell and made Side modal/non-resizable. The local correction keeps Center as a centered modal and Side as a nonmodal resizable split while reserving the compact shell for compact/coarse input. A newer local correction also preserves an already-docked nav for desktop Full while using inert covered chrome on compact Full. Focused repeats cover the current tranche, and the latest Cloud postfix campaign ran all 179 tests at 175/179 before the final divider fix; the post-fix full 179/179 rerun, unmatched visual matrix, and real-device/screen-reader gates still keep Phase A open.

## Implemented in this checkpoint

### Resource list and render stability

- Resource controls use component-level patching instead of replacing `#viewRoot` for every search, filter, sort, or view update.
- Search retains the input node, focus, caret, composition state, and Side peek database context.
- Resource title editing uses a composition-aware local draft and patches corresponding title displays instead of rebuilding the list.
- Detail soft mutations preserve the active editor DOM and selection for property, URL, relation, and comment changes; Advanced windows do not recreate unrelated editors.
- Database and Full-text search scopes are separate and visible.
- Active/archive base scope and additional Resource predicates have explicit AND behavior.
- Library cards are keyboard-operable Resource links. Library buckets are exclusive, so a card is not repeated across sections; the header renders active/archive counts.
- The exclusive `trash` Resource filter renders a dedicated Trash view with recoverable rows instead of mixing trashed pages into Library/List/Map results.

### Resource page model and opening surfaces

- State v4 adds `createdAt`, `updatedAt`, `revision`, `timestampSource`, `parentId`, `childOrder`, `pageSettings`, `icon`, `cover`, permission `readOnly`, user-toggle `locked`, `trashedAt`, and `commentThreads`.
- Unknown historical timestamps are labeled as migration-derived rather than presented as original edit times.
- Resource mutations advance timestamp and revision; open, scroll, and hover do not.
- Stable updated sorting uses a deterministic tie-break.
- Default parity mode hides floating/dock/split/multi-window chrome. Advanced window mode retains those features behind an explicit setting.
- Per-view opening settings default Library → Center, List → Side, Map → Center and support Side/Center/Full.
- Center is a modal dialog with backdrop, focus entry/trap/return, and Escape close. Fine-pointer desktop Side, including 768px, is a nonmodal resizable panel that leaves the database interactive. Full is a routed page. On fine-pointer desktop 768px and wider, an already-docked nav remains visible and interactive while background main/FAB become inert and Full uses the remaining width. Docked or non-docked navigation pushes a root destination and Back/Forward restores route, focus, and inert state; the skip link retargets the focusable Resource surface. Compact/coarse Full covers and inerts the sidebar, while resize across the breakpoint restores the matching chrome. Compact/coarse Side intentionally becomes a full-screen modal; crossing the compact boundary synchronizes modality, focus trap, initial focus, resize availability, and the accessible save status.
- Stable Resource URLs support direct load/reload, Back/Forward, previous/next, expand to Full, return to originating peek, copy link, not-found, and trashed-page recovery state.
- Node, Sites Worker, and service worker implement navigation fallback while excluding APIs, real assets, extension paths, and forbidden paths.

### Page features

- The active-page toolbar exposes only implemented navigation, copy link, comments, sub-page, page menu, expand, and close actions. A trashed page uses a recovery-only toolbar with close, copy, restore, and applicable expand actions. No decorative share/AI/collaboration action was added.
- Title is a wrapping, single-line-sanitized textarea backed by a semantic page heading and title ↔ first-block Arrow navigation.
- Properties use boolean switch/checkbox controls, hidden/inert collapse behavior, relation controls, and URL Open/Copy/Edit/Clear actions.
- Page settings implement Default/Serif/Mono, Small text, Full width, Copy link, Duplicate, Lock/Unlock, a real Move to submenu, Markdown-only export, and Move to trash. The menu supports Tab exit, ArrowRight submenu entry, layered Escape/ArrowLeft return, and viewport-bounded scrolling on 320px and short landscape screens.
- Icon supports a scoped emoji picker; cover supports HTTPS images, repositioning, load/error state, and removal. Upload is explicitly unsupported.
- `parentId`/`childOrder`, child creation, parent selection, self/descendant cycle prevention, sub-page navigation, mention-derived Resource backlinks, and a real page Move submenu are implemented. Hierarchy persistence writes old parent → moved Resource → new parent with stable `queueOrder`; reload, transient retry, Keep local conflict rebase, and PostgreSQL validation preserve the same order and valid intermediate states. The direct picker excludes immutable destinations and rolls rejected changes back to its stored value. Resource/Project/Goal/Box/Task/Habit mentions navigate by click/Enter/Space and expose target state.
- Page discussions and inline range threads support reply, resolve, reopen, and thread soft-delete without fabricated author identity. Their block/thread snapshots share undo/redo; living marks rebase anchors, lost anchors become explicit page threads with `anchorLostAt`/`formerAnchor`, and orphan comment marks are removed. Unread badges use a durable workspace+Resource IndexedDB cursor, survive normal/locked/read-only reload, and do not mutate workspace state.
- Soft trash preserves page data and supports direct-route restore, a dedicated Trash view, and a focus-preserving keyboard Undo action toast. Restoring beside a read-only Trash row focuses its enabled opener. Trashed parents and Resource mentions expose explicit recovery/orphan state instead of appearing missing.
- Resource UI hard delete is disabled. Public full-state writes that omit an existing Resource fail atomically with `422 RESOURCE_PERMANENT_DELETE_DISABLED`; incremental trash/restore remains writable, while confirmed operator restore/reset paths are the explicit membership-replacement exception. The user-facing statistics demo action supplements missing examples without deleting existing Resources. User-facing retention is indefinite and permanent delete is not exposed.
- `locked` is a user-toggle content lock distinct from permission `readOnly`. Locked pages keep Copy, Markdown export, page-menu access, and Unlock while rejecting content mutations. Read-only Resources keep navigation, comments read, URL Open, Copy, and export but cannot change Lock state; forced handler paths reject both policies.
- Duplicate assigns fresh page/block IDs, does not copy comments, opens a new deep link, and preserves browser Back to the source. Export intentionally downloads deterministic Markdown only and chooses a code fence longer than any backtick run in the block.

### Editor, accessibility, and mobile

- H1/H2/H3, list/listitem, blockquote, pre/code, and named multiline textbox semantics retain stable editor data hooks.
- Existing paragraph, heading, list, todo, toggle, quote, callout, divider, code, inline mark, selection, drag, clipboard, and structural undo/redo behavior remains regression-locked.
- Markdown block/inline conversion, Enter/Shift+Enter, Backspace/Delete boundaries, Tab/Shift+Tab, Cmd shortcuts, Cmd+A, Cmd+D, undo/redo, slash/mention/emoji/equation commands, Escape priority, title Arrow navigation, and Korean IME paths are covered.
- Block transport covers ordered multi-selection, custom MIME/HTML/plain priority, sanitizer fallback, fresh pasted IDs, pointer drag/cancel, Alt-copy, keyboard move, and undo. Standalone credential-free HTTPS paste offers Link/Bookmark/Embed/Cancel with a keyboard-operable, viewport-clamped chooser; Bookmark/Embed render as inert static previews rather than executing remote content.
- Slash/mention/page/emoji/equation menus expose stable option IDs and connect `aria-controls`, `aria-haspopup`, `aria-expanded`, and `aria-activedescendant` to the active editor.
- The selection toolbar exposes inline equation plus nine text and nine background colors with keyboard state, persistence, and above/below visualViewport clamping. The selected-block menu exposes Copy link, whole-block Comment, ordering, cross-page Move, Copy, Duplicate, Delete, Turn into, and colors. Cross-page Move preserves multi-root/subtree order, transfers anchored threads, rejects collisions without writes, and undoes/redoes both Resources together.
- Exact block links reveal collapsed ancestors without persisting expansion, focus editable/divider/URL-preview targets, and fall back to the page shell with a failure announcement for missing/malformed hashes.
- Center/Side modal state, focus-visible, reduced motion, forced colors, keyboard Side resize, scoped save status, Full skip-link retargeting, 44px touch controls, viewport-bounded Page-menu scrolling, safe-area/visualViewport layout, wrapping mobile title, and bottom editing toolbar are implemented.

### Persistence, concurrency, migration, and security

- IndexedDB stores an authoritative local snapshot plus durable Resource operation queue before edits rely on remote persistence. Database version 2 also stores local Resource metadata keyed by workspace+Resource; legacy state read cursors and v1 databases migrate in place without a server revision/write.
- Offline reload, replay, transient retry, stale conflict, explicit remote reload, and waiting service-worker update behavior expose truthful Saving/Saved/Offline/Retrying/Conflict states.
- Workspace ETag and `If-Match`/`baseRevision` support optional `428`, stale `409`, and an incremental `PUT /api/resources/:id` path.
- Multi-Resource hierarchy operation groups carry stable `queueOrder`; old parent, moved Resource, and new parent replay in dependency-safe order after reload/retry and after Keep local conflict rebasing.
- Strict server validation rejects invalid roots, duplicate IDs, bad block/mark/range/indent values, broken relations, unsafe URL protocols, excessive size/depth, and ID mismatches before database mutation.
- Public full-state writes compare Resource membership under the same row lock and reject omissions with `422` without advancing revision or mutating relational rows. Trusted operator restore/reset omits that public guard deliberately; backup restore retains its separate confirmation, integrity, safety-backup, and revision checks. The browser's demo-data supplement preserves membership and completes without entering a 422 retry loop.
- Client link rendering revalidates safe protocols and adds `noopener noreferrer`; pasted HTML is sanitized.
- Central headers, redacted errors and audit records, request-size limits, route rate limits, and bounded state-write concurrency are implemented.
- `app_state_migration_backups` and `app_state_restore_history` support automatic pre-migration/read-heal snapshots and manual workspace-scoped create/list/restore with SHA-256 verification, revision precondition, safety backup, and monotonic restored revision. A manual production predeploy backup exists, and Railway migrated production v3→v4 at revision 1.
- The private Sites Worker strips browser-controlled auth/identity/forwarding headers before injecting its own credential. On the exact production Railway target, `server/deployment-security.js` forces a one-way verifier and state preconditions regardless of weaker environment or DB-policy values. This is a single-workspace gate, not per-user authorization.

## Production rollout evidence

- PR #1 merged the tested Resource rebuild to `main` at `665b237`; PR #2 merged target-scoped production auth hardening at `617f44e`.
- Railway production state migrated v3→v4 at revision 1, with a manual predeploy backup retained.
- Sites version 8 was saved from `0bb41c3` and deployed owner-only/custom at <https://sygma-personal-web.ateens.chatgpt.site> with environment revision 1, `API_BEARER_TOKEN` installed, and `REQUIRE_AUTHENTICATED_PROXY=1`.
- Anonymous Sites requests to `/`, `/api/state/status`, and `/health` return `401`.
- Railway deployment `32e9cf58-b0ca-4342-9638-e1bf078e071c` reported `ACTIVE` and `Deployment successful` for the PR #2 merge during live auth verification.
- Direct Railway `/api/state/status` returns `401 AUTH_REQUIRED` for missing and wrong bearer credentials and `200` for the matching Sites credential. Authenticated `/api/state` also returns `200`; both authenticated responses reported revision 2, `ETag: "state-2"`, and `X-State-Concurrency: required`. `/health` remains `200`.
- The signed-in owner Sites `/api/state/status` returned `200` at revision 2. The production root loaded, the Resources view rendered 16 active Resources, and a real Resource opened in Center peek.
- The verifier fingerprint was matched locally against the existing Sites credential without printing the token; its mode-`0600` temporary file was deleted immediately after live verification.
- The production SHA/deployment evidence above is intentionally unchanged. Trash/guard, docked-Full, Lock/Move/Duplicate/Markdown export, and hierarchy-queue work exists only in the current local worktree and has not been pushed or deployed; no production smoke result is attributed to those features.

## Automated evidence

### Browser suite

The prior checkpoint's complete bundled-Chromium run reported **84 passed (3.3 minutes)**. That run predates the current Trash/guard, docked-Full, Lock/action, and hierarchy-queue changes, so it is historical baseline evidence only.

The later **115/115 bundled-Chromium run (3.8 minutes)** covered the Trash/guard, docked-Full, Lock/action, and hierarchy checkpoint, but it predates the newest URL/toolbar/block-Move/comment/deep-link/read-cursor work. It is historical and must not be presented as the current-worktree total.

Current scoped evidence includes URL chooser 7/7, inline toolbar 5/5, cross-page Move 6/6, comment history/anchor integrity 4/4 with a related 56/56 combined batch, and a 17-case deep-link/read-cursor set (deep link 3, read cursor 4, block menu 3, page lock 5, read-only 2). The local metadata change also passed 13/13 offline/hierarchy regressions. Playwright discovery currently lists **179 tests in 30 spec files**, but discovery is not a pass result; the latest Cloud postfix campaign ran all 179 tests at 175/179 before the final divider fix, so the root task must rerun a clean post-fix 179/179 campaign before release wording.

| Spec | Tests | Main evidence |
|---|---:|---|
| historical bundled-Chromium E2E | 115 | pre-URL/toolbar/block-Move/comment/deep-link/read-cursor checkpoint; not current |
| current discovered E2E suite | 179 | 30 spec files; latest full Cloud postfix first run was 175/179 before the final divider fix; post-fix 179/179 rerun pending |
| current deep-link/read-cursor focused set | 17 | exact block success/fallback, IndexedDB cursor migration/upgrade/reload, zero-write lock/read-only behavior and related regressions |
| current offline/hierarchy regression set | 13 | offline 7 plus hierarchy persistence 6 after local metadata changes |
| `resource-cross-page-block-move.spec.js` | 6 | searchable/clamped submenu, source→target ordering, multi-root/nested/all-block behavior, thread transfer, collision no-mutation, multi-Resource undo/redo |
| `resource-url-paste-choice.spec.js` | 7 | Link/Bookmark/Embed/Cancel, keyboard/clamp, inert preview, transport/reload/undo and server validation |
| `resource-inline-toolbar.spec.js` | 5 | inline equation, 18 colors, keyboard semantics, persistence/history, viewport flip/clamp |
| `resource-comment-history-integrity.spec.js` | 4 | atomic comment lifecycle undo/redo, text-anchor rebase/loss, destructive mutation integrity, duplicate/clipboard mark ownership |
| `resource-trash-view.spec.js` | 6 | Trash target/view/restore, recovery-only toolbar, orphan state, keyboard Undo and adjacent-row focus, UI hard-delete guard |
| `resource-state-delete-guard.spec.js` | 3 | public omission 422/no mutation, incremental trash/restore, operator reset exception, non-destructive demo-data supplement |
| `resource-full-docked-nav.spec.js` | 7 | 768px docked geometry, inert/focus, docked/non-docked history, skip link, desktop/compact chrome |
| `resource-page-lock.spec.js` | 5 | `locked` versus `readOnly`, Copy/Lock/Unlock, forced handler, server type, offline replay |
| `resource-hierarchy-persistence.spec.js` | 6 | intermediate validity, immutable picker rollback, Move, Duplicate ordering, retry/reload queue order, Keep local rebase |

The fixture server is memory-only and carries an explicit production-write guard. No browser test above mutates production.

### Non-browser checks

- The last isolated PostgreSQL checkpoint covered atomic public Resource-omission rejection, incremental soft-trash/restore, dependency-safe hierarchy transitions, and the trusted operator reset exception. URL-block, inline-color, and lost-comment metadata validation changed afterward, so the final candidate needs a fresh PostgreSQL check.
- The deep-link/read-cursor tranche passed `npm run check` and `git diff --check`. The root task must still rerun the combined source/build/PostgreSQL/backup/API-auth/diff gates after all concurrent edits settle.
- The recorded build (`1,162,032 → 815,222` bytes, Brotli `142,042`, gzip `181,108`) predates the newest tranche and is historical only. Latest verified Cloud build metrics are `1,318,622 -> 921,298` bytes, Brotli `160,042`, gzip `206,578`; rerun only if the release candidate changes again.

### Performance evidence

The deterministic 400-block local fixture recorded the following at the pre-tranche checkpoint; rerun it on the final candidate before treating these numbers as current:

```json
{
  "shellDomNodes": 4555,
  "propertyPatchMs": 20.8,
  "scrollResponseMs": 16.4,
  "maxLongTaskMs": 0,
  "totalLongTaskMs": 0,
  "longTaskCount": 0,
  "readyMs": 284
}
```

These are headless local fixture values, not field RUM or a guarantee for slower devices.

## Viewport and visual evidence

The recorded matrix captured Center, Side, and Full at 1440×1000, 1280×900, 1024×768, 900×760, 768×720, 390×844, 375×812, 360×800, and 320×720: 27 screenshots total. Every shell stayed within viewport bounds and the one-pixel overflow tolerance at that checkpoint. A separate settled matrix contains 19 implementation states plus a contact sheet. The latest inline toolbar, cross-page Move submenu, exact deep-link states, and comment read/anchor-lost states postdate those captures, so regenerate affected product evidence before calling it current.

Authenticated Notion desktop-app reference captures are now available as ephemeral/private audit evidence at 768×964: Side peek (`pm=s`), Center peek (`pm=c`), and Full page. They directly verify the three static shell structures and supplied the evidence for the breakpoint correction. No raw Notion screenshot is committed because the images expose private workspace content.

The reference session was dark-theme, Korean, and used a custom/pinned property layout, while the product fixture is light-theme and not content-matched. Therefore:

- authenticated static desktop shell structure at 768×964 is `[Verified]`;
- exact typography, color, border, shadow, radius, backdrop, and the complete paired state matrix are `[Unverified]`;
- static captures do not verify Back/Forward, focus/Escape order, resize behavior, interaction, or motion;
- neither the private references nor product screenshots are evidence of “Notion과 동일” or pixel identity;
- real iOS/Android soft keyboard, touch drag/long press, VoiceOver, and TalkBack remain manual gates.

The local docked-Full behavior adds focused functional evidence, not a new pixel claim: on fine-pointer desktop 768px and wider Full starts after the docked sidebar, leaves sidebar navigation active, and makes background main/FAB inert. Root navigation plus Back/Forward restores route and focus. Compact/coarse Full covers and inerts the sidebar, and resize across the boundary restores the appropriate chrome. This behavior is not deployed.

## Changed-file groups

| Files | Purpose |
|---|---|
| `app.js`, `styles.css` | Resource v4 model, minimal patching, router/page shells, docked-Full chrome, Trash/Lock/page actions, URL chooser, inline equation/colors, block actions/cross-page Move, comment history/anchor repair, exact deep links, local read cursor, mobile and accessibility behavior |
| `server.js`, `server/deployment-security.js`, `server/storage.js` | SPA/API routing, validation, revisions, incremental Resource writes, public Resource-membership deletion guard, exact-target one-way bearer policy, migration backup/restore |
| `service-worker.js`, `worker/index.js` | offline navigation/update handling and authenticated private proxy boundary |
| `index.html`, `manifest.json`, `assets/sygma-social-preview.png`, `README.md`, `.env.example` | app-shell and social-preview metadata, cache/build versioning, operator/user-facing state and configuration documentation |
| `scripts/*.mjs`, `package.json`, `package-lock.json`, `playwright.config.js` | source/build/Worker/PostgreSQL/auth/backup checks and deterministic browser harness |
| `tests/fixture-server.mjs`, `tests/fixtures/*`, `tests/e2e/*` | isolated state fixture, production-write/omission guards, functional/visual/performance matrix, Trash/docked-Full/Lock/hierarchy plus URL/toolbar/block-Move/comment-history/deep-link/read-cursor specs |
| `docs/resource-*.md` | pre-change audit, final local gap audit, checkpoint, auth and migration/restore runbooks |

The pre-change audit remains historical and must not be edited to make its original gaps look smaller.

## Deployment and rollback gate

Completed:

1. Final checks, PR #1/PR #2 merges, active Railway deployment, production v4 migration, and manual predeploy backup.
2. Owner-only/custom Sites version 8 deployment with the API secret and authenticated-proxy requirement.
3. Anonymous Sites `/`, `/api/state/status`, and `/health` rejection with `401`.
4. Exact-production token fingerprint match, direct Railway `401/401/200`, authenticated state `200` with required preconditions, and health `200`.
5. Signed-in Sites status `200` at revision 2 plus production Resources and Center peek smoke checks.
6. Secure deletion of the temporary credential file.

Pending before any release of the newer local worktree:

1. Publish only through an explicitly authorized release workflow.
2. After deployment, repeat Railway/Sites auth, state, Trash, docked-Full, and page-action smoke checks against the deployed revision.

Non-blocking operational follow-ups:

1. Update project/environment/service IDs and the scope tests before any Railway resource recreation.
2. Rotate the Sites secret and verifier together; use a temporary dual-verifier rollout if zero downtime is required.
3. Audit/remove any obsolete production DB `api_proxy_auth` row when operator DB access is available; the exact-target path currently ignores it.
4. Confirm separate PostgreSQL PITR/dump coverage.

Restore requires stopped/drained writes, exact workspace confirmation, and the current revision. It creates a safety backup and advances revision rather than rewinding it. Authentication rollback should prefer the verified fail-closed environment override; do not delete the DB credential first. Follow the dedicated migration and auth runbooks for exact commands and limitations.

## Remaining work

### P0

- No known functional or production-access P0 implementation gap remains in the defined single-workspace scope. The 768px shell defects and Resource membership deletion risk are fixed locally, and the newest tranche has focused evidence; however, the latest full Cloud postfix run was 175/179 before the final divider fix, so the post-fix aggregate/release gate remains pending. Every new local change is still undeployed.

### P1

- Real mobile soft-keyboard, touch drag/long press, VoiceOver/TalkBack, and contrast QA.
- Privacy-safe matched authenticated reference pairs and state-by-state visual diffs beyond the verified 768×964 static Side/Center/Full shells.
- Richer property popovers and ordering/hiding policy.
- Cross-entity backlink surfaces/indexing beyond the verified Resource/Project/Goal/Box/Task/Habit mention navigation.
- Reply-level comment deletion plus attributed author/permission/notification and multi-user unread semantics. Thread delete, anchor-loss/rebase, and durable local-only single-user read cursors are implemented.
- Page version history. Current Duplicate/Move/Lock/Markdown export actions are not version history.
- Full slash/media block catalog, image/file and large-paste flow, remote bookmark metadata/real iframe policy, complete inline-link actions, and columns. The selected-block action menu and URL Link/Bookmark/Embed chooser now cover their defined local subset.

### P2

- Custom database page layout builder.
- Additional table/media/file/embed/equation/breadcrumb/TOC/database/synced/button/AI blocks and column engine.
- Multi-user tenant/role/resource authorization, attributed collaboration, notifications/presence.
- Store/repository/router/editor module extraction, long-document virtualization, repo-wide legacy-ID migration, and dark mode if brought into scope.

## Checkpoint conclusion

The production access-control rollout is verified through Railway and owner-only/custom Sites. The newer Trash/guard, docked-Full, page actions, hierarchy queue, URL/toolbar/block-Move/comment/deep-link/read-cursor changes are local only. Their focused suites provide subsystem evidence, but the recorded 115-test run and build metrics predate the newest tranche; the root task must run the post-fix 179/179 E2E campaign and all release gates. Phase A is still not declared complete because the matched visual state matrix and real mobile/screen-reader gates remain open; the project as a whole also remains incomplete because the listed P1/P2 capabilities remain. No exact visual parity claim is made; detailed current status is maintained in `resource-notion-parity-final-gap-audit-2026-07-11.md`.

## 2026-07-12 Codex Cloud evidence refresh

After rereading the original source specification, the completion ledger, and the current worktree, the checkpoint remains **Partial** and must not be described as Notion-identical.

Fresh evidence on this cloud workspace:

- `npm ci` passed with 47 packages installed/audited and 0 vulnerabilities.
- `npm run check` passed.
- `npm run check:build` passed with historical metrics `1,299,160 -> 908,347` bytes, Brotli `157,930`, gzip `203,507`.
- `npx playwright test --list` discovered **179 tests in 30 spec files**.
- Focused mention rerun, full E2E, Axe checks, and visual matrix regeneration are blocked here because Playwright Chromium is missing, `npx playwright install chromium` returns `403 Domain forbidden`, and no system Chrome/Chromium executable is available.
- `npm run check:api-auth`, `npm run check:postgres`, and `npm run check:backups` are blocked here by the absent `.env`/`DATABASE_URL` and therefore remain unverified in this environment.
- `git diff --check` passed after this documentation update.

The user's **173/174** local real-Chrome result remains historical pre-179 evidence. Current full-run evidence is the later Cloud postfix campaign: **175/179** passed before the final divider fix, followed by focused divider verification; a clean post-fix **179/179** campaign is still required.

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
