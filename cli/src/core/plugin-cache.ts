import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getPluginCacheRoot, ensureDir } from "./paths.js";
import type { PluginSource } from "../types.js";

const TMP_PREFIX = "mcpx-acquire-";

export interface CachedPlugin {
  source: string;
  name: string;
  sha: string;
  root: string;
}

export class PluginCache {
  private cacheRoot: string;

  constructor() {
    this.cacheRoot = getPluginCacheRoot();
    ensureDir(this.cacheRoot);
  }

  private sourceDir(source: PluginSource): string {
    // Sanitize source key for filesystem
    const key = source.type === "github"
      ? `github_${source.original.split("@")[0].replace(/[^a-zA-Z0-9_/-]/g, "_")}`
      : source.type === "npm"
      ? `npm_${source.original.replace(/^npm:/, "").split("@")[0].replace(/[^a-zA-Z0-9_/-]/g, "_")}`
      : source.type === "local"
      ? `local_${source.original.replace(/[^a-zA-Z0-9_/-]/g, "_")}`
      : `git_${source.original.replace(/[^a-zA-Z0-9_./@-]/g, "_")}`;
    return path.join(this.cacheRoot, key);
  }

  private refPath(srcDir: string): string {
    return path.join(srcDir, "ref.json");
  }

  private shaDir(srcDir: string, sha: string): string {
    return path.join(srcDir, sha);
  }

