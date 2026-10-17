import type { HttpServerSpec } from "../types.js";
import { SecretsManager } from "./secrets.js";
import { probeOAuthSupport, type OAuthSupport } from "./oauth.js";
import { mcpV2Headers, mcpV2Meta } from "./mcp-v2.js";

const JSON_RPC_VERSION = "2.0";
const DEFAULT_AUTH_PROBE_TIMEOUT_MS = 8000;

const AUTH_KEYWORDS = [
  "unauthorized",
  "unauthenticated",
  "forbidden",
  "authentication",
  "authorization",
  "api key",
  "api_key",
  "apikey",
  "credentials",
  "access denied",
  "auth required",
  "x-api-key",
  "invalid key",
  "missing header",
  "not authenticated",
  "auth token"
];

export interface HttpAuthProbeResult {
  authRequired: boolean;
  oauthLikely?: boolean;
  /** Result of RFC 9728 / RFC 8414 discovery, only populated when authRequired is true. */
  oauthSupport?: OAuthSupport;
  status?: number;
  wwwAuthenticate?: string;
  error?: string;
}

function isAuthRelatedMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return AUTH_KEYWORDS.some((kw) => lower.includes(kw));
}

function resolveHeaders(spec: HttpServerSpec, secrets: SecretsManager): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json"
  };

  for (const [key, value] of Object.entries(spec.headers ?? {})) {
    headers[key] = secrets.resolveMaybeSecret(value);
  }

  return headers;
}

function isOAuthLikelyChallenge(wwwAuthenticate: string | null): boolean {
  if (!wwwAuthenticate) {
    return false;
  }

  const lower = wwwAuthenticate.toLowerCase();
  return lower.includes("bearer") || lower.includes("authorization_uri") || lower.includes("resource_metadata");
}

export async function probeHttpAuthRequirement(
  spec: HttpServerSpec,
  secrets: SecretsManager,
  timeoutMs = DEFAULT_AUTH_PROBE_TIMEOUT_MS,
  options: { discoverOAuth?: boolean } = {}
): Promise<HttpAuthProbeResult> {
  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs);
  const discoverOAuth = options.discoverOAuth ?? true;

  async function withOAuthSupport(result: HttpAuthProbeResult): Promise<HttpAuthProbeResult> {
    if (!discoverOAuth) {
      return result;
    }
    const support = await probeOAuthSupport(spec.url).catch(() => undefined);
    return {
      ...result,
      oauthSupport: support?.support,
      oauthLikely: result.oauthLikely || support?.support === "supported"
    };
  }

  try {
    const headers = mcpV2Headers("tools/list", resolveHeaders(spec, secrets));
    const response = await fetch(spec.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: JSON_RPC_VERSION,
        id: "mcpx-auth-probe",
        method: "tools/list",
        params: {
          _meta: {
            ...mcpV2Meta({ name: "mcpx-auth-probe", version: "2.0.0" })
          }
        }
      }),
      signal: timeoutController.signal
    });

    if (response.status === 401 || response.status === 403) {
      const wwwAuthenticate = response.headers.get("www-authenticate");
      return await withOAuthSupport({
        authRequired: true,
        oauthLikely: isOAuthLikelyChallenge(wwwAuthenticate),
        status: response.status,
        wwwAuthenticate: wwwAuthenticate ?? undefined
      });
    }

    if (response.status === 200) {
      try {
        const body = (await response.json()) as Record<string, unknown>;
        const err = body?.error;
        if (
          err &&
          typeof err === "object" &&
          !("result" in body)
        ) {
          const message =
            typeof (err as { message?: unknown }).message === "string"
              ? (err as { message: string }).message
              : "";
          if (message && isAuthRelatedMessage(message)) {
            return await withOAuthSupport({
              authRequired: true,
              status: response.status,
              error: `JSON-RPC error: ${message}`
            });
          }
        }
      } catch {
        // Response body is not valid JSON — not an auth indicator
      }
    }

    return {
      authRequired: false,
      status: response.status
    };
  } catch (error) {
    const isAbort = (error as { name?: string }).name === "AbortError";
    return {
      authRequired: false,
      error: isAbort
        ? `Auth probe timed out after ${timeoutMs}ms.`
        : (error as Error).message
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}
