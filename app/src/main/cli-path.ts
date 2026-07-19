import fs from "node:fs";
import path from "node:path";

export function resolveCliDaemonPath(
  resourcesPath: string | undefined,
  appPath: string,
  exists: (candidate: string) => boolean = fs.existsSync,
): string {
  const candidates: string[] = [];
  if (resourcesPath) candidates.push(path.join(resourcesPath, "cli", "dist", "cli.js"));

  let current = path.resolve(appPath);
  for (let depth = 0; depth < 5; depth += 1) {
    candidates.push(path.join(current, "cli", "dist", "cli.js"));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const resolved = [...new Set(candidates)].find(exists);
  if (resolved) return resolved;
  throw new Error(`Unable to locate the mcpx CLI. Checked: ${candidates.join(", ")}`);
}
