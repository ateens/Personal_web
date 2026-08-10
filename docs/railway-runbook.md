# Railway-only operations runbook

SYGMA is hosted and executed only on Railway. The Node server serves the optimized client, PostgreSQL API, and Google OAuth flow from one origin:

```text
https://personalweb-production-81a6.up.railway.app
```

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
