/**
 * Helper to format token count to an approximate value (closest thousand).
 * If 0 < tokens < 500, returns "<1k".
 * If tokens is exactly 0, returns "0".
 * Otherwise, rounds to the nearest thousand (e.g., "~3k").
 */
export function formatTokenApprox(tokens: number): string {
  if (tokens === 0) return "0";
  if (tokens > 0 && tokens < 500) return "<1k";
  const thousands = Math.round(tokens / 1000);
  if (thousands === 0) return "<1k";
  return `~${thousands}k`;
}

const AUTH_ERROR_SUBSTRINGS = [
  "invalid refresh token",
  "no oauth tokens",
  "refresh token",
  "re-authentication required",
  "unauthorized",
  "401",
  "403"
];

/**
 * Classifies a token-count error string as auth-like or generic.
 * Returns a short human-readable label and whether this looks like an auth failure.
 */
export function describeTokenError(error: string): { label: string; authLike: boolean } {
  const lower = error.toLowerCase();
  const authLike = AUTH_ERROR_SUBSTRINGS.some((s) => lower.includes(s));
  return {
    label: authLike ? "Sign-in expired" : "token error",
    authLike
  };
}
