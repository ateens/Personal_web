export const PRODUCTION_RAILWAY_SECURITY_POLICY = Object.freeze({
  projectId: "623a83b1-085a-446a-8789-be57923a7058",
  environmentId: "0bd3f580-8f52-47e7-b69f-89f413176d3e",
  serviceId: "3a97e1c9-5424-4ec5-8da7-423b21f76785",
  accessPasswordSha256: "sha256:ae73741c23106a905fff4aec3647baa8d5ec1a0c4f31febb87ad4478e7d5fea6",
  googleRedirectUri: "https://personalweb-production-81a6.up.railway.app/api/google/oauth/callback",
  publicBaseUrl: "https://personalweb-production-81a6.up.railway.app",
});

export function railwayRuntimeDetected(env = {}) {
  return Boolean(
    String(env.RAILWAY_PROJECT_ID || "").trim()
    || String(env.RAILWAY_ENVIRONMENT_ID || "").trim()
    || String(env.RAILWAY_SERVICE_ID || "").trim(),
  );
}

export function deploymentSecurityPolicy(env = {}, expected = PRODUCTION_RAILWAY_SECURITY_POLICY) {
  const matches = String(env.RAILWAY_PROJECT_ID || "") === expected.projectId
    && String(env.RAILWAY_ENVIRONMENT_ID || "") === expected.environmentId
    && String(env.RAILWAY_SERVICE_ID || "") === expected.serviceId;
  return {
    isProductionTarget: matches,
    forceAppAccessAuth: matches,
    forceStatePrecondition: matches,
    accessPasswordSha256: matches ? expected.accessPasswordSha256 : "",
    googleRedirectUri: matches ? expected.googleRedirectUri : "",
    publicBaseUrl: matches ? expected.publicBaseUrl : "",
  };
}
