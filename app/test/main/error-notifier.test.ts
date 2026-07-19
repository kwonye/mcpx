// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  Notification: { isSupported: () => true }
}));

vi.mock("@mcpx/core", () => ({
  loadConfig: vi.fn(),
  getDaemonStatus: vi.fn(),
  SecretsManager: vi.fn()
}));

vi.mock("../../src/main/settings-store", () => ({
  loadDesktopSettings: vi.fn()
}));

vi.mock("../../src/main/dashboard", () => ({
  openDashboard: vi.fn()
}));

const { computeErrorNotifications } = await import("../../src/main/error-notifier");
const { GATEWAY_FETCH_TIMEOUT_MS } = await import("../../src/shared/timeouts");

describe("computeErrorNotifications", () => {
  it("fires once on a new runtimeError", () => {
    const counts = {
      Railway: { total: 120, runtimeError: "MCP error -32603: Not authenticated. Run 'railway login' first. Unauthorized" }
    };
    const { toNotify, nextNotified } = computeErrorNotifications(counts, new Map());

    expect(toNotify).toHaveLength(1);
    expect(toNotify[0].server).toBe("Railway");
    expect(toNotify[0].kind).toBe("call");
    expect(toNotify[0].title).toBe("Railway: tool calls are failing");
    expect(toNotify[0].body).toContain("Not authenticated");
    expect(nextNotified.get("Railway")).toBe("call");
  });

  it("fires on an auth-like error (reauth)", () => {
    const counts = {
      Stripe: { total: 0, error: "Invalid refresh token" }
    };
    const { toNotify, nextNotified } = computeErrorNotifications(counts, new Map());

    expect(toNotify).toHaveLength(1);
    expect(toNotify[0].server).toBe("Stripe");
    expect(toNotify[0].kind).toBe("reauth");
    expect(toNotify[0].title).toBe("Stripe needs re-authentication");
    expect(toNotify[0].body).toBe("Sign-in expired — open mcpx to re-authenticate.");
    expect(nextNotified.get("Stripe")).toBe("reauth");
  });

  it("does not re-fire on the next tick with the same state", () => {
    const counts = {
      Railway: { total: 120, runtimeError: "Not authenticated. Run 'railway login' first. Unauthorized" }
    };
    const first = computeErrorNotifications(counts, new Map());
    expect(first.toNotify).toHaveLength(1);

    const second = computeErrorNotifications(counts, first.nextNotified);
    expect(second.toNotify).toHaveLength(0);
    expect(second.nextNotified.get("Railway")).toBe("call");
  });

  it("re-arms after recovery so a re-failure notifies again", () => {
    const failing = {
      Railway: { total: 120, runtimeError: "Not authenticated. Run 'railway login' first. Unauthorized" }
    };
    const recovered = { Railway: { total: 120 } };

    const first = computeErrorNotifications(failing, new Map());
    expect(first.toNotify).toHaveLength(1);

    const afterRecovery = computeErrorNotifications(recovered, first.nextNotified);
    expect(afterRecovery.toNotify).toHaveLength(0);
    expect(afterRecovery.nextNotified.has("Railway")).toBe(false);

    const refail = computeErrorNotifications(failing, afterRecovery.nextNotified);
    expect(refail.toNotify).toHaveLength(1);
    expect(refail.nextNotified.get("Railway")).toBe("call");
  });

  it("does not fire on a non-auth-like generic error", () => {
    const counts = { db: { total: 0, error: "fetch failed" } };
    const { toNotify, nextNotified } = computeErrorNotifications(counts, new Map());

    expect(toNotify).toHaveLength(0);
    expect(nextNotified.has("db")).toBe(false);
  });

  it("fires when the error kind changes from call to reauth", () => {
    const callState = { Railway: { total: 120, runtimeError: "boom" } };
    const reauthState = { Railway: { total: 0, error: "Unauthorized" } };

    const first = computeErrorNotifications(callState, new Map());
    expect(first.toNotify).toHaveLength(1);
    expect(first.toNotify[0].kind).toBe("call");

    const second = computeErrorNotifications(reauthState, first.nextNotified);
    expect(second.toNotify).toHaveLength(1);
    expect(second.toNotify[0].kind).toBe("reauth");
    expect(second.nextNotified.get("Railway")).toBe("reauth");
  });

  it("clears servers no longer present in counts", () => {
    const withServer = { Railway: { total: 120, runtimeError: "boom" } };
    const empty = {};

    const first = computeErrorNotifications(withServer, new Map());
    expect(first.nextNotified.get("Railway")).toBe("call");

    const second = computeErrorNotifications(empty, first.nextNotified);
    expect(second.toNotify).toHaveLength(0);
    expect(second.nextNotified.has("Railway")).toBe(false);
  });
});

describe("shared timeout constant", () => {
  it("GATEWAY_FETCH_TIMEOUT_MS is 5000ms", () => {
    expect(GATEWAY_FETCH_TIMEOUT_MS).toBe(5000);
  });
});
