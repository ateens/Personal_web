# Resource Page History Cloud Verification — 2026-07-12

## Scope

- Branch-head commit under verification: `f3e3c8e02e108df1c1123b30f7f80f0ed0f228e7`.
- Required durable report file: `docs/resource-page-history-cloud-verification-2026-07-12.md`.
- Requested app/test/package files were not edited. Temporary Playwright cloud config was created as `playwright.cloud.tmp.config.js` for the browser run and removed before finalizing. `package.json` and `package-lock.json` were restored after the `--no-save` browser package install.

## Runtime and Browser

- Node command/version used for verification: `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH node -v` → `v22.22.2`.
- npm version observed under Node 22: `11.4.2`.
- Cloud browser package install command: `npm install @sparticuz/chromium@149.0.0 --no-save`.
- Chromium executable resolved by `@sparticuz/chromium`: `/tmp/chromium`.
- Chromium version: `/tmp/chromium --version` → `Chromium 149.0.7827.0`.
- Temporary Playwright config used `channel: undefined`, `launchOptions.executablePath = await chromium.executablePath()`, `launchOptions.args = ["--disable-gpu", "--disable-webgl"]`, and `launchOptions.ignoreDefaultArgs = ["--enable-unsafe-swiftshader"]`.

## Verification Commands and Results

| Step | Exact command | Result | Elapsed |
| --- | --- | --- | --- |
| Dependency install | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm ci` | Passed; `added 47 packages`, `audited 48 packages`, `found 0 vulnerabilities`. | 3s |
| Cloud browser package | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm install @sparticuz/chromium@149.0.0 --no-save` | Passed; `added 18 packages`, `audited 66 packages`, `found 0 vulnerabilities`. | 5s |
| Static/source checks | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check` | Passed; `Source audit passed.` and `Sites worker check passed.` | 5s |
| Build check | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check:build` | Passed; built assets and `Build check passed: 1316106 -> 919621 bytes (159791 Brotli, 206249 gzip).` | 3s |
| Focused page-history test, first run | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-page-history.spec.js` | Failed. | 58s |
| Focused page-history test, retry | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-page-history.spec.js` | Failed with the same assertion. | 52s |

## Static and Build Results

- `npm run check`: passed all syntax checks, source audit, and Worker checks. No static failures were reported.
- `npm run check:build`: passed. Build output reported `Built SYGMA assets: 1316106 -> 919621 bytes (70%).`, `Precompressed Brotli assets: 159791 bytes (12% of source).`, and `Build check passed: 1316106 -> 919621 bytes (159791 Brotli, 206249 gzip).`

## Playwright Test Counts

### First focused run

- Total tests executed: 5.
- Passed: 4.
- Failed: 1.
- Skipped: 0.
- Timed out tests: 0 separately reported; the failed assertion's `expect.poll` timed out after 8000ms.
- Browser/setup failures: 0.
- Overall status: failed, exit status `1`.

### Retry run

- Total tests executed: 5.
- Passed: 4.
- Failed: 1.
- Skipped: 0.
- Timed out tests: 0 separately reported; the failed assertion's `expect.poll` timed out after 8000ms.
- Browser/setup failures: 0.
- Overall status: failed, exit status `1`.

## Failed Tests and Assertions

The same test failed in both the first run and the retry:

- Test: `tests/e2e/resource-page-history.spec.js:62:1 › block text, title, property, icon, cover, and page settings share one chronological history`.
- Assertion location: `tests/e2e/resource-page-history.spec.js:101:85`.
- Assertion: `await expect.poll(async () => (await currentResource(request)).pageSettings.font).toBe("default");`
- Expected value: `"default"`.
- Observed/received value: `"serif"`.
- Failure message: `Error: expect(received).toBe(expected) // Object.is equality`.
- Polling evidence: `Timeout 8000ms exceeded while waiting on the predicate`.
- First-run artifacts reported by Playwright:
  - Screenshot: `output/playwright-test/resource-page-history-bloc-7f44c-e-one-chronological-history/test-failed-1.png`.
  - Error context: `output/playwright-test/resource-page-history-bloc-7f44c-e-one-chronological-history/error-context.md`.
  - Trace: `output/playwright-test/resource-page-history-bloc-7f44c-e-one-chronological-history/trace.zip`.
- Retry artifacts reported by Playwright used the same output paths before cleanup.

## Retry Result

- One retry of the focused test command was performed after the initial failure.
- Retry result: failed.
- Retry reproduced the same failed test, assertion location, expected value (`"default"`), and observed value (`"serif"`).

## Crash, Disconnect, and OOM Evidence

- No browser crash was reported.
- No Playwright/browser disconnect was reported.
- No out-of-memory condition was reported.
- The fixture server started successfully on both Playwright runs: `Memory-only Playwright fixture listening on http://127.0.0.1:43128`.
- The only browser-run warnings observed were Node warnings that `NO_COLOR` was ignored because `FORCE_COLOR` was set.

## Cleanup and Final Git Status

