# Resource API proxy authentication runbook

> Archived on 2026-07-16. This document records the former Sites-to-Railway proxy model and is not an active deployment procedure. Use `railway-runbook.md` for the current Railway-only public model.

Date: 2026-07-11

Scope: the single-workspace PostgreSQL API served by `server.js` and reached through the private OpenAI Sites Worker in `worker/index.js`.

## Security model

The production path has two independent gates:

1. A private Sites access policy authenticates the human user. When `REQUIRE_AUTHENTICATED_PROXY=1`, the Worker also requires the platform-provided `oai-authenticated-user-email` header.
2. The Worker strips browser-controlled authentication, cookie, forwarded-IP, and identity headers, then adds its server-side `API_BEARER_TOKEN`. Railway compares that bearer token with either the exact-production one-way verifier, a fail-closed deployment credential, or the enabled DB-backed proxy credential.

The normalized Sites email is forwarded as `x-sygma-authenticated-user-email` for future attribution. The current Node server does not use it for per-user authorization. This is therefore a shared, single-workspace bearer gate, not tenant isolation or role-based access control.

The staged DB credential is stored under the `api_proxy_auth` key in `app_private_data`, scoped by `APP_STATE_ID`. The configuration command prints only status, timestamps, and a SHA-256 fingerprint; it never prints the token. The server caches only the policy and token digest for `API_PROXY_AUTH_CACHE_TTL_MS`.

This repository also has an exact-production policy in `server/deployment-security.js`. When Railway's injected project, environment, and service IDs all match the intended production target, the server forces API authentication and state-write preconditions and compares the supplied token with a committed SHA-256 verifier. The token itself remains only in the Sites secret store. This is safe only because the credential was generated from 32 random bytes; do not replace it with a human-chosen or short token.

## Preconditions

- Deploy the server and Worker code that implements this flow before enabling the policy.
- Confirm the Sites deployment is private and its allowed-user policy is correct.
- Confirm `DATABASE_URL` and `APP_STATE_ID` point to the intended production workspace.
- Keep `FAIL_CLOSED_API_AUTH=0` or unset during staging. An environment override would ignore the DB policy.
- Keep `TRUST_PROXY_IP_HEADERS=0` unless direct access is restricted to a trusted ingress that sanitizes those headers.
- Use a secure operator machine with PostgreSQL access. Do not run token commands in CI logs.
- If the Railway project, environment, or service is recreated, update all three IDs in `server/deployment-security.js` and rerun the target-scope auth tests before moving traffic. An ID mismatch deliberately does not inherit the production verifier.

Run the isolated checks before touching the production key:

```bash
npm run check:api-auth
```

The check creates random test workspace IDs and cleans them up. It does not enable the production `APP_STATE_ID`.

## Exact-production one-way verifier

The exact-production policy is the preferred fail-closed path when the Sites secret is already installed but Railway dashboard secret propagation is unavailable:

1. Recover the staged token only into a mode-`0600` temporary file.
2. Compute its SHA-256 fingerprint locally and confirm it exactly matches `PRODUCTION_RAILWAY_SECURITY_POLICY.apiBearerTokenSha256`; never print the token.
3. Deploy the source containing the matching verifier. Railway supplies `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`, and `RAILWAY_SERVICE_ID`; all three must match. The platform-provided variables are documented at <https://docs.railway.com/variables/reference>.
4. The exact target forces auth and `REQUIRE_STATE_PRECONDITION` regardless of weaker or stale `API_BEARER_TOKEN`, `API_BEARER_TOKEN_SHA256`, `FAIL_CLOSED_API_AUTH`, or DB-policy values.
5. Verify the missing/wrong/correct matrix and the signed-in Sites path, then delete the temporary token file.

For another deployment, `API_BEARER_TOKEN_SHA256=sha256:<64 hex characters>` may be used with `FAIL_CLOSED_API_AUTH=1`. A malformed verifier fails closed with `503 API_AUTH_NOT_CONFIGURED`. If both a digest and plaintext deployment token are present outside the exact production target, the digest is authoritative.

## Staged activation

### 1. Inspect the current policy

```bash
node --env-file-if-exists=.env scripts/configure-api-proxy-auth.mjs status
```

Expected for a new rollout: `configured: false`, `enforced: false`. Stop if the command points at the wrong `APP_STATE_ID`, reports a malformed configuration, or the existing fingerprint is unexpected.

### 2. Stage a credential without enforcing it

Create a private temporary directory and give `stage` a path that does not yet exist:

```bash
TOKEN_DIR="$(mktemp -d)"
chmod 700 "$TOKEN_DIR"
TOKEN_FILE="$TOKEN_DIR/api-bearer-token"
node --env-file-if-exists=.env scripts/configure-api-proxy-auth.mjs stage --token-file "$TOKEN_FILE"
```

