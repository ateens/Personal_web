# Resource postfix full Cloud verification — shard C

Date: 2026-07-12 UTC
Branch head: `37d744c fix: suppress native resource card drags`
Mode: Cloud-only postfix verification shard C

## Runtime configuration

- Node: `v22.23.1` via `npx -y node@22`.
- Browser package: `@sparticuz/chromium@149.0.0` installed outside the repository at `/tmp/shardc-chromium`.
- Browser channel: `undefined`.
- Browser executable path: `/tmp/chromium` from `@sparticuz/chromium.executablePath()`.
- Browser launch args: `--disable-gpu`, `--disable-webgl` only.
- Browser `ignoreDefaultArgs`: `--enable-unsafe-swiftshader`.
- Every spec was run individually with `workers: 1`, `reuseExistingServer: false`, a fresh fixture server/browser process, and a unique first-run port. Failed specs were rerun once in a fresh process on a separate unique port.
- No product code, tests, package files, existing docs, performance thresholds, or visual evidence coverage were modified.

## Setup and static checks

| Command | Exit | Start UTC | End UTC | Duration | Result notes |
| --- | ---: | --- | --- | ---: | --- |
| `npx -y node@22 $(which npm) ci` | 0 | 2026-07-12T07:12:36Z | 2026-07-12T07:12:39Z | 3s | Added 47 packages, audited 48 packages, 0 vulnerabilities. |
| `npx -y node@22 $(which npm) run check` | 0 | 2026-07-12T07:12:44Z | 2026-07-12T07:12:49Z | 5s | Source audit passed; Sites worker check passed. |
| `npx -y node@22 $(which npm) run check:build` | 0 | 2026-07-12T07:12:49Z | 2026-07-12T07:12:54Z | 5s | Build check passed: 1318099 -> 921039 bytes; 159858 Brotli; 206474 gzip. |

## Exact first-run totals

- Specs requested: 10.
- Specs run on first attempt: 10.
- First-run spec passes: 8.
- First-run spec failures: 2 (`resource-performance.spec.js`, `resource-visual-state-evidence.spec.js`).
- First-run tests executed: 48.
- First-run test passes: 46.
- First-run test failures: 2.
- First-run wall-clock duration across specs: 711s.

## Exact rerun totals

- Failed specs rerun once: 2.
- Rerun spec passes: 0.
- Rerun spec failures: 2.
- Rerun tests executed: 5.
- Rerun test passes: 3.
- Rerun test failures: 2.
- Rerun wall-clock duration across specs: 101s.

## Crash / disconnect / OOM events

- Chromium crash events: 0 observed.
- Playwright browser disconnect events: 0 observed.
- Renderer OOM events: 0 observed.
- Node process OOM events: 0 observed.
- Fixture server crashes after startup: 0 observed.

## Per-spec results

| Spec | Run | Port | Exit | Tests | Pass | Fail | Start UTC | End UTC | Duration | Result |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | --- |
| `resource-page-shell.spec.js` | first | 45200 | 0 | 17 | 17 | 0 | 2026-07-12T07:14:43Z | 2026-07-12T07:17:32Z | 169s | Passed. |
| `resource-performance.spec.js` | first | 45201 | 1 | 1 | 0 | 1 | 2026-07-12T07:17:32Z | 2026-07-12T07:17:45Z | 13s | Failed; see first-run failure details. |
| `resource-performance.spec.js` | rerun | 45301 | 1 | 1 | 0 | 1 | 2026-07-12T07:17:45Z | 2026-07-12T07:17:57Z | 12s | Failed again; see rerun failure details. |
| `resource-readonly.spec.js` | first | 45202 | 0 | 2 | 2 | 0 | 2026-07-12T07:17:57Z | 2026-07-12T07:18:18Z | 21s | Passed. |
| `resource-revision-conflict.spec.js` | first | 45203 | 0 | 1 | 1 | 0 | 2026-07-12T07:18:18Z | 2026-07-12T07:18:48Z | 30s | Passed. |
| `resource-save-error-policy.spec.js` | first | 45204 | 0 | 6 | 6 | 0 | 2026-07-12T07:18:48Z | 2026-07-12T07:20:06Z | 78s | Passed. |
| `resource-state-delete-guard.spec.js` | first | 45205 | 0 | 3 | 3 | 0 | 2026-07-12T07:20:06Z | 2026-07-12T07:20:22Z | 16s | Passed. |
| `resource-trash-view.spec.js` | first | 45206 | 0 | 6 | 6 | 0 | 2026-07-12T07:20:22Z | 2026-07-12T07:21:31Z | 69s | Passed. |
| `resource-url-paste-choice.spec.js` | first | 45207 | 0 | 7 | 7 | 0 | 2026-07-12T07:21:31Z | 2026-07-12T07:22:10Z | 39s | Passed. |
| `resource-viewport-matrix.spec.js` | first | 45208 | 0 | 1 | 1 | 0 | 2026-07-12T07:22:10Z | 2026-07-12T07:25:12Z | 182s | Passed. |
| `resource-visual-state-evidence.spec.js` | first | 45209 | 1 | 4 | 3 | 1 | 2026-07-12T07:25:12Z | 2026-07-12T07:26:46Z | 94s | Failed; see first-run failure details. |
| `resource-visual-state-evidence.spec.js` | rerun | 45309 | 1 | 4 | 3 | 1 | 2026-07-12T07:26:46Z | 2026-07-12T07:28:15Z | 89s | Failed again; see rerun failure details. |

