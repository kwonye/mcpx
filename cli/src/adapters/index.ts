import type { ClientAdapter, HarnessDescriptor } from "../types.js";
import { ClaudeAdapter } from "./claude.js";
import { ClaudeDesktopAdapter } from "./claude-desktop.js";
import { CodexAdapter } from "./codex.js";
import { CursorAdapter } from "./cursor.js";
import { ClineAdapter } from "./cline.js";
import { KiroAdapter } from "./kiro.js";
import { OpenCodeAdapter } from "./json.js";
import { VsCodeAdapter } from "./vscode.js";
import { QwenAdapter } from "./qwen.js";
import { OpenClawAdapter } from "./openclaw.js";
import { HermesAdapter } from "./hermes.js";

import { PiAdapter } from "./pi.js";

interface Registration { factory: () => ClientAdapter; descriptor: HarnessDescriptor }
const registrations = new Map<string, Registration>();
export function registerHarness(id: string, factory: () => ClientAdapter, descriptor: HarnessDescriptor = {}): void {
  if (registrations.has(id)) throw new Error(`Harness already registered: ${id}`);
  registrations.set(id, { factory, descriptor });
}

// All harness-specific paths and capabilities live at this registration boundary.
registerHarness("claude", () => new ClaudeAdapter(), { label: "Claude Code", projectConfig: ".mcp.json", skillPath: ".claude/skills", projectSkills: ".claude/skills", pluginComponents: ["skills"] });
registerHarness("claude-desktop", () => new ClaudeDesktopAdapter(), { label: "Claude Desktop" });
registerHarness("codex", () => new CodexAdapter(), { label: "Codex", projectConfig: ".codex/config.toml", skillPath: ".agents/skills", projectSkills: ".agents/skills", pluginComponents: ["skills"] });
registerHarness("cursor", () => new CursorAdapter(), { label: "Cursor", projectConfig: ".cursor/mcp.json", skillPath: ".cursor/skills", pluginComponents: ["skills", "commands"] });
registerHarness("cline", () => new ClineAdapter(), { label: "Cline", skillPath: ".config/cline/skills", skillLayout: "flat", pluginComponents: ["skills"] });
registerHarness("opencode", () => new OpenCodeAdapter(), { label: "OpenCode", projectConfig: "opencode.json", pluginComponents: [] });
registerHarness("kiro", () => new KiroAdapter(), { label: "Kiro", skillPath: ".kiro/skills", skillLayout: "flat", pluginComponents: ["skills"] });
registerHarness("vscode", () => new VsCodeAdapter(), { label: "VS Code", projectConfig: ".vscode/mcp.json", skillPath: ".copilot/skills", projectSkills: ".github/skills", pluginComponents: ["skills"] });
registerHarness("qwen", () => new QwenAdapter(), { label: "Qwen Code", skillPath: ".qwen/skills", skillLayout: "flat", pluginComponents: ["skills"] });
registerHarness("openclaw", () => new OpenClawAdapter(), { label: "OpenClaw", skillPath: ".openclaw/skills", pluginComponents: ["skills"] });
registerHarness("hermes", () => new HermesAdapter(), { label: "Hermes", skillPath: ".hermes/skills", pluginComponents: ["skills"] });
registerHarness("pi", () => new PiAdapter(), { label: "Pi", projectConfig: ".pi/mcp.json", projectSkills: ".pi/skills", pluginComponents: ["skills"] });

export function getAdapters(): ClientAdapter[] {
  return Array.from(registrations.values(), ({ factory, descriptor }) => Object.assign(factory(), { descriptor }));
}
