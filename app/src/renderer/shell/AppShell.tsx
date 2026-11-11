import type { ReactNode } from "react";
import type { Platform } from "../lib/api";
import { Sidebar } from "./Sidebar";
import { Wordmark } from "./LogoMark";
import "./AppShell.css";

/**
 * Window chrome per OS:
 * - macOS: hiddenInset title bar; the sidebar's first 44px clear the traffic lights and drag the window.
 * - Windows: a 40px drawn title bar (drag region) with ~140px reserved for the native caption buttons.
 * - Linux: native frame; no custom title bar and no drag regions.
 */
export function AppShell({ platform, children, banner }: { platform: Platform; children: ReactNode; banner?: ReactNode }) {
  return (
    <div className="app-shell" data-platform={platform}>
      {platform === "win32" && (
        <div className="titlebar drag-region">
          <Wordmark />
        </div>
      )}
      <div className="app-shell__body">
        <Sidebar platform={platform} />
        <main className="app-shell__main" id="main">
          {banner}
          {children}
        </main>
      </div>
    </div>
  );
}
