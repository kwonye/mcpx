import type { HttpServerSpec } from "../types.js";
import { SecretsManager } from "./secrets.js";

const JSON_RPC_VERSION = "2.0";
const DEFAULT_AUTH_PROBE_TIMEOUT_MS = 8000;

export interface HttpAuthProbeResult {
  authRequired: boolean;
  status?: number;
  wwwAuthenticate?: string;
  error?: string;
}

function resolveHeaders(spec: HttpServerSpec, secrets: SecretsManager): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream"
  };

  for (const [key, value] of Object.entries(spec.headers ?? {})) {
    headers[key] = secrets.resolveMaybeSecret(value);
  }

  return headers;
}

export async function probeHttpAuthRequirement(
  spec: HttpServerSpec,
  secrets: SecretsManager,
  timeoutMs = DEFAULT_AUTH_PROBE_TIMEOUT_MS
): Promise<HttpAuthProbeResult> {
  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs);

  try {
    const headers = resolveHeaders(spec, secrets);
    const response = await fetch(spec.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: JSON_RPC_VERSION,
        id: "mcpx-auth-probe",
        method: "tools/list",
        params: {}
      }),
      signal: timeoutController.signal
    });

    if (response.status === 401 || response.status === 403) {
      return {
        authRequired: true,
        status: response.status,
        wwwAuthenticate: response.headers.get("www-authenticate") ?? undefined
      };
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
