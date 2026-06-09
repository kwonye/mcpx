import os from "node:os";
import path from "node:path";
import fs from "node:fs";

function existingNvmCurrentBin(): string | null {
  const nvmDir = process.env.NVM_DIR ?? path.join(os.homedir(), ".nvm");
  const current = path.join(nvmDir, "current", "bin");
  return fs.existsSync(current) ? current : null;
}

export function buildEnrichedPath(current = process.env.PATH ?? ""): string {
  const candidates = [
    ...current.split(":"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(os.homedir(), ".bun", "bin"),
    path.join(os.homedir(), ".local", "bin"),
    existingNvmCurrentBin()
  ].filter((entry): entry is string => Boolean(entry));

  const seen = new Set<string>();
  const entries: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    entries.push(candidate);
  }

  return entries.join(":");
}
