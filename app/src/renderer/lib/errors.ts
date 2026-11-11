export function errorMessage(error: unknown, fallback = "Something went wrong."): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

/** A user-initiated OAuth cancel is not a failure worth showing. */
export function isCancellation(error: unknown): boolean {
  return (error instanceof Error && error.name === "OAuthCancelledError") || errorMessage(error, "").toLowerCase().includes("cancelled");
}
