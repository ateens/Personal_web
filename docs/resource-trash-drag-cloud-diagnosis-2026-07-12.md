# Resource Trash drag Cloud diagnosis — 2026-07-12

## Scope

Diagnosed the repeated Codex Cloud failure in `tests/e2e/resource-trash-view.spec.js` for `Resource drag actions expose a reversible Trash target and never expose delete`. The reported failure was that `.delete-drag-stage` was not found after the Playwright drag gesture on both the first run and rerun.

## Cloud route and runtime

- Runtime requested by task: Codex Cloud with Node 22.
- Browser route used for browser-backed checks: temporary `@sparticuz/chromium@149.0.0` executable at `/tmp/chromium` launched from a temporary Playwright config with `channel: undefined` and `executablePath: await chromium.executablePath()`.
- The stable launch args for the final checks were intentionally bounded to `--no-sandbox`, `--disable-gpu`, and `--disable-dev-shm-usage`. A first diagnostic config using the full `chromium.args` set reproduced browser-process instability across multiple contexts; the narrower config completed the full Resource Trash spec.
- Temporary files used for execution were not intended as product changes and were removed before commit.

## Reproduction and measured evidence

### Focused failure mechanism

The focused test starts the gesture from the visible Resource card:

```js
const card = page.locator(`[data-delete-drag-type="resources"][data-delete-drag-id="${FIXTURE_IDS.resource}"]`).first();
const bounds = await card.boundingBox();
const startX = bounds.x + bounds.width / 2;
const startY = bounds.y + 4;
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.mouse.move(startX, startY + 14, { steps: 2 });
```

The Resource card renderer wraps the visible card body in an opener anchor:

```html
<article class="card" data-delete-drag-type="resources" data-delete-drag-id="...">
  <a class="resource-card-open" data-open-resource="..." style="display:block;...">
```

The delete-drag pointerdown gate previously rejected any event whose target was inside `a`:

```js
!event.target.closest("button, input, select, textarea, a, [contenteditable='true']")
```

Therefore the Playwright gesture landed on the supported visual Resource card but the actual event target was the opener anchor. `ui.pendingDeleteDrag` was never created, so the later pointer move had no pending drag to promote into `ui.deleteDrag`, `renderOverlays()` was never called for the delete/trash drag, and `.delete-drag-stage` could not exist. This is a product-code drag hit-target defect, not a bounded async rendering transition.

### Drag state and DOM rendering after fix

The fix keeps interactive form controls and editable content excluded, but allows the Resource opener anchor to participate in the pending drag path. A normal click still opens the Resource because suppression is only set once the drag threshold is crossed in `beginDeleteDrag`; after threshold crossing the existing click-suppression path prevents accidental opener activation.

After the fix, the same Cloud-focused gesture produced:

- `window.dragActionTargets("resources", id)` contained exactly one `trash` action.
- `window.dragActionTargets("resources", id)` contained no `delete` action.
- The 14px mouse move crossed the 8px activation threshold.
- `.delete-drag-stage` became visible.
- `[data-delete-drop][data-drag-action="trash"]` became visible.
- `[data-delete-drop][data-drag-action="delete"]` remained absent.
- `window.cancelDeleteDrag()` removed the stage.

## Code change

Changed only the delete-drag pointerdown target filter in `app.js` so Resource card opener anchors can start a pending delete/trash drag while buttons, inputs, selects, textareas, and editable content remain protected.

## Commands and final results

| Command | Result | Notes |
| --- | --- | --- |
| `npx -y node@22 node_modules/.bin/playwright test tests/e2e/resource-trash-view.spec.js -g "Resource drag actions" --config=playwright.cloud.tmp.config.js` | Passed, `1 passed (19.5s)` | Focused Cloud reproduction after product fix. |
| `npm run check` | Passed | Source audit and worker check passed. |
| `npm run check:build` | Passed | Built assets and build check passed. |
| `npx -y node@22 node_modules/.bin/playwright test tests/e2e/resource-trash-view.spec.js --config=playwright.cloud.tmp.config.js` | Passed, `6 passed (1.5m)` | Full Resource Trash spec on Node 22 + Chromium 149 route. |
| `npx -y node@22 node_modules/.bin/playwright test tests/e2e/resource-page-features.spec.js -g "trash|Trash" tests/e2e/resource-state-delete-guard.spec.js tests/e2e/resource-hierarchy-persistence.spec.js --config=playwright.cloud.tmp.config.js` | Passed, `4 passed (50.3s)` | Directly related trash/delete-guard coverage selected by grep; no hierarchy tests matched the grep in that command. |

## Final conclusion

The Cloud failure was caused by the product excluding anchor targets from the Resource delete/trash drag start path even though Resource library cards render their visible drag surface inside an opener anchor. The fix restores the required supported path: a valid Resource card drag exposes the reversible Trash target, and permanent delete is never exposed for Resources.
