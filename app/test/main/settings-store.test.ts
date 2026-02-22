// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPathMock = vi.fn<(name: string) => string>();

vi.mock("electron", () => ({
  app: {
    getPath: getPathMock
  }
}));

describe("settings store", () => {
  let tempDir: string;
  let settingsFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpx-settings-test-"));
    settingsFilePath = path.join(tempDir, "settings.json");
    getPathMock.mockReturnValue(tempDir);
  });

  afterEach(() => {
    vi.resetModules();
    getPathMock.mockReset();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns defaults when settings file is missing", async () => {
    const { loadDesktopSettings } = await import("../../src/main/settings-store");
    const settings = loadDesktopSettings();

    expect(settings).toEqual({
      autoUpdateEnabled: true,
      startOnLoginEnabled: true
    });

    const persisted = JSON.parse(fs.readFileSync(settingsFilePath, "utf8"));
    expect(persisted).toEqual(settings);
  });

  it("normalizes partial settings and persists missing defaults", async () => {
    fs.writeFileSync(settingsFilePath, JSON.stringify({
      autoUpdateEnabled: false
    }), "utf8");

    const { loadDesktopSettings } = await import("../../src/main/settings-store");
    const settings = loadDesktopSettings();

    expect(settings).toEqual({
      autoUpdateEnabled: false,
      startOnLoginEnabled: true
    });

    const persisted = JSON.parse(fs.readFileSync(settingsFilePath, "utf8"));
    expect(persisted).toEqual(settings);
  });

  it("falls back to defaults when settings file is invalid JSON", async () => {
    fs.writeFileSync(settingsFilePath, "{invalid-json", "utf8");

    const { loadDesktopSettings } = await import("../../src/main/settings-store");
    const settings = loadDesktopSettings();

    expect(settings).toEqual({
      autoUpdateEnabled: true,
      startOnLoginEnabled: true
    });

    const persisted = JSON.parse(fs.readFileSync(settingsFilePath, "utf8"));
    expect(persisted).toEqual(settings);
  });
});
