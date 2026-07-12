# Resource editor matrix isolation post-fix Cloud verification (2026-07-12)

## Scope

Verified the latest branch head after the fixture reset-generation isolation fix. Product code, tests, package files, Playwright config, and existing docs were not edited. The only intended repository change from this verification is this new document.

## Environment

- Date: 2026-07-12 UTC.
- Node: `v22.23.1` via `nvm use 22`.
- npm: `10.9.8`.
- Temporary Cloud browser package: `npm install --no-save @sparticuz/chromium@149.0.0`.
- Temporary repo-local Playwright Cloud config: `playwright.cloud.tmp.config.mjs`; removed before completion.
- Temporary config used `@sparticuz/chromium` executable path and args, with the same base test directory, single worker, locale/timezone/viewport, fixture server, and `E2E_PORT` behavior as the committed Playwright config.

## Setup and static checks

| Command | Result | Notes |
| --- | --- | --- |
| `source /root/.nvm/nvm.sh && nvm use 22 >/dev/null && node -v && npm ci` | Passed | Printed `v22.23.1`; installed 21 packages; 0 vulnerabilities. |
| `source /root/.nvm/nvm.sh && nvm use 22 >/dev/null && npm install --no-save @sparticuz/chromium@149.0.0` | Passed | Added 18 temporary packages; 0 vulnerabilities. |
| `source /root/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run check` | Passed | Source audit and worker check passed. |
| `source /root/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run check:build` | Passed | Build check passed: `1319214 -> 921781 bytes (159949 Brotli, 206670 gzip)`. |

## Playwright runs

All Playwright commands used Node 22 and `-c playwright.cloud.tmp.config.mjs`. Each matrix run used a unique port so it started a fresh fixture server/browser process.

| Run | Command | Port | Result | Pass | Fail | Skip | Timeout | Browser crash/disconnect/OOM events |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| Baseline focused | `E2E_PORT=55101 npx playwright test -c playwright.cloud.tmp.config.mjs -g "fixture generation rejects pre-reset stale writes before revision checks" tests/e2e/resource-baseline.spec.js --reporter=json` | 55101 | Passed | 1 | 0 | 0 | 0 | None. |
| Baseline full | `E2E_PORT=55102 npx playwright test -c playwright.cloud.tmp.config.mjs tests/e2e/resource-baseline.spec.js --reporter=json` | 55102 | Failed | 4 | 5 | 0 | 0 | Browser closed / target closed events; one socket hang-up. No explicit OOM text. |
| Matrix 1 | `E2E_PORT=55111 npx playwright test -c playwright.cloud.tmp.config.mjs tests/e2e/resource-editor-matrix.spec.js --reporter=json` | 55111 | Failed | 8 | 7 | 0 | 0 | Browser closed / target closed events. No explicit OOM text. |
| Matrix 2 | `E2E_PORT=55112 npx playwright test -c playwright.cloud.tmp.config.mjs tests/e2e/resource-editor-matrix.spec.js --reporter=json` | 55112 | Failed | 8 | 7 | 0 | 0 | Browser closed / target closed events. No explicit OOM text. |
| Matrix 3 | `E2E_PORT=55113 npx playwright test -c playwright.cloud.tmp.config.mjs tests/e2e/resource-editor-matrix.spec.js --reporter=json` | 55113 | Failed | 8 | 7 | 0 | 0 | Browser closed / target closed events. No explicit OOM text. |
| Matrix 4 | `E2E_PORT=55114 npx playwright test -c playwright.cloud.tmp.config.mjs tests/e2e/resource-editor-matrix.spec.js --reporter=json` | 55114 | Failed | 8 | 7 | 0 | 0 | Browser closed / target closed events. No explicit OOM text. |
| Matrix 5 | `E2E_PORT=55115 npx playwright test -c playwright.cloud.tmp.config.mjs tests/e2e/resource-editor-matrix.spec.js --reporter=json` | 55115 | Failed | 8 | 7 | 0 | 0 | Browser closed / target closed events. No explicit OOM text. |
| Offline | `E2E_PORT=55121 npx playwright test -c playwright.cloud.tmp.config.mjs tests/e2e/resource-offline.spec.js --reporter=json` | 55121 | Failed | 3 | 4 | 0 | 1 | Browser closed / target closed events. No explicit OOM text. |
| Save error policy | `E2E_PORT=55122 npx playwright test -c playwright.cloud.tmp.config.mjs tests/e2e/resource-save-error-policy.spec.js --reporter=json` | 55122 | Failed | 3 | 3 | 0 | 1 | Browser closed / target closed events. No explicit OOM text. |

