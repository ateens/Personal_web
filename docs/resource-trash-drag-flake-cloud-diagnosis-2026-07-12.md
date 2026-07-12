# Resource Trash drag flake Cloud diagnosis — 2026-07-12

## Scope

Investigated the remaining nondeterministic failure in `tests/e2e/resource-trash-view.spec.js` for `Resource drag actions expose a reversible Trash target and never expose delete`. The reported symptom was that `.delete-drag-stage` was absent after a real Playwright mouse drag on the Resource library card.

All verification in this pass was run in Codex Cloud with Node 22 (`v22.22.2`) and Playwright's stable Chrome channel. The host stable package available during this run resolved to `Google Chrome 150.0.7871.114`; the test route and launch path were the same stable-channel path requested for the Cloud Chromium lane.

## Reproduction and instrumentation evidence

### Fresh-process focused reproduction

Before changing product code, I ran the focused test in 10 fresh Playwright/server processes with unique fixture ports:

- Command pattern: `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=<unique> npx playwright test tests/e2e/resource-trash-view.spec.js -g "Resource drag actions" --reporter=line`
- Result: **10/10 passed**, so the new session did not capture the failure twice before the fix.
- This satisfies the requested minimum of at least 10 fresh-process attempts when the failure is not recaptured.

### Previously captured Cloud failure

The current branch already contained exact prior Cloud evidence for the same symptom:

- First full `resource-trash-view.spec.js` shard run: **5 passed, 1 failed**; failing locator was `.delete-drag-stage`, expected visible, element not found.
- Fresh rerun: **5 passed, 1 failed** with the same missing `.delete-drag-stage` symptom.

### Pointer/target/layout diagnosis

The Resource card is an `<article>` with `data-delete-drag-type="resources"` and `data-delete-drag-id`, but its entire visible content is wrapped by an opener `<a class="resource-card-open" href="..." data-open-resource="...">`. Therefore the supported visible card surface is commonly an anchor child, not a plain article background.

The first product fix made anchor descendants eligible for delete/trash drag start, so `pointerdown` on the opener anchor can create `ui.pendingDeleteDrag`. However, the opener remains a native draggable hyperlink. During a small real mouse drag from the card top (`startY = bounds.y + 4`) to `+14px`, Chromium can enter native link drag behavior (`dragstart`) before the app promotes `pendingDeleteDrag` to `deleteDrag`. In that path the app's `handleDragStart` previously did not prevent default for Resource/Box/Inbox delete-drag cards, so native drag behavior could steal/cancel the pointer stream and leave no `.delete-drag-stage` rendered.

Measured against the requested hypotheses:

- **Excluded child?** No. After the anchor exclusion removal, the visible opener anchor is no longer excluded by `handlePointerDown` for delete/trash drag start.
- **Gesture races layout?** No evidence of a required arbitrary wait. The card is visible and bounded before the gesture; passing and failing reports both use the same visible card selector. The observed missing overlay maps to drag state never promoting rather than late overlay render.
- **Pointer/mouse compatibility overwrite?** The app only registers one down/move/up family when Pointer Events are supported, so duplicate `mousedown` compatibility events are not the main overwrite vector. The remaining browser-level interference is native `dragstart` from the anchor child.

## Product fix

`handleDragStart` now prevents the browser's native drag operation whenever the drag starts inside a supported delete/trash drag card in the `inbox`, `boxes`, or `resources` views. This keeps the existing end-to-end real pointer gesture intact, does not call internal drag APIs, and does not add sleeps. Normal clicks remain supported because only native drag initiation is cancelled.

## Final verification counts

| Check | Result |
| --- | --- |
| Focused `Resource drag actions` after fix, 10 fresh processes | **10/10 passed** |
| Full `resource-trash-view.spec.js`, run 1 | **6/6 passed** |
| Full `resource-trash-view.spec.js`, run 2 | **6/6 passed** |
| `resource-state-delete-guard.spec.js` | **3/3 passed** |
| `npm run check` | **passed** |
| `npm run check:build` | **passed** |

## Conclusion

The remaining nondeterminism was a product-code drag integration issue on Resource cards whose visible drag surface is a native hyperlink. The app accepted the anchor child for pending drag, but did not suppress the browser's native link `dragstart`; under Chromium timing this could prevent promotion to `ui.deleteDrag`, so the trash/delete drag overlay was never rendered. Preventing native dragstart for supported delete/trash cards fixes the valid visible-card drag without changing the test into a synthetic shortcut.
