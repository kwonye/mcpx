import * as Sentry from "@sentry/electron/renderer";
import type { TelemetryStatus } from "@mcpx/core";
import { TELEMETRY_BUILD_CONFIG } from "../shared/build-constants";

let initialized = false;
let active = false;

const EXPECTED_ERROR_TYPES = new Set([
  "ConfigLoadError",
  "CommanderError",
  "ZodError",
  "ValidationError",
  "SyntaxError",
  "SecretNotFoundError",
  "UpstreamError",
  "OAuthCancelledError",
  "OAuthLoginInProgressError"
]);

function isSafeVirtualFilename(filename: string): boolean {
  return filename.startsWith("webpack:///") || /^app:\/\/\/out\/(?:renderer\/)?/.test(filename);
}

function normalizeFilename(filename: string | undefined): string | undefined {
  if (!filename) return filename;
  const normalized = filename.replaceAll("\\", "/");
  if (isSafeVirtualFilename(normalized)) return normalized;
  const sourceMarker = normalized.lastIndexOf("/src/");
  if (sourceMarker >= 0) return normalized.slice(sourceMarker + 1);
  return normalized.split("/").at(-1);
}

function sanitizeEvent(event: any): any {
  if (!active) return null;
  const firstType = event.exception?.values?.[0]?.type;
  if (firstType && EXPECTED_ERROR_TYPES.has(firstType)) return null;
  event.message = undefined;
  event.request = undefined;
  event.user = undefined;
  event.extra = undefined;
  const rendererArchitecture = (globalThis as { process?: { arch?: string } }).process?.arch;
  event.contexts = {
    os: { name: /darwin/i.test(navigator.userAgent) ? "macos" : /windows/i.test(navigator.userAgent) ? "windows" : /linux/i.test(navigator.userAgent) ? "linux" : "other" },
    ...(rendererArchitecture ? { device: { arch: rendererArchitecture } } : {})
  };
  event.tags = undefined;
  event.transaction = undefined;
  event.server_name = undefined;
  event.breadcrumbs = [];
  if (event.exception?.values) {
    event.exception.values = event.exception.values.map((value: any) => ({
      type: value.type,
      value: value.type ? "redacted" : undefined,
      mechanism: value.mechanism ? { type: value.mechanism.type, handled: value.mechanism.handled } : undefined,
      stacktrace: value.stacktrace
        ? {
            frames: value.stacktrace.frames?.map((frame: any) => ({
              filename: normalizeFilename(frame.filename),
              function: typeof frame.function === "string" ? frame.function : undefined,
              module: normalizeFilename(typeof frame.module === "string" ? frame.module : undefined),
              lineno: frame.lineno,
              colno: frame.colno,
              in_app: frame.in_app
            }))
          }
        : undefined
    }));
  }
  return event;
}

export function initializeRendererErrorReporting(status: TelemetryStatus): void {
  if (initialized || !status.errorsActive) return;
  active = true;
  const rendererRoot = (() => {
    try {
      return new URL(".", window.location.href).toString();
    } catch {
      return undefined;
    }
  })();
  Sentry.init({
    dsn: TELEMETRY_BUILD_CONFIG.sentryDsn,
    release: TELEMETRY_BUILD_CONFIG.sentryRelease || undefined,
    enabled: true,
    sendDefaultPii: false,
    includeLocalVariables: false,
    attachStacktrace: true,
    maxBreadcrumbs: 0,
    tracesSampleRate: 0,
    integrations: (defaults) => [
      ...defaults,
      ...(rendererRoot
        ? [Sentry.rewriteFramesIntegration({ root: rendererRoot, prefix: "app:///out/renderer/" })]
        : [])
    ],
    beforeSend: sanitizeEvent
  });
  initialized = true;
}

export async function updateRendererErrorReporting(status: TelemetryStatus): Promise<void> {
  if (status.errorsActive) {
    active = true;
    if (initialized) {
      const client = Sentry.getClient();
      if (client) {
        (client.getOptions() as { enabled?: boolean }).enabled = true;
      }
      return;
    }
    initializeRendererErrorReporting(status);
    return;
  }
  active = false;
  if (initialized) {
    const client = Sentry.getClient();
    if (client) {
      // Disabling the client drops future events without flushing data captured
      // before the user changed this preference.
      (client.getOptions() as { enabled?: boolean }).enabled = false;
    }
  }
}
