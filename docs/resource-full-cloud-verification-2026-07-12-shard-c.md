# Resource Full Cloud Verification — Shard C — 2026-07-12

## Scope

- Verification date: 2026-07-12.
- Branch under verification: current branch at commit `7765ef27252e4ac838148d75eae76deaad544ba8`.
- Requested durable report file: `docs/resource-full-cloud-verification-2026-07-12-shard-c.md`.
- File discipline: no product code, tests, package files, or existing docs were intentionally modified. A temporary `playwright.cloud.tmp.config.js` was created for the cloud Chromium route and removed after the run. Transient Playwright output was removed after recording results.

## Environment and Cloud Browser Route

- Node command/version: `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH node -v` → `v22.22.2`.
- npm command/version: `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm -v` → `11.4.2`.
- Dependency install command: `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm ci`.
- Cloud Chromium package command: `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm install @sparticuz/chromium@149.0.0 --no-save`.
- Chromium executable resolved by `@sparticuz/chromium`: `/tmp/chromium`.
- Chromium version command: `/tmp/chromium --version` → `Chromium 149.0.7827.0`.
- Temporary Playwright config followed the documented cloud route: `channel: undefined`; `launchOptions.executablePath = await chromium.executablePath()`; `launchOptions.args = ["--disable-gpu", "--disable-webgl"]`; `launchOptions.ignoreDefaultArgs = ["--enable-unsafe-swiftshader"]`.
- Common browser/server warning observed on Playwright runs: Node warned that `NO_COLOR` was ignored because `FORCE_COLOR` was set.

## Setup and Static Verification

| Step | Exact command | Result | Duration |
| --- | --- | --- | --- |
| Dependency install | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm ci` | Passed; `added 47 packages`, `audited 48 packages`, `found 0 vulnerabilities`. | ~2s |
| Cloud browser package | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm install @sparticuz/chromium@149.0.0 --no-save` | Passed; `added 18 packages`, `audited 66 packages`, `found 0 vulnerabilities`. | ~5s |
| Source/static check | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check` | Passed; `Source audit passed.` and `Sites worker check passed.` | ~3s |
| Build check | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check:build` | Passed; `Built SYGMA assets: 1316106 -> 919621 bytes (70%).`, `Precompressed Brotli assets: 159791 bytes (12% of source).`, and `Build check passed: 1316106 -> 919621 bytes (159791 Brotli, 206249 gzip).` | ~2s |

## First-Run Playwright Results

Each spec was run individually with a fresh browser/server process and unique `E2E_PORT`.

| Spec | Exact command | Port | First-run result | Counts | Duration | Failure / timeout message |
| --- | --- | ---: | --- | --- | ---: | --- |
| `resource-page-shell.spec.js` | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=44101 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-page-shell.spec.js` | 44101 | Passed | 17 passed, 0 failed, 0 skipped, 0 timed out | 169s; Playwright reported 2.8m | None |
| `resource-performance.spec.js` | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=44102 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-performance.spec.js` | 44102 | Failed | 0 passed, 1 failed, 0 skipped, 0 timed out | 12s | `Error: expect(received).toBeLessThan(expected)` at `tests/e2e/resource-performance.spec.js:79:35`; expected `< 500`, received `720.8000000007451` for `metrics.propertyPatchMs`. Reported metrics: `{"shellDomNodes":4557,"propertyPatchMs":720.8000000007451,"scrollResponseMs":1218.800000000745,"maxLongTaskMs":377,"totalLongTaskMs":1361,"longTaskCount":8,"readyMs":2125}`. |
| `resource-readonly.spec.js` | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=44103 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-readonly.spec.js` | 44103 | Passed | 2 passed, 0 failed, 0 skipped, 0 timed out | 21s; Playwright reported 19.2s | None |
| `resource-revision-conflict.spec.js` | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=44104 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-revision-conflict.spec.js` | 44104 | Passed | 1 passed, 0 failed, 0 skipped, 0 timed out | 33s; Playwright reported 30.5s | None |
| `resource-save-error-policy.spec.js` | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=44105 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-save-error-policy.spec.js` | 44105 | Passed | 6 passed, 0 failed, 0 skipped, 0 timed out | 82s; Playwright reported 1.3m | None |
| `resource-state-delete-guard.spec.js` | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=44106 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-state-delete-guard.spec.js` | 44106 | Passed | 3 passed, 0 failed, 0 skipped, 0 timed out | 17s; Playwright reported 15.0s | None |
| `resource-trash-view.spec.js` | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=44107 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-trash-view.spec.js` | 44107 | Failed | 5 passed, 1 failed, 0 skipped, 0 timed out | 73s; Playwright reported 1.2m | `Error: expect(locator).toBeVisible() failed` at `tests/e2e/resource-trash-view.spec.js:126:27`; locator `.delete-drag-stage`; expected visible; timeout 8000ms; element not found. Failed test: `Resource drag actions expose a reversible Trash target and never expose delete`. |
| `resource-url-paste-choice.spec.js` | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=44108 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-url-paste-choice.spec.js` | 44108 | Passed | 7 passed, 0 failed, 0 skipped, 0 timed out | 41s; Playwright reported 39.4s | None |
| `resource-viewport-matrix.spec.js` | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=44109 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-viewport-matrix.spec.js` | 44109 | Passed | 1 passed, 0 failed, 0 skipped, 0 timed out | 160s; Playwright reported 2.6m | None |
| `resource-visual-state-evidence.spec.js` | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=44110 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-visual-state-evidence.spec.js` | 44110 | Failed | 3 passed, 1 failed, 0 skipped, 1 timed out | 89s; Playwright reported 1.5m | `Test timeout of 30000ms exceeded` in `settled block hover, slash, selection, block-menu, and drag-guide evidence`; `page.evaluate` timed out at `tests/e2e/resource-visual-state-evidence.spec.js:47:14`, called from `capture` at line 61 and the test at line 257. |