For a new configuration, `stage` creates the token file with mode `0600`, writes the matching DB configuration with `enforced: false`, and returns only its fingerprint. It refuses to overwrite an existing file. Re-running `stage` for an existing valid configuration recovers the same token and preserves the current enforcement setting; it is not token rotation.

Record the displayed fingerprint in the change record. Do not copy the token into a ticket, chat, command line, or ordinary environment variable.

### 3. Configure and deploy the private Sites Worker

In the Sites deployment configuration:

- keep the site access policy private;
- set `API_ORIGIN` to the Railway origin;
- set `REQUIRE_AUTHENTICATED_PROXY=1` as a non-secret variable;
- install the contents of `TOKEN_FILE` as the Sites secret named `API_BEARER_TOKEN`;
- build, save, and deploy the exact validated source revision.

Before enabling Railway enforcement, verify through the private Sites URL:

- an allowed signed-in user receives `200` from `/api/state/status`;
- an unauthenticated or disallowed user cannot reach application data;
- `/api/state` reads and a conditional state write still work through Sites;
- the Worker returns `AUTHENTICATED_PROXY_NOT_CONFIGURED` with `503` if its secret is deliberately absent in a non-production check;
- the Worker returns `AUTHENTICATED_SITE_USER_REQUIRED` with `401` if a request reaches it without platform identity.

At this stage the direct Railway API is still anonymous. Keep this interval short.

### 4. Enable the DB-backed Railway policy

```bash
node --env-file-if-exists=.env scripts/configure-api-proxy-auth.mjs enable --confirm
```

The running server refreshes the policy after `API_PROXY_AUTH_CACHE_TTL_MS` (default 1000 ms, allowed 100–5000 ms). A process `SIGHUP` invalidates the cache immediately where the runtime permits it.

### 5. Verify both paths

Use `/api/state/status`, not `/health`: Railway intentionally leaves its direct `/health` endpoint anonymous for deployment health checks. The Sites Worker gates `/health` when authenticated proxy mode is enabled.

The following verifier reads the token file without putting the token in the command arguments or printing it:

```bash
API_ORIGIN="https://your-railway-origin.example" TOKEN_FILE="$TOKEN_FILE" node --input-type=module <<'NODE'
import { readFile } from "node:fs/promises";

const origin = new URL(process.env.API_ORIGIN);
const token = (await readFile(process.env.TOKEN_FILE, "utf8")).trim();
const target = new URL("/api/state/status", origin);
const cases = [
  ["missing", {}],
  ["wrong", { Authorization: "Bearer intentionally-wrong-credential" }],
  ["correct", { Authorization: `Bearer ${token}` }],
];

for (const [label, headers] of cases) {
  const response = await fetch(target, { headers });
  const payload = await response.json().catch(() => ({}));
  console.log(`${label}: ${response.status} ${payload.code || "OK"}`);
}
NODE
```

Expected results:

```text
missing: 401 AUTH_REQUIRED
wrong: 401 AUTH_REQUIRED
correct: 200 OK
```

Then recheck the signed-in private Sites path. It must still return `200`, proving that the Worker secret matches the enabled DB credential. Confirm that API responses and application logs expose neither the bearer token nor the proxy's platform-identity header. Audit records should contain only request ID, operation, outcome, safe code/reason fields, status, and related numeric metadata.

After all checks pass, securely delete the temporary token directory:

```bash
rm -rf "$TOKEN_DIR"
unset TOKEN_FILE TOKEN_DIR
```

## State-write and abuse controls

Production should enable `REQUIRE_STATE_PRECONDITION=1`. The client must send the current revision using `If-Match` and/or `baseRevision`; mismatched values return `400`, missing required preconditions return `428`, and stale revisions return `409`. This prevents silent last-writer-wins overwrites but is separate from authentication.

The server applies a fixed-window rate limit before authentication:

| Variable | Default | Applies to |
| --- | ---: | --- |
| `API_RATE_LIMIT_WINDOW_MS` | 60000 | Window for all limited route classes |
| `API_RATE_LIMIT_STATE_READ_MAX` | 240 | `GET /api/state` and `/api/state/status` |
| `API_RATE_LIMIT_STATE_WRITE_MAX` | 120 | `PUT`/`POST /api/state` |
| `API_RATE_LIMIT_GOOGLE_MUTATION_MAX` | 20 | OAuth start/callback, event insert, disconnect |
| `API_RATE_LIMIT_MAX_KEYS` | 10000 | Maximum in-memory client/operation buckets |

A route-class maximum of `0` disables that class. Rejections return `429 API_RATE_LIMITED` and `Retry-After`.

State writes also pass through per-process admission control:

| Variable | Default | Meaning |
| --- | ---: | --- |
| `STATE_WRITE_MAX_CONCURRENCY` | 2 | Concurrent state-write transactions |
| `STATE_WRITE_MAX_QUEUE` | 16 | Waiting state writes |
| `STATE_WRITE_QUEUE_TIMEOUT_MS` | 10000 | Maximum queue wait |

