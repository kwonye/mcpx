// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }));

vi.mock("electron", () => ({
  app: { on: vi.fn() },
  net: {},
  protocol: {},
  session: {},
  shell: { openExternal }
}));

import {
  buildContentSecurityPolicy,
  hardenWebContents,
  isAllowedExternalUrl,
  isAppUrl,
  isWithinDirectory
} from "../../src/main/security";

const rendererEntry = path.resolve("/app/out/renderer/index.html");
const prod = { rendererEntry };
const dev = { rendererEntry, devServerUrl: "http://localhost:5173" };

describe("external URL allowlist", () => {
  it("allows web and mail links only", () => {
    expect(isAllowedExternalUrl("https://github.com/kwonye/mcpx")).toBe(true);
    expect(isAllowedExternalUrl("http://example.com")).toBe(true);
    expect(isAllowedExternalUrl("mailto:someone@example.com")).toBe(true);
    expect(isAllowedExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("smb://host/share")).toBe(false);
    expect(isAllowedExternalUrl("vscode://extension/foo")).toBe(false);
    expect(isAllowedExternalUrl("not a url")).toBe(false);
  });
});

describe("app URL detection", () => {
  it("accepts the bundled renderer entry with any hash", () => {
    const url = pathToFileURL(rendererEntry).href;
    expect(isAppUrl(url, prod)).toBe(true);
    expect(isAppUrl(`${url}#popover`, prod)).toBe(true);
  });

  it("rejects other files and web origins in production", () => {
    expect(isAppUrl(pathToFileURL(path.resolve("/etc/passwd")).href, prod)).toBe(false);
    expect(isAppUrl(pathToFileURL(path.resolve("/app/out/renderer/other.html")).href, prod)).toBe(false);
    expect(isAppUrl("https://evil.example/", prod)).toBe(false);
  });

  it("accepts only the dev server origin in development", () => {
    expect(isAppUrl("http://localhost:5173/#/dashboard", dev)).toBe(true);
    expect(isAppUrl("http://localhost:5174/", dev)).toBe(false);
    expect(isAppUrl("https://evil.example/", dev)).toBe(false);
  });

  it("detects paths inside the renderer directory", () => {
    const root = path.resolve("/app/out/renderer");
    expect(isWithinDirectory(root, path.join(root, "assets", "index.js"))).toBe(true);
    expect(isWithinDirectory(root, root)).toBe(true);
    expect(isWithinDirectory(root, path.join(root, "..", "main", "index.js"))).toBe(false);
    expect(isWithinDirectory(root, path.resolve("/app/out/renderer-evil/x.js"))).toBe(false);
  });
});

describe("content security policy", () => {
  it("production allows only self-hosted content", () => {
    const csp = buildContentSecurityPolicy();

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/https?:/);
    expect(csp).not.toContain("googleapis");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("development relaxes only what Vite HMR needs", () => {
    const csp = buildContentSecurityPolicy("http://localhost:5173");

    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self' sentry-ipc: ws://localhost:5173");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("googleapis");
  });
});

describe("web contents hardening", () => {
  function makeContents() {
    const handlers: Record<string, (event: { url: string; preventDefault: () => void }) => void> = {};
    let windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null;
    const contents = {
      setWindowOpenHandler: vi.fn((handler) => {
        windowOpenHandler = handler;
      }),
      on: vi.fn((event: string, handler) => {
        handlers[event] = handler;
      })
    };
    hardenWebContents(contents as never, prod);
    return {
      openWindow: (url: string) => windowOpenHandler!({ url }),
      navigate: (url: string) => {
        const event = { url, preventDefault: vi.fn() };
        handlers["will-navigate"](event);
        return event;
      },
      attachWebview: () => {
        const event = { url: "", preventDefault: vi.fn() };
        handlers["will-attach-webview"](event);
        return event;
      }
    };
  }

  beforeEach(() => {
    openExternal.mockClear();
  });

  it("denies every new window and forwards https links to the OS browser", () => {
    const contents = makeContents();

    expect(contents.openWindow("https://plugin-homepage.example/")).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenCalledWith("https://plugin-homepage.example/");
  });

  it("denies new windows for non-web schemes without opening them", () => {
    const contents = makeContents();

    expect(contents.openWindow("file:///etc/passwd")).toEqual({ action: "deny" });
    expect(contents.openWindow("javascript:alert(1)")).toEqual({ action: "deny" });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("blocks navigation away from the app and opens web links externally", () => {
    const contents = makeContents();

    const external = contents.navigate("https://evil.example/");
    expect(external.preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith("https://evil.example/");

    const file = contents.navigate(pathToFileURL(path.resolve("/etc/passwd")).href);
    expect(file.preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it("allows navigation within the app's own page", () => {
    const contents = makeContents();

    const own = contents.navigate(`${pathToFileURL(rendererEntry).href}#dashboard`);
    expect(own.preventDefault).not.toHaveBeenCalled();
  });

  it("refuses <webview> attachment", () => {
    expect(makeContents().attachWebview().preventDefault).toHaveBeenCalled();
  });
});
