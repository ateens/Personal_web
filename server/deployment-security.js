export const PRODUCTION_RAILWAY_SECURITY_POLICY = Object.freeze({
  projectId: "623a83b1-085a-446a-8789-be57923a7058",
  environmentId: "0bd3f580-8f52-47e7-b69f-89f413176d3e",
  serviceId: "3a97e1c9-5424-4ec5-8da7-423b21f76785",
  apiBearerTokenSha256: "sha256:dbfe0513ee6c21bae63755ff70ed9f2f68af30c5e3412f4b405558009381592a",
  googleRedirectUri: "https://personalweb-production-81a6.up.railway.app/api/google/oauth/callback",
  publicBaseUrl: "https://sygma-personal-web.ateens.chatgpt.site",
});

export function deploymentSecurityPolicy(env = {}, expected = PRODUCTION_RAILWAY_SECURITY_POLICY) {
  const matches = String(env.RAILWAY_PROJECT_ID || "") === expected.projectId
    && String(env.RAILWAY_ENVIRONMENT_ID || "") === expected.environmentId
    && String(env.RAILWAY_SERVICE_ID || "") === expected.serviceId;
  return {
    isProductionTarget: matches,
    forceApiAuth: matches,
    forceStatePrecondition: matches,
    apiBearerTokenSha256: matches ? expected.apiBearerTokenSha256 : "",
    googleRedirectUri: matches ? expected.googleRedirectUri : "",
    publicBaseUrl: matches ? expected.publicBaseUrl : "",
  };
}
