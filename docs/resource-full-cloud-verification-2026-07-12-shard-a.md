# Resource Full Cloud Verification — 2026-07-12 — Shard A

## Scope

- Branch-head commit under verification: `7765ef27252e4ac838148d75eae76deaad544ba8`.
- Required durable report file: `docs/resource-full-cloud-verification-2026-07-12-shard-a.md`.
- Requested file discipline was followed: product code, tests, package files, and existing docs were not intentionally modified.
- Temporary files used during verification were removed before final status capture: `playwright.cloud.tmp.config.js`, `tmp-verification-logs/`, and `output/playwright-test/`.

## Environment and Cloud Browser

- Node command/version: `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH node -v` → `v22.22.2`.
- npm version under Node 22: `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm -v` → `11.4.2`.
- Branch-head command: `git rev-parse HEAD` → `7765ef27252e4ac838148d75eae76deaad544ba8`.
- Cloud browser package command, matching the documented Cloud Chromium route: `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm install @sparticuz/chromium@149.0.0 --no-save`.
- Cloud browser package result: passed; `added 18 packages`, `audited 66 packages`, `found 0 vulnerabilities`; npm-reported duration `4s`.
- Chromium executable resolved by `@sparticuz/chromium`: `/tmp/chromium`.
- Chromium version: `/tmp/chromium --version` → `Chromium 149.0.7827.0`.
- Temporary Playwright cloud config used `channel: undefined`, `launchOptions.executablePath = await chromium.executablePath()`, `launchOptions.args = ["--disable-gpu", "--disable-webgl"]`, and `launchOptions.ignoreDefaultArgs = ["--enable-unsafe-swiftshader"]`.

## Setup, Static Checks, and Build Checks

| Step | Exact command | Result | Duration |
| --- | --- | --- | --- |
| Dependency install | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm ci` | Passed; `added 47 packages`, `audited 48 packages`, `found 0 vulnerabilities`. | npm-reported `1s` |
| Cloud browser package | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm install @sparticuz/chromium@149.0.0 --no-save` | Passed; `added 18 packages`, `audited 66 packages`, `found 0 vulnerabilities`. | npm-reported `4s` |
| Static/source checks | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check` | Passed; output ended with `Source audit passed.` and `Sites worker check passed.` | observed approximately `2s` |
| Build check | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check:build` | Passed; output included `Build check passed: 1316106 -> 919621 bytes (159791 Brotli, 206249 gzip).` | observed approximately `2s` |

## First-Run Playwright Results

Each spec below was executed individually with a fresh Playwright browser/server process and a unique `E2E_PORT`.

| Spec | Exact command | Port | First-run result | Counts | Duration |
| --- | --- | ---: | --- | --- | --- |
| `resource-a11y-axe.spec.js` | `E2E_PORT=45100 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-a11y-axe.spec.js` | 45100 | Passed | 5 passed, 0 failed, 0 skipped, 0 timed out | shell `54s`; Playwright `50.5s` |
| `resource-baseline.spec.js` | `E2E_PORT=45101 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-baseline.spec.js` | 45101 | Passed | 8 passed, 0 failed, 0 skipped, 0 timed out | shell `69s`; Playwright `1.1m` |
| `resource-block-deep-link.spec.js` | `E2E_PORT=45102 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-block-deep-link.spec.js` | 45102 | Passed | 4 passed, 0 failed, 0 skipped, 0 timed out | shell `18s`; Playwright `16.4s` |
| `resource-block-menu-actions.spec.js` | `E2E_PORT=45103 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-block-menu-actions.spec.js` | 45103 | Passed | 3 passed, 0 failed, 0 skipped, 0 timed out | shell `26s`; Playwright `24.1s` |
| `resource-comment-history-integrity.spec.js` | `E2E_PORT=45104 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-comment-history-integrity.spec.js` | 45104 | Failed | 5 passed, 1 failed, 0 skipped, 0 timed out | shell `43s`; Playwright `42.3s` |
| `resource-comment-read-cursor.spec.js` | `E2E_PORT=45105 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-comment-read-cursor.spec.js` | 45105 | Passed | 4 passed, 0 failed, 0 skipped, 0 timed out | shell `20s`; Playwright `18.2s` |
| `resource-cross-page-block-move.spec.js` | `E2E_PORT=45106 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-cross-page-block-move.spec.js` | 45106 | Passed | 7 passed, 0 failed, 0 skipped, 0 timed out | shell `47s`; Playwright `46.3s` |
| `resource-dom-stability.spec.js` | `E2E_PORT=45107 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-dom-stability.spec.js` | 45107 | Passed | 4 passed, 0 failed, 0 skipped, 0 timed out | shell `36s`; Playwright `33.8s` |
| `resource-editor-matrix.spec.js` | `E2E_PORT=45108 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-editor-matrix.spec.js` | 45108 | Failed | 14 passed, 1 failed, 0 skipped, 0 timed out | shell `63s`; Playwright `1.0m` |
| `resource-editor-transport.spec.js` | `E2E_PORT=45109 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-editor-transport.spec.js` | 45109 | Passed | 9 passed, 0 failed, 0 skipped, 0 timed out | shell `64s`; Playwright `1.0m` |

### First-Run Aggregate Counts

- Total specs: 10.
- Passed specs: 8.
- Failed specs: 2.
- Total tests: 65.
- Passed tests: 63.
- Failed tests: 2.
- Skipped tests: 0.
- Timed out tests: 0. Both failures were assertion/expect timeouts, not Playwright test-level timeouts.

## First-Run Failure Messages

### `resource-comment-history-integrity.spec.js`