  async resolveSha(source: PluginSource): Promise<string> {
    const srcDir = this.sourceDir(source);

    if (source.type === "github") {
      const repo = source.original.split("@")[0];
      const ref = source.ref || "HEAD";
      const output = execFileSync("git", ["ls-remote", `https://github.com/${repo}.git`, ref], {
        encoding: "utf8",
        timeout: 30000,
      });
      const sha = output.split("\t")[0]?.trim();
      if (!sha) throw new Error(`Could not resolve ref ${ref} for ${repo}`);
      return sha;
    }

    if (source.type === "git") {
      const ref = source.ref || "HEAD";
      const output = execFileSync("git", ["ls-remote", source.original, ref], {
        encoding: "utf8",
        timeout: 30000,
      });
      const sha = output.split("\t")[0]?.trim();
      if (!sha) throw new Error(`Could not resolve ref ${ref} for ${source.original}`);
      return sha;
    }

    if (source.type === "local") {
      const resolved = path.resolve(source.original);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Local path not found: ${resolved}`);
      }
      // Tree-hash the local directory
      return computeTreeHash(resolved);
    }

    if (source.type === "npm") {
      throw new Error("npm source SHA resolution not yet implemented");
    }

    throw new Error(`Cannot resolve SHA for source type: ${source.type}`);
  }

  async fetch(source: PluginSource, pluginName: string): Promise<CachedPlugin> {
    const sha = source.resolvedSha || await this.resolveSha(source);
    const srcDir = this.sourceDir(source);
    const destDir = this.shaDir(srcDir, sha);

    // Already cached
    if (fs.existsSync(destDir)) {
      this.updateRef(srcDir, sha);
      return { source: source.original, name: pluginName, sha, root: destDir };
    }

    ensureDir(srcDir);

    if (source.type === "github") {
      const repo = source.original.split("@")[0];
      const tmpDir = fs.mkdtempSync(path.join(this.cacheRoot, TMP_PREFIX));
      try {
        execFileSync("git", ["clone", "--depth", "1", `https://github.com/${repo}.git`, tmpDir], {
          stdio: "pipe",
          timeout: 60000,
        });
        const actualSha = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: tmpDir,
          encoding: "utf8",
          timeout: 10000,
        }).trim();

        // Remove .git for clean cache
        fs.rmSync(path.join(tmpDir, ".git"), { recursive: true, force: true });

        const finalDest = this.shaDir(srcDir, actualSha);
        if (fs.existsSync(finalDest)) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          this.updateRef(srcDir, actualSha);
          return { source: source.original, name: pluginName, sha: actualSha, root: finalDest };
        }

        fs.renameSync(tmpDir, finalDest);
        this.updateRef(srcDir, actualSha);
        return { source: source.original, name: pluginName, sha: actualSha, root: finalDest };
      } catch (e) {
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
        throw e;
      }
    }

    if (source.type === "git") {
      const tmpDir = fs.mkdtempSync(path.join(this.cacheRoot, TMP_PREFIX));
      try {
        execFileSync("git", ["clone", "--depth", "1", source.original, tmpDir], {
          stdio: "pipe",
          timeout: 60000,
        });
        const actualSha = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: tmpDir,
          encoding: "utf8",
          timeout: 10000,
        }).trim();
        fs.rmSync(path.join(tmpDir, ".git"), { recursive: true, force: true });

        const finalDest = this.shaDir(srcDir, actualSha);
        if (fs.existsSync(finalDest)) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          this.updateRef(srcDir, actualSha);
          return { source: source.original, name: pluginName, sha: actualSha, root: finalDest };
        }

        fs.renameSync(tmpDir, finalDest);
        this.updateRef(srcDir, actualSha);
        return { source: source.original, name: pluginName, sha: actualSha, root: finalDest };
      } catch (e) {
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
        throw e;
      }
    }

    if (source.type === "local") {
      const resolved = path.resolve(source.original);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Local path not found: ${resolved}`);
      }
      // Copy local directory to cache
      copyDirSync(resolved, destDir);
      this.updateRef(srcDir, sha);
      return { source: source.original, name: pluginName, sha, root: destDir };
    }

    if (source.type === "npm") {
      throw new Error("npm source fetch not yet implemented");
    }

    throw new Error(`Cannot fetch source type: ${source.type}`);
  }

  private updateRef(srcDir: string, sha: string): void {
    const refs: Record<string, string> = {};
    if (fs.existsSync(this.refPath(srcDir))) {
      try {
        const existing = JSON.parse(fs.readFileSync(this.refPath(srcDir), "utf8"));
        Object.assign(refs, existing);
      } catch {
        // ignore
      }
    }
    refs.latest = sha;
    fs.writeFileSync(this.refPath(srcDir), JSON.stringify(refs, null, 2));
  }

  listCached(): CachedPlugin[] {
    const results: CachedPlugin[] = [];
    try {
      const sourceDirs = fs.readdirSync(this.cacheRoot);
      for (const dir of sourceDirs) {
        const srcDir = path.join(this.cacheRoot, dir);
        if (!fs.statSync(srcDir).isDirectory()) continue;
        const entries = fs.readdirSync(srcDir);
        for (const entry of entries) {
          if (entry === "ref.json") continue;
          const shaDir = path.join(srcDir, entry);
          if (!fs.statSync(shaDir).isDirectory()) continue;
          const refs: Record<string, string> = {};
          if (fs.existsSync(this.refPath(srcDir))) {
            try {
              Object.assign(refs, JSON.parse(fs.readFileSync(this.refPath(srcDir), "utf8")));
            } catch {
              // ignore
            }
          }
          results.push({
            source: dir,
            name: entry,
            sha: entry,
            root: shaDir,
          });
        }
      }
    } catch {
      // ignore
    }
    return results;
  }

  remove(source: PluginSource, sha: string): void {
    const srcDir = this.sourceDir(source);
    const target = this.shaDir(srcDir, sha);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }

  removeAll(source: PluginSource): void {
    const srcDir = this.sourceDir(source);
    if (fs.existsSync(srcDir)) {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  }
}

function computeTreeHash(dir: string): string {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const crypto = require("node:crypto");
  const hash = crypto.createHash("sha256");
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      hash.update(entry.name);
      hash.update(computeTreeHash(path.join(dir, entry.name)));
    } else if (entry.isFile()) {
      hash.update(entry.name);
      hash.update(fs.readFileSync(path.join(dir, entry.name)));
    }
  }
  return hash.digest("hex");
}

function copyDirSync(src: string, dest: string): void {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".git")) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
