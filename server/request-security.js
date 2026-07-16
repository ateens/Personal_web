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
  return SAFE_METHODS.has(method) || requestOriginMatches(request, requestUrl);
}
