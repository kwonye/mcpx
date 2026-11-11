// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { buildAppMenuTemplate } from "../../src/main/platform/menu-template";

const buildFromTemplate = vi.fn((template) => ({ template }));
const quitApp = vi.fn();
const navigateDashboard = vi.fn();

vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate,
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock("../../src/main/app-control", () => ({
  quitApp,
}));

vi.mock("../../src/main/dashboard", () => ({
  navigateDashboard,
}));

type Item = MenuItemConstructorOptions;

function flatten(items: Item[]): Item[] {
  return items.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? flatten(item.submenu) : [])]);
}

function actions() {
  return { openSettings: vi.fn(), quit: vi.fn(), openProjectPage: vi.fn() };
}

const MAC_ONLY_ROLES = ["hide", "hideOthers", "unhide", "front", "services", "zoom", "window"];

describe("application menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes Quit through app-control and Settings to the settings route", async () => {
    const { buildApplicationMenu } = await import("../../src/main/menu");

    buildApplicationMenu();

    const template = buildFromTemplate.mock.calls[0][0] as Item[];
    const items = flatten(template);
    items.find((item) => item.accelerator === "CmdOrCtrl+Q")?.click?.(undefined as never, undefined, undefined as never);
    items.find((item) => item.accelerator === "CmdOrCtrl+,")?.click?.(undefined as never, undefined, undefined as never);

    expect(quitApp).toHaveBeenCalledTimes(1);
    expect(navigateDashboard).toHaveBeenCalledWith("settings");
  });
});

describe("application menu templates", () => {
  it("macOS: app menu named after the product with the standard roles", () => {
    const template = buildAppMenuTemplate("darwin", "mcpx", actions());

    expect(template[0].label).toBe("mcpx");
    const appRoles = (template[0].submenu as Item[]).map((item) => item.role).filter(Boolean);
    expect(appRoles).toEqual(["about", "services", "hide", "hideOthers", "unhide"]);
    expect(template.map((menu) => menu.label ?? menu.role)).toEqual(["mcpx", "File", "Edit", "View", "Window", "help"]);
  });

  for (const platform of ["win32", "linux"] as const) {
    it(`${platform}: File/Edit/View/Window/Help without macOS-only roles or an app menu`, () => {
      const template = buildAppMenuTemplate(platform, "mcpx", actions());

      expect(template.map((menu) => menu.label)).toEqual(["&File", "&Edit", "&View", "&Window", "&Help"]);
      const roles = flatten(template).map((item) => item.role).filter(Boolean);
      for (const role of MAC_ONLY_ROLES) {
        expect(roles).not.toContain(role);
      }
    });
  }

  for (const platform of ["darwin", "win32", "linux"] as const) {
    it(`${platform}: Settings (CmdOrCtrl+,) and Quit (CmdOrCtrl+Q) call the actions`, () => {
      const a = actions();
      const items = flatten(buildAppMenuTemplate(platform, "mcpx", a));

      const settings = items.find((item) => item.label === "Settings…");
      const quit = items.find((item) => item.label === "Quit mcpx");
      expect(settings?.accelerator).toBe("CmdOrCtrl+,");
      expect(quit?.accelerator).toBe("CmdOrCtrl+Q");

      settings?.click?.(undefined as never, undefined, undefined as never);
      quit?.click?.(undefined as never, undefined, undefined as never);
      expect(a.openSettings).toHaveBeenCalledTimes(1);
      expect(a.quit).toHaveBeenCalledTimes(1);
    });
  }
});
