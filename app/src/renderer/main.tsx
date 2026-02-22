import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";

const root = document.getElementById("root");
if (root) {
  // Clear any existing children (e.g. injected by extensions or dev tools)
  // to avoid React 19 Hydration mismatch errors on strictly SCR (Client) renders.
  root.innerHTML = "";
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
