import { app } from "electron";
import { DESKTOP_BUILD_FLAVOR, DESKTOP_PRODUCT_NAME } from "../shared/build-constants";

export type DesktopAppFlavor = "production" | "dev";

const DEFAULT_PRODUCT_NAME = "mcpx";
const DEV_PRODUCT_NAME = "mcpx-dev";
const UNPACKAGED_APP_NAME = "mcpx-desktop";

function normalizeFlavor(value: string | undefined): DesktopAppFlavor | null {
  return value === "dev" || value === "production" ? value : null;
}

function normalizeProductName(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getDesktopProductName(): string {
  const buildName = normalizeProductName(DESKTOP_PRODUCT_NAME);
  if (buildName) {
    return buildName;
  }

  const explicitName = normalizeProductName(process.env.MCPX_DESKTOP_PRODUCT_NAME);
  if (explicitName) {
    return explicitName;
  }

  if (typeof app.getName === "function") {
    const runtimeName = normalizeProductName(app.getName());
    if (runtimeName === UNPACKAGED_APP_NAME) {
      return DEFAULT_PRODUCT_NAME;
    }

    if (runtimeName) {
      return runtimeName;
    }
  }

  return DEFAULT_PRODUCT_NAME;
}

export function getDesktopAppFlavor(): DesktopAppFlavor {
  const buildFlavor = normalizeFlavor(DESKTOP_BUILD_FLAVOR);
  if (buildFlavor) {
    return buildFlavor;
  }

  const explicitFlavor = normalizeFlavor(process.env.MCPX_DESKTOP_FLAVOR);
  if (explicitFlavor) {
    return explicitFlavor;
  }

  return getDesktopProductName() === DEV_PRODUCT_NAME ? "dev" : "production";
}

export function isDevDesktopApp(): boolean {
  return getDesktopAppFlavor() === "dev";
}
