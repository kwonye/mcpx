import { ToastProvider } from "./components/ui";
import { platform } from "./lib/api";
import { AppShell } from "./shell/AppShell";
import { FirstRunNotice } from "./shell/FirstRunNotice";
import { NavigationProvider, useNavigation } from "./shell/navigation";
import { Popover } from "./popover/Popover";
import { ServersView } from "./views/servers/ServersView";
import { SignInHost } from "./views/servers/SignInHost";
import { ClientsView } from "./views/clients/ClientsView";
import { AddonsView } from "./views/addons/AddonsView";
import { ProjectsView } from "./views/projects/ProjectsView";
import { SettingsView } from "./views/settings/SettingsView";

export function isPopoverWindow(hash = window.location.hash): boolean {
  return hash.replace(/^#\/?/, "") === "popover";
}

/** Renderer entry: the tray popover at #popover, the dashboard everywhere else. */
export function App() {
  if (isPopoverWindow()) {
    return (
      <ToastProvider>
        <Popover />
      </ToastProvider>
    );
  }
  return (
    <ToastProvider>
      <NavigationProvider>
        <Dashboard />
      </NavigationProvider>
    </ToastProvider>
  );
}

export function Dashboard() {
  const { route } = useNavigation();
  return (
    <AppShell platform={platform()} banner={<FirstRunNotice />}>
      {route === "servers" && <ServersView />}
      {route === "clients" && <ClientsView />}
      {route === "addons" && <AddonsView />}
      {route === "projects" && <ProjectsView />}
      {route === "settings" && <SettingsView />}
      <SignInHost />
    </AppShell>
  );
}
