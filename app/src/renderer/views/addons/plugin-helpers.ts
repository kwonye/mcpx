import type { ManagedPlugin, PluginComponent } from "@mcpx/core";
import type { Tone } from "../../components/ui/Badge";

/** Components that run code on your machine and need an explicit OK. */
export const GATED_COMPONENTS: PluginComponent[] = ["hooks", "commands", "mcpServers"];

export const COMPONENT_LABELS: Record<string, string> = {
  mcpServers: "Servers",
  skills: "Skills",
  hooks: "Hooks",
  agents: "Agents",
  commands: "Commands"
};

export function componentLabel(component: string): string {
  return COMPONENT_LABELS[component] ?? component;
}

export function needsApproval(plugin: ManagedPlugin): PluginComponent[] {
  return (Object.entries(plugin.components) as Array<[PluginComponent, boolean]>)
    .filter(([key, enabled]) => enabled && GATED_COMPONENTS.includes(key))
    .filter(([key]) => plugin.approvals?.[key] === false || (key === "hooks" && plugin.approvals?.[key] !== true))
    .map(([key]) => key);
}

export function pluginState(plugin: ManagedPlugin): { label: string; tone: Tone } {
  if (!plugin.enabled) return { label: "Off", tone: "neutral" };
  switch (plugin.status) {
    case "healthy": return { label: "Ready", tone: "success" };
    case "preparing": return { label: "Preparing", tone: "neutral" };
    case "updating": return { label: "Updating", tone: "neutral" };
    case "unhealthy": return { label: "Has problems", tone: "warning" };
    case "error": return { label: "Error", tone: "danger" };
    default: return { label: String(plugin.status), tone: "neutral" };
  }
}

export function pluginSource(plugin: ManagedPlugin): string {
  return plugin.marketplace ? `${plugin.marketplace.pluginName} from ${plugin.marketplace.name}` : plugin.source;
}
