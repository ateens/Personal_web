# Refactoring backlog

Measured on 2026-07-16 after the Railway-only deployment cutover work.

## Completed in the deployment cutover

- Removed the Sites Worker, hosting metadata, proxy-bearer scripts, OAuth handoff, and unused static-host build artifacts.
- Removed the Railway access-code/session gate at the operator's request and retained same-origin mutation checks independently.
- Made the production build explicit and fail closed when `dist/client` is missing.
- Added Railway deployment-policy, mutation-origin, and production-build checks to the default verification path.
- Kept Google OAuth on one Railway origin.

## P1: split the browser monolith

`app.js` is about 26.6k lines and 1.1 MB, with roughly 1.4k top-level functions, 45 mutable top-level bindings, and a large shared `ui` object. The most concentrated dispatchers are `handleClick`, `handleKeydown`, and `handlePointerDown`.

Do this behind the existing behavior suite, without a framework rewrite:

1. Change the production browser build from single-file transform to a module entry bundle.
2. Extract pure state contracts and normalizers first.
3. Extract navigation/router, persistence, calendar, task scheduling, and Resource editor boundaries.
4. Replace the large DOM event handlers with small feature dispatchers.
5. Split feature-local UI state only after the event and render boundaries are stable.

## P1: replace full-state relational rewrites

The client commonly saves a full workspace snapshot after a short debounce. `syncRelationalState` then deletes relation rows in dependency order and reinserts the complete collection graph. This is correct for the current small personal dataset but creates avoidable database round trips, row churn, write-queue pressure, and revision conflicts as the workspace grows.

Move toward entity-level mutations and batched SQL:

- keep the full-state endpoint only for bootstrap, import, and recovery;
- use incremental upsert/delete endpoints for normal edits;
- batch rows per table instead of issuing one statement per item;
- preserve the JSONB snapshot as a backup/compatibility representation, not the primary write path;
- measure write latency and conflict rate before and after each step.

## P1: establish one shared state contract

Navigation order, view settings, calendar sources, Resource page state, normalization rules, and validation rules are repeated across `app.js`, `server/storage.js`, `server.js`, and `tests/fixture-server.mjs`.

Extract browser-safe pure modules such as:

- `shared/state-contract.js`
- `shared/state-normalization.js`
- `shared/state-validation.js`

The production server, browser bundle, and test fixture should import the same rules. This reduces schema drift and makes migrations reviewable.

## P1: make the server injectable and testable

`server.js` still owns environment loading, security headers, rate limiting, state validation, routing, OAuth, static delivery, and process startup. `server/storage.js` still contains schema setup, migrations, repositories, backups, normalization, and private data in one large closure.

Recommended boundaries:

- `createAppServer(config, dependencies)` with no import-time listen;
- `routes/state`, `routes/resources`, and `routes/google`;
- `middleware/rate-limit` and `middleware/request-audit`;
- `validation/state`;
- `storage/migrations` plus collection repositories;
- a real schema-version table and explicit migration runner.

The new `server/request-security.js` is the first extracted request-policy boundary and should remain independent.

## P2: reduce CSS cascade debt

`styles.css` is about 11.5k lines and 257 KB, with roughly 1.3k rules and 84 `!important` declarations. Resource editor and parity-shell overrides are layered late in the file, so mechanical deduplication is risky.

Split only with matched visual regression coverage, in this order:

1. tokens and reset/base;
2. shell and navigation;
3. shared view controls;
4. feature views;
5. Resource editor and overlays;
6. responsive and accessibility overrides.

Use cascade layers or an equally explicit ordering contract before deleting overrides.

## P0: add an independent CI and release gate

Railway currently runs source and build checks, but the same deployment is both the verifier and the release target. Add an independent GitHub Actions gate for syntax/source checks, build checks, baseline browser tests, and an isolated PostgreSQL smoke database before deployment. Keep post-deploy `/health`, public app/API access, mutation-origin rejection, and OAuth-origin probes as release checks.

## P1: harden the intentionally public deployment boundary

There is no application-level authorization. Anyone who can reach the Railway URL can read workspace state, initiate Google OAuth, and issue valid mutations after reading the current revision. Revision preconditions, Origin checks, and rate limits protect concurrency and browser request integrity; they do not establish ownership.

If the deployment must become private again, design authorization as an explicit product boundary: identity, per-route policy, shared sessions, audit events, browser logout/local-data handling, tests, credential lifecycle, and operations must land together. Do not silently restore the former single access-code gate.

After extracting an injectable server factory, add an integration test proving that unsafe public mutations reject missing or foreign Origin headers and that the Google OAuth callback still requires signed, expiring, one-time state and its matching cookie.

The public Railway `/health` readiness path currently performs a PostgreSQL status query on every request. Add a short shared-result cache or split low-cost liveness from database readiness so anonymous polling cannot consume the connection pool; preserve an uncached failure transition for Railway's deployment decision.

## P2: broaden feature coverage

The Playwright suite is heavily concentrated on Resources. Today/tasks, Inbox/capture, Projects, Habits, Journal, Calendar rendering and sync, Database view, and global navigation shortcuts need behavior-level coverage. The fixture server also duplicates substantial production behavior.

Next verification improvements:

- add focused smoke suites for every top-level view;
- replace fixture-server behavior with an injectable production server and memory storage;
- add focused public-boundary and OAuth integration tests against the extracted production server;

## Recommended execution order

1. Independent CI and post-deploy release gate.
2. Shared state contract and injectable server factory, including real OAuth integration coverage.
3. Public-boundary integration tests, request audit events, and cached readiness.
4. Incremental persistence and batched SQL.
5. Browser event/router/persistence modules.
6. Feature-by-feature browser modules.
7. CSS layers and visual cleanup.

Each item should land separately with `npm run check`, `npm run check:build`, its focused Playwright suites, and the relevant PostgreSQL check. Avoid combining the browser monolith split, persistence rewrite, and CSS reordering in one release.
