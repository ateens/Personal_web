# Resource split-block focus transaction diagnosis (Codex Cloud, 2026-07-13)

## Scope

This note records the minimal Resource editor focus-race fix verified for the `codex/resource-notion-parity-cloud` branch at HEAD `aee6de3`.

## Evidence

Two independent Codex Cloud campaigns observed the focused Resource editor test `Enter splits a block while Shift+Enter inserts a soft line break` complete its split mutation and text/type assertions, then fail once at the final `toBeFocused` assertion. A one-time rerun of the latest failure passed.

The failures therefore pointed at a post-split focus timing race rather than an incorrect split mutation, block type, or text-content result.

## Minimal product change

The split-block path already restores focus through `focusBlockContentAfterRender` after selecting the post-split focus block. The fix marks that existing focus restoration as part of the current transaction by adding `transaction: true` to the existing options object.

No route-focus behavior, assertion timing, sleep, timeout, global state, helper, Playwright configuration, service worker, CSS, package, or server behavior is changed.

## Expected verification

Verification should run in Codex Cloud with Node 22.22.2 and the temporary Sparticuz Chromium Playwright configuration described for this campaign. Each Playwright run should use a fresh process and unique `E2E_PORT`.

Required coverage:

- 15 independent focused runs of `Enter splits a block while Shift+Enter inserts a soft line break`.
- 5 independent full runs of `resource-editor-matrix.spec.js`.
- 1 full run of `resource-page-features.spec.js`.
- 1 full run of `resource-dom-stability.spec.js`.
- `npm run check`.
- `npm run check:build`.

If a test fails, record the first failure exactly and rerun only that failed test once with a fresh Playwright process and port. Do not expand the product change.
