// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const appMock = {
  getName: vi.fn()
};

vi.mock("electron", () => ({
  app: appMock
}));

describe("app flavor", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock("../../src/shared/build-constants");
    delete process.env.MCPX_DESKTOP_FLAVOR;
    delete process.env.MCPX_DESKTOP_PRODUCT_NAME;
    appMock.getName.mockReturnValue("mcpx");
  });

  it("prefers production build constants by default", async () => {
    const { getDesktopAppFlavor, getDesktopProductName } = await import("../../src/main/app-flavor");

    expect(getDesktopAppFlavor()).toBe("production");
    expect(getDesktopProductName()).toBe("mcpx");
  });

  it("supports dev build constants", async () => {
    vi.doMock("../../src/shared/build-constants", () => ({
      DESKTOP_BUILD_FLAVOR: "dev",
      DESKTOP_PRODUCT_NAME: "mcpx-dev",
      DESKTOP_DEBUG: true,
      DESKTOP_MANAGER_NAME: "mcpx-dev Manager"
    }));

    const { getDesktopAppFlavor, getDesktopProductName } = await import("../../src/main/app-flavor");

    expect(getDesktopAppFlavor()).toBe("dev");
    expect(getDesktopProductName()).toBe("mcpx-dev");
  });

  it("falls back to app name for ad hoc runtime launches", async () => {
    vi.doMock("../../src/shared/build-constants", () => ({
      DESKTOP_BUILD_FLAVOR: undefined,
      DESKTOP_PRODUCT_NAME: "",
      DESKTOP_DEBUG: false,
      DESKTOP_MANAGER_NAME: " Manager"
    }));
    appMock.getName.mockReturnValue("mcpx-dev");

    const { getDesktopAppFlavor, getDesktopProductName } = await import("../../src/main/app-flavor");

    expect(getDesktopProductName()).toBe("mcpx-dev");
    expect(getDesktopAppFlavor()).toBe("dev");
  });
});
