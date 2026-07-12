# Resource Editor Matrix Isolation Cloud Diagnosis — 2026-07-12

## Production-neutral fix

The isolated Playwright fixture server intentionally resets the in-memory workspace back to `serverRevision: 1` for every `POST /__e2e__/reset`. That made revision-only concurrency ambiguous: a delayed autosave from a page opened before reset could still send `baseRevision: 1` and match the freshly reset fixture.

The fix adds a fixture-only, monotonically increasing `resetGeneration`:

- `POST /__e2e__/reset` increments `resetGeneration` while continuing to reset `serverRevision` to `1`.
- Fixture status/state responses expose the generation for deterministic tests and for the browser app when running against the fixture server.
- The app stores the value only on `databaseBackendStatus` when `/api/state/status` supplies it.
- Full-state and incremental Resource writes echo it as top-level `e2eFixtureGeneration` only when the field exists.
- Production status responses omit `resetGeneration`, so production request bodies do not include `e2eFixtureGeneration`.
- The fixture server checks a supplied generation before revision checks and rejects stale supplied values with `409 E2E_FIXTURE_GENERATION_CONFLICT`.
- Existing fixture helper/direct requests that omit `e2eFixtureGeneration` remain allowed so older deterministic helper flows keep working.

This keeps the isolation guard entirely inside fixture-generation plumbing and avoids mutating or persisting the generation inside application state.

## Regression coverage

The focused regression test captures generation/revision, resets back to `serverRevision: 1` with a newer generation, submits a stale-generation write at `baseRevision: 1`, and asserts:

- HTTP `409` with code `E2E_FIXTURE_GENERATION_CONFLICT`.
- No state mutation.
- No revision mutation.
- A current-generation Resource write still succeeds and advances revision.

## Guardrails preserved

- The memory-only fixture server still advertises `X-E2E-Fixture: memory-only` and `X-E2E-Production-Write-Guard: active`.
- Production-write guard assertions remain in the baseline e2e coverage.
- No browser route, dependency, engine, or Playwright configuration changes are required.
- No `@sparticuz/chromium` dependency is added.
