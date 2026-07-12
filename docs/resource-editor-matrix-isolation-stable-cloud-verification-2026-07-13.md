# Resource editor matrix isolation stable-route verification — 2026-07-13

## Scope

This run verifies the fixture reset-generation isolation fix on the latest branch with a stable browser route for product-count confidence, replacing the prior invalid single-process harness only for product counts.

## Stable-route browser configuration

A repo-local temporary Playwright config was created for this verification and removed after the run. It preserved the committed `testDir`, `workers: 1`, locale, timezone, viewport, service-worker setting, and fixture-server environment while changing only the temporary browser route:

- `channel: undefined`
- `executablePath: await chromium.executablePath()` from temporary `@sparticuz/chromium@149.0.0`
- `launchOptions.args: ["--disable-gpu", "--disable-webgl"]`
- `launchOptions.ignoreDefaultArgs: ["--enable-unsafe-swiftshader"]`

The temporary config did not import or spread `chromium.args`, and did not add `--single-process`, `--no-zygote`, or any extra `@sparticuz/chromium` launch argument.

## Dependency handling and unchanged-file guard

- Ran `npm ci` before verification.
- Temporarily installed `@sparticuz/chromium@149.0.0` with `npm install --no-save @sparticuz/chromium@149.0.0`.
- npm emitted an `EBADENGINE` warning because `@sparticuz/chromium@149.0.0` declares Node `^22.17.0 || >=24.0.0`, while the environment used Node `v20.20.2`; the package still installed and the executable launched with the exact required route.
- Confirmed `package.json`, `package-lock.json`, and `playwright.config.js` had no git diff after the temporary install and cleanup.
- Removed the repo-local temporary Playwright config and temporary stable-route Playwright output directory.

## Commands and results

| Step | Command | Port(s) | Result | Counts |
| --- | --- | --- | --- | --- |
| Install | `npm ci` | n/a | Passed | n/a |
| Temporary Chromium install | `npm install --no-save @sparticuz/chromium@149.0.0` | n/a | Passed with npm engine warning | n/a |
| Static/source checks | `npm run check` | n/a | Passed | n/a |
| Build checks | `npm run check:build` | n/a | Passed | n/a |
| Focused fixture-generation baseline | `E2E_PORT=45131 npx playwright test -c playwright.stable-route.tmp.config.js tests/e2e/resource-baseline.spec.js -g "fixture generation rejects pre-reset stale writes before revision checks"` | 45131 | Passed | 1 passed |
| Full resource baseline | `E2E_PORT=45132 npx playwright test -c playwright.stable-route.tmp.config.js tests/e2e/resource-baseline.spec.js` | 45132 | Passed | 9 passed |
| Resource editor matrix run 1 | `E2E_PORT=45141 npx playwright test -c playwright.stable-route.tmp.config.js tests/e2e/resource-editor-matrix.spec.js` | 45141 | Passed | 15 passed |
| Resource editor matrix run 2 | `E2E_PORT=45142 npx playwright test -c playwright.stable-route.tmp.config.js tests/e2e/resource-editor-matrix.spec.js` | 45142 | Passed | 15 passed |
| Resource editor matrix run 3 | `E2E_PORT=45143 npx playwright test -c playwright.stable-route.tmp.config.js tests/e2e/resource-editor-matrix.spec.js` | 45143 | Failed | 14 passed, 1 failed |
| Resource editor matrix run 4 | `E2E_PORT=45144 npx playwright test -c playwright.stable-route.tmp.config.js tests/e2e/resource-editor-matrix.spec.js` | 45144 | Passed | 15 passed |
| Resource editor matrix run 5 | `E2E_PORT=45145 npx playwright test -c playwright.stable-route.tmp.config.js tests/e2e/resource-editor-matrix.spec.js` | 45145 | Passed | 15 passed |
| Resource offline | `E2E_PORT=45151 npx playwright test -c playwright.stable-route.tmp.config.js tests/e2e/resource-offline.spec.js` | 45151 | Passed | 7 passed |
| Resource save error policy | `E2E_PORT=45152 npx playwright test -c playwright.stable-route.tmp.config.js tests/e2e/resource-save-error-policy.spec.js` | 45152 | Passed | 6 passed |
| Unchanged guard | `git diff -- package.json package-lock.json playwright.config.js --stat` | n/a | Passed | no diff |

## Failure, crash, disconnect, and OOM record

- Failures: one assertion failure in resource editor matrix run 3 on port 45143.
  - Test: `tests/e2e/resource-editor-matrix.spec.js:324:1 › page title and first block support bidirectional Arrow navigation`.
  - Failure: `expect(locator).toBeFocused()` timed out after 8000 ms at `tests/e2e/resource-editor-matrix.spec.js:329:28`.
  - Expected focused locator: `[data-resource-note="fixture-resource-main"] [data-block-content="fixture-block-paragraph"]`.
  - Received state: inactive.
- Browser crashes: none observed.
- Browser disconnects: none observed.
- OOM events: none observed.
- Executable launch failures with the exact required args: none observed.

## Aggregate product counts

- Focused fixture-generation baseline: 1/1 passed.
- Full resource baseline: 9/9 passed.
- Resource editor matrix across five fresh runs: 74/75 passed, 1/75 failed.
- Resource offline: 7/7 passed.
- Resource save error policy: 6/6 passed.
- Overall Playwright product-count total for requested specs: 97/98 passed, 1/98 failed.
