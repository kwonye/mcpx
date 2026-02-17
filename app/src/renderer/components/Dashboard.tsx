import { useState } from "react";
import { useStatus } from "../hooks/useMcpx";
import { ServerCard } from "./ServerCard";
import { ServerDetail } from "./ServerDetail";
import { BrowseTab } from "./BrowseTab";
import { DaemonControls } from "./DaemonControls";

type Tab = "servers" | "browse" | "settings";

export function Dashboard(): JSX.Element {
  const { status, loading, refresh } = useStatus();
  const [tab, setTab] = useState<Tab>("servers");
  const [selectedServer, setSelectedServer] = useState<string | null>(null);

  if (loading || !status) {
    return <div className="dashboard">Loading...</div>;
  }

  const report = status as {
    daemon: { running: boolean; pid?: number; port: number };
    servers: Array<{
      name: string;
      transport: string;
      target: string;
      authBindings: Array<{ kind: string; key: string; value: string }>;
      clients: Array<{ clientId: string; status: string; managed: boolean }>;
    }>;
  };

  if (selectedServer) {
    const server = report.servers.find((s) => s.name === selectedServer);
    if (server) {
      return (
        <ServerDetail
          server={server}
          onBack={() => setSelectedServer(null)}
          onRefresh={refresh}
        />
      );
    }
  }

  return (
    <div className="dashboard">
      <nav className="dashboard-tabs">
        <button data-active={tab === "servers"} onClick={() => setTab("servers")}>Servers</button>
        <button data-active={tab === "browse"} onClick={() => setTab("browse")}>Browse</button>
        <button data-active={tab === "settings"} onClick={() => setTab("settings")}>Settings</button>
      </nav>

      {tab === "servers" && (
        <div className="server-list">
          <DaemonControls daemon={report.daemon} onRefresh={refresh} />
          {report.servers.map((server) => (
            <ServerCard
              key={server.name}
              name={server.name}
              transport={server.transport}
              target={server.target}
              authConfigured={server.authBindings.length > 0}
              syncedCount={server.clients.filter((c) => c.managed && c.status === "SYNCED").length}
              errorCount={server.clients.filter((c) => c.managed && c.status === "ERROR").length}
              onClick={() => setSelectedServer(server.name)}
            />
          ))}
        </div>
      )}

      {tab === "browse" && <BrowseTab onServerAdded={refresh} />}
    </div>
  );
}
