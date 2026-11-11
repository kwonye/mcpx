import { Blocks, FolderGit2, Laptop, Server, Settings, type LucideIcon } from "lucide-react";
import type { Platform } from "../lib/api";
import { needsAttention } from "../lib/domain";
import { useServers } from "../hooks/useServers";
import { useNavigation, type Route } from "./navigation";
import { GatewayControl } from "./GatewayControl";
import { Wordmark } from "./LogoMark";

interface NavItem {
  route: Route;
  label: string;
  icon: LucideIcon;
}

const PRIMARY: NavItem[] = [
  { route: "servers", label: "Servers", icon: Server },
  { route: "clients", label: "Clients", icon: Laptop },
  { route: "addons", label: "Add-ons", icon: Blocks },
  { route: "projects", label: "Projects", icon: FolderGit2 }
];

export function Sidebar({ platform }: { platform: Platform }) {
  const { route, go } = useNavigation();
  const { servers } = useServers();
  const attention = servers.filter((server) => needsAttention(server.state)).length;

  return (
    <nav className="sidebar" aria-label="Main">
      {platform !== "win32" && (
        <div className="sidebar__brand drag-region">
          <Wordmark />
        </div>
      )}
      <ul className="sidebar__nav">
        {PRIMARY.map((item) => (
          <li key={item.route}>
            <SidebarLink
              item={item}
              active={route === item.route}
              onSelect={() => go(item.route)}
              badge={item.route === "servers" && attention > 0 ? attention : undefined}
            />
          </li>
        ))}
      </ul>
      <div className="sidebar__spacer" />
      <ul className="sidebar__nav">
        <li>
          <SidebarLink item={{ route: "settings", label: "Settings", icon: Settings }} active={route === "settings"} onSelect={() => go("settings")} />
        </li>
      </ul>
      <div className="sidebar__footer">
        <GatewayControl />
      </div>
    </nav>
  );
}

function SidebarLink({ item, active, onSelect, badge }: { item: NavItem; active: boolean; onSelect: () => void; badge?: number }) {
  const Icon = item.icon;
  return (
    <button type="button" className="sidebar__link" aria-current={active ? "page" : undefined} onClick={onSelect}>
      <Icon size={16} strokeWidth={1.75} aria-hidden />
      <span className="sidebar__label">{item.label}</span>
      {badge !== undefined && (
        <span className="sidebar__badge" aria-label={`${badge} need${badge === 1 ? "s" : ""} attention`}>{badge}</span>
      )}
    </button>
  );
}
