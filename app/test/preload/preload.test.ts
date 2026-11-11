// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("preload bridge", () => {
  const invokeMock = vi.fn();
  const onMock = vi.fn();
  const exposeInMainWorldMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock("electron", () => ({
      contextBridge: { exposeInMainWorld: exposeInMainWorldMock },
      ipcRenderer: { invoke: invokeMock, on: onMock, removeListener: vi.fn() }
    }));
  });

  async function loadApi() {
    await import("../../src/preload/index");
    const [name, api] = exposeInMainWorldMock.mock.calls[0] as [string, Record<string, any>];
    expect(name).toBe("mcpx");
    return api;
  }

  it("exposes typed methods only - no generic invoke escape hatch", async () => {
    const api = await loadApi();
    expect(api.invoke).toBeUndefined();
    expect(typeof api.servers.add).toBe("function");
    expect(api.platform).toBe(process.platform);
  });

  it("forwards arguments to the matching channel", async () => {
    const { IPC } = await import("../../src/shared/ipc-channels");
    const api = await loadApi();
    invokeMock.mockResolvedValue("ok");
    await expect(api.servers.setEnabled("github", false)).resolves.toBe("ok");
    expect(invokeMock).toHaveBeenCalledWith(IPC.SET_SERVER_ENABLED, "github", false);
  });

  it("strips Electron's remote-method prefix from errors", async () => {
    const api = await loadApi();
    invokeMock.mockRejectedValue(new Error("Error invoking remote method 'mcpx:get-status': Error: config is corrupt"));
    await expect(api.status.get()).rejects.toMatchObject({ message: "config is corrupt" });
    invokeMock.mockRejectedValue(new Error("Error invoking remote method 'mcpx:add-server': ValidationError: Name must not be empty"));
    await expect(api.servers.remove("")).rejects.toMatchObject({ message: "Name must not be empty" });
  });

  it("buffers a navigate message that arrives before the renderer subscribes", async () => {
    const { IPC } = await import("../../src/shared/ipc-channels");
    const api = await loadApi();
    const navigateListener = onMock.mock.calls.find(([channel]) => channel === IPC.NAVIGATE)?.[1] as (event: unknown, route: unknown) => void;
    navigateListener({}, "clients");
    const received: string[] = [];
    api.app.onNavigate((route: string) => received.push(route));
    expect(received).toEqual(["clients"]);
    navigateListener({}, "settings");
    expect(received).toEqual(["clients", "settings"]);
  });
});
