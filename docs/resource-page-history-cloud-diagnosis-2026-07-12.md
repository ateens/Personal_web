# Resource page history cloud diagnosis — 2026-07-12

## Scope and guardrails

- Starting commit: `f3e3c8e`.
- Diagnosis only; no product, test, or package files were intentionally edited.
- Temporary diagnostic files used during the run:
  - `tests/e2e/resource-page-history-cloud-diagnosis.tmp.spec.js`
  - `playwright.diagnosis.tmp.config.js`
  - `tmp-diagnosis/check-node22.mjs`
- Temporary files were removed after diagnosis. Package files had no diff after the temporary `@sparticuz/chromium@149` install.
- The only retained repository change is this report.

## Browser/runtime setup used

The diagnostic used the established cloud workaround:

- Node 22 via `npx -y node@22` (`v22.23.1` verified before running Playwright).
- Temporary `@sparticuz/chromium@149` install.
- Temporary Playwright config with:
  - `channel: undefined`
  - `executablePath: await chromium.executablePath()`
  - `args` based on `chromium.args`, filtering out `--enable-unsafe-swiftshader`
  - extra `--disable-gpu` and `--disable-webgl`

## Commands run

```bash
npx -y node@22 tmp-diagnosis/check-node22.mjs
npm install --no-save @sparticuz/chromium@149
npx -y node@22 node_modules/.bin/playwright test tests/e2e/resource-page-history-cloud-diagnosis.tmp.spec.js --config=playwright.diagnosis.tmp.config.js
npx -y node@22 node_modules/.bin/playwright test tests/e2e/resource-page-history.spec.js --config=playwright.diagnosis.tmp.config.js
```

## Diagnostic reproduction

The temporary spec reproduced the first sequence from `tests/e2e/resource-page-history.spec.js` through selecting the `serif` page font:

1. Reset fixture.
2. Open `/resources/fixture-resource-main`.
3. Fill block text with `History body`.
4. Fill title with `History title`.
5. Expand properties and set type to `scrap`.
6. Set icon to `📄`.
7. Set cover URL to `https://example.com/history-cover.jpg` and apply.
8. Open the page menu and click the `serif` font option.
9. Wait for the fixture server snapshot font to become `serif`.

## Key captured states

### After serif reproduction

- Active element: `BUTTON`, `data-resource-page-menu="fixture-resource-main"`.
- `ui.editorHistory.undo.length`: `6`.
- `ui.editorHistory.redo.length`: `0`.
- Ordered undo summaries:
  1. editor-blocks for `resources/fixture-resource-main`
  2. resource-page fields `["title"]`
  3. resource-page fields `["type"]`
  4. resource-page fields `["icon"]`
  5. resource-page fields `["cover"]`
  6. resource-page fields `["pageSettings"]`, before font `default`, after font `serif`
- Local `itemById("resources", id).pageSettings.font`: `serif`.
- DOM shell `data-resource-font`: `serif`.
- Fixture-server snapshot font: `serif`.
- Local operation queue: empty.

### After Playwright `Meta+z`

- Active element: `BODY`.
- `ui.editorHistory.undo.length`: `5`.
- `ui.editorHistory.redo.length`: `1`.
- The `pageSettings` entry moved from undo to redo with before font `default` and after font `serif`.
- Local font: `default`.
- DOM shell font: `default`.
- Fixture-server snapshot font immediately after the key press: `serif`.
- Local operation queue immediately after the key press: empty.

This means the keyboard shortcut was consumed and the app-local undo path did run. The failure is not that `Meta+z` is ignored.

### Cancelable synthetic `Meta+z` KeyboardEvent

The diagnostic dispatched:

```js
new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true })
```

on `document`.

- `defaultPrevented`: `false`.
- Active element after dispatch: `BUTTON`, `data-resource-page-menu="fixture-resource-main"`.
- Undo/redo lengths remained `5` / `1`.
- Local font remained `default`.
- DOM shell font remained `default`.
- Fixture snapshot remained `serif` at that instant.
- Local operation queue then showed one pending resource operation with payload font `default`.

The synthetic event did not trigger another undo because the page menu button focus is not considered an editor-history shortcut context. Its `defaultPrevented: false` is expected for this focus target.

### Poll after keyboard undo

The diagnostic then waited/polled because keyboard undo changed local/DOM but not the server snapshot immediately.

- A subsequent poll observed fixture-server snapshot font: `default`.
- Local font: `default`.
- DOM shell font: `default`.
- Local operation queue: empty.

This shows the server update is asynchronous and eventually succeeds, but not within the immediate assertion window in the existing test run.

### Mobile undo control after reset/reproduction

After resetting and reproducing again, the diagnostic clicked the visible mobile undo control at a `390 x 844` viewport.

Before click:

- Undo length: `1`.
- Undo entry: resource-page `pageSettings`, before font `default`, after font `serif`.
- Local font: `serif`.
- DOM shell font: `serif`.
- Fixture-server snapshot font: `serif`.

After click:

- Active element: `BUTTON`, `data-resource-mobile-action="undo"`.
- Undo length: `0`.
- Redo length: `1`.
- Local font: `default`.
- DOM shell font: `default`.
- Fixture-server snapshot font immediately after click: `serif`.
- Local operation queue: empty at capture time.

The mobile control follows the same local undo path and has the same immediate local-vs-server timing gap.

## Existing focused file run

The focused file was run once with the same temporary Node 22 + `@sparticuz/chromium@149` config.

Result: `3 failed, 2 passed`.

Relevant first failure:

- `tests/e2e/resource-page-history.spec.js:62:1` failed at line 101.
- Expected fixture-server `pageSettings.font` to become `default` after the first `Meta+z`.
- Received `serif` until the assertion timed out.

The later failures were browser/context closure errors after the first failure under the temporary single-process cloud browser setup, not additional product diagnosis signals.

## Causal code path supported by evidence

1. Font selection is recorded as resource-page history before the setting mutates. `setResourcePageSetting()` obtains a `beginResourcePageHistory()` token, mutates `resource.pageSettings.font`, commits the page-history token, calls `saveState()`, patches page settings, and closes the page menu.
2. Keyboard undo is handled by `handleDocumentKeydown()` only when `editorHistoryShortcutContext(event)` returns true, then it calls `event.preventDefault()`, `event.stopPropagation()`, and `undoEditorHistory()`.
3. `undoEditorHistory()` pops the latest undo entry, pushes it to redo, and calls `restoreEditorHistoryEntry(entry, "before")`.
4. `restoreEditorHistoryEntry()` dispatches resource-page entries to `restoreResourcePageHistoryEntry()`.
5. `restoreResourcePageHistoryEntry()` clones the `beforePage.pageSettings` snapshot back onto the resource, calls `touchResource(resource)`, calls `saveState()`, rerenders/patches UI, and restores focus.
6. `saveState()` routes resource-only pending changes through local resource operation persistence and asynchronous autosave. The diagnostic observed exactly that: local resource and DOM font changed to `default` immediately; fixture server remained `serif` briefly; a pending local operation with payload font `default` appeared; then the fixture server snapshot eventually became `default`.

## Conclusion

The exact causal path is an assertion timing mismatch against asynchronous resource autosave after app-history undo. Keyboard `Meta+z` does change app-local history, `itemById()` state, and the DOM shell font from `serif` to `default`. The server snapshot does not update synchronously with `undoEditorHistory()`; it is persisted through the local operation/autosave path and can lag behind the immediate assertion. The existing focused test's first assertion waits for the fixture snapshot only and timed out in this cloud run, even though the local state and DOM had already been restored to `default`.

No code fix was made.
