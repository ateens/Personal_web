# Resource paste ingress preflight cloud diagnosis (2026-07-13)

Phase 1 implements only the verified synchronous preflight foundation for Resource paste/drop ingress.

## Implemented

- File-bearing paste/drop is rejected from the actual event target when the target is a Resource title, Resource block editor, or Resource page shell.
- Raw text, custom block MIME, and HTML fallback representations are bounded before mutation or block-selection clearing.
- Structural block paste now prepares one projected Resource clone before commit, then validates the exact projected block count, block text lengths, and Resource PUT body size.
- Code-block paste validates the exact merged code text and projected Resource PUT body before beginning history or mutating the live block.
- Rejections use the existing toast and app announcement surfaces.

## Intentionally not implemented in phase 1

- Async progress/cancel UI.
- Real binary upload or media block handling.
- File reads, data/blob URLs, base64 asset ingestion, workers, timers, or new asset schema.
- New `ui.pasteIngress` state or CSS.

These remain phase 2 / P2 work.

## Focused Codex Cloud verification at `b79b859`

Verification target: `codex/paste-preflight-cloud-review` at HEAD `b79b859527480ef0f720a2842c9194eba8f0481f`.

### Environment and temporary browser setup

All `node`, `npm`, and `npx` commands were run with this PATH:

```sh
PATH=/root/.nvm/versions/node/v22.22.2/bin:/Users/isanghyeon/.npm-global/bin:/Applications/Codex.app/Contents/Resources:/Users/isanghyeon/.npm-global/bin:/Applications/Codex.app/Contents/Resources:/Users/isanghyeon/.cargo/bin:/Users/isanghyeon/.codex/tmp/arg0/codex-arg0Dw6hO4:/Users/isanghyeon/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override:/Users/isanghyeon/.antigravity/antigravity/bin:/opt/homebrew/opt/postgresql@15/bin:/Users/isanghyeon/.npm-global/bin:/Users/isanghyeon/.local/npm/bin:/Users/isanghyeon/.local/npm/bin:/Users/isanghyeon/.npm-global/bin:/Users/isanghyeon/.npm-global/bin:/Users/isanghyeon/.npm-global/bin:/Users/isanghyeon/.npm-global/bin:/Users/isanghyeon/.npm-global/bin:/usr/local/bin:/Users/isanghyeon/Library/pnpm:/Users/isanghyeon/.bun/bin:/Users/isanghyeon/.bun/bin:/opt/miniconda3/bin:/opt/miniconda3/condabin:/opt/homebrew/opt/openjdk/bin:/Users/isanghyeon/.local/bin:/Users/isanghyeon/.local/bin:/Users/isanghyeon/.local/bin:/Library/TeX/texbin:/opt/homebrew/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Users/isanghyeon/.lmstudio/bin:/Users/isanghyeon/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:/Applications/ChatGPT.app/Contents/Resources
```

Focused setup commands and results:

```sh
node --version
# v22.22.2

npm --version
# 11.4.2

npm ci
# added 47 packages, audited 48 packages, 0 vulnerabilities

npm install --no-save --no-package-lock @sparticuz/chromium@149.0.0
# added 18 packages, audited 66 packages, 0 vulnerabilities

node -e "import chromium from '@sparticuz/chromium'; console.log(await chromium.executablePath());"
# /tmp/chromium

/tmp/chromium --version
# Chromium 149.0.7827.0
```

The temporary, untracked Playwright config used only:

- `executablePath: await chromium.executablePath()`.
- `args: ["--disable-gpu", "--disable-webgl"]`.
- `ignoreDefaultArgs: ["--enable-unsafe-swiftshader"]`.

It did not use `chromium.args`, `--single-process`, or `--no-zygote`. The temporary config and value-probe spec were deleted after verification. `package.json`, `package-lock.json`, and the tracked `playwright.config.js` remained unchanged.

### Focused preflight runs

Complete `tests/e2e/resource-paste-ingress-preflight.spec.js` was run three independent times at final HEAD with unique fixture ports:

```sh
E2E_PORT=45101 npx playwright test tests/e2e/resource-paste-ingress-preflight.spec.js --config=playwright.paste-preflight-cloud.config.mjs
# 9 passed (1.7m)

E2E_PORT=45102 npx playwright test tests/e2e/resource-paste-ingress-preflight.spec.js --config=playwright.paste-preflight-cloud.config.mjs
# 9 passed (1.8m)

E2E_PORT=45103 npx playwright test tests/e2e/resource-paste-ingress-preflight.spec.js --config=playwright.paste-preflight-cloud.config.mjs
# 9 passed (1.7m)
```

No failures occurred in the complete preflight spec. No deterministic test setup correction was necessary, and no product code was modified.

The split tests verified independent fixture reset and time budgets for:

- Exact Resource block-count projection bounds: 5,000 accepted and 5,001 rejected.
- 250,001-character structural merge rejection with stale selection and prior history preserved.
- Exact 250,000-character structural merge commit, undo, and redo.
- Projected Resource PUT body overflow below the incoming custom representation cap.

### Recorded boundary values

A temporary, untracked one-test Playwright value probe on `E2E_PORT=45104` recorded the boundary values below and passed in 13.1s. The probe used the same fixture helpers and temporary Chromium config, then was deleted.

```json
{
  "mergeOverflowBytes": 50003,
  "exactBoundaryBytes": 50003,
  "projectedRejectionLength": 250003,
  "undoRedoLengths": [250000, 199999, 250000],
  "seededBodyBytes": 4979778,
  "pageNextWriteBytes": 4979778,
  "incomingCustomBytes": 237055,
  "projectedNextBodyBytes": 5216880
}
```

Interpretation:

- The structural merge overflow representation was 50,003 UTF-8 bytes and projected to 250,003 characters, so it was below the incoming representation cap but above the merged block cap and was rejected atomically.
- The exact-boundary representation was also 50,003 UTF-8 bytes and produced the expected commit/undo/redo lengths of 250,000, 199,999, and 250,000.
- The projected PUT body test seeded a next-write body of 4,979,778 bytes; the browser-side next-write body measurement was also 4,979,778 bytes, which is between 4,900,000 and 5,000,000.
- The incoming custom block MIME body was 237,055 bytes, which is below the 250,000-byte incoming cap.
- The projected next Resource PUT body was 5,216,880 bytes, which is above the 5,000,000-byte body cap and was rejected without mutation.

### Stability notes

Across the three complete focused preflight passes and the one value probe, Playwright completed normally with no browser crash, page disconnect, fixture-server crash, or out-of-memory termination observed in command output.

Full regressions remain pending; this run intentionally covered only the focused Resource paste ingress preflight spec and the associated boundary-value probe.
