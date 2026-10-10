import fs from "node:fs";
import TOML from "@iarna/toml";
import YAML from "yaml";
import { z } from "zod";
import { writeJsonAtomic } from "../util/fs.js";

export function readNativeDocument(file: string): Record<string, any> {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8");
  return z.record(z.string(), z.unknown()).parse(file.endsWith(".toml") ? TOML.parse(text) : /\.ya?ml$/.test(file) ? YAML.parse(text) : JSON.parse(text));
}
export function nativeServers(harness: string, document: Record<string, any>): Record<string, any> {
  if (harness === "openclaw") return document.mcp?.servers ?? {};
  return document[harness === "codex" || harness === "hermes" ? "mcp_servers" : harness === "vscode" ? "servers" : harness === "opencode" ? "mcp" : "mcpServers"] ?? {};
}
export function writeNativeDocument(file: string, document: Record<string, any>): void {
  if (!/\.(toml|ya?ml)$/.test(file)) return writeJsonAtomic(file, document);
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, file.endsWith(".toml") ? TOML.stringify(document as never) : YAML.stringify(document), { mode: 0o600 });
  fs.renameSync(temp, file);
}
