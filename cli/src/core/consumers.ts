import crypto from "node:crypto";
import type { McpxConfig } from "../types.js";
import { SecretsManager } from "./secrets.js";
import { sha256 } from "../util/fs.js";

export function consumerToken(config: McpxConfig, id: string, projectPath?: string, secrets = new SecretsManager()): string {
  const key = `consumer_${sha256(id).slice(0, 24)}`;
  let token = secrets.getSecret(key);
  if (!token) { token = crypto.randomBytes(32).toString("base64url"); secrets.setSecret(key, token); }
  config.consumers ??= {};
  config.consumers[id] = { tokenRef: `secret://${key}`, ...(projectPath ? { projectPath } : {}) };
  return token;
}
export function resolveConsumer(config: McpxConfig, token: string, secrets = new SecretsManager()): { id: string; projectPath?: string } | null {
  for (const [id, consumer] of Object.entries(config.consumers ?? {})) {
    let expected: string;
    try { expected = secrets.resolveMaybeSecret(consumer.tokenRef); } catch { continue; }
    const a = Buffer.from(token), b = Buffer.from(expected);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { id, projectPath: consumer.projectPath };
  }
  return null;
}