### First-Run Aggregate

- Specs run: 10.
- Specs passed: 7.
- Specs failed: 3.
- Total tests: 48.
- Passed tests: 45.
- Failed tests: 3.
- Skipped tests: 0.
- Timed out tests: 1.
- First-run wall-clock sum: 697s.

## Reruns for Failed Specs

Each failed first-run spec was rerun once with a new fresh browser/server process and a separate unique port. These reruns are recorded separately and do not hide the first-run failures.

| Spec | Exact rerun command | Port | Rerun result | Counts | Duration | Failure / timeout message |
| --- | --- | ---: | --- | --- | ---: | --- |
| `resource-performance.spec.js` | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=44202 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-performance.spec.js` | 44202 | Failed | 0 passed, 1 failed, 0 skipped, 0 timed out | 12s | Same assertion class at `tests/e2e/resource-performance.spec.js:79:35`; expected `< 500`, received `742.7000000011176` for `metrics.propertyPatchMs`. Reported metrics: `{"shellDomNodes":4557,"propertyPatchMs":742.7000000011176,"scrollResponseMs":1216.5,"maxLongTaskMs":329,"totalLongTaskMs":1173,"longTaskCount":7,"readyMs":2077}`. |
| `resource-trash-view.spec.js` | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=44207 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-trash-view.spec.js` | 44207 | Failed | 5 passed, 1 failed, 0 skipped, 0 timed out | 73s; Playwright reported 1.2m | Same failure at `tests/e2e/resource-trash-view.spec.js:126:27`; locator `.delete-drag-stage`; expected visible; timeout 8000ms; element not found. |
| `resource-visual-state-evidence.spec.js` | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=44210 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-visual-state-evidence.spec.js` | 44210 | Failed | 2 passed, 2 failed, 0 skipped, 2 timed out | 96s; Playwright reported 1.6m | Test `settled library, Center, Side, toolbar, properties, and no-media hover evidence` timed out after 30000ms. Test `settled block hover, slash, selection, block-menu, and drag-guide evidence` also timed out after 30000ms during `page.screenshot` at `tests/e2e/resource-visual-state-evidence.spec.js:69:19`, called from `capture` at line 257. |

### Rerun Aggregate

- Specs rerun: 3.
- Specs passed on rerun: 0.
- Specs failed on rerun: 3.
- Total rerun tests: 11.
- Rerun passed tests: 7.
- Rerun failed tests: 4.
- Rerun skipped tests: 0.
- Rerun timed out tests: 2.
- Rerun wall-clock sum: 181s.

## Crash, Disconnect, and OOM Events

- Browser crashes reported: none observed.
- Playwright/browser disconnects reported: none observed.
- Out-of-memory events reported: none observed.
- Fixture servers started successfully for every first run and rerun on their assigned ports.
- Failed runs produced Playwright screenshots, error contexts, and traces under `output/playwright-test/` before cleanup.

## Cleanup and Final State

- Removed temporary cloud Playwright config: `playwright.cloud.tmp.config.js`.
- Removed transient Playwright output directory: `output/playwright-test`.
- Restored package files after the `@sparticuz/chromium@149.0.0 --no-save` install with `git checkout -- package.json package-lock.json`.
- Intended final diff: exactly this report file, `docs/resource-full-cloud-verification-2026-07-12-shard-c.md`.

## Concise Result Summary

Shard C did not pass on the first run. Static verification and build checks passed, and 7 of 10 first-run Playwright specs passed. The first-run failures were `resource-performance.spec.js`, `resource-trash-view.spec.js`, and `resource-visual-state-evidence.spec.js`. All three failed specs were rerun once with fresh browser/server processes and unique ports; all three still failed on rerun.
