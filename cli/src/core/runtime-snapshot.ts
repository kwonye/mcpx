import { loadMergedConfig } from "./config.js";
import type { McpxConfig } from "../types.js";

let committed: McpxConfig | undefined;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
/** A gateway request sees one committed configuration revision throughout its work. */
export function compileRuntimeSnapshot(): void { committed = freeze(structuredClone(loadMergedConfig())); }
export function clearRuntimeSnapshot(): void { committed = undefined; }
export function runtimeConfig(): McpxConfig { return committed ?? loadMergedConfig(); }
