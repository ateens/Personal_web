const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requestOriginMatches(request, requestUrl) {
  const supplied = String(request?.headers?.origin || "").trim();
  if (!supplied) return false;
  try {
    return new URL(supplied).origin === requestUrl.origin;
  } catch {
    return false;
  }
}

export function mutationOriginAllowed(request, requestUrl, required) {
  if (!required) return true;
  const method = String(request?.method || "GET").toUpperCase();
  if (SAFE_METHODS.has(method)) return true;
  const suppliedOrigin = String(request?.headers?.origin || "").trim();
  if (suppliedOrigin) return requestOriginMatches(request, requestUrl);
  const fetchSite = String(request?.headers?.["sec-fetch-site"] || "").trim().toLowerCase();
  return !fetchSite || fetchSite === "none";
}
