import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { DESKTOP_PRODUCT_NAME } from "../shared/build-constants";

const root = document.getElementById("root");
if (root) {
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
