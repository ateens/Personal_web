# Resource Comment + Trash Postfix Cloud Verification — 2026-07-12

## Scope

- Branch-head commit verified: `71e58dca2cfbd4857c6507f605aab70c74bcb172`.
- Required durable report file: `docs/resource-comment-trash-postfix-cloud-verification-2026-07-12.md`.
- File-discipline result: product code, tests, package files, and existing docs were not intentionally modified. This report is the only intended repository change.
- Requested focused specs:
  - `tests/e2e/resource-trash-view.spec.js` twice.
  - `tests/e2e/resource-comment-history-integrity.spec.js` twice.
  - `tests/e2e/resource-state-delete-guard.spec.js` once.
  - `tests/e2e/resource-block-menu-actions.spec.js` once.

## Environment

- Node command/version: `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH node -v` → `v22.22.2`.
- npm command/version: `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm -v` → `11.4.2`.
- Chromium package install command: `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm install @sparticuz/chromium@149.0.0 --no-save`.
- Chromium executable resolved by `@sparticuz/chromium`: `/tmp/chromium`.
- Chromium version: `/tmp/chromium --version` → `Chromium 149.0.7827.0`.
- Playwright route used for the valid browser runs:
  - `channel: undefined`.
  - `launchOptions.executablePath = await chromium.executablePath()`.
  - `launchOptions.args = ["--disable-gpu", "--disable-webgl"]`.
  - `launchOptions.ignoreDefaultArgs = ["--enable-unsafe-swiftshader"]`.
- Each valid Playwright command below used `reuseExistingServer: false`, one worker, a fresh fixture server/browser process, and a unique `E2E_PORT`.

## Setup and Static Checks

| Step | Exact command | Result |
| --- | --- | --- |
| Dependency install | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm ci` | Passed: `added 47 packages`, `audited 48 packages`, `found 0 vulnerabilities`. |
| Cloud Chromium package | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm install @sparticuz/chromium@149.0.0 --no-save` | Passed: `added 18 packages`, `audited 66 packages`, `found 0 vulnerabilities`. |
| Static/source checks | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check` | Passed: output ended with `Source audit passed.` and `Sites worker check passed.` |
| Build check | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check:build` | Passed: output included `Build check passed: 1317944 -> 920888 bytes (159812 Brotli, 206421 gzip).` |

## Valid Focused Playwright Runs

| Run | Spec | Exact command | Port | Result | Counts | Playwright duration |
| --- | --- | --- | ---: | --- | --- | --- |
| Trash 1 | `tests/e2e/resource-trash-view.spec.js` | `E2E_PORT=47201 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.verify.config.mjs tests/e2e/resource-trash-view.spec.js` | 47201 | Passed | 6 passed, 0 failed, 0 skipped, 0 timed out | 1.1m |
| Trash 2 | `tests/e2e/resource-trash-view.spec.js` | `E2E_PORT=47202 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.verify.config.mjs tests/e2e/resource-trash-view.spec.js` | 47202 | Failed | 5 passed, 1 failed, 0 skipped, 0 timed out | 1.1m |
| Comment history 1 | `tests/e2e/resource-comment-history-integrity.spec.js` | `E2E_PORT=47203 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.verify.config.mjs tests/e2e/resource-comment-history-integrity.spec.js` | 47203 | Passed | 6 passed, 0 failed, 0 skipped, 0 timed out | 55.8s |
| Comment history 2 | `tests/e2e/resource-comment-history-integrity.spec.js` | `E2E_PORT=47204 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.verify.config.mjs tests/e2e/resource-comment-history-integrity.spec.js` | 47204 | Passed | 6 passed, 0 failed, 0 skipped, 0 timed out | 51.0s |
| Delete guard | `tests/e2e/resource-state-delete-guard.spec.js` | `E2E_PORT=47205 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.verify.config.mjs tests/e2e/resource-state-delete-guard.spec.js` | 47205 | Passed | 3 passed, 0 failed, 0 skipped, 0 timed out | 12.7s |
| Menu actions | `tests/e2e/resource-block-menu-actions.spec.js` | `E2E_PORT=47206 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.verify.config.mjs tests/e2e/resource-block-menu-actions.spec.js` | 47206 | Passed | 3 passed, 0 failed, 0 skipped, 0 timed out | 35.5s |

