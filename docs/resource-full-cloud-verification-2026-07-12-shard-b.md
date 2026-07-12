# Resource Full Cloud Verification — Shard B — 2026-07-12

## Scope

- Branch-head commit under verification: `7765ef2`.
- Durable report file requested: `docs/resource-full-cloud-verification-2026-07-12-shard-b.md`.
- Product code, tests, package files, and existing docs were not edited.
- Temporary Playwright cloud config `playwright.cloud.tmp.config.js` and transient `output/playwright-test` artifacts were removed after the run.
- `package.json` and `package-lock.json` were restored after the temporary `@sparticuz/chromium@149.0.0 --no-save` install.

## Environment and Cloud Chromium Route

- Node command/version: `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH node -v` → `v22.22.2`.
- npm command/version: `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm -v` → `11.4.2`.
- Cloud browser package command: `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm install @sparticuz/chromium@149.0.0 --no-save`.
- Chromium executable resolved by `@sparticuz/chromium`: `/tmp/chromium`.
- Chromium version: `/tmp/chromium --version` → `Chromium 149.0.7827.0`.
- Temporary Playwright cloud config used the documented Cloud Chromium route: `channel: undefined`, `launchOptions.executablePath = await chromium.executablePath()`, `launchOptions.args = ["--disable-gpu", "--disable-webgl"]`, and `launchOptions.ignoreDefaultArgs = ["--enable-unsafe-swiftshader"]`.
- Each Playwright spec was run as an individual command with a fresh browser/server process and a unique `E2E_PORT` value.

## Required Command Results

| Step | Exact command | Result | Wall duration |
| --- | --- | --- | --- |
| Dependency install | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm ci` | Passed; `added 47 packages`, `audited 48 packages`, `found 0 vulnerabilities`. | 2s |
| Cloud browser package | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm install @sparticuz/chromium@149.0.0 --no-save` | Passed; `added 18 packages`, `audited 66 packages`, `found 0 vulnerabilities`. | 6s |
| Static/source checks | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check` | Passed; `Source audit passed.` and `Sites worker check passed.` | 4s |
| Build check | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check:build` | Passed; `Build check passed: 1316106 -> 919621 bytes (159791 Brotli, 206249 gzip).` | 3s |

## First-Run Playwright Results

| Spec | Port | First-run result | Pass | Fail | Skip | Timeout | Duration | Failure message |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- | --- |
| `tests/e2e/resource-full-docked-nav.spec.js` | 45200 | Passed | 7 | 0 | 0 | 0 | 67s wall; Playwright reported 1.1m | None |
| `tests/e2e/resource-hierarchy-persistence.spec.js` | 45201 | Passed | 6 | 0 | 0 | 0 | 72s wall; Playwright reported 1.2m | None |
| `tests/e2e/resource-inline-toolbar.spec.js` | 45202 | Failed | 4 | 1 | 0 | 0 test timeouts; assertion poll timed out after 10000ms | 45s wall; Playwright reported 43.3s | `tests/e2e/resource-inline-toolbar.spec.js:134:1 › toolbar flips around the selection and stays inside the 12px viewport inset`; at line 160, `expect(received).toBe(expected)` expected `true`, received `false`; call log: `Timeout 10000ms exceeded while waiting on the predicate`. |
| `tests/e2e/resource-input-limits.spec.js` | 45203 | Passed | 2 | 0 | 0 | 0 | 34s wall; Playwright reported 32.2s | None |
| `tests/e2e/resource-offline.spec.js` | 45204 | Passed | 7 | 0 | 0 | 0 | 84s wall; Playwright reported 1.4m | None |
| `tests/e2e/resource-p0.spec.js` | 45205 | Passed | 8 | 0 | 0 | 0 | 93s wall; Playwright reported 1.5m | None |
| `tests/e2e/resource-page-command-mentions.spec.js` | 45206 | Passed | 2 | 0 | 0 | 0 | 21s wall; Playwright reported 19.2s | None |
| `tests/e2e/resource-page-features.spec.js` | 45207 | Failed | 18 | 1 | 0 | 0 | 190s wall; Playwright reported 3.1m | `tests/e2e/resource-page-features.spec.js:132:1 › page title owns document semantics and moves focus to and from the first block`; at line 141, `expect(locator).toBeFocused()` expected focused, received inactive; timeout 10000ms. |
| `tests/e2e/resource-page-history.spec.js` | 45208 | Failed | 4 | 1 | 0 | 0 | 61s wall; Playwright reported 59.9s | `tests/e2e/resource-page-history.spec.js:63:1 › block text, title, property, icon, cover, and page settings share one chronological history`; at line 103, `expect(locator).toHaveAttribute(expected)` expected `data-resource-font="default"`, received `"serif"`; timeout 10000ms. |
| `tests/e2e/resource-page-lock.spec.js` | 45209 | Passed | 5 | 0 | 0 | 0 | 64s wall; Playwright reported 1.0m | None |

### First-Run Totals

- Total specs: 10.
- Passed specs: 7.
- Failed specs: 3.
- Total tests: 66.
- Passed tests: 63.
- Failed tests: 3.
- Skipped tests: 0.
- Timed-out tests: 0. The three failures were assertion/predicate timeouts, not Playwright test-timeout terminations.

## Failed-Spec Reruns

| Spec | Rerun port | Rerun result | Pass | Fail | Skip | Timeout | Duration | Failure message |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- | --- |
| `tests/e2e/resource-inline-toolbar.spec.js` | 45302 | Failed | 4 | 1 | 0 | 0 test timeouts; assertion poll timed out after 10000ms | 45s wall; Playwright reported 42.4s | Same failure as first run: `toolbar flips around the selection and stays inside the 12px viewport inset`; at line 160, expected `true`, received `false`; predicate timed out after 10000ms. |
| `tests/e2e/resource-page-features.spec.js` | 45307 | Passed | 19 | 0 | 0 | 0 | 172s wall; Playwright reported 2.8m | None |
| `tests/e2e/resource-page-history.spec.js` | 45308 | Failed | 4 | 1 | 0 | 0 | 60s wall; Playwright reported 57.2s | Same failure as first run: `block text, title, property, icon, cover, and page settings share one chronological history`; at line 103, expected `data-resource-font="default"`, received `"serif"`; timeout 10000ms. |

## Crash, Disconnect, and OOM Events

- No browser crash was reported by Playwright.
- No browser disconnect was reported by Playwright.
- No out-of-memory condition was reported by Playwright, Node, or the fixture server.
- The only repeated warning observed during browser runs was Node's warning that `NO_COLOR` was ignored because `FORCE_COLOR` was set.

## Concise Result Summary

- Required non-browser verification passed: `npm ci`, `npm run check`, and `npm run check:build` all exited 0 under Node 22.
- Shard B first-run Playwright result: 7 of 10 specs passed; 63 of 66 tests passed; 3 tests failed; 0 skipped; 0 test timeouts.
- Reruns: `resource-page-features.spec.js` passed on rerun; `resource-inline-toolbar.spec.js` and `resource-page-history.spec.js` reproduced their first-run failures on rerun.
