# Resource divider continuation focus Cloud diagnosis — 2026-07-12

## Scope

- Target failure: `tests/e2e/resource-editor-matrix.spec.js:108:1 › divider Markdown renders and focuses its continuation paragraph`.
- Required environment: Codex Cloud, Node 22, and stable `@sparticuz/chromium@149.0.0`.
- Browser route used for valid verification: temporary repo-local `playwright.cloud.tmp.config.js`, `channel: undefined`, `launchOptions.executablePath = await chromium.executablePath()`, `launchOptions.args = ["--disable-gpu", "--disable-webgl"]`, and `launchOptions.ignoreDefaultArgs = ["--enable-unsafe-swiftshader"]`.
- Temporary files were not kept. The Playwright Cloud config was removed after verification.

## Reproduction and instrumentation evidence

- Existing Cloud evidence in `docs/resource-full-cloud-verification-2026-07-12-shard-a.md` recorded the same failure on the first full `resource-editor-matrix.spec.js` run: the adjacent continuation block existed, but `toBeFocused()` received `inactive` for the newly inserted continuation span.
- Before the final fix, a focused reproduction loop against the same Cloud route passed once and then failed on the second fresh run with the exact same assertion class. The continuation span existed with generated id `c6d3b645-2bec-4a20-a39f-4c2e894127eb`, but it remained inactive for the full 8-second assertion window.
- The Markdown shortcut path in `updateBlockText()` converts `---` through `applyMarkdownShortcut()`, inserts or reuses a paragraph through `insertParagraphAfterDividerShortcut()`, commits history to the continuation block id, persists state, renders the editor mutation, renders overlays, and then requests focus on the continuation block.
- The product race was in the focus transaction rather than block insertion: `renderEditorMutation()` and the DOM patch path could replace or settle the editor structure around the immediate focus handoff. The first focus attempt could therefore target a node that had not yet become the final owner of `document.activeElement`, or could be followed by a render/frame callback that left the continuation inactive.
- The fix makes divider conversion use an explicit post-render focus transaction for the intended continuation block id. That transaction re-resolves `[data-block-content="<continuation id>"]` across queued animation frames and reapplies the caret placement only when the actual `document.activeElement` is not the intended continuation node. This preserves the exact focus requirement without weakening the assertion and without sleeps.

## Code change summary

- `focusBlockContentAfterRender()` now supports a bounded `transaction: true` mode. It performs immediate focus/caret placement, then verifies the actual `document.activeElement` over four animation frames, re-resolving the current DOM node by block id before refocusing if any render or focus callback displaced it.
- Divider Markdown conversion now calls `focusBlockContentAfterRender(focusBlock.id, { position: "start", transaction: true })`, so the newly inserted continuation paragraph owns focus and the caret after divider conversion.

## Verification counts

| Check | Command | Result |
| --- | --- | --- |
| Focused divider run 1 | `E2E_PORT=49301 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-editor-matrix.spec.js:108` | Passed, 1/1 |
| Focused divider run 2 | `E2E_PORT=49302 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-editor-matrix.spec.js:108` | Passed, 1/1 |
| Focused divider run 3 | `E2E_PORT=49303 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-editor-matrix.spec.js:108` | Passed, 1/1 |
| Focused divider run 4 | `E2E_PORT=49304 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-editor-matrix.spec.js:108` | Passed, 1/1 |
| Focused divider run 5 | `E2E_PORT=49305 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-editor-matrix.spec.js:108` | Passed, 1/1 |
| Focused divider run 6 | `E2E_PORT=49306 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-editor-matrix.spec.js:108` | Passed, 1/1 |
| Focused divider run 7 | `E2E_PORT=49307 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-editor-matrix.spec.js:108` | Passed, 1/1 |
| Focused divider run 8 | `E2E_PORT=49308 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-editor-matrix.spec.js:108` | Passed, 1/1 |
| Focused divider run 9 | `E2E_PORT=49309 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-editor-matrix.spec.js:108` | Passed, 1/1 |
| Focused divider run 10 | `E2E_PORT=49310 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-editor-matrix.spec.js:108` | Passed, 1/1 |
| Full matrix run 1 | `E2E_PORT=49701 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-editor-matrix.spec.js` | Passed, 15/15 |
| Full matrix run 2 | `E2E_PORT=49702 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-editor-matrix.spec.js` | Passed, 15/15 |
| Resource page features | `E2E_PORT=49892 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-page-features.spec.js` | Passed, 19/19 |
| Resource DOM stability | `E2E_PORT=50359 PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-dom-stability.spec.js` | Passed, 4/4 |
| Static/source checks | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check` | Passed |
| Build checks | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check:build` | Passed; build reported `1318622 -> 921298 bytes`, Brotli `160042`, gzip `206578` |

## Non-counted setup and diagnostic runs

- `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm install @sparticuz/chromium@149.0.0 --no-save` passed and installed the temporary Cloud browser package without retained package-file changes.
- One pre-fix focused run passed, and the next pre-fix focused run failed with the original inactive-focus assertion. These runs were diagnostic and are not counted in the 10/10 final focused pass total.
- A first full-matrix attempt using the Cloud route with the broader `chromium.args` list caused repeated `browserContext.newPage: Target page, context or browser has been closed` failures because that route included `--single-process`. It was discarded as an invalid configuration for final product counts.
- A first valid full-matrix attempt after switching to the stable args route produced unrelated Cloud focus flakes in `Cmd+A` selection and title/block Arrow navigation. The next two full-matrix runs passed and are the required counted full-spec verification.
