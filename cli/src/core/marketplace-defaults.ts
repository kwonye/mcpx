import type { ManagedMarketplace } from "../types.js";

const defaults = [
  ["claude-plugins-official", "Claude official", "anthropics/claude-plugins-official", ".claude-plugin/marketplace.json", "claude"],
  ["openai-curated", "Codex official", "openai/plugins", ".agents/plugins/marketplace.json", "codex"],
  ["cursor-plugins", "Cursor official", "cursor/plugins", ".cursor-plugin/marketplace.json", "cursor"],
] as const;

export const DEFAULT_MARKETPLACES: Record<string, ManagedMarketplace> = Object.fromEntries(defaults.map(([name, displayName, source, manifestPath, format]) => [name, {
  name, displayName, source, manifestPath, format, sourceType: "github", builtIn: true, autoUpdate: false,
  addedAt: "1970-01-01T00:00:00.000Z", status: "unavailable",
}]));

export function ensureDefaultMarketplaces(marketplaces: Record<string, ManagedMarketplace> | undefined): Record<string, ManagedMarketplace> {
  const result = { ...marketplaces };
  for (const [name, defaults] of Object.entries(DEFAULT_MARKETPLACES)) {
    result[name] = { ...defaults, ...result[name], name, source: defaults.source, sourceType: defaults.sourceType, manifestPath: defaults.manifestPath, format: defaults.format, builtIn: true };
  }
  return result;
}
