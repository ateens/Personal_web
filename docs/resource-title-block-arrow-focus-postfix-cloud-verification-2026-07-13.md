# Resource title/block Arrow focus postfix Cloud verification — 2026-07-13

## Scope and guardrails

- Verification target: current branch `codex/resource-notion-parity-cloud` at `ec35a7e`.
- This was a report-only Codex Cloud verification. No product code, CSS, existing docs, tests, package files, Playwright config, server, or service worker files were intentionally modified.
- Only tracked output from this task is this report file.
- This report does **not** claim the full project is complete; it only summarizes the requested postfix verification runs.

## Preflight

- `git rev-parse --short HEAD`: `ec35a7e`.
- Initial `git status --short`: clean.
- Runtime selected for all npm and Playwright commands: Node `v22.23.1`.
- Temporary browser package installed with `npm install --no-save @sparticuz/chromium@149.0.0` after `npm ci`.
- Sparticuz executable path recorded from Node: `/tmp/chromium`.
- Browser version recorded from executable: `Chromium 149.0.7827.0`.

## Temporary Playwright configuration

A temporary untracked Playwright config was used during browser execution and removed after verification. It preserved the committed `testDir`, one-worker behavior, base URL and `E2E_PORT` handling, locale, timezone, viewport, service worker settings, and fixture server. It used:

- `channel: undefined`
- `executablePath: await chromium.executablePath()`
- `launchOptions.args: ["--disable-gpu", "--disable-webgl"]`
- `launchOptions.ignoreDefaultArgs: ["--enable-unsafe-swiftshader"]`

The config did not import or spread `chromium.args`, and did not add `--single-process`, `--no-zygote`, or other Sparticuz launch arguments.

## Browser execution summary

Every scheduled browser run used a fresh Playwright process and a unique `E2E_PORT`.

| Run group | Runs | Ports | Result |
| --- | ---: | --- | --- |
| Focused `page title and first block support bidirectional Arrow navigation` from `resource-editor-matrix.spec.js` | 15 | `45001`-`45015` | 15/15 passed |
| Complete `resource-editor-matrix.spec.js` | 5 | `45101`-`45105` | 4/5 passed; 1 unrelated failure |
| One-time rerun of the first failing test | 1 | `45401` | passed |
| Complete `resource-page-features.spec.js` | 2 | `45201`-`45202` | 2/2 passed |
| Complete `resource-dom-stability.spec.js` | 1 | `45301` | 1/1 passed |

### Target Arrow handoff result

- Target test title: `page title and first block support bidirectional Arrow navigation`.
- Focused target runs: 15 passed, 0 failed.
- Target occurrences inside the 5 complete `resource-editor-matrix.spec.js` runs: all executed target-test occurrences passed.
- No target Arrow handoff failure reproduced.

### Prior split-block focus failure

The prior split-block focus failure did reproduce once during complete `resource-editor-matrix.spec.js` run 3 on port `45103`:

- Failed test: `Enter splits a block while Shift+Enter inserts a soft line break`.
- Assertion: `expect(locator).toBeFocused()`.
- Expected: `focused`.
- Received: `inactive`.
- Timeout: `8000ms`.
- Source assertion location reported by Playwright: `tests/e2e/resource-editor-matrix.spec.js:147:60`.
- First failure artifact paths reported by Playwright:
  - `output/playwright-test/resource-editor-matrix-Ent-9c969-r-inserts-a-soft-line-break/test-failed-1.png`
  - `output/playwright-test/resource-editor-matrix-Ent-9c969-r-inserts-a-soft-line-break/error-context.md`
  - `output/playwright-test/resource-editor-matrix-Ent-9c969-r-inserts-a-soft-line-break/trace.zip`
- One fresh-process, fresh-port rerun of only that failing test was performed on port `45401`; it passed in `7.6s`.
- Classification: unrelated to the requested target Arrow handoff and not repeated on the required one-time rerun.

### Crash, disconnect, and OOM counts

- Browser crash count observed in retained logs: 0.
- Browser disconnect count observed in retained logs: 0.
- OOM / killed-process count observed in retained logs: 0.

## Commands and outcomes

### Dependency and environment commands

- `npm ci`: passed.
- `npm install --no-save @sparticuz/chromium@149.0.0`: passed.
- `node -v`: `v22.23.1`.
- `node -e 'import chromium from "@sparticuz/chromium"; const p=await chromium.executablePath(); console.log(process.version); console.log(p);'`: recorded `v22.23.1` and `/tmp/chromium`.
- `/tmp/chromium --version`: recorded `Chromium 149.0.7827.0`.

### Browser commands

- Focused target command template: `E2E_PORT=<port> npx playwright test tests/e2e/resource-editor-matrix.spec.js -g "page title and first block support bidirectional Arrow navigation" --config=playwright.codex-sparticuz.tmp.config.mjs`.
  - Ports: `45001`, `45002`, `45003`, `45004`, `45005`, `45006`, `45007`, `45008`, `45009`, `45010`, `45011`, `45012`, `45013`, `45014`, `45015`.
  - Result: 15 passed / 0 failed.
- Complete matrix command template: `E2E_PORT=<port> npx playwright test tests/e2e/resource-editor-matrix.spec.js --config=playwright.codex-sparticuz.tmp.config.mjs`.
  - Ports: `45101`, `45102`, `45103`, `45104`, `45105`.
  - Result: 4 passed / 1 failed.
  - Failure details: run 3 on port `45103`, unrelated split-block focus failure described above.
- Rerun command: `E2E_PORT=45401 npx playwright test tests/e2e/resource-editor-matrix.spec.js -g "Enter splits a block while Shift\+Enter inserts a soft line break" --config=playwright.codex-sparticuz.tmp.config.mjs`.
  - Result: 1 passed / 0 failed.
- Complete features command template: `E2E_PORT=<port> npx playwright test tests/e2e/resource-page-features.spec.js --config=playwright.codex-sparticuz.tmp.config.mjs`.
  - Ports: `45201`, `45202`.
  - Result: 2 passed / 0 failed.
- Complete DOM stability command: `E2E_PORT=45301 npx playwright test tests/e2e/resource-dom-stability.spec.js --config=playwright.codex-sparticuz.tmp.config.mjs`.
  - Result: 1 passed / 0 failed.

### Static/build checks

- `npm run check`: passed.
- `npm run check:build`: passed.
- Build byte counts from `npm run check:build`:
  - Built SYGMA assets: `1319939 -> 922200 bytes (70%)`.
  - Precompressed Brotli assets: `160039 bytes (12% of source)`.
  - Build check: `1319939 -> 922200 bytes (160039 Brotli, 206788 gzip)`.

## Cleanup and final verification

After testing:

- Removed the temporary untracked Playwright config.
- Removed Playwright test output.
- Removed `node_modules` after verification because it was generated by this report-only task.
- Restored `package.json` and `package-lock.json` if npm touched them; no tracked package-file diff remained.
- Verification commands requested for final state:
  - `git diff --exit-code -- package.json package-lock.json playwright.config.js`
  - `git status --short`

Expected final tracked diff: only `docs/resource-title-block-arrow-focus-postfix-cloud-verification-2026-07-13.md`.
