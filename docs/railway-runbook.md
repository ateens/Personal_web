# Railway-only operations runbook

SYGMA is hosted and executed only on Railway. The Node server serves the optimized client, PostgreSQL API, and Google OAuth flow from one origin:

```text
https://personalweb-production-81a6.up.railway.app
```

## Public access boundary

- There is no application-level password, session gate, Sites Worker, proxy bearer, or OAuth handoff ticket.
- `GET /`, workspace reads, Google Calendar reads, and the mutation APIs are reachable by anyone who can reach the Railway URL.
- Production and every Railway runtime require revision preconditions for state mutations. This prevents stale concurrent writes; it is not authorization.
- Unsafe API requests require the exact app `Origin`, limiting cross-site browser submission. This does not stop a person from opening the app and using its API directly.
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
4. Confirm an unsafe API request without `Origin` returns `403 ORIGIN_NOT_ALLOWED`.
5. Confirm the browser can save with the current revision precondition.
6. Confirm `/api/google/auth/start` redirects to Google and uses the Railway callback URI.
7. Confirm a Resource deep link reloads through the SPA fallback.

## Rollback

Roll back to the previous Railway-only commit through the Railway or GitHub deployment history. Reintroducing an access gate is a separate architecture change and must include its credential lifecycle, session store, browser behavior, tests, and operating documentation together.
