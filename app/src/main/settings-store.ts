import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  DEFAULT_DESKTOP_SETTINGS,
  type DesktopSettings,
  type DesktopSettingsPatch
} from "../shared/desktop-settings";

const VALID_TABS = ["servers", "browse", "settings"] as const;

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function normalizeSettings(value: unknown): DesktopSettings {
  const partial = (value && typeof value === "object")
    ? (value as Partial<DesktopSettings>)
    : {};

  const browseStatePartial = partial.browseState && typeof partial.browseState === "object"
    ? (partial.browseState as { searchQuery?: unknown; activeCategory?: unknown; activeTab?: unknown })
    : {};

  const normalizedBrowseState = {
    searchQuery: typeof browseStatePartial.searchQuery === "string"
      ? browseStatePartial.searchQuery
      : undefined,
    activeCategory: typeof browseStatePartial.activeCategory === "string"
      ? browseStatePartial.activeCategory
      : undefined,
    activeTab: typeof browseStatePartial.activeTab === "string" &&
      VALID_TABS.includes(browseStatePartial.activeTab as typeof VALID_TABS[number])
      ? browseStatePartial.activeTab
      : undefined
  };

  return {
    autoUpdateEnabled: typeof partial.autoUpdateEnabled === "boolean"
      ? partial.autoUpdateEnabled
      : DEFAULT_DESKTOP_SETTINGS.autoUpdateEnabled,
    startOnLoginEnabled: typeof partial.startOnLoginEnabled === "boolean"
      ? partial.startOnLoginEnabled
      : DEFAULT_DESKTOP_SETTINGS.startOnLoginEnabled,
    browseState: normalizedBrowseState
  };
}

export function saveDesktopSettings(settings: DesktopSettings): DesktopSettings {
  const normalized = normalizeSettings(settings);
  const filePath = settingsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function loadDesktopSettings(): DesktopSettings {
  const filePath = settingsPath();
  if (!fs.existsSync(filePath)) {
    return saveDesktopSettings(DEFAULT_DESKTOP_SETTINGS);
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return saveDesktopSettings(normalizeSettings(parsed));
  } catch {
    return saveDesktopSettings(DEFAULT_DESKTOP_SETTINGS);
  }
}

export function updateDesktopSettings(patch: DesktopSettingsPatch): DesktopSettings {
  const current = loadDesktopSettings();
  return saveDesktopSettings({
    ...current,
    ...patch
  });
}
