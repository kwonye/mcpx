// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const buildFromTemplate = vi.fn((template) => ({ template }));
const hideDashboard = vi.fn();
const quitApp = vi.fn();

vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate,
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock("../../src/main/app-control", () => ({
  hideDashboard,
  quitApp,
}));

describe("application menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses dynamic product naming for the app menu", async () => {
    const { buildApplicationMenu } = await import("../../src/main/menu");

    buildApplicationMenu();

    const template = buildFromTemplate.mock.calls[0][0];
    expect(template[0].label).toMatch(/mcpx/);
  });

  it("routes Cmd+Q and Cmd+W through app-control", async () => {
    const { buildApplicationMenu } = await import("../../src/main/menu");

    buildApplicationMenu();

    const template = buildFromTemplate.mock.calls[0][0];
    const quitItem = template[0].submenu.find((item: { accelerator?: string }) => item.accelerator === "CommandOrControl+Q");
    const closeItem = template[3].submenu.find((item: { accelerator?: string }) => item.accelerator === "CommandOrControl+W");

    quitItem.click();
    closeItem.click();

    expect(quitApp).toHaveBeenCalledTimes(1);
    expect(hideDashboard).toHaveBeenCalledTimes(1);
  });
});
