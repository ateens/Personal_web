# Resource parity implementation checkpoint

Date: 2026-07-11 (Asia/Seoul)

Branch: `codex/resource-notion-parity-phase-a`

Checkpoint type: local implementation, migration, and test checkpoint; production rollout pending

This checkpoint records the current branch's implemented and tested behavior. It does not claim a completed production deployment or pixel parity with authenticated current Notion.

## Phase status

| Phase | Status | Evidence | Open gate |
|---|---|---|---|
| Phase A — page/editor parity | Broad local implementation complete; scoped gaps remain | 83-test isolated browser suite, 27 viewport captures, four state captures, source/build checks | authenticated Notion reference diff, real mobile keyboard/screen-reader QA, named P1/P2 features |
| Phase B — persistence/offline | Local core implemented and tested | IndexedDB snapshot/queue/replay/conflict, incremental Resource writes, SW update gate, migration backup/restore checks | production pre-deploy backup, rollout smoke test, disaster-recovery coverage outside the application DB |
| Phase C — deployment/access control | Code and runbook implemented; production activation not started/completed | Worker and DB-policy self-tests pass | private Sites deployment, matching secret, Railway policy enablement, direct/public path verification |

The one remaining P0 release blocker is production API access. The 2026-07-11 production audit still observed anonymous `200` state reads and a DB auth policy of `configured:false`, `enforced:false`. Do not describe production as protected until the ordered auth rollout and post-deploy checks pass.

## Implemented in this checkpoint

### Resource list and render stability

- Resource controls use component-level patching instead of replacing `#viewRoot` for every search, filter, sort, or view update.
- Search retains the input node, focus, caret, composition state, and Side peek database context.
- Resource title editing uses a composition-aware local draft and patches corresponding title displays instead of rebuilding the list.
- Detail soft mutations preserve the active editor DOM and selection for property, URL, relation, and comment changes; Advanced windows do not recreate unrelated editors.
- Database and Full-text search scopes are separate and visible.
- Active/archive base scope and additional Resource predicates have explicit AND behavior.
- Library cards are keyboard-operable Resource links. Library buckets are exclusive, so a card is not repeated across sections; the header renders active/archive counts.

### Resource page model and opening surfaces

- State v4 adds `createdAt`, `updatedAt`, `revision`, `timestampSource`, `parentId`, `childOrder`, `pageSettings`, `icon`, `cover`, `readOnly`, `trashedAt`, and `commentThreads`.
- Unknown historical timestamps are labeled as migration-derived rather than presented as original edit times.
- Resource mutations advance timestamp and revision; open, scroll, and hover do not.
- Stable updated sorting uses a deterministic tie-break.
- Default parity mode hides floating/dock/split/multi-window chrome. Advanced window mode retains those features behind an explicit setting.
- Per-view opening settings default Library → Center, List → Side, Map → Center and support Side/Center/Full.
- Center is a modal dialog with backdrop, focus entry/trap/return, and Escape close. Desktop Side is a nonmodal resizable panel that leaves the database interactive. Full is a routed page. Narrow Side intentionally becomes a full-screen modal.
- Stable Resource URLs support direct load/reload, Back/Forward, previous/next, expand to Full, return to originating peek, copy link, not-found, and trashed-page recovery state.
- Node, Sites Worker, and service worker implement navigation fallback while excluding APIs, real assets, extension paths, and forbidden paths.

### Page features

- The page toolbar exposes only implemented navigation, copy link, comments, sub-page, page menu, expand, and close actions. No decorative share/AI/collaboration action was added.
- Title is a wrapping, single-line-sanitized textarea backed by a semantic page heading and title ↔ first-block Arrow navigation.
- Properties use boolean switch/checkbox controls, hidden/inert collapse behavior, relation controls, and URL Open/Copy/Edit/Clear actions.
- Page settings implement Default/Serif/Mono, Small text, Full width, and Move to trash.
- Icon supports a scoped emoji picker; cover supports HTTPS images, repositioning, load/error state, and removal. Upload is explicitly unsupported.
- `parentId`/`childOrder`, child creation, parent selection, self/descendant cycle prevention, sub-page navigation, and mention-derived Resource backlinks are implemented.
- Page discussions and inline range threads support reply, resolve, and reopen. No fabricated author identity is stored.
- Soft trash preserves page data and supports direct-route restore and immediate Undo.
- Read-only Resources keep navigation, comments read, URL Open, and Copy available while UI controls and forced handler paths reject mutations.

### Editor, accessibility, and mobile

