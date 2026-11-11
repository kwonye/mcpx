import { app, net, protocol, session, shell, type WebContents } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where the app's own renderer content lives. */
export interface AppContentLocation {
  /** `ELECTRON_RENDERER_URL` in development (Vite dev server with HMR). */
  devServerUrl?: string;
  /** Absolute path of the bundled `out/renderer/index.html`. */
  rendererEntry: string;
}

const EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** URLs that may be handed to the OS (default browser / mail client). */
export function isAllowedExternalUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return Boolean(parsed && EXTERNAL_PROTOCOLS.has(parsed.protocol));
}

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  return platform === "win32" || platform === "darwin" ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

/** True when `candidate` is `root` itself or inside it. */
export function isWithinDirectory(root: string, candidate: string, platform: NodeJS.Platform = process.platform): boolean {
  const fold = (p: string) => (platform === "win32" || platform === "darwin" ? p.toLowerCase() : p);
  const relative = path.relative(fold(path.resolve(root)), fold(path.resolve(candidate)));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Whether a navigation target is the app's own page (any hash). */
export function isAppUrl(url: string, location: AppContentLocation, platform: NodeJS.Platform = process.platform): boolean {
  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }
  if (location.devServerUrl) {
    const dev = parseUrl(location.devServerUrl);
    return Boolean(dev && parsed.origin === dev.origin);
  }
  if (parsed.protocol !== "file:") {
    return false;
  }
  try {
    return samePath(fileURLToPath(parsed), location.rendererEntry, platform);
  } catch {
    return false;
  }
}

/**
 * Content-Security-Policy for the app's own pages. Only self-hosted scripts,
 * styles, fonts and images. `style-src 'unsafe-inline'` permits inline style
 * attributes/elements only (no external hosts). `sentry-ipc:` is the
 * transport @sentry/electron's renderer SDK uses without its preload.
 * In development the Vite dev server needs its inline React Refresh preamble
 * and the HMR websocket.
 */
export function buildContentSecurityPolicy(devServerUrl?: string): string {
  const dev = devServerUrl ? parseUrl(devServerUrl) : null;
  const hmrSocket = dev ? `${dev.protocol === "https:" ? "wss:" : "ws:"}//${dev.host}` : null;
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'none'"]],
    ["script-src", dev ? ["'self'", "'unsafe-inline'"] : ["'self'"]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", "sentry-ipc:", ...(hmrSocket ? [hmrSocket] : [])]],
    ["worker-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["frame-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["base-uri", ["'none'"]],
    ["form-action", ["'none'"]]
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/** Window-open and navigation guards for every webContents the app creates. */
export function hardenWebContents(contents: WebContents, location: AppContentLocation): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  contents.on("will-navigate", (event) => {
    const url = event.url;
    if (isAppUrl(url, location)) {
      return;
    }
    event.preventDefault();
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
  });

  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}

function withCsp(headers: Record<string, string[] | string> | undefined, csp: string): Record<string, string[] | string> {
  const next: Record<string, string[] | string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() !== "content-security-policy") {
      next[key] = value;
    }
  }
  next["Content-Security-Policy"] = [csp];
  return next;
}

/**
 * Installs app-wide protections. Call once after `app.whenReady()` and before
 * any window is created.
 */
export function installAppSecurity(location: AppContentLocation): void {
  app.on("web-contents-created", (_event, contents) => {
    hardenWebContents(contents, location);
  });

  const ses = session.defaultSession;
  // Deny every permission (camera, notifications from pages, geolocation, ...)
  // except sanitized clipboard writes, which copy buttons need.
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === "clipboard-sanitized-write");
  });
  ses.setPermissionCheckHandler((_contents, permission) => permission === "clipboard-sanitized-write");

  const csp = buildContentSecurityPolicy(location.devServerUrl);

  if (location.devServerUrl) {
    const dev = parseUrl(location.devServerUrl);
    if (dev) {
      ses.webRequest.onHeadersReceived({ urls: [`${dev.origin}/*`] }, (details, callback) => {
        callback({ responseHeaders: withCsp(details.responseHeaders, csp) });
      });
    }
    return;
  }

  // file:// responses carry no headers and never reach webRequest, so serve
  // them through a handler that adds the CSP and refuses anything outside the
  // bundled renderer directory.
  const rendererRoot = path.dirname(location.rendererEntry);
  protocol.handle("file", async (request) => {
    let filePath: string;
    try {
      filePath = fileURLToPath(request.url);
    } catch {
      return new Response(null, { status: 400 });
    }
    if (!isWithinDirectory(rendererRoot, filePath)) {
      return new Response(null, { status: 404 });
    }
    const response = await net.fetch(request, { bypassCustomProtocolHandlers: true });
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", csp);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  });
}
