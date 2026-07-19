// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("preload IPC channel allowlist", () => {
  const invokeMock = vi.fn();
  const exposeInMainWorldMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    vi.doMock("electron", () => ({
      contextBridge: {
        exposeInMainWorld: exposeInMainWorldMock
      },
      ipcRenderer: {
        invoke: invokeMock,
        on: vi.fn(),
        removeListener: vi.fn()
      }
    }));
  });

  async function loadExposedApi() {
    await import("../../src/preload/index");
    const call = exposeInMainWorldMock.mock.calls[0] as [string, { invoke: (channel: string, ...args: unknown[]) => unknown }];
    expect(call[0]).toBe("mcpx");
    return call[1];
  }

  it("forwards a known channel to ipcRenderer.invoke with the same args", async () => {
    const { IPC } = await import("../../src/shared/ipc-channels");
    const api = await loadExposedApi();
    invokeMock.mockResolvedValue("ok");

    const result = await api.invoke(IPC.GET_STATUS, "arg1", 2);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith(IPC.GET_STATUS, "arg1", 2);
    expect(result).toBe("ok");
  });

  it("throws on an unknown channel and never calls ipcRenderer.invoke", async () => {
    const api = await loadExposedApi();

    expect(() => api.invoke("bogus:channel")).toThrow("Unknown IPC channel: bogus:channel");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
