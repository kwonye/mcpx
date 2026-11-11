import type { McpxApi } from "../../preload/index";

/** The preload bridge. Kept behind a function so tests can swap window.mcpx. */
export function api(): McpxApi {
  return window.mcpx;
}

export type Platform = "darwin" | "win32" | "linux";

export function platform(): Platform {
  const value = window.mcpx?.platform;
  return value === "darwin" ? "darwin" : value === "win32" ? "win32" : "linux";
}