## First-run failure details kept separate

### `resource-performance.spec.js` first run

- Failed test: `a 400-block Resource stays within the local render and interaction budgets`.
- Failure message: `Error: expect(received).toBeLessThan(expected)`.
- Assertion: expected `propertyPatchMs` to be `< 500`; received `1527.7999999998137` at `tests/e2e/resource-performance.spec.js:79:35`.
- Metrics emitted: `{"shellDomNodes":4557,"propertyPatchMs":1527.7999999998137,"scrollResponseMs":1938,"maxLongTaskMs":304,"totalLongTaskMs":1262,"longTaskCount":9,"readyMs":1881}`.
- Artifacts reported by Playwright: `output/playwright-test/resource-performance-a-400-31655-der-and-interaction-budgets/test-failed-1.png`, `output/playwright-test/resource-performance-a-400-31655-der-and-interaction-budgets/error-context.md`, `output/playwright-test/resource-performance-a-400-31655-der-and-interaction-budgets/trace.zip`.

### `resource-visual-state-evidence.spec.js` first run

- Failed test: `settled block hover, slash, selection, block-menu, and drag-guide evidence`.
- Failure message: `Test timeout of 30000ms exceeded.`
- Failure location: `page.evaluate` timed out while `settle()` waited at `tests/e2e/resource-visual-state-evidence.spec.js:47:14`; called from `capture()` at line 61 and the test at line 257.
- Artifacts reported by Playwright: `output/playwright-test/resource-visual-state-evid-dffb8-enu-and-drag-guide-evidence/test-failed-1.png`, `output/playwright-test/resource-visual-state-evid-dffb8-enu-and-drag-guide-evidence/error-context.md`, `output/playwright-test/resource-visual-state-evid-dffb8-enu-and-drag-guide-evidence/trace.zip`.

## Rerun failure details

### `resource-performance.spec.js` rerun

- Failed test: `a 400-block Resource stays within the local render and interaction budgets`.
- Failure message: `Error: expect(received).toBeLessThan(expected)`.
- Assertion: expected `propertyPatchMs` to be `< 500`; received `1088.2999999998137` at `tests/e2e/resource-performance.spec.js:79:35`.
- Metrics emitted: `{"shellDomNodes":4557,"propertyPatchMs":1088.2999999998137,"scrollResponseMs":1142.7000000001863,"maxLongTaskMs":434,"totalLongTaskMs":1461,"longTaskCount":9,"readyMs":2178}`.
- Artifacts reported by Playwright: `output/playwright-test/resource-performance-a-400-31655-der-and-interaction-budgets/test-failed-1.png`, `output/playwright-test/resource-performance-a-400-31655-der-and-interaction-budgets/error-context.md`, `output/playwright-test/resource-performance-a-400-31655-der-and-interaction-budgets/trace.zip`.

### `resource-visual-state-evidence.spec.js` rerun

- Failed test: `settled block hover, slash, selection, block-menu, and drag-guide evidence`.
- Failure message: `Test timeout of 30000ms exceeded.`
- Failure location: `page.screenshot` timed out while `capture()` was taking the screenshot at `tests/e2e/resource-visual-state-evidence.spec.js:69:19`; called from the test at line 257.
- Playwright call log: taking page screenshot; disabled all CSS animations; waiting for fonts to load; fonts loaded.
- Artifacts reported by Playwright: `output/playwright-test/resource-visual-state-evid-dffb8-enu-and-drag-guide-evidence/test-failed-1.png`, `output/playwright-test/resource-visual-state-evid-dffb8-enu-and-drag-guide-evidence/error-context.md`, `output/playwright-test/resource-visual-state-evid-dffb8-enu-and-drag-guide-evidence/trace.zip`.
