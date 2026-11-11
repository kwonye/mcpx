import fs from "node:fs";
import TOML from "@iarna/toml";
import YAML from "yaml";
import { z } from "zod";
import { writeJsonAtomic } from "../util/fs.js";
import { getClientDefinition } from "../adapters/catalogue.js";

export function readNativeDocument(file: string): Record<string, any> {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8");
  return z.record(z.string(), z.unknown()).parse(file.endsWith(".toml") ? TOML.parse(text) : /\.ya?ml$/.test(file) ? YAML.parse(text) : JSON.parse(text));
}
/** The client's server map, at the container path its catalogue entry declares. */
export function nativeServers(harness: string, document: Record<string, any>): Record<string, any> {
  const container = getClientDefinition(harness)?.container ?? ["mcpServers"];
  let node: any = document;
  for (const key of container) node = node?.[key];
  return node && typeof node === "object" && !Array.isArray(node) ? node : {};
}
export function writeNativeDocument(file: string, document: Record<string, any>): void {
  if (!/\.(toml|ya?ml)$/.test(file)) return writeJsonAtomic(file, document);
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, file.endsWith(".toml") ? TOML.stringify(document as never) : YAML.stringify(document), { mode: 0o600 });
  fs.renameSync(temp, file);
}
