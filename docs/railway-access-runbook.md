# Railway-only access runbook

SYGMA is hosted and executed only on Railway. The Node server serves the optimized client, PostgreSQL API, single-owner access gate, and Google OAuth flow from one origin:

```text
https://personalweb-production-81a6.up.railway.app
```

## Security boundary

- Every Railway runtime and every production-mode process requires the access gate and state-write preconditions. The exact production Railway project, environment, and service IDs supply the verifier in `server/deployment-security.js`; another Railway service must provide `APP_ACCESS_PASSWORD_SHA256` or startup fails closed.
- The repository contains only a SHA-256 verifier for a high-entropy access code. The code itself is stored in the operator's macOS login keychain.
- A correct login creates an opaque random session kept in Node memory and an HttpOnly, Secure, SameSite=Lax cookie. Server restart or deploy invalidates every session.
- Keep the service at one replica while sessions remain process-local. A multi-replica rollout requires a shared session store before horizontal scaling.
- The production target trusts Railway's recreated `X-Real-IP` header for bounded per-client login and API rate limits.
- Unsafe authenticated requests require an exact same-origin `Origin` header.
- `/health` remains public for Railway health checks. `/api/google/oauth/callback` is admitted without an app session but remains protected by the signed, expiring, one-time OAuth state and cookie.
- There is no Sites Worker, proxy bearer, or OAuth handoff ticket.

## Retrieve the access code

```bash
security find-generic-password -a "$USER" -s "SYGMA Railway Access" -w
```

Do not put the returned value in source, shell history, issue trackers, screenshots, logs, or Railway variables. The one-way verifier is the only committed representation.

## Local verification

```bash
npm run check:access-auth
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
2. Confirm anonymous `GET /` redirects to `/auth/login`.
3. Confirm anonymous `GET /api/state/status` returns `401 AUTH_REQUIRED`.
4. Log in with the keychain access code and confirm `GET /` plus `GET /api/state/status` return `200`.
5. Confirm an authenticated state write succeeds with the current revision precondition.
6. Confirm `/api/google/auth/start` redirects to Google and the callback returns to the Railway origin.
7. Confirm a Resource deep link reloads through the SPA fallback.

## Credential rotation

1. Generate a new high-entropy access code without printing it to logs.
2. Compute its SHA-256 digest and update only `accessPasswordSha256` in `server/deployment-security.js`.
3. Replace the keychain entry named `SYGMA Railway Access`.
4. Run the local verification set and deploy through `main`.
5. Confirm old sessions were invalidated by the deployment and the old code no longer logs in.

## Rollback

Roll back to the last Railway-only commit that contains a known verifier. Do not roll back to a Sites proxy commit unless the former Sites secret, Worker policy, public origin, and OAuth handoff configuration are intentionally restored together. A code-only rollback to that architecture leaves the browser unable to reach protected APIs.
