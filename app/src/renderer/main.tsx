import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import "./views/views.css";
import { App } from "./App";
import { DESKTOP_PRODUCT_NAME } from "../shared/build-constants";
import { initializeRendererErrorReporting, updateRendererErrorReporting } from "./telemetry";

const root = document.getElementById("root");

function bootstrap(): void {
  if (!root) return;
  document.title = DESKTOP_PRODUCT_NAME;
  document.documentElement.dataset.platform = window.mcpx?.platform ?? "linux";

  // Diagnostics initialise in the background; rendering never waits on them.
  try {
    void window.mcpx.telemetry.status().then(initializeRendererErrorReporting).catch(() => {});
    window.mcpx.telemetry.onChanged((next) => {
      void updateRendererErrorReporting(next);
    });
  } catch {
    // Rendering stays available if diagnostics initialisation fails.
  }

  root.innerHTML = "";
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

bootstrap();
