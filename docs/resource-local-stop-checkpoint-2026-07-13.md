# Resource local stop checkpoint (2026-07-13)

## Scope decision

- The product scope is single-user and single-workspace.
- Phase C multi-user work is explicitly out of scope by user decision: tenant separation, RBAC, collaborative identity, and multi-user session/CSRF design are not completion gates.
- Existing single-user authentication, security headers, rate limiting, audit events, backups, and restore protections remain in place.

## Local checkpoint

Branch: `codex/paste-preflight-cloud-review`

The synchronous Resource paste preflight now covers file paste/drop and dragover rejection, incoming representation byte limits, exact projected Resource PUT body size, final serialized mark count, controlled single-line/plain and title insertion, sanitized-empty HTML no-op behavior, native selection/history preservation on rejection, and `If-Match` as the sole revision authority for queued incremental Resource writes.

The visual-state evidence spec was split into one capture per test. It no longer forces animations to finish or disables animations during screenshots; it waits for fonts, idle save state, zero active animations, and three stable animation frames.

## Local verification

- `resource-paste-ingress-preflight.spec.js`: 15/15 passed in 57.6 seconds.
- Related editor transport, input-limit, editor-matrix, and URL batch: 32/33 passed before updating the stale native-fallback expectation; the unchanged non-URL 26 tests passed, then the complete final URL spec passed 7/7 in 12.5 seconds.
- `resource-visual-state-evidence.spec.js`: 19/19 passed twice in 50.2 and 51.3 seconds.
- `npm run check`: passed.
- `npm run check:build`: passed; `1,333,353 -> 930,610` bytes, Brotli `161,715`, gzip `209,058`.
- `git diff --check`: passed before checkpoint commit.

The full 189-test suite was not rerun at this stop checkpoint, so this branch is not merged to main and is not a release-complete claim.

## Cloud termination state

- `task_e_6a543608ce1c8332bc95e375b58c7b54` finished, but its diff was rejected during review and was not applied.
- `task_e_6a543b03abf48332b851cf8e622ef980` remained pending. The available `codex cloud` CLI has no cancel command. No diff from this task was applied, and it is not part of this checkpoint.
- All accepted code and verification in this checkpoint were performed locally on macOS.

## Stop state

No new feature tranche should begin from this checkpoint without first running the full local regression and deciding whether to merge the review branch. Phase A and Phase B remain partial overall; the active goal is not complete.
