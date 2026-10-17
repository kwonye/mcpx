import type { ManagedMarketplace } from "../types.js";

const BUILTIN_ADDED_AT = "1970-01-01T00:00:00.000Z";

export const DEFAULT_MARKETPLACES: Record<string, ManagedMarketplace> = {
  "claude-plugins-official": {
    name: "claude-plugins-official",
    displayName: "Claude official",
    source: "anthropics/claude-plugins-official",
    sourceType: "github",
    manifestPath: ".claude-plugin/marketplace.json",
    format: "claude",
    builtIn: true,
    autoUpdate: true,
    addedAt: BUILTIN_ADDED_AT,
    status: "unavailable",
  },
  "openai-curated": {
    name: "openai-curated",
    displayName: "Codex official",
    source: "openai/plugins",
    sourceType: "github",
    manifestPath: ".agents/plugins/marketplace.json",
    format: "codex",
    builtIn: true,
    autoUpdate: true,
    addedAt: BUILTIN_ADDED_AT,
    status: "unavailable",
  },
};

export function ensureDefaultMarketplaces(
  marketplaces: Record<string, ManagedMarketplace> | undefined,
): Record<string, ManagedMarketplace> {
  const result = { ...(marketplaces ?? {}) };
  for (const [name, defaults] of Object.entries(DEFAULT_MARKETPLACES)) {
    const existing = result[name];
    result[name] = existing
      ? { ...defaults, ...existing, name, source: defaults.source, sourceType: defaults.sourceType, manifestPath: defaults.manifestPath, format: defaults.format, builtIn: true }
      : { ...defaults };
  }
  return result;
}
