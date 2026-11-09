# Railway-only operations runbook

SYGMA is hosted and executed only on Railway. The Node server serves the optimized client, PostgreSQL API, and Google OAuth flow from one origin:

```text
https://personalweb-production-81a6.up.railway.app
```

Railway starts the server directly with `NODE_ENV=production STATIC_ROOT=dist/client node server.js`. This preserves production settings and the built client while avoiding an idle npm parent process in the running container. `npm run start:production` remains available for local use.

## Usage and cost checks

- JSON responses negotiate Brotli/gzip above 1 KiB and fall back to the original body if compression fails or grows it. State responses remain `no-store`; revision preconditions and authoritative PostgreSQL reads are unchanged.
- Healthy browser SSE connections use a 60-second safety poll, with immediate events and wake checks. Disconnected clients retain the 10-second polling fallback. Bundled equation/code renderers use the service worker's release-scoped cache.
- Resource saves reconstruct relational collections once. Public full-state saves preserve unchanged collections and write the canonical JSON snapshot once; changed reference IDs still refresh dependent rows. Migration and restore paths retain their complete reconstruction.
- Compare memory and public network egress over equivalent usage periods after deployment; local process measurements are not a production savings guarantee.
- Keep application-to-database traffic on Railway's private network. Reference the PostgreSQL service's private `DATABASE_URL`, not `DATABASE_PUBLIC_URL`; inspect only the hostname when verifying configuration. [Railway cost control](https://docs.railway.com/pricing/cost-control)
- Keep backups, durability settings, and production security enabled. Lower memory limits can cause crashes without reducing steady memory consumption.
- Serverless is optional: it sleeps after roughly 5–10 minutes without outbound packets, requires a deployment to take effect, and may delay or fail the first request while waking. Background connections and polling can prevent sleeping. Evaluate these behaviors before changing the setting. [Railway Serverless](https://docs.railway.com/deployments/serverless)
- On Railway CLI versions that support it, `railway metrics --json --memory --network --since 1d` provides a comparable snapshot. Older versions without `metrics` need the dashboard or API instead. [Railway metrics](https://docs.railway.com/cli/metrics)

The November 2026 local checks measured a read-only production state response at 773,376 bytes, or 218,645 bytes with Brotli quality 4 (71.7% smaller). A synthetic 1.66 MB PostgreSQL workspace reduced Resource-save queries from 31 to 18 and settings-save queries from 265 to 51. These are response/workload measurements, not forecasts of total bill reductions. Local benchmark artifacts are under `output/railway-optimization-20261109/` and `output/railway-storage-20261109/`.

The current iOS widget source still fetches full workspace state, requesting Today refreshes every minute and calendar refreshes every 15 minutes; WidgetKit controls actual execution. HTTP compression benefits existing compatible clients. A narrower widget API or a different refresh schedule requires a separate native app build and installation; neither is included in this deployment.

## Public access boundary

- The ordinary workspace has no application-level password, session gate, Sites Worker, proxy bearer, or OAuth handoff ticket.
- `GET /`, ordinary workspace reads, Google Calendar reads, and the ordinary mutation APIs are reachable by anyone who can reach the Railway URL.
- `/finance` is isolated behind its own password and HttpOnly session cookie. Anonymous finance-state reads and writes return `401`; the finance state is stored outside `app_state`.
- Production and every Railway runtime require revision preconditions for state mutations. This prevents stale concurrent writes; it is not authorization.
- Unsafe requests carrying browser `Origin` or `Sec-Fetch-Site` metadata must be same-origin. Native app requests without browser fetch metadata are accepted. This does not stop a person from using the API directly.
- API rate limits and the state-write queue remain enabled.
- Google OAuth uses a signed, expiring, one-time state transaction and matching cookie on the Railway origin. This protects the callback protocol, not workspace ownership.
- `/health` remains public for Railway readiness checks.

## Local verification

```bash
npm run check:deployment-security
npm run check
npm run check:build
npm run test:e2e:baseline
```

For the full PostgreSQL path, use an isolated database target:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/sygma_personal_web npm run check:postgres
```

## Deployment verification

After `main` is pushed and Railway reports the new deployment healthy:

1. Confirm `GET /health` returns `200` and `{"ok":true,"database":"postgresql"}`.
2. Confirm anonymous `GET /` returns `200` without redirecting to `/auth/login`.
3. Confirm anonymous `GET /api/state/status` and `GET /api/state` return `200`.
4. Confirm a cross-site browser mutation returns `403 ORIGIN_NOT_ALLOWED` while a native request without browser fetch metadata reaches normal payload validation.
5. Confirm the browser and iPhone app can save with the current revision precondition.
6. Confirm `/api/google/auth/start` redirects to Google and uses the Railway callback URI.
7. Confirm a Resource deep link reloads through the SPA fallback.
8. Confirm `GET /finance` renders the locked finance shell and anonymous `GET /api/finance/state` returns `401 FINANCE_AUTH_REQUIRED`.
9. Sign in with the finance password, confirm `/api/finance/session` reports authenticated, then lock it and confirm the session cookie is cleared.
10. Confirm an authenticated conditional finance write advances `X-Finance-State-Revision` without adding a `finance` key to `/api/state`.

## Automatic web deployment hook

This checkout uses the tracked `.githooks/post-commit` hook. Enable it once with:

```bash
git config core.hooksPath .githooks
```

On `main`, a commit that changes production web paths pushes the unpushed commits to `origin/main`, waits for Railway to report `SUCCESS` for the exact commit, and checks the production `/health` response. Commits limited to docs, tests, iOS, or macOS skip deployment. Railway continues to run `npm run check && npm run check:build` against the exact pushed commit.

Run `.githooks/post-commit` to retry a failed deployment. Use `SKIP_RAILWAY_DEPLOY=1 git commit ...` only when a web commit must deliberately remain local.

## Rollback

Roll back to the previous Railway-only commit through the Railway or GitHub deployment history. If the finance gate is rolled back, do not enter real finance data until the authenticated finance boundary is restored and verified.
