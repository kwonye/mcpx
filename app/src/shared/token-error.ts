const AUTH_ERROR_SUBSTRINGS = [
  "invalid refresh token",
  "no oauth tokens",
  "refresh token",
  "re-authentication required",
  "unauthorized",
  "401",
  "403"
];

const CODE_LABELS: Record<string, { label: string; authLike: boolean }> = {
  auth_expired: { label: "Sign-in expired", authLike: true },
  auth_required: { label: "Sign-in required", authLike: true },
  secret_missing: { label: "Missing secret", authLike: false },
  unreachable: { label: "Unreachable", authLike: false },
  timeout: { label: "Timed out", authLike: false },
};

/**
 * Classifies a token-count error by code first, with substring fallback for old daemons.
 * Returns a short human-readable label and whether this looks like an auth failure.
 */
export function describeTokenError(error: string, code?: string): { label: string; authLike: boolean } {
  if (code && CODE_LABELS[code]) {
    return CODE_LABELS[code];
  }

  const lower = error.toLowerCase();
  const authLike = AUTH_ERROR_SUBSTRINGS.some((s) => lower.includes(s));
  return {
    label: authLike ? "Sign-in expired" : "token error",
    authLike
  };
}

export { AUTH_ERROR_SUBSTRINGS };