Queue saturation or timeout returns `429 STATE_WRITE_BUSY` with `Retry-After`.

These controls are in-memory and per Node process, not distributed quotas. Multiple replicas require an ingress/WAF or shared limiter for a global guarantee. With `TRUST_PROXY_IP_HEADERS=0`, the limiter uses the socket peer address; users behind one proxy may share a bucket. Set it to `1` only when untrusted clients cannot reach Node directly and the trusted ingress strips and recreates `X-Forwarded-For`, `CF-Connecting-IP`, and `X-Real-IP`.

## Rollback and recovery

### Preserve authentication while bypassing the DB policy

The safer generic fallback is the environment override. Install either the same credential as a Railway secret named `API_BEARER_TOKEN`, or its SHA-256 verifier as `API_BEARER_TOKEN_SHA256`, set `FAIL_CLOSED_API_AUTH=1`, redeploy, and repeat the missing/wrong/correct checks. A configured digest is authoritative over a plaintext deployment token, and either deployment override ignores the DB policy. If the flag is enabled without a valid token or verifier, all protected `/api/*` routes fail closed with `503 API_AUTH_NOT_CONFIGURED`.

Once that override is verified, the DB record may be disabled for diagnosis:

```bash
node --env-file-if-exists=.env scripts/configure-api-proxy-auth.mjs disable --confirm
```

Disabling or changing the DB record does not affect requests while the environment override remains active.

### Return deliberately to anonymous Railway access

Only use this compatibility rollback with explicit acceptance that the direct Railway API becomes anonymous again:

```bash
node --env-file-if-exists=.env scripts/configure-api-proxy-auth.mjs disable --confirm
```

Wait for the policy cache TTL or invalidate it with `SIGHUP`, then confirm the prior client works. Keep the private Sites policy and Worker gate enabled unless the whole access model is intentionally being rolled back. Turning off `REQUIRE_AUTHENTICATED_PROXY` while Railway enforcement is still enabled makes the Worker stop injecting the bearer token and produces `401` responses.

Do not run `remove --confirm` as the first rollback step. It permanently deletes the stored credential and makes safe re-enablement impossible without staging a new one. Remove only after a validated rollback and an explicit decision to discard the credential:

```bash
node --env-file-if-exists=.env scripts/configure-api-proxy-auth.mjs remove --confirm
```

## Failure modes and limitations

| Observation | Meaning | Action |
| --- | --- | --- |
| Worker `401 AUTHENTICATED_SITE_USER_REQUIRED` | Sites did not provide authenticated identity | Check private access policy and signed-in session; do not accept a browser-supplied replacement header |
| Worker `503 AUTHENTICATED_PROXY_NOT_CONFIGURED` | Worker gate is on but its secret is absent | Install `API_BEARER_TOKEN` as a Sites secret and redeploy |
| Railway `401 AUTH_REQUIRED` | Missing or wrong bearer under an enforced policy | Check Worker secret against the staged fingerprint; never log the token |
| Railway `503 API_AUTH_NOT_CONFIGURED` | Missing/malformed deployment verifier or token, malformed DB policy, or DB auth-policy read failure | Restore a valid verifier/secret/policy; repeat the exact target and request-matrix checks |
| `429 API_RATE_LIMITED` | Fixed-window route quota exceeded | Honor `Retry-After`; inspect ingress/client keying before raising limits |
| `429 STATE_WRITE_BUSY` | Write queue full or timed out | Honor `Retry-After`; reduce write bursts or scale with a shared concurrency design |

Known boundaries:

- A single bearer credential protects the whole `APP_STATE_ID`; there is no row-level tenant isolation, per-user authorization, or role model.
- The identity email is forwarded for future attribution but is not an authorization decision in the current server.
- In DB-backed mode, the credential is recoverable by the server, so database and Sites-secret access remain security-critical. The exact-production path instead stores only the one-way verifier in source and the token in the Sites secret store.
- On the exact production target, a staged DB `api_proxy_auth` row is ignored. Audit and remove an obsolete plaintext row when production DB operator access is available, but do not weaken the active one-way gate to do so.
- Recreating the Railway project, environment, or service changes the IDs and requires a policy update before cutover. Token rotation requires coordinated Sites-secret and verifier changes; use a temporary dual-verifier rollout if zero downtime is required.
- The direct Railway `/health` route remains anonymous, and `/api/google/oauth/callback` is exempt from the Node bearer check so that OAuth state-cookie validation can complete. Application state routes are not exempt.
- The limiter and state-write queue are process-local. They are guardrails, not DDoS protection.
- `stage` recovers an existing credential and does not rotate it. There is no atomic zero-downtime rotation command in this version; plan a controlled fail-closed environment-override transition for rotation.
