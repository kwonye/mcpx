import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./paths.js";
import type { Skill } from "../types.js";
import { z } from "zod";

const OWNERSHIP_MANIFEST = "mcpx-skills.json";

interface OwnershipManifest {
  version: 1;
  paths: string[];
}

const ownershipSchema = z.object({
  version: z.literal(1),
  paths: z.array(z.string()),
});

function assertWithinBase(base: string, target: string): void {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error(`Refusing to access path outside projection base: ${target}`);
  }
}

function loadOwnership(targetDir: string): OwnershipManifest {
  const manifestPath = path.join(targetDir, OWNERSHIP_MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    return { version: 1, paths: [] };
  }
  try {
    const parsed = ownershipSchema.safeParse(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
    if (parsed.success) return parsed.data;
  } catch {
    console.error(`[mcpx] Warning: corrupt ownership manifest at ${manifestPath}, resetting`);
    return { version: 1, paths: [] };
  }
  return { version: 1, paths: [] };
}

function saveOwnership(targetDir: string, manifest: OwnershipManifest): void {
  ensureDir(targetDir);
  fs.writeFileSync(
    path.join(targetDir, OWNERSHIP_MANIFEST),
    JSON.stringify(manifest, null, 2)
  );
}

export function projectSkillsToDir(targetDir: string, skills: Skill[], layout: "dir" | "flat"): void {
  const owned = loadOwnership(targetDir);
  const newPaths = new Set(skills.map(s => layout === "dir" ? `${s.id}/SKILL.md` : `${s.id}.md`));

  for (const ownedPath of owned.paths) {
    if (!newPaths.has(ownedPath)) {
      const fullPath = path.join(targetDir, ownedPath);
      try {
        assertWithinBase(targetDir, fullPath);
        if (fs.existsSync(fullPath)) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        }
        if (layout === "dir") {
          const dirPath = path.join(targetDir, path.dirname(ownedPath));
          assertWithinBase(targetDir, dirPath);
          try {
            const remaining = fs.readdirSync(dirPath);
            if (remaining.length === 0) {
              fs.rmSync(dirPath, { recursive: true, force: true });
            }
          } catch {
            // dir may not exist
          }
        }
      } catch {
        console.error(`[mcpx] Warning: could not remove stale skill projection: ${fullPath}`);
      }
    }
  }

  for (const skill of skills) {
    const filePath = layout === "dir"
      ? path.join(targetDir, skill.id, "SKILL.md")
      : path.join(targetDir, `${skill.id}.md`);
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, skill.content, "utf-8");
  }

  saveOwnership(targetDir, { version: 1, paths: Array.from(newPaths) });
}
