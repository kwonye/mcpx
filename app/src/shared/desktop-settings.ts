export type DesktopTab = "servers" | "projects" | "plugins" | "settings";

export interface DesktopSettings {
  autoUpdateEnabled: boolean;
  startOnLoginEnabled: boolean;
  errorNotificationsEnabled: boolean;
  activeTab?: DesktopTab;
}

export type DesktopSettingsPatch = Partial<DesktopSettings>;

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  autoUpdateEnabled: true,
  startOnLoginEnabled: true,
  errorNotificationsEnabled: true,
  activeTab: "servers"
};
