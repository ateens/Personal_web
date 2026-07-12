# Resource title/block Arrow focus cloud diagnosis (2026-07-13)

## Scope

Implemented a minimal Resource editor focus stabilization for nondeterministic keyboard focus handoff between the page title and the first block.

## Code change

- Title `Enter`/`ArrowDown` now preserves the existing boundary behavior while resolving the first block id and calling the existing tested block focus helper exactly once as `focusBlockContentAfterRender(firstBlockId, { position: "start", transaction: true })`.
- First-block `ArrowUp` at caret start now uses a small analogous Resource title focus helper.
  - The helper immediately re-resolves the current title, focuses it, and places the caret at the end.
  - It performs at most four `requestAnimationFrame` checks.
  - It refocuses only when `document.activeElement` is not the current re-resolved title.

## Constraints observed

- No sleep calls, timers, 400ms expiry, or new global UI transaction state were added.
- Native Arrow behavior remains unchanged outside the existing title/first-block boundary guards.
- No test files were changed.
- `package.json`, `package-lock.json`, and `playwright.config.js` were restored after the temporary cloud browser dependency/configuration work.

## Verification log

Commands were run in Codex Cloud after switching to Node 22. `npm ci` was run first, followed by a temporary `npm install --no-save @sparticuz/chromium@149.0.0`.

A repo-local temporary Playwright config was used for browser verification with:

- `channel: undefined`
- `executablePath` resolved from `@sparticuz/chromium`
- `args: ["--disable-gpu", "--disable-webgl"]`
- `ignoreDefaultArgs: ["--enable-unsafe-swiftshader"]`
- no `chromium.args`
- no `--single-process`

The temporary config was removed after verification, and package files were restored.

Final exact verification counts and outcomes are recorded from the completed run:

- Initial temporary-config attempt before moving `executablePath`, `args`, and `ignoreDefaultArgs` under Playwright `launchOptions`: 15 focused runs failed to launch the browser; 5 `resource-editor-matrix.spec.js` runs failed to launch the browser; 2 `resource-page-features.spec.js` runs failed to launch the browser; 1 `resource-dom-stability.spec.js` run failed to launch the browser. These were configuration failures with 0 crashes, 0 disconnects, and 0 OOMs.
- Config smoke check after correcting the repo-local temporary config: 1 focused Resource title/first-block Arrow run, 1 passed, 0 failed, 0 crashes, 0 disconnects, 0 OOMs.
- Focused Resource title/first-block Arrow test: 15 fresh required runs, 15 passed, 0 failed, 0 crashes, 0 disconnects, 0 OOMs.
- `resource-editor-matrix.spec.js`: 5 fresh required runs, 4 passed and 1 failed, 0 crashes, 0 disconnects, 0 OOMs. The failure was in `Enter splits a block while Shift+Enter inserts a soft line break`, where the expected split block existed with text but was not focused before the assertion timeout.
- `resource-page-features.spec.js`: 2 fresh required runs, 2 passed, 0 failed, 0 crashes, 0 disconnects, 0 OOMs.
- `resource-dom-stability.spec.js`: 1 fresh required run, 1 passed, 0 failed, 0 crashes, 0 disconnects, 0 OOMs.
- `npm run check`: passed.
- `npm run check:build`: passed.