- Failed test: `tests/e2e/resource-comment-history-integrity.spec.js:196:1 › inline comment creation and page discussion lifecycle are atomic undo/redo history entries`.
- Assertion location: `tests/e2e/resource-comment-history-integrity.spec.js:230:84`.
- Failure message:

```text
Error: expect(received).toBe(expected) // Object.is equality

Expected: false
Received: true

Call Log:
- Timeout 8000ms exceeded while waiting on the predicate

  228 |   }).not.toBe("");
  229 |   await page.keyboard.press("Meta+z");
> 230 |   await expect.poll(async () => Boolean(await threadState(request, pageThreadId))).toBe(false);
      |                                                                                    ^
```

- First-run artifacts reported by Playwright:
  - Screenshot: `output/playwright-test/resource-comment-history-i-6e2cb-c-undo-redo-history-entries/test-failed-1.png`.
  - Error context: `output/playwright-test/resource-comment-history-i-6e2cb-c-undo-redo-history-entries/error-context.md`.
  - Trace: `output/playwright-test/resource-comment-history-i-6e2cb-c-undo-redo-history-entries/trace.zip`.

### `resource-editor-matrix.spec.js`

- Failed test: `tests/e2e/resource-editor-matrix.spec.js:108:1 › divider Markdown renders and focuses its continuation paragraph`.
- Assertion location: `tests/e2e/resource-editor-matrix.spec.js:116:117`.
- Failure message:

```text
Error: expect(locator).toBeFocused() failed

Locator:  locator('[data-resource-note="fixture-resource-main"]').locator('[data-block-id="fixture-block-callout"] + .block [data-block-content]')
Expected: focused
Received: inactive
Timeout:  8000ms

Call log:
  - Expect "toBeFocused" with timeout 8000ms
  - waiting for locator('[data-resource-note="fixture-resource-main"]').locator('[data-block-id="fixture-block-callout"] + .block [data-block-content]')
    20 × locator resolved to <span role="textbox" spellcheck="true" aria-multiline="true" contenteditable="true" aria-label="텍스트 블록 편집" data-placeholder="입력 또는 /" class="block-content is-empty" data-block-content="4714211a-0e40-49fd-91f7-b258854844e3"></span>
       - unexpected value "inactive"

  114 |   await expect.poll(() => resourceBlockCount(request)).toBe(beforeCount + 1);
  115 |   await expect(blocks).toHaveCount(beforeCount + 1);
> 116 |   await expect(resourceNote(page).locator('[data-block-id="fixture-block-callout"] + .block [data-block-content]')).toBeFocused();
      |                                                                                                                     ^
```

- First-run artifacts reported by Playwright:
  - Screenshot: `output/playwright-test/resource-editor-matrix-div-b5e49--its-continuation-paragraph/test-failed-1.png`.
  - Error context: `output/playwright-test/resource-editor-matrix-div-b5e49--its-continuation-paragraph/error-context.md`.
  - Trace: `output/playwright-test/resource-editor-matrix-div-b5e49--its-continuation-paragraph/trace.zip`.

## Reruns of Failed Specs

Each failed spec was rerun once with a fresh browser/server process and a unique rerun port. These reruns are reported separately and do not hide first-run failures.

| Spec | Exact rerun command | Port | Rerun result | Counts | Duration |
| --- | --- | ---: | --- | --- | --- |
| `resource-comment-history-integrity.spec.js` | `E2E_PORT=46104 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-comment-history-integrity.spec.js` | 46104 | Failed | 5 passed, 1 failed, 0 skipped, 0 timed out | shell `44s`; Playwright `41.6s` |
| `resource-editor-matrix.spec.js` | `E2E_PORT=46108 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-editor-matrix.spec.js` | 46108 | Passed | 15 passed, 0 failed, 0 skipped, 0 timed out | shell `53s`; Playwright `51.1s` |

### Rerun Failure Message

`resource-comment-history-integrity.spec.js` failed on rerun with the same failed test, assertion location, expected value, received value, and `expect.poll` timeout as the first run:

```text
Error: expect(received).toBe(expected) // Object.is equality

Expected: false
Received: true

Call Log:
- Timeout 8000ms exceeded while waiting on the predicate

  228 |   }).not.toBe("");
  229 |   await page.keyboard.press("Meta+z");
> 230 |   await expect.poll(async () => Boolean(await threadState(request, pageThreadId))).toBe(false);
      |                                                                                    ^
```

## Crash, Disconnect, and OOM Events

- Browser crashes: none reported.
- Playwright/browser disconnects: none reported.
- Out-of-memory events: none reported.
- Every first-run and rerun fixture server started successfully on its assigned unique port.
- The only repeated runtime warnings observed during browser runs were:
  - npm warning: `Unknown env config "http-proxy". This will stop working in the next major version of npm.`
  - Node warning: `The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.`

## Cleanup and Final Status

- Removed temporary Playwright cloud config: `playwright.cloud.tmp.config.js`.
- Removed transient local logs: `tmp-verification-logs/`.
- Removed transient Playwright output: `output/playwright-test/`.
- Restored package files after the `@sparticuz/chromium@149.0.0 --no-save` install with `git checkout -- package.json package-lock.json`.
- Final intended diff: only `docs/resource-full-cloud-verification-2026-07-12-shard-a.md`.

## Concise Result Summary

Shard A completed under Node 22 and Cloud Chromium. Static checks and build checks passed. First-run Playwright results were 63 passed and 2 failed across 65 tests; no skips, test-level timeouts, crashes, disconnects, or OOM events were reported. The `resource-comment-history-integrity.spec.js` failure reproduced on its single rerun, while the `resource-editor-matrix.spec.js` failure passed on its single rerun.
