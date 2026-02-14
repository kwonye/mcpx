import type { ClientAdapter } from "../types.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import { CursorAdapter } from "./cursor.js";
import { ClineAdapter } from "./cline.js";
import { VsCodeAdapter } from "./vscode.js";

export function getAdapters(): ClientAdapter[] {
  return [
    new ClaudeAdapter(),
    new CodexAdapter(),
    new CursorAdapter(),
    new ClineAdapter(),
    new VsCodeAdapter()
  ];
}
