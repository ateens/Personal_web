# Resource Postfix Full Cloud Verification — Shard A — 2026-07-12

## Scope

- Branch: `work`.
- Latest branch head verified: `37d744c`.
- Runtime: Node `v22.22.2` from `/root/.nvm/versions/node/v22.22.2/bin/node`.
- Dependency install: `npm ci` completed before verification.
- Cloud Chromium package: `@sparticuz/chromium@149.0.0`, installed with `npm install @sparticuz/chromium@149.0.0 --no-save` after `npm ci`.
- Chromium executable resolved by the package: `/tmp/chromium`.
- Chromium version: `Chromium 149.0.7827.0`.
- Playwright Cloud launch route used for each spec:
  - `browserName: "chromium"`.
  - `channel: undefined`.
  - `launchOptions.executablePath = await chromium.executablePath()`.
  - `launchOptions.args = ["--disable-gpu", "--disable-webgl"]`.
  - `launchOptions.ignoreDefaultArgs = ["--enable-unsafe-swiftshader"]`.
- Each spec was run individually with `workers: 1`, `reuseExistingServer: false`, a fresh Playwright browser/server process, and a unique `E2E_PORT`.
- Failed specs were rerun once in a fresh process with a different unique port.

## Setup and non-browser checks

| Step | Command | Result | Duration |
| --- | --- | --- | --- |
| Install dependencies | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm ci` | Passed; `added 47 packages`, `audited 48 packages`, `found 0 vulnerabilities`. | 1.736s |
| Install Cloud Chromium package | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm install @sparticuz/chromium@149.0.0 --no-save` | Passed; `added 18 packages`, `audited 66 packages`, `found 0 vulnerabilities`. | 3.773s |
| Static/source checks | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check` | Passed; `Source audit passed.` and `Sites worker check passed.` | 3.026s |
| Build checks | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check:build` | Passed; build and build check completed. | 2.103s |

## First-run shard results

First-run total: 10 spec files, 65 tests, 63 passed, 2 failed. Combined first-run wall-clock duration from the per-spec wrapper: 415s.

| Spec | Port | First-run result | Tests | Playwright duration | Wrapper duration | First-run failure message |
| --- | ---: | --- | ---: | ---: | ---: | --- |
| `resource-a11y-axe.spec.js` | 44100 | Passed | 5 passed, 0 failed | 43.6s | 46s | None |
| `resource-baseline.spec.js` | 44101 | Passed | 8 passed, 0 failed | 1.0m | 62s | None |
| `resource-block-deep-link.spec.js` | 44102 | Passed | 4 passed, 0 failed | 15.7s | 17s | None |
| `resource-block-menu-actions.spec.js` | 44103 | Passed | 3 passed, 0 failed | 23.6s | 25s | None |
| `resource-comment-history-integrity.spec.js` | 44104 | Failed | 5 passed, 1 failed | 48.5s | 50s | `Error: expect(locator).toHaveClass(expected) failed`; expected `/is-selected/`; timed out after 8000ms because the locator for `[data-block-id="fixture-block-inline"]` under `[data-resource-note="fixture-resource-main"]` was not found. Failing test: `duplicate plus internal and external clipboard copies strip unowned comment marks` at `tests/e2e/resource-comment-history-integrity.spec.js:365:1`. |
| `resource-comment-read-cursor.spec.js` | 44105 | Passed | 4 passed, 0 failed | 15.8s | 17s | None |
| `resource-cross-page-block-move.spec.js` | 44106 | Passed | 7 passed, 0 failed | 42.7s | 45s | None |
| `resource-dom-stability.spec.js` | 44107 | Passed | 4 passed, 0 failed | 34.1s | 35s | None |
| `resource-editor-matrix.spec.js` | 44108 | Failed | 14 passed, 1 failed | 54.1s | 56s | `Error: expect(locator).toBeFocused() failed`; expected the continuation paragraph locator `[data-block-id="fixture-block-callout"] + .block [data-block-content]` to be focused, but it remained inactive for 8000ms. Failing test: `divider Markdown renders and focuses its continuation paragraph` at `tests/e2e/resource-editor-matrix.spec.js:108:1`. |
| `resource-editor-transport.spec.js` | 44109 | Passed | 9 passed, 0 failed | 59.8s | 62s | None |

## Rerun results for failed first-run specs

Rerun total: 2 spec files, 21 tests, 20 passed, 1 failed. Combined rerun wall-clock duration from the per-spec wrapper: 101s.

| Spec | Port | Rerun result | Tests | Playwright duration | Wrapper duration | Rerun failure message |
| --- | ---: | --- | ---: | ---: | ---: | --- |
| `resource-comment-history-integrity.spec.js` | 44204 | Passed | 6 passed, 0 failed | 43.0s | 45s | None |
| `resource-editor-matrix.spec.js` | 44208 | Failed | 14 passed, 1 failed | 55.2s | 56s | `Error: expect(locator).toBeFocused() failed`; expected the continuation paragraph locator `[data-block-id="fixture-block-callout"] + .block [data-block-content]` to be focused, but it remained inactive for 8000ms. Failing test: `divider Markdown renders and focuses its continuation paragraph` at `tests/e2e/resource-editor-matrix.spec.js:108:1`. |

## Crash, disconnect, and OOM review

- Browser crash events: 0 observed in retained logs.
- Browser disconnect events: 0 observed in retained logs.
- Out-of-memory / OOM / killed events: 0 observed in retained logs.
- Browser-closed / target-closed errors: 0 observed in retained logs.
- Server process start failures during the final Cloud route: 0 observed.
- Repeated environment warnings observed but non-fatal: npm printed `Unknown env config "http-proxy"`; Node printed `The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.`

## Notes

- A temporary Playwright config and all raw run logs were kept outside the repository under `/tmp`; they are not product code, tests, package files, or docs.
- The temporary `@sparticuz/chromium@149.0.0 --no-save` install did not leave package-file changes in the working tree.