## Valid Focused Run Aggregate

- Total valid spec process runs: 6.
- Passed spec process runs: 5.
- Failed spec process runs: 1.
- Total tests executed in valid runs: 30.
- Passed tests: 29.
- Failed tests: 1.
- Skipped tests: 0.
- Timed-out tests: 0.
- Browser crashes: none reported.
- Browser/server disconnects: none reported.
- Test-level timeouts: none reported.

## Failure Detail

### `resource-trash-view.spec.js` second run, port 47202

- Failed test: `tests/e2e/resource-trash-view.spec.js:105:1 › Resource drag actions expose a reversible Trash target and never expose delete`.
- Assertion location: `tests/e2e/resource-trash-view.spec.js:126:27`.
- Failure type: Playwright assertion timeout waiting for `.delete-drag-stage`, not a test-level timeout.
- Counts for this run: 5 passed, 1 failed, 0 skipped, 0 timed out.
- Reported artifacts:
  - Screenshot: `output/playwright-test/resource-trash-view-Resour-5a462-get-and-never-expose-delete/test-failed-1.png`.
  - Error context: `output/playwright-test/resource-trash-view-Resour-5a462-get-and-never-expose-delete/error-context.md`.
  - Trace: `output/playwright-test/resource-trash-view-Resour-5a462-get-and-never-expose-delete/trace.zip`.

Failure excerpt:

```text
Error: expect(locator).toBeVisible() failed

Locator: locator('.delete-drag-stage')
Expected: visible
Timeout: 8000ms
Error: element(s) not found
```

## Initial Invalid Harness Attempts

Before the valid focused runs above, the same six requested commands were attempted with the cloud Playwright config stored under `/tmp`. Those attempts failed before starting the fixture server or browser because Node could not resolve `@playwright/test` from `/tmp/playwright.cloud.verify.config.mjs`. They are recorded here so the setup error is not hidden, but they are not counted as valid product/browser test runs.

| Attempt | Spec | Port | Result | Counts |
| --- | --- | ---: | --- | --- |
| Invalid harness 1 | `tests/e2e/resource-trash-view.spec.js` | 47101 | Failed before browser/server start | 0 passed, 0 failed test assertions, 0 skipped, 0 timed out |
| Invalid harness 2 | `tests/e2e/resource-trash-view.spec.js` | 47102 | Failed before browser/server start | 0 passed, 0 failed test assertions, 0 skipped, 0 timed out |
| Invalid harness 3 | `tests/e2e/resource-comment-history-integrity.spec.js` | 47103 | Failed before browser/server start | 0 passed, 0 failed test assertions, 0 skipped, 0 timed out |
| Invalid harness 4 | `tests/e2e/resource-comment-history-integrity.spec.js` | 47104 | Failed before browser/server start | 0 passed, 0 failed test assertions, 0 skipped, 0 timed out |
| Invalid harness 5 | `tests/e2e/resource-state-delete-guard.spec.js` | 47105 | Failed before browser/server start | 0 passed, 0 failed test assertions, 0 skipped, 0 timed out |
| Invalid harness 6 | `tests/e2e/resource-block-menu-actions.spec.js` | 47106 | Failed before browser/server start | 0 passed, 0 failed test assertions, 0 skipped, 0 timed out |

Invalid harness error excerpt:

```text
Error: Cannot find package '@playwright/test' imported from /tmp/playwright.cloud.verify.config.mjs
```

## Cleanup Notes

- The temporary repository-local Playwright config `playwright.cloud.verify.config.mjs` was removed after valid runs.
- The transient package-file changes caused by the `@sparticuz/chromium@149.0.0 --no-save` install were not kept.
- Transient local logs were kept outside the repository under `/tmp/verify-logs` and `/tmp/verify-logs2`.
