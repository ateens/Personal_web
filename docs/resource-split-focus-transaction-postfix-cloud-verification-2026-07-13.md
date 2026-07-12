# Resource split focus transaction postfix cloud verification — 2026-07-13

## Scope and repository guards

- Verification target: current branch `work`, representing remote branch request `codex/resource-notion-parity-cloud`, at `HEAD` `6e48d61bf636dc599f819413f98d4e607c973d54` (`6e48d61`).
- Initial worktree state before dependency/test execution: clean tracked worktree (`git status --short` produced no tracked entries).
- No production code, CSS, tests, package files, committed Playwright config, server code, service worker, or existing docs were edited.
- Only tracked output intentionally added by this task: `docs/resource-split-focus-transaction-postfix-cloud-verification-2026-07-13.md`.

## Node, dependency, browser, and temporary config verification

All `node` / `npm` / `npx` commands were executed with this exact PATH prefix:

```bash
PATH=/root/.nvm/versions/node/v22.22.2/bin:/Users/isanghyeon/.npm-global/bin:/Applications/Codex.app/Contents/Resources:/Users/isanghyeon/.npm-global/bin:/Applications/Codex.app/Contents/Resources:/Users/isanghyeon/.cargo/bin:/Users/isanghyeon/.codex/tmp/arg0/codex-arg0Dw6hO4:/Users/isanghyeon/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override:/Users/isanghyeon/.antigravity/antigravity/bin:/opt/homebrew/opt/postgresql@15/bin:/Users/isanghyeon/.npm-global/bin:/Users/isanghyeon/.local/npm/bin:/Users/isanghyeon/.local/npm/bin:/Users/isanghyeon/.npm-global/bin:/Users/isanghyeon/.npm-global/bin:/Users/isanghyeon/.npm-global/bin:/Users/isanghyeon/.npm-global/bin:/Users/isanghyeon/.npm-global/bin:/usr/local/bin:/Users/isanghyeon/Library/pnpm:/Users/isanghyeon/.bun/bin:/Users/isanghyeon/.bun/bin:/opt/miniconda3/bin:/opt/miniconda3/condabin:/opt/homebrew/opt/openjdk/bin:/Users/isanghyeon/.local/bin:/Users/isanghyeon/.local/bin:/Users/isanghyeon/.local/bin:/Library/TeX/texbin:/opt/homebrew/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Users/isanghyeon/.lmstudio/bin:/Users/isanghyeon/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:/Applications/ChatGPT.app/Contents/Resources
```

Executed setup commands:

```bash
node -v
npm ci
npm install --no-save @sparticuz/chromium@149.0.0
node -e "import chromium from '@sparticuz/chromium'; console.log(await chromium.executablePath())"
/tmp/chromium --version
```

Observed setup results:

- Node version: `v22.22.2`.
- `npm ci`: passed.
- Temporary `npm install --no-save @sparticuz/chromium@149.0.0`: passed.
- Sparticuz executable path: `/tmp/chromium`.
- Browser version: `Chromium 149.0.7827.0`.
- Temporary untracked config used `channel: undefined`, `executablePath: await chromium.executablePath()`, `launchOptions.args: ["--disable-gpu","--disable-webgl"]`, and `launchOptions.ignoreDefaultArgs: ["--enable-unsafe-swiftshader"]`.
- Temporary config did not use `chromium.args`, `--single-process`, `--no-zygote`, or other Sparticuz args.

## Browser verification commands and results

Each browser run used a fresh `npx playwright test` process with a unique `E2E_PORT` and the temporary Sparticuz Playwright config.

### Focused split/soft-break test — 15 independent runs

Command shape for each run:

```bash
PATH=<exact PATH above> E2E_PORT=<unique port> npx playwright test --config codex-temp-playwright.config.mjs tests/e2e/resource-editor-matrix.spec.js -g 'Enter splits a block while Shift\+Enter inserts a soft line break'
```

