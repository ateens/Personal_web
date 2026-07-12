# Resource postfix full Cloud verification — shard B — 2026-07-12

## Scope

Final Cloud-only postfix verification shard B was run on the latest branch head in this workspace. Product code, tests, package files, and existing docs were not intentionally modified. The only retained repository change from this pass is this report.

## Runtime and browser route

- Node runtime: `v22.22.2` via `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH`.
- Cloud browser package install: `npm install @sparticuz/chromium@149.0.0 --no-save`.
- Chromium executable resolved by `@sparticuz/chromium`: `/tmp/chromium`.
- Chromium version: `/tmp/chromium --version` → `Chromium 149.0.7827.0`.
- Temporary Playwright config used `channel: undefined`, `launchOptions.executablePath = await chromium.executablePath()`, `launchOptions.args = ["--disable-gpu", "--disable-webgl"]`, and `launchOptions.ignoreDefaultArgs = ["--enable-unsafe-swiftshader"]`.
- Every listed spec was run individually through a fresh Playwright process and fixture server process with a unique `E2E_PORT`.
- First-run failures were tracked separately from reruns. No first-run failures occurred, so no spec reruns were executed.

## Setup and static checks

| Step | Command | Result | Duration |
| --- | --- | --- | ---: |
| Node version | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH node -v` | Passed: `v22.22.2`. | <1s |
| Clean install | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm ci` | Passed: `added 47 packages`, `audited 48 packages`, `found 0 vulnerabilities`. | 3s |
| Cloud Chromium package | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm install @sparticuz/chromium@149.0.0 --no-save` | Passed: `added 18 packages`, `audited 66 packages`, `found 0 vulnerabilities`. | 7s |
| Syntax/source checks | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check` | Passed: `Source audit passed.` and `Sites worker check passed.` | 6s |
| Build check | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check:build` | Passed: build/check completed with `Built SYGMA assets: 1318099 -> 921039 bytes (70%).` and `Build check passed: 1318099 -> 921039 bytes (159858 Brotli, 206474 gzip).` | 4s |

The npm commands emitted the environment warning `npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.` The warning did not fail any command.

## Spec results

| First-run order | Spec | Port | First-run result | Playwright-reported duration | Wall duration | Rerun result |
| ---: | --- | ---: | --- | ---: | ---: | --- |
| 1 | `tests/e2e/resource-full-docked-nav.spec.js` | 45200 | Passed: 7/7 | 59.4s | 62s | Not run; first run passed. |
| 2 | `tests/e2e/resource-hierarchy-persistence.spec.js` | 45201 | Passed: 6/6 | 1.1m | 69s | Not run; first run passed. |
| 3 | `tests/e2e/resource-inline-toolbar.spec.js` | 45202 | Passed: 5/5 | 31.6s | 34s | Not run; first run passed. |
| 4 | `tests/e2e/resource-input-limits.spec.js` | 45203 | Passed: 2/2 | 26.2s | 28s | Not run; first run passed. |
| 5 | `tests/e2e/resource-offline.spec.js` | 45204 | Passed: 7/7 | 1.4m | 86s | Not run; first run passed. |
| 6 | `tests/e2e/resource-p0.spec.js` | 45205 | Passed: 8/8 | 1.5m | 93s | Not run; first run passed. |
| 7 | `tests/e2e/resource-page-command-mentions.spec.js` | 45206 | Passed: 2/2 | 17.7s | 20s | Not run; first run passed. |
| 8 | `tests/e2e/resource-page-features.spec.js` | 45207 | Passed: 19/19 | 2.7m | 162s | Not run; first run passed. |
| 9 | `tests/e2e/resource-page-history.spec.js` | 45208 | Passed: 5/5 | 54.9s | 57s | Not run; first run passed. |
| 10 | `tests/e2e/resource-page-lock.spec.js` | 45209 | Passed: 5/5 | 54.4s | 56s | Not run; first run passed. |

## Totals

- First-run specs: 10.
- First-run tests: 66.
- First-run passed tests: 66.
- First-run failed specs: 0.
- First-run failed tests: 0.
- Rerun specs: 0, because no first-run spec failed.
- Overall retained result: 66/66 tests passed on first run.
- Sum of first-run wall durations: 667s.

## Failure, crash, disconnect, and OOM ledger

- First-run failure messages: none.
- Rerun failure messages: none; no reruns were needed.
- Browser crash events: none observed in command output.
- Browser disconnect events: none observed in command output.
- Fixture server crash events: none observed in command output.
- Out-of-memory events: none observed in command output.
- Non-fatal process warnings observed: Node emitted `Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.` during Playwright/fixture-server runs; npm emitted the `http-proxy` config warning noted above.