- H1/H2/H3, list/listitem, blockquote, pre/code, and named multiline textbox semantics retain stable editor data hooks.
- Existing paragraph, heading, list, todo, toggle, quote, callout, divider, code, inline mark, selection, drag, clipboard, and structural undo/redo behavior remains regression-locked.
- Markdown block/inline conversion, Enter/Shift+Enter, Backspace/Delete boundaries, Tab/Shift+Tab, Cmd shortcuts, Cmd+A, Cmd+D, undo/redo, slash/mention/emoji/equation commands, Escape priority, title Arrow navigation, and Korean IME paths are covered.
- Block transport covers ordered multi-selection, custom MIME/HTML/plain priority, sanitizer fallback, fresh pasted IDs, pointer drag/cancel, Alt-copy, keyboard move, and undo.
- Slash/mention/page/emoji/equation menus expose stable option IDs and connect `aria-controls`, `aria-haspopup`, `aria-expanded`, and `aria-activedescendant` to the active editor.
- Center/Side modal state, focus-visible, reduced motion, forced colors, keyboard Side resize, scoped save status, 44px touch controls, safe-area/visualViewport layout, wrapping mobile title, and bottom editing toolbar are implemented.

### Persistence, concurrency, migration, and security

- IndexedDB stores an authoritative local snapshot plus durable Resource operation queue before edits rely on remote persistence.
- Offline reload, replay, transient retry, stale conflict, explicit remote reload, and waiting service-worker update behavior expose truthful Saving/Saved/Offline/Retrying/Conflict states.
- Workspace ETag and `If-Match`/`baseRevision` support optional `428`, stale `409`, and an incremental `PUT /api/resources/:id` path.
- Strict server validation rejects invalid roots, duplicate IDs, bad block/mark/range/indent values, broken relations, unsafe URL protocols, excessive size/depth, and ID mismatches before database mutation.
- Client link rendering revalidates safe protocols and adds `noopener noreferrer`; pasted HTML is sanitized.
- Central headers, redacted errors and audit records, request-size limits, route rate limits, and bounded state-write concurrency are implemented.
- `app_state_migration_backups` and `app_state_restore_history` support automatic pre-migration/read-heal snapshots and manual workspace-scoped create/list/restore with SHA-256 verification, revision precondition, safety backup, and monotonic restored revision.
- The branch includes a staged DB-backed bearer policy and private Sites Worker proxy design. The Worker strips browser-controlled auth/identity/forwarding headers before injecting its own credential. This is a single-workspace gate, not per-user authorization.

## Automated evidence

### Browser suite

Last complete command:

```sh
PLAYWRIGHT_CHANNEL=chromium E2E_PORT=43260 npm run test:e2e -- --reporter=line
```

Result: **83 passed (2.8 minutes)**.

| Spec | Tests | Main evidence |
|---|---:|---|
| `resource-baseline.spec.js` | 8 | isolated production guard, views, minimal patch, existing schema, unsafe link rejection |
| `resource-p0.spec.js` | 7 | timestamp/revision, IME-safe search/title, search scope, keyboard card, parity mode |
| `resource-page-shell.spec.js` | 16 | opening modes, routes/history, focus/Escape/backdrop, resize, readable Side background controls, mobile, reduced/forced colors |
| `resource-page-features.spec.js` | 15 | semantics, title/properties/menu/media, trash, hierarchy/backlinks, comment threads |
| `resource-editor-matrix.spec.js` | 15 | Markdown/keyboard/IME/menu/editor transaction matrix |
| `resource-editor-transport.spec.js` | 9 | selection, drag/copy/move, clipboard priority/sanitize/paste |
| `resource-offline.spec.js` | 6 | durable snapshot, offline reload, replay, retry, conflict, SW update |
| `resource-dom-stability.spec.js` | 2 | active editor identity and Advanced-window isolation |
| `resource-readonly.spec.js` | 2 | read-only UI and forced-handler no-write behavior |
| conflict/performance/viewport specs | 3 | stale writer recovery, 400-block budget, 27 geometry captures |

The complete run was executed against the final documented source revision, including the Library section/header copy adjustment and readable background controls beside Side peek.

### Non-browser checks

- `npm run check`: passed syntax, source audit, and Sites Worker checks.
- `npm run check:build`: passed; authoritative final bundle result `1,112,382 → 779,823` bytes, Brotli `136,347`, gzip `173,007`.
- `assets/sygma-social-preview.png` is copied into the client build and referenced by `index.html` Open Graph and Twitter image metadata.
- `npm run check:postgres`: passed against isolated workspace `check-33b0d96e4b4d`, including v4 migration/read-heal, strict validation/no mutation, preconditions, stale conflict, incremental Resource writes, URL-scheme rejection, relational reconstruction, and cleanup.
- `npm run check:backups`: passed against isolated workspace `migration-backup-check-83a74611bc7186b0`, including automatic v3→v4 backup, CLI create/list/restore, integrity, safety backup, restore history, unrelated sentinel protection, and cleanup.
- `npm run check:api-auth`: passed isolated DB policy and configuration self-tests.

### Performance evidence

The deterministic 400-block local fixture recorded:

```json
{
  "shellDomNodes": 4556,
  "propertyPatchMs": 18.7,
  "scrollResponseMs": 9.8,
  "maxLongTaskMs": 0,
  "totalLongTaskMs": 0,
  "longTaskCount": 0,
  "readyMs": 294
}
```

These are headless local fixture values, not field RUM or a guarantee for slower devices.

## Viewport and visual evidence

The matrix captures Center, Side, and Full at 1440×1000, 1280×900, 1024×768, 900×760, 768×720, 390×844, 375×812, 360×800, and 320×720: 27 screenshots total. Every shell stayed within viewport bounds and the one-pixel overflow tolerance. Additional captures cover Center properties, Center comments, Center page menu, and mobile comments.

Authenticated Notion reference capture was unavailable. Therefore:

- behavior and local geometry are `[Verified]`;
- exact typography, color, border, shadow, radius, backdrop, and motion comparison is `[Unverified]`;
- the screenshots are not evidence of “Notion과 동일” or pixel identity;
- real iOS/Android soft keyboard, touch drag/long press, VoiceOver, and TalkBack remain manual gates.

## Changed-file groups

| Files | Purpose |
|---|---|
| `app.js`, `styles.css` | Resource v4 model, minimal patching, router/page shells, editor/page features, IndexedDB queue, mobile and accessibility behavior |
| `server.js`, `server/storage.js` | SPA/API routing, validation, revisions, incremental Resource writes, security controls, bearer policy, migration backup/restore |
| `service-worker.js`, `worker/index.js` | offline navigation/update handling and authenticated private proxy boundary |
| `index.html`, `manifest.json`, `assets/sygma-social-preview.png`, `README.md`, `.env.example` | app-shell and social-preview metadata, cache/build versioning, operator/user-facing state and configuration documentation |
| `scripts/*.mjs`, `package.json`, `package-lock.json`, `playwright.config.js` | source/build/Worker/PostgreSQL/auth/backup checks and deterministic browser harness |
| `tests/fixture-server.mjs`, `tests/fixtures/*`, `tests/e2e/*` | isolated state fixture, production-write guard, functional/visual/performance matrix |
| `docs/resource-*.md` | pre-change audit, final local gap audit, checkpoint, auth and migration/restore runbooks |

The pre-change audit remains historical and must not be edited to make its original gaps look smaller.

## Deployment and rollback gate

1. Run all checks against the exact commit to deploy.
2. Create the production manual migration checkpoint and confirm separate PostgreSQL PITR/dump coverage.
3. Deploy the fail-closed-capable server and Worker code while DB auth enforcement remains disabled.
4. Stage the bearer credential with a private `0600` token file; never print it or place it in ordinary command arguments/logs.
5. Make Sites private, set `REQUIRE_AUTHENTICATED_PROXY=1`, install the matching Sites secret, deploy, and verify the signed-in Sites path.
6. Enable the DB-backed policy only after step 5 works. After cache refresh, verify direct Railway missing/wrong credentials return `401` and private Sites still returns `200`.
7. Record commit, deployment IDs, backup ID, auth fingerprint, revision, and smoke-test results without recording state or secrets.

Restore requires stopped/drained writes, exact workspace confirmation, and the current revision. It creates a safety backup and advances revision rather than rewinding it. Authentication rollback should prefer the verified fail-closed environment override; do not delete the DB credential first. Follow the dedicated migration and auth runbooks for exact commands and limitations.

## Remaining work

### P0 release blocker

- Production backup, backend/Worker deployment, private Sites access policy and secret, DB enforcement, and missing/wrong/correct credential verification.

### P1

- Real mobile soft-keyboard, touch drag/long press, VoiceOver/TalkBack, and contrast QA.
- Authenticated current Notion reference captures and state-by-state visual diffs.
- Page menu actions that need real storage/export/move/history support; richer property popovers and ordering/hiding policy.
- Cross-entity mention navigation and broken-target/orphan handling.
- Comment deletion, anchor-loss/rebase, unread/read behavior when identity exists.
- Dedicated Trash view, permanent-delete and retention policy.
- Full block action menu, image/file and large-paste flow, URL bookmark/embed choice, and unified title/property/icon/comment history.

### P2

- Custom database page layout builder.
- Additional table/media/file/embed/equation/breadcrumb/TOC/database/synced/button/AI blocks and column engine.
- Multi-user tenant/role/resource authorization, attributed collaboration, notifications/presence.
- Store/repository/router/editor module extraction, long-document virtualization, repo-wide legacy-ID migration, and dark mode if brought into scope.

## Checkpoint conclusion

The branch passed its final same-revision local test gate and is suitable for deployment review. It is not yet a completed production release, and the absence of authenticated reference captures prevents any exact Notion visual parity claim. The detailed current status is maintained in `resource-notion-parity-final-gap-audit-2026-07-11.md`.