- Removed temporary repo-local Playwright config: `playwright.cloud.tmp.config.js`.
- Restored package files after `@sparticuz/chromium@149.0.0 --no-save`: `git checkout -- package.json package-lock.json`.
- Removed transient Playwright output directory: `output/playwright-test`.
- Final git status before committing this report:

```text
?? docs/resource-page-history-cloud-verification-2026-07-12.md
```

Only this durable report file remains as the task diff.

---

## Superseding Rerun — Branch Head `b1d8f8b` — 2026-07-12

### Scope and File Discipline

- Supersedes the earlier run in this report for the requested branch head `b1d8f8b`.
- Product, test, and package files were not intentionally edited for this rerun.
- Temporary Playwright config was created as `playwright.cloud.tmp.config.js` and removed before final status capture.
- Transient Playwright output was removed from `output/playwright-test` before final status capture.
- `package.json` and `package-lock.json` were restored with `git checkout -- package.json package-lock.json` after installing `@sparticuz/chromium@149.0.0 --no-save`.

### Runtime and Browser

- Node command/version used: `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH node -v` → `v22.22.2`.
- npm version under Node 22: `11.4.2`.
- Cloud browser package command: `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm install @sparticuz/chromium@149.0.0 --no-save`.
- Cloud browser package install result: passed; `added 18 packages`, `audited 66 packages`, `found 0 vulnerabilities`; elapsed approximately 4s.
- Chromium executable resolved by `@sparticuz/chromium`: `/tmp/chromium`.
- Chromium version: `/tmp/chromium --version` → `Chromium 149.0.7827.0`.
- Temporary Playwright config used `channel: undefined`, `launchOptions.executablePath = await chromium.executablePath()`, `launchOptions.args = ["--disable-gpu", "--disable-webgl"]`, and `launchOptions.ignoreDefaultArgs = ["--enable-unsafe-swiftshader"]`.

### Verification Commands and Results

| Step | Exact command | Result | Elapsed |
| --- | --- | --- | --- |
| Dependency install | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm ci` | Passed; `added 47 packages`, `audited 48 packages`, `found 0 vulnerabilities`. | ~1s |
| Cloud browser package | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm install @sparticuz/chromium@149.0.0 --no-save` | Passed; `added 18 packages`, `audited 66 packages`, `found 0 vulnerabilities`. | ~4s |
| Static/source checks | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check` | Passed; `Source audit passed.` and `Sites worker check passed.` | 3.006s |
| Build check | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check:build` | Passed; built assets and `Build check passed: 1316106 -> 919621 bytes (159791 Brotli, 206249 gzip).` | 2.143s |
| Focused page-history test | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-page-history.spec.js` | Passed. | 47.404s wall time; Playwright reported 45.8s |

### Static and Build Results

- `npm run check`: passed all configured syntax checks, source audit, and Worker checks. Output ended with `Source audit passed.` and `Sites worker check passed.` No static failures were reported.
- `npm run check:build`: passed. Build output reported `Built SYGMA assets: 1316106 -> 919621 bytes (70%).`, `Precompressed Brotli assets: 159791 bytes (12% of source).`, and `Build check passed: 1316106 -> 919621 bytes (159791 Brotli, 206249 gzip).`

### Playwright Test Counts

- Total tests executed: 5.
- Passed: 5.
- Failed: 0.
- Skipped: 0.
- Timed out tests: 0.
- Browser/setup failures: 0.
- Overall status: passed, exit status `0`.

### Per-Test Results

| Result | Test |
| --- | --- |
| Passed | `tests/e2e/resource-page-history.spec.js:63:1 › block text, title, property, icon, cover, and page settings share one chronological history` |
| Passed | `tests/e2e/resource-page-history.spec.js:183:1 › title paste is plaintext-only, collapses newlines, preserves replacement caret, and rejects overflow atomically` |
| Passed | `tests/e2e/resource-page-history.spec.js:249:1 › native draft inputs keep native undo and do not consume page history` |
| Passed | `tests/e2e/resource-page-history.spec.js:270:1 › coalesced block text and IME commits use app history while a new edit invalidates redo` |
| Passed | `tests/e2e/resource-page-history.spec.js:309:1 › history is session-only and a reload cannot undo a persisted pre-reload edit` |

### Crash, Disconnect, and OOM Evidence

- No browser crash was reported.
- No Playwright/browser disconnect was reported.
- No out-of-memory condition was reported.
- The fixture server started successfully: `Memory-only Playwright fixture listening on http://127.0.0.1:43128`.
- The only browser-run warnings observed were Node warnings that `NO_COLOR` was ignored because `FORCE_COLOR` was set.

### Cleanup and Final Git Status

- Removed temporary repo-local Playwright config: `playwright.cloud.tmp.config.js`.
- Removed transient Playwright output directory: `output/playwright-test`.
- Restored package files after `@sparticuz/chromium@149.0.0 --no-save`: `git checkout -- package.json package-lock.json`.
- Final git status before committing this report:

```text
 M docs/resource-page-history-cloud-verification-2026-07-12.md
```

Only this durable report file remains as the task diff.
