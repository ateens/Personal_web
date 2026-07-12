# Resource toolbar/history postfix cloud verification — 2026-07-12

## Scope

- Verification target: latest branch head after the inline toolbar bounds and Resource page history routing fixes.
- Branch-head commit verified: `5fb62b264b2eb871597795dc6d029975517610c4`.
- Requested durable report file: `docs/resource-toolbar-history-postfix-cloud-verification-2026-07-12.md`.
- Product code, tests, package files, and existing docs were not modified.
- Temporary local files used for the run were not part of the final diff.

## Runtime route

- Node route: `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH ...`.
- Node version: `v22.22.2`.
- npm version: `11.4.2`.
- Browser route: temporary `@sparticuz/chromium@149.0.0` installed with `--no-save`, launched through a temporary Playwright config with `channel: undefined` and `launchOptions.executablePath = await chromium.executablePath()`.
- Chromium executable: `/tmp/chromium`.
- Chromium version: `Chromium 149.0.7827.0`.
- Launch arguments: `--disable-gpu`, `--disable-webgl`; ignored default arg: `--enable-unsafe-swiftshader`.
- Each Playwright command below used a fresh Node/Playwright process, `reuseExistingServer: false`, a fresh fixture server, and a unique `E2E_PORT`.

## Install, static, and build checks

| Step | Exact command | Result |
| --- | --- | --- |
| Dependency install | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm ci` | Passed: `added 47 packages`, `audited 48 packages`, `found 0 vulnerabilities`. |
| Chromium 149 package for cloud route | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm install @sparticuz/chromium@149.0.0 --no-save` | Passed: `added 18 packages`, `audited 66 packages`, `found 0 vulnerabilities`. |
| Static checks | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check` | Passed: `Source audit passed.` and `Sites worker check passed.` |
| Build check | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH npm run check:build` | Passed: `Built SYGMA assets: 1317924 -> 920895 bytes (70%).`, `Precompressed Brotli assets: 159850 bytes (12% of source).`, and `Build check passed: 1317924 -> 920895 bytes (159850 Brotli, 206432 gzip).` |

## Focused Playwright verification

| Run | Exact command | Port | Count | Result |
| --- | --- | ---: | --- | --- |
| Inline toolbar, first run | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=45101 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-inline-toolbar.spec.js` | 45101 | 5 passed / 5 total | Passed in 33.1s. |
| Inline toolbar, repeated run | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=45102 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-inline-toolbar.spec.js` | 45102 | 5 passed / 5 total | Passed in 30.3s. |
| Resource page history, first run | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=45103 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-page-history.spec.js` | 45103 | 5 passed / 5 total | Passed in 52.4s. |
| Resource page history, repeated run | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=45104 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-page-history.spec.js` | 45104 | 5 passed / 5 total | Passed in 53.2s. |
| Comment/history integrity regression guard | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=45105 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-comment-history-integrity.spec.js` | 45105 | 6 passed / 6 total | Passed in 48.8s. |
| Resource page features regression guard | `PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH E2E_PORT=45106 npx playwright test -c playwright.cloud.tmp.config.js tests/e2e/resource-page-features.spec.js` | 45106 | 19 passed / 19 total | Passed in 2.8m. |

## First-run and repeated counts

- `tests/e2e/resource-inline-toolbar.spec.js`: first run 5/5 passed; repeated run 5/5 passed.
- `tests/e2e/resource-page-history.spec.js`: first run 5/5 passed; repeated run 5/5 passed.
- `tests/e2e/resource-comment-history-integrity.spec.js`: single guard run 6/6 passed.
- `tests/e2e/resource-page-features.spec.js`: single guard run 19/19 passed.
- Aggregate focused Playwright total across all requested runs: 45/45 passed.

## Failures and infrastructure events

- First-run failures: none.
- Repeated-run failures: none.
- Exact failed assertions: none.
- Browser crash events: none observed in the captured Playwright output.
- Browser disconnect events: none observed in the captured Playwright output.
- OOM, out-of-memory, `SIGKILL`, or `Target closed` events: none observed in the captured Playwright output.
- Non-failing environment noise: npm printed `npm warn Unknown env config "http-proxy"`; Node printed the fixture warning `The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.` These warnings did not fail any requested check.

## Conclusion

The latest branch head passed the requested Node 22 + Chromium 149 fresh-process verification route for the inline toolbar bounds fix, the Resource page history-routing fix, and the two additional history-routing regression guard specs. No first-run failures or browser crash/disconnect/OOM events were observed.
