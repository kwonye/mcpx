export type UpstreamErrorCode =
  | "auth_required"
  | "auth_expired"
  | "secret_missing"
  | "unreachable"
  | "timeout"
  | "upstream_error";

export class UpstreamError extends Error {
  readonly code: UpstreamErrorCode;
  readonly upstream: string;
  readonly status?: number;
  readonly wwwAuthenticate?: string;

  constructor(upstream: string, code: UpstreamErrorCode, message: string, options?: { status?: number; wwwAuthenticate?: string }) {
    super(message);
    this.name = "UpstreamError";
    this.code = code;
    this.upstream = upstream;
    this.status = options?.status;
    this.wwwAuthenticate = options?.wwwAuthenticate;
  }
}

export class SecretNotFoundError extends Error {
  readonly code: UpstreamErrorCode = "secret_missing";
  readonly secretName: string;

  constructor(secretName: string) {
    super(`Secret not found: ${secretName}. Run: mcpx secret set ${secretName}`);
    this.name = "SecretNotFoundError";
    this.secretName = secretName;
  }
}

const TIMEOUT_RE = /timed out after \d+ms/;
const UNREACHABLE_PATTERNS = [
  /fetch failed/i,
  /ECONNREFUSED/,
  /ENOTFOUND/,
  /EAI_AGAIN/,
  /socket hang up/,
  /ENOENT/,
  /connect econnrefused/i,
];

export function classifyUpstreamError(
  upstream: string,
  error: unknown,
  wwwAuthenticate?: string
): UpstreamError {
  if (error instanceof UpstreamError) return error;
  if (error instanceof SecretNotFoundError) {
    return new UpstreamError(upstream, "secret_missing", error.message);
  }

  const message = error instanceof Error ? error.message : String(error);

  // StreamableHTTPError check (duck-typing since SDK may not export it)
  const maybeHttpError = error as { code?: number; message?: string } | undefined;
  if (maybeHttpError?.code && (maybeHttpError.code === 401 || maybeHttpError.code === 403)) {
    return new UpstreamError(upstream, "auth_required", message, {
      status: maybeHttpError.code,
      wwwAuthenticate
    });
  }

  if (TIMEOUT_RE.test(message)) {
    return new UpstreamError(upstream, "timeout", message);
  }

  if (UNREACHABLE_PATTERNS.some((p) => p.test(message))) {
    return new UpstreamError(upstream, "unreachable", message);
  }

  return new UpstreamError(upstream, "upstream_error", message);
}
