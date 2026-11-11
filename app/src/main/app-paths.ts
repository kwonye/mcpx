import { fileURLToPath } from "node:url";
import type { AppContentLocation } from "./security";

export function rendererEntryPath(): string {
  return fileURLToPath(new URL("../renderer/index.html", import.meta.url));
}

export function preloadPath(): string {
  return fileURLToPath(new URL("../preload/index.js", import.meta.url));
}

export function appContentLocation(): AppContentLocation {
  return {
    devServerUrl: process.env.ELECTRON_RENDERER_URL || undefined,
    rendererEntry: rendererEntryPath()
  };
}
