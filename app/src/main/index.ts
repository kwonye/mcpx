import { app } from "electron";
import { createTray } from "./tray";
import { registerIpcHandlers } from "./ipc-handlers";

app.dock?.hide(); // Hide dock icon — menubar app

app.whenReady().then(() => {
  registerIpcHandlers();
  createTray();
});
