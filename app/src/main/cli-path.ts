import fs from "node:fs";
import path from "node:path";

type PathApi = Pick<typeof path, "join" | "resolve" | "dirname">;

export function resolveCliDaemonPath(
  resourcesPath: string | undefined,
  appPath: string,
  exists: (candidate: string) => boolean = fs.existsSync,
  paths: PathApi = path,
): string {
  const candidates: string[] = [];
  if (resourcesPath) candidates.push(paths.join(resourcesPath, "cli", "dist", "cli.js"));

  let current = paths.resolve(appPath);
  for (let depth = 0; depth < 5; depth += 1) {
    candidates.push(paths.join(current, "cli", "dist", "cli.js"));
    const parent = paths.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const resolved = [...new Set(candidates)].find(exists);
  if (resolved) return resolved;
  throw new Error(`Unable to locate the mcpx CLI. Checked: ${candidates.join(", ")}`);
}
