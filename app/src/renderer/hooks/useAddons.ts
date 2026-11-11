import type { ManagedMarketplace, ManagedPlugin, MarketplaceListing, Skill } from "@mcpx/core";
import { api } from "../lib/api";
import { invalidate, useQuery } from "../lib/query";

export const PLUGINS_KEY = "plugins";
export const MARKETPLACES_KEY = "marketplaces";
export const LISTINGS_KEY = "listings";
export const SKILLS_KEY = "skills";

export const usePlugins = () => useQuery<ManagedPlugin[]>(PLUGINS_KEY, () => api().plugins.list());
export const useMarketplaces = () => useQuery<ManagedMarketplace[]>(MARKETPLACES_KEY, () => api().marketplaces.list());
export const useListings = (enabled = true) => useQuery<MarketplaceListing[]>(LISTINGS_KEY, () => api().marketplaces.browse(), { enabled });
export const useSkills = () => useQuery<Skill[]>(SKILLS_KEY, () => api().skills.list());

/** After any add-on change: plugins and their listings' "installed" flags both move. */
export function refreshAddons(): Promise<unknown> {
  return invalidate(PLUGINS_KEY, LISTINGS_KEY, MARKETPLACES_KEY, SKILLS_KEY);
}
