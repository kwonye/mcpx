/** The three desktop platforms mcpx ships on. Anything else is treated like Linux. */
export type DesktopPlatform = "darwin" | "win32" | "linux";

export function toDesktopPlatform(platform: NodeJS.Platform = process.platform): DesktopPlatform {
  return platform === "darwin" || platform === "win32" ? platform : "linux";
}

/** Dashboard routes the renderer understands for the `navigate` IPC message. */
export type DashboardRoute = "servers" | "clients" | "addons" | "projects" | "settings";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
