import type { ClientAdapter } from "../types.js";
import { ClaudeAdapter } from "./claude.js";
import { ClaudeDesktopAdapter } from "./claude-desktop.js";
import { CodexAdapter } from "./codex.js";
import { CursorAdapter } from "./cursor.js";
import { ClineAdapter } from "./cline.js";
import { KiroAdapter } from "./kiro.js";
import { OpenCodeAdapter } from "./opencode.js";
import { VsCodeAdapter } from "./vscode.js";
import { QwenAdapter } from "./qwen.js";

export function getAdapters(): ClientAdapter[] {
  return [
    new ClaudeAdapter(),
    new ClaudeDesktopAdapter(),
    new CodexAdapter(),
    new CursorAdapter(),
    new ClineAdapter(),
    new OpenCodeAdapter(),
    new KiroAdapter(),
    new VsCodeAdapter(),
    new QwenAdapter()
  ];
}
