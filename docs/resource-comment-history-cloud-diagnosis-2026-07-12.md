# Resource comment history Cloud diagnosis — 2026-07-12

## Scope

- Target failure: `tests/e2e/resource-comment-history-integrity.spec.js`, test `inline comment creation and page discussion lifecycle are atomic undo/redo history entries`, original line 230.
- Runtime route: Node 22 via `npx -y node@22`, with a temporary `@sparticuz/chromium@149` install and a temporary Playwright config using `chromium.executablePath()`, `chromium.args`, `--disable-gpu`, and `--disable-webgl`.
- Temporary files used for diagnosis were removed before commit.

## Reproduction

Command:

```bash
npx -y node@22 node_modules/.bin/playwright test tests/e2e/resource-comment-history-integrity.spec.js:196 --config=playwright.sparticuz.tmp.config.js
```

Result before the fix: reproduced in 18.0s. The page discussion thread remained present on the fixture server for the full default 8,000 ms `expect.poll` window after `Meta+Z`.

## Instrumentation evidence

A temporary diagnostic spec logged the immediate browser state around the page-discussion undo:

- Before `Meta+Z`: active element was `BODY`, one `[data-resource-note]` existed, and the new page discussion thread was visible in the comments pane.
- Immediately after `Meta+Z`: active element was still `BODY`, the thread was still visible in the comments pane, and the fixture server still returned the thread.
- Repeating with `Control+Z` and a synthetic `KeyboardEvent` confirmed the failure was not merely an 8-second autosave delay for the visible pane assertion; the UI did not re-render the comments pane after the history restore.

## Root cause

The defect was a real comment-history UI/persistence integration issue rather than only autosave latency:

1. Comment-only page discussion creation could rely on the generic editor history path, which is optimized for block mutations. A dedicated comment-history wrapper now guarantees comment-thread-only changes are captured as editor undo/redo entries.
2. Restoring a resource editor-history entry updated resource blocks/comment threads and the editor surface, but it did not refresh the Resource detail comments pane. The local history restore could therefore leave the page discussion visibly present immediately after undo even when the resource model had been restored.
3. Server persistence still uses the existing asynchronous local resource operation/autosave path, so the regression test now asserts immediate UI state and then polls server state for the same bounded 20,000 ms duration used by the Cloud page-history tests.

## Fix

- Added `beginResourceCommentHistory()` and `commitResourceCommentHistory()` for resource comment-thread history entries.
- Routed page discussion creation through the dedicated comment-history helpers.
- Refreshed the Resource detail pane after restoring resource editor-history entries so page discussions, replies, resolved state, and delete state reflect undo/redo immediately in the UI.
- Strengthened the focused regression test to assert immediate DOM state for inline and page comments, then poll server convergence with a bounded 20,000 ms timeout.

## Commands and results

```bash
npm install --no-save @sparticuz/chromium@149
```

Succeeded. NPM emitted the expected engine warning when the install command ran under the container default Node 20, while the Playwright runs below used Node 22.

```bash
npx -y node@22 node_modules/.bin/playwright test tests/e2e/resource-comment-history-integrity.spec.js:197 --config=playwright.sparticuz.tmp.config.js
```

Passed: 1 passed in 26.1s after the fix.

```bash
npm run check
npm run check:build
```

Passed. `npm run check` completed source audit and worker checks. `npm run check:build` built assets and passed `scripts/check-build.mjs`.

```bash
npx -y node@22 node_modules/.bin/playwright test tests/e2e/resource-comment-history-integrity.spec.js --config=playwright.sparticuz.tmp.config.js
```

Partial Cloud result: 4 passed, 2 failed due to repeated `browserContext.newPage: Target page, context or browser has been closed` after the first focused test passed. The failed tests did not report assertion mismatches; the @sparticuz single-process browser closed between tests.

```bash
npx -y node@22 node_modules/.bin/playwright test tests/e2e/resource-page-history.spec.js tests/e2e/resource-page-features.spec.js tests/e2e/resource-block-menu-actions.spec.js --config=playwright.sparticuz.tmp.config.js
```

Partial Cloud result: 14 passed, 13 failed with the same `browserContext.newPage: Target page, context or browser has been closed` browser-lifecycle error. The run included directly related page history, page feature comment, and block-menu comment coverage; failures were environment/browser-route closures, not product assertion failures.

## Final result

The targeted Cloud reproduction now passes. The final root cause is a product-side comment-history restore/render gap combined with asynchronous server autosave latency. Coverage was strengthened rather than weakened: immediate UI behavior is asserted first, and eventual fixture-server convergence is bounded at 20 seconds, matching existing Cloud history-test practice.
