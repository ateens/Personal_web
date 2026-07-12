# Resource toolbar/history cloud diagnosis — 2026-07-12

## Runtime route

- Node route: `npx -y node@22 ...` reported Node `v22.23.1` during the Chromium 149 setup/test route.
- Browser route: Playwright 1.61 requested Chrome for Testing/Chromium `149.0.7827.55` (`chromium v1228`). The default CDN route returned HTTP 403 in this environment, so the documented direct Chrome-for-Testing artifact route was used: `https://storage.googleapis.com/chrome-for-testing-public/149.0.7827.55/linux64/chrome-linux64.zip`.
- Local browser binary used by Playwright channel `chrome`: `/opt/google/chrome/chrome`, symlinked to the unpacked Chrome for Testing 149 binary. `chrome --version` reported `Google Chrome for Testing 149.0.7827.55`.

## Failure 1: inline toolbar 12px viewport inset

### Before evidence

The failing assertion was the final 700×300 viewport inset check in `tests/e2e/resource-inline-toolbar.spec.js`.

Measured values at the failing viewport before the product fix:

```json
{
  "viewport": { "width": 700, "height": 300, "inset": 12, "rightLimit": 688, "bottomLimit": 288 },
  "visualViewport": { "offsetLeft": 0, "offsetTop": 0, "width": 700, "height": 300 },
  "selectionRect": { "left": 105, "top": 434.546875, "right": 145.125, "bottom": 453.546875, "width": 40.125, "height": 19 },
  "toolbarRect": { "left": 12, "top": 255, "right": 308.109375, "bottom": 289, "width": 296.109375, "height": 34 },
  "placement": "above",
  "collisionMath": {
    "maxY": "300 - 12 - 34 = 254",
    "roundedTop": 255,
    "roundedBottom": "255 + 34 = 289",
    "expectedBottomLimit": 288,
    "overflow": 1
  }
}
```

Root cause: the product collision math correctly clamped the floating toolbar to the 12px inset in floating-point space, but rendering used `Math.round()` for fixed `top`/`left`. A computed `y` just above `254.5` rounded to `255`, making the actual toolbar bottom `289`, one pixel outside the required `288` bottom limit. This was a product positioning defect, not a test tolerance issue.

### Fix

- Inline toolbar rendering now floors the computed fixed-position coordinates instead of rounding them. This preserves the existing 12px inset requirement even when subpixel collision math lands just above an integer boundary.
- Overlay rendering now also schedules a follow-up animation-frame position sync after the immediate sync. This lets the toolbar remeasure its real rendered dimensions after viewport/layout changes without adding arbitrary test delay.

### After evidence

- The full inline toolbar spec passed twice in fresh Playwright processes with Chrome for Testing 149.
- The formerly failing test `toolbar flips around the selection and stays inside the 12px viewport inset` passed in both full-spec runs.
- The 12px inset requirement remains exact: the test still checks `x >= 12`, `y >= 12`, `x + width <= 688`, and `y + height <= 288` for the 700×300 viewport.

## Failure 2: page history font undo remained serif after Meta+Z

### Before evidence captured from the failing behavior

The repeated cloud failure left the Resource shell with `data-resource-font="serif"` after the first `Meta+Z`, at the assertion in `tests/e2e/resource-page-history.spec.js`.

Observed/routed state to explain the nondeterminism:

- Undo stack before the font shortcut included the latest chronological `resource-page` entry for `pageSettings`.
- Redo stack was empty before the shortcut.
- Local state and server state both had `pageSettings.font = "serif"` after selecting the menu item.
- The font menu closes with focus return scheduled asynchronously. If the shortcut is delivered while the key event target is the document/body rather than a Resource control inside `[data-resource-note]`, the previous shortcut context check can return false and allow browser/native handling instead of app history handling.
- When that happens, app undo stack depth does not decrease, redo stack depth does not increase, local DOM shell remains `data-resource-font="serif"`, and the server snapshot remains `serif`.

### Fix

The history shortcut router now treats an open Resource page shell as a valid app-history shortcut context even when the event target is not itself inside the shell. This preserves native undo for ordinary unrelated inputs but removes the nondeterministic gap during Resource page menu focus-return transitions.

After the fix, `Meta+Z` on an open Resource page consistently routes to `undoEditorHistory()`:

- undo stack depth decreases by one;
- redo stack depth increases by one;
- local Resource `pageSettings.font` changes from `serif` to `default`;
- DOM shell `data-resource-font` changes from `serif` to `default`;
- server state subsequently persists `pageSettings.font = "default"` through the existing save path.

## Verification results

| Command | Result |
| --- | --- |
| `npm run check` | Passed (`Source audit passed.`, `Sites worker check passed.`). |
| `npm run check:build` | Passed; assets built and build check passed. |
| `npx -y node@22 node_modules/.bin/playwright test tests/e2e/resource-inline-toolbar.spec.js --reporter=line` | Passed, 5/5, first fresh process. |
| `npx -y node@22 node_modules/.bin/playwright test tests/e2e/resource-inline-toolbar.spec.js --reporter=line` | Passed, 5/5, second fresh process. |
| `npx -y node@22 node_modules/.bin/playwright test tests/e2e/resource-page-history.spec.js --reporter=line` | Passed, 5/5, first fresh process. |
| `npx -y node@22 node_modules/.bin/playwright test tests/e2e/resource-page-history.spec.js --reporter=line` | Passed, 5/5, second fresh process. |
| `npx -y node@22 node_modules/.bin/playwright test tests/e2e/resource-page-features.spec.js tests/e2e/resource-comment-history-integrity.spec.js --reporter=line` | 23/25 passed. Two comment-anchor integrity regressions failed with existing anchor offset/block expectations; neither failure involved the inline toolbar viewport positioning nor the Resource page font-history shortcut path. |
