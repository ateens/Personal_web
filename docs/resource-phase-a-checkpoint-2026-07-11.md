# Resource parity implementation checkpoint

Date: 2026-07-12 (Asia/Seoul)

Implementation: PR #1 merged the parity rebuild at `665b237`; PR #2 merged production auth hardening at `617f44e`

Checkpoint type: final tested source with verified production access-control rollout

This checkpoint records the implemented/tested behavior and completed production access-control rollout. It does not claim pixel parity with authenticated current Notion.

## Phase status

| Phase | Status | Evidence | Open gate |
|---|---|---|---|
| Phase A — page/editor parity | Broad local implementation complete; scoped gaps remain | 83-test isolated browser suite, 27 viewport captures, four state captures, source/build checks | authenticated Notion reference diff, real mobile keyboard/screen-reader QA, named P1/P2 features |
| Phase B — persistence/offline | Core implemented/tested and production migration checkpoint created | IndexedDB snapshot/queue/replay/conflict, incremental Resource writes, SW update gate, v3→v4 production revision 1, current revision 2, manual predeploy backup | disaster-recovery coverage outside the application DB |
| Phase C — deployment/access control | Production gate complete for the current single-workspace scope | Railway active deployment, exact-target one-way verifier, direct `401/401/200`, required state preconditions, anonymous Sites `401`, signed-in Sites status/Resources/Center peek `200` | per-user/RBAC/tenant scope remains P2; ID drift, token rotation, and external PITR are operational follow-ups |

There is no remaining P0 production-access blocker. Sites rejects anonymous `/`, `/api/state/status`, and `/health` with `401`; the signed-in owner path returns `200`; direct Railway rejects missing and wrong bearer credentials with `401 AUTH_REQUIRED` and accepts only the matching Sites credential. Authenticated state reads reported revision 2, `ETag: "state-2"`, and `X-State-Concurrency: required`, while `/health` remained public `200` for Railway health checks.

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

## Automated evidence

### Browser suite

Last complete command:

```sh
PLAYWRIGHT_CHANNEL=chromium E2E_PORT=43280 npm run test:e2e -- --reporter=line
```

Result: **83 passed (2.6 minutes)**.

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
- `npm run check:postgres`: passed against isolated workspace `check-43890cbf0704`, including v4 migration/read-heal, strict validation/no mutation, preconditions, stale conflict, incremental Resource writes, URL-scheme rejection, relational reconstruction, and cleanup.
- `npm run check:backups`: passed against isolated workspace `migration-backup-check-a2962e1a6ddf852d`, including automatic v3→v4 backup, CLI create/list/restore, integrity, safety backup, restore history, unrelated sentinel protection, and cleanup.
- `npm run check:api-auth`: passed isolated DB policy/configuration checks plus exact-target scope, digest-only auth, digest-over-stale-plaintext priority, and malformed-verifier fail-closed cases.

### Performance evidence

The deterministic 400-block local fixture recorded:

```json
{
  "shellDomNodes": 4556,
  "propertyPatchMs": 20.5,
  "scrollResponseMs": 16.6,
  "maxLongTaskMs": 0,
  "totalLongTaskMs": 0,
  "longTaskCount": 0,
  "readyMs": 270
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
| `server.js`, `server/deployment-security.js`, `server/storage.js` | SPA/API routing, validation, revisions, incremental Resource writes, exact-target one-way bearer policy, migration backup/restore |
| `service-worker.js`, `worker/index.js` | offline navigation/update handling and authenticated private proxy boundary |
| `index.html`, `manifest.json`, `assets/sygma-social-preview.png`, `README.md`, `.env.example` | app-shell and social-preview metadata, cache/build versioning, operator/user-facing state and configuration documentation |
| `scripts/*.mjs`, `package.json`, `package-lock.json`, `playwright.config.js` | source/build/Worker/PostgreSQL/auth/backup checks and deterministic browser harness |
| `tests/fixture-server.mjs`, `tests/fixtures/*`, `tests/e2e/*` | isolated state fixture, production-write guard, functional/visual/performance matrix |
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

Non-blocking operational follow-ups:

1. Update project/environment/service IDs and the scope tests before any Railway resource recreation.
2. Rotate the Sites secret and verifier together; use a temporary dual-verifier rollout if zero downtime is required.
3. Audit/remove any obsolete production DB `api_proxy_auth` row when operator DB access is available; the exact-target path currently ignores it.
4. Confirm separate PostgreSQL PITR/dump coverage.

Restore requires stopped/drained writes, exact workspace confirmation, and the current revision. It creates a safety backup and advances revision rather than rewinding it. Authentication rollback should prefer the verified fail-closed environment override; do not delete the DB credential first. Follow the dedicated migration and auth runbooks for exact commands and limitations.

## Remaining work

### P0

- No open functional or production-access P0 remains in the defined single-workspace scope.

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

The implementation passed its final same-revision local test gate and the production access-control rollout is verified through Railway and owner-only/custom Sites. The absence of authenticated Notion reference captures still prevents any exact visual parity claim, and real mobile/screen-reader plus named P1/P2 capabilities remain open. The detailed current status is maintained in `resource-notion-parity-final-gap-audit-2026-07-11.md`.
