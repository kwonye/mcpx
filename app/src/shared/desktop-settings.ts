export interface BrowseState {
  searchQuery?: string;
  activeCategory?: string;
  activeTab?: string;
}

export interface DesktopSettings {
  autoUpdateEnabled: boolean;
  startOnLoginEnabled: boolean;
  browseState?: BrowseState;
}

export type DesktopSettingsPatch = Partial<DesktopSettings>;

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  autoUpdateEnabled: true,
  startOnLoginEnabled: true,
  browseState: {}
};