## Failure messages

### Baseline full

- `fixture generation rejects pre-reset stale writes before revision checks`: `Error: browserContext.newPage: Target page, context or browser has been closed`.
- `Resource filter minimally patches the open Side database context`: `Error: browserContext.newPage: Target page, context or browser has been closed`.
- `Resource sort minimally patches the open Side database context`: `Error: apiRequestContext.get: socket hang up`; call log showed `GET http://127.0.0.1:55102/__e2e__/state` from Playwright `node/22.23`.
- `Resource opens and closes without changing fixture content`: `Error: browserContext.newPage: Target page, context or browser has been closed`.
- `unsafe inline-link schemes never become anchors in the local DOM`: `Error: browserContext.newPage: Target page, context or browser has been closed`.

### Resource editor matrix, runs 1-5

Each of the five fresh-process matrix runs had the same seven failed test titles and the same failure message shape:

- `divider Markdown renders and focuses its continuation paragraph`: `Error: browserContext.newPage: Target page, context or browser has been closed`.
- `Enter splits a block while Shift+Enter inserts a soft line break`: `Error: browserContext.newPage: Target page, context or browser has been closed`.
- `Tab and Shift+Tab indent and outdent the current block`: `Error: browserContext.newPage: Target page, context or browser has been closed`.
- `Cmd+A selects current text first and the block second`: `Error: browserContext.newPage: Target page, context or browser has been closed`.
- `slash, mention, emoji, and equation commands open, select, and apply`: `Error: browserContext.newPage: Target page, context or browser has been closed`.
- `Escape selects a block, clears the selection, then closes the Resource page`: `Error: browserContext.newPage: Target page, context or browser has been closed`.
- `Korean IME composition ignores slash, Enter, Backspace, and single-line synthetic paste`: `Error: browserContext.newPage: Target page, context or browser has been closed`.

The browser launch log for these failures used `/tmp/chromium` from `@sparticuz/chromium@149.0.0` and included Chromium flags from `@sparticuz/chromium.args`, including `--single-process`, `--headless='shell'`, `--no-sandbox`, and `--no-zygote`. Several logs also contained the console line `Service Worker registration blocked by Playwright` before the browser/context closed.

### Offline

- `a first-offline title input survives immediate pagehide and migrates once to the real workspace`: `Error: browserContext.newPage: Target page, context or browser has been closed` at `openServiceWorkerControlledApp`.
- `an offline title edit survives a direct deep-link reload without reaching the server`: `Test timeout of 30000ms exceeded`.
- `a transient write failure is visible as Retrying and keeps the operation until the retry succeeds`: `Error: browserContext.newPage: Target page, context or browser has been closed` at `openServiceWorkerControlledApp`.
- `a waiting service-worker update is blocked by pending work and only applies after a successful save`: `Error: browserContext.newPage: Target page, context or browser has been closed` at `openServiceWorkerControlledApp`.

### Save error policy

- `terminal validation failure is durable, never loops or reload-retries, and only the affected Resource rearms it`: `Test timeout of 45000ms exceeded`.
- `425 is transient and retries with the queued payload`: `Error: browserContext.newPage: Target page, context or browser has been closed`.
- `503 is transient and retries with the queued payload`: `Error: browserContext.newPage: Target page, context or browser has been closed`.

## Package/config immutability confirmation

- Confirmed `package.json`, `package-lock.json`, and `playwright.config.js` had no diff after the temporary `@sparticuz/chromium@149.0.0 --no-save` install and after removing the temporary Cloud config: `git diff --exit-code -- package.json package-lock.json playwright.config.js` returned exit code `0`.
- `playwright.cloud.tmp.config.mjs` was removed before completion.
