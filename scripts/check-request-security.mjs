import assert from "node:assert/strict";
import { mutationOriginAllowed, requestOriginMatches } from "../server/request-security.js";

const requestUrl = new URL("https://personalweb-production-81a6.up.railway.app/api/state");

assert(mutationOriginAllowed({ method: "GET", headers: {} }, requestUrl, true), "safe request unexpectedly required Origin");
assert(mutationOriginAllowed({ method: "POST", headers: {} }, requestUrl, false), "disabled boundary rejected a mutation");
assert(mutationOriginAllowed({ method: "POST", headers: {} }, requestUrl, true), "native request without browser metadata was rejected");
assert(!mutationOriginAllowed({ method: "POST", headers: { "sec-fetch-site": "cross-site" } }, requestUrl, true), "cross-site browser mutation without Origin was accepted");
assert(!mutationOriginAllowed({ method: "POST", headers: { origin: "https://example.com" } }, requestUrl, true), "foreign Origin was accepted");
assert(!mutationOriginAllowed({ method: "POST", headers: { origin: "not-a-url" } }, requestUrl, true), "malformed Origin was accepted");
assert(mutationOriginAllowed({ method: "POST", headers: { origin: requestUrl.origin } }, requestUrl, true), "exact Origin was rejected");
assert(requestOriginMatches({ headers: { origin: `${requestUrl.origin}/ignored-path` } }, requestUrl), "same-origin URL path was rejected");

console.log("Browser same-origin and native API mutation check passed.");