| Run | Port | Result |
| --- | ---: | --- |
| focused-1 | 45201 | pass |
| focused-2 | 45202 | pass |
| focused-3 | 45203 | pass |
| focused-4 | 45204 | pass |
| focused-5 | 45205 | pass |
| focused-6 | 45206 | pass |
| focused-7 | 45207 | pass |
| focused-8 | 45208 | pass |
| focused-9 | 45209 | pass |
| focused-10 | 45210 | pass |
| focused-11 | 45211 | pass |
| focused-12 | 45212 | pass |
| focused-13 | 45213 | pass |
| focused-14 | 45214 | pass |
| focused-15 | 45215 | pass |

Focused aggregate: 15/15 passed. No focused reruns were required after the corrected temporary config was used. Split focus did not reproduce as a failure.

### Complete `resource-editor-matrix.spec.js` — 5 independent runs

Command shape for each run:

```bash
PATH=<exact PATH above> E2E_PORT=<unique port> npx playwright test --config codex-temp-playwright.config.mjs tests/e2e/resource-editor-matrix.spec.js
```

| Run | Port | Result | Test count |
| --- | ---: | --- | ---: |
| matrix-1 | 45401 | pass | 15/15 |
| matrix-2 | 45402 | pass | 15/15 |
| matrix-3 | 45403 | pass | 15/15 |
| matrix-4 | 45404 | pass | 15/15 |
| matrix-5 | 45405 | pass | 15/15 |

Matrix aggregate: 5/5 spec runs passed, 75/75 tests passed. No matrix reruns were required after the corrected temporary config was used. The title/first-block Arrow navigation test remained clean in all 5 full matrix runs.

### Complete `resource-page-features.spec.js` — 1 run

Command:

```bash
PATH=<exact PATH above> E2E_PORT=45601 npx playwright test --config codex-temp-playwright.config.mjs tests/e2e/resource-page-features.spec.js
```

Result: pass, 19/19 tests passed. No rerun required.

### Complete `resource-dom-stability.spec.js` — 1 run

Command:

```bash
PATH=<exact PATH above> E2E_PORT=45701 npx playwright test --config codex-temp-playwright.config.mjs tests/e2e/resource-dom-stability.spec.js
```

Result: pass, 4/4 tests passed. No rerun required.

## Non-browser checks

Executed commands:

```bash
PATH=<exact PATH above> npm run check
PATH=<exact PATH above> npm run check:build
```

Results:

- `npm run check`: passed. Output included `Source audit passed.` and `Sites worker check passed.`
- `npm run check:build`: passed.
- Build bytes: `Built SYGMA assets: 1319958 -> 922215 bytes (70%).`
- Precompression bytes: `Precompressed Brotli assets: 160068 bytes (12% of source).`
- Build check bytes: `Build check passed: 1319958 -> 922215 bytes (160068 Brotli, 206792 gzip).`

## Aggregate pass/fail, reruns, and stability notes

- Browser runs requested: 22 independent runs.
- Browser runs passed: 22/22.
- Browser test assertions passed: 113/113 across the requested browser suite executions.
  - Focused split/soft-break: 15 tests.
  - Matrix: 75 tests.
  - Page features: 19 tests.
  - DOM stability: 4 tests.
- Failed browser tests after corrected temporary config: 0.
- Requested failure reruns after corrected temporary config: 0.
- Crash count: 0.
- Disconnect count: 0.
- OOM / out-of-memory count: 0.
- Split focus reproduced: no.
- Title/first-block Arrow remained clean in all full matrix runs: yes, 5/5.

## Cleanup and final guards

Cleanup performed after verification:

```bash
rm -f codex-temp-playwright.config.mjs /tmp/pw-sparticuz-resource.config.mjs /tmp/run-resource-verification.sh
rm -rf output node_modules
```

Package/config guard command:

```bash
git diff --exit-code -- package.json package-lock.json playwright.config.js
```

Final tracked diff guard:

```bash
git status --short --untracked-files=all
```

Final expected tracked diff is exactly this new report file.
