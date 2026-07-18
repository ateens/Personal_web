import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  deploymentSecurityPolicy,
  PRODUCTION_RAILWAY_SECURITY_POLICY,
  railwayRuntimeDetected,
} from "../server/deployment-security.js";
import { mutationOriginAllowed } from "../server/request-security.js";

const exactTarget = {
  RAILWAY_PROJECT_ID: PRODUCTION_RAILWAY_SECURITY_POLICY.projectId,
  RAILWAY_ENVIRONMENT_ID: PRODUCTION_RAILWAY_SECURITY_POLICY.environmentId,
  RAILWAY_SERVICE_ID: PRODUCTION_RAILWAY_SECURITY_POLICY.serviceId,
  PUBLIC_BASE_URL: "https://stale-origin.example",
};
const policy = deploymentSecurityPolicy(exactTarget);

assert(policy.isProductionTarget, "exact production target was not recognized");
assert(policy.forceStatePrecondition, "production state preconditions were not forced");
assert.equal(policy.publicBaseUrl, "https://personalweb-production-81a6.up.railway.app");
assert.equal(policy.googleRedirectUri, "https://personalweb-production-81a6.up.railway.app/api/google/oauth/callback");
assert(!("forceAppAccessAuth" in policy), "removed app access policy is still exposed");
assert(!("accessPasswordSha256" in policy), "removed access verifier is still exposed");
assert(railwayRuntimeDetected({ RAILWAY_SERVICE_ID: "preview-service" }), "Railway preview runtime was not detected");
assert(!railwayRuntimeDetected({}), "local development was mistaken for a Railway runtime");

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
assert(!server.includes("createAccessController"), "server still imports the app access controller");
assert(!server.includes("/auth/login"), "server still exposes the access-code login route");
assert(server.includes("const requireMutationOrigin = railwayRuntime"), "Railway same-origin mutation protection is missing");
assert(server.includes('code: "ORIGIN_NOT_ALLOWED"'), "same-origin mutation rejection is missing");
assert(server.includes("mutationOriginAllowed(request, requestUrl, requireMutationOrigin)"), "same-origin mutation helper is not connected");
assert(!existsSync(new URL("../server/access-auth.js", import.meta.url)), "app access controller file still exists");
assert(!existsSync(new URL("check-access-auth.mjs", import.meta.url)), "app access self-test still exists");
assert(!existsSync(new URL("../tests/e2e/access-session-expiry.spec.js", import.meta.url)), "app access browser test still exists");

const requestUrl = new URL("https://personalweb-production-81a6.up.railway.app/api/state");
assert(mutationOriginAllowed({ method: "PUT", headers: {} }, requestUrl, true), "native API mutation without browser metadata was rejected");
assert(!mutationOriginAllowed({ method: "PUT", headers: { "sec-fetch-site": "cross-site" } }, requestUrl, true), "cross-site browser mutation without Origin was accepted");

console.log("Railway deployment security check passed without an app access gate.");
