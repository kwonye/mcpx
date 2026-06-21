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

export { AUTH_ERROR_SUBSTRINGS };
