import { useEffect, useState } from "react";
import { StatusPopover } from "./components/StatusPopover";
import { Dashboard } from "./components/Dashboard";
import { TelemetryDisclosure } from "./components/TelemetryDisclosure";
import type { TelemetryStatus } from "@mcpx/core";

export function App() {
  const [view] = useState<"popover" | "dashboard">(() => {
    const hash = window.location.hash.replace("#", "");
    return hash === "popover" ? "popover" : "dashboard";
  });
  const [telemetryStatus, setTelemetryStatus] = useState<TelemetryStatus | null>(null);
  const [telemetryReady, setTelemetryReady] = useState(false);

  useEffect(() => {
    void Promise.resolve(window.mcpx.getTelemetryStatus?.()).then((status) => {
      if (status) setTelemetryStatus(status);
    }).catch(() => {
      setTelemetryStatus(null);
    }).finally(() => setTelemetryReady(true));
  }, []);

  if (!telemetryReady) {
    return <div className="app-shell"><div className="empty-state">Loading privacy settings...</div></div>;
  }

  if (telemetryStatus && telemetryStatus.noticeAcknowledgedVersion < 1 && telemetryStatus.blockedReason !== "environment") {
    return <TelemetryDisclosure status={telemetryStatus} onComplete={() => void Promise.resolve(window.mcpx.getTelemetryStatus?.()).then((status) => status && setTelemetryStatus(status))} />;
  }

  if (view === "popover") {
    return (
      <div className="app-shell app-shell--popover">
        <StatusPopover />
      </div>
    );
  }

  return (
    <div className="app-shell app-shell--dashboard">
      <Dashboard />
    </div>
  );
}
