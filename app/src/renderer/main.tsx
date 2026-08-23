import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { DESKTOP_PRODUCT_NAME } from "../shared/build-constants";
import { initializeRendererErrorReporting, updateRendererErrorReporting } from "./telemetry";

const root = document.getElementById("root");
async function bootstrap(): Promise<void> {
  if (!root) return;
  try {
    const status = await window.mcpx.getTelemetryStatus?.();
    if (status) initializeRendererErrorReporting(status);
    window.mcpx.onTelemetryChanged?.((next) => {
      void updateRendererErrorReporting(next);
    });
  } catch {
    // Rendering remains available if diagnostics initialization fails.
  }

  document.title = DESKTOP_PRODUCT_NAME;
  // Clear any existing children (e.g. injected by extensions or dev tools)
  // to avoid React 19 Hydration mismatch errors on strictly SCR (Client) renders.
  root.innerHTML = "";
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void bootstrap();
