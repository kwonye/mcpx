import { app } from "electron";
import { join } from "node:path";

/**
 * Absolute path to a file under `app/resources/`. Native consumers (tray
 * icons, window icons, files copied out of the app) need a real file, so
 * packaged builds read the copy unpacked next to app.asar.
 */
export function resourcePath(...segments: string[]): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "app.asar.unpacked", "resources", ...segments);
  }
  return join(__dirname, "../../resources", ...segments);
}
