import { app } from "electron";

export type DesktopAppFlavor = "production" | "dev";

const DEFAULT_PRODUCT_NAME = "mcpx";
const DEV_PRODUCT_NAME = "mcpx-dev";
const UNPACKAGED_APP_NAME = "mcpx-desktop";

export function getDesktopProductName(): string {
  const explicitName = process.env.MCPX_DESKTOP_PRODUCT_NAME;
  if (explicitName && explicitName.trim().length > 0) {
    return explicitName;
  }

  if (typeof app.getName === "function") {
    const runtimeName = app.getName();
    if (runtimeName === UNPACKAGED_APP_NAME) {
      return DEFAULT_PRODUCT_NAME;
    }

    if (runtimeName && runtimeName.trim().length > 0) {
      return runtimeName;
    }
  }

  return DEFAULT_PRODUCT_NAME;
}

export function getDesktopAppFlavor(): DesktopAppFlavor {
  const explicitFlavor = process.env.MCPX_DESKTOP_FLAVOR;
  if (explicitFlavor === "dev") {
    return "dev";
  }

  if (explicitFlavor === "production") {
    return "production";
  }

  return getDesktopProductName() === DEV_PRODUCT_NAME ? "dev" : "production";
}

export function isDevDesktopApp(): boolean {
  return getDesktopAppFlavor() === "dev";
}
