export type DesktopTab = "servers" | "projects" | "skills" | "settings";

export interface DesktopSettings {
  autoUpdateEnabled: boolean;
  startOnLoginEnabled: boolean;
  activeTab?: DesktopTab;
}

export type DesktopSettingsPatch = Partial<DesktopSettings>;

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  autoUpdateEnabled: true,
  startOnLoginEnabled: true,
  activeTab: "servers"
};
