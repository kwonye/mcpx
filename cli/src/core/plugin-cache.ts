import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getPluginCacheRoot, ensureDir } from "./paths.js";
import type { PluginSource } from "../types.js";

const TMP_PREFIX = "mcpx-acquire-";
const execFileAsync = promisify(execFile);

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
      : source.type === "git-subdir"
      ? `git_subdir_${`${source.original}/${source.path ?? ""}`.replace(/[^a-zA-Z0-9_./@-]/g, "_")}`
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
      const repo = source.original.replace(/^github\.com\//, "").split("@")[0];
      const ref = source.ref || "HEAD";
      const { stdout } = await execFileAsync("git", ["ls-remote", `https://github.com/${repo}.git`, ref], { timeout: 30000 });
      const sha = stdout.split("\t")[0]?.trim();
      if (!sha) throw new Error(`Could not resolve ref ${ref} for ${repo}`);
      return sha;
    }

    if (source.type === "git" || source.type === "git-subdir") {
      const ref = source.ref || "HEAD";
      const { stdout } = await execFileAsync("git", ["ls-remote", source.original, ref], { timeout: 30000 });
      const sha = stdout.split("\t")[0]?.trim();
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
      const pkg = source.original.replace(/^npm:/, "");
      const spec = source.ref ? `${pkg}@${source.ref}` : pkg;
      const { stdout } = await execFileAsync("npm", ["view", spec, "version", "dist.integrity", "--json"], { timeout: 30000 });
      const metadata = JSON.parse(stdout) as { version?: string; dist?: { integrity?: string }; "dist.integrity"?: string };
      if (!metadata.version) throw new Error(`Could not resolve npm package ${spec}`);
      return `npm-${metadata.version}-${metadata.dist?.integrity ?? metadata["dist.integrity"] ?? "unverified"}`;
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

    if (source.type === "github" || source.type === "git" || source.type === "git-subdir") {
      const remote = source.type === "github"
        ? `https://github.com/${source.original.replace(/^github\.com\//, "").split("@")[0]}.git`
        : source.original;
      const target = source.resolvedSha || source.ref || "HEAD";
      const tmpDir = fs.mkdtempSync(path.join(this.cacheRoot, TMP_PREFIX));
      try {
        await execFileAsync("git", ["init"], { cwd: tmpDir, timeout: 10000 });
        await execFileAsync("git", ["remote", "add", "origin", remote], { cwd: tmpDir, timeout: 10000 });
        await execFileAsync("git", ["fetch", "--depth", "1", "origin", target], {
          cwd: tmpDir,
          timeout: 60000,
        });
        await execFileAsync("git", ["checkout", "--detach", "FETCH_HEAD"], { cwd: tmpDir, timeout: 10000 });
        const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
          cwd: tmpDir,
          timeout: 10000,
        });
        const actualSha = stdout.trim();
        fs.rmSync(path.join(tmpDir, ".git"), { recursive: true, force: true });

        const finalDest = this.shaDir(srcDir, actualSha);
        if (fs.existsSync(finalDest)) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          this.updateRef(srcDir, actualSha);
          return { source: source.original, name: pluginName, sha: actualSha, root: finalDest };
        }

        if (source.type === "git-subdir") {
          if (!source.path) throw new Error("git-subdir source is missing a path");
          const subdir = path.resolve(tmpDir, source.path);
          if (!subdir.startsWith(path.resolve(tmpDir) + path.sep) || !fs.existsSync(subdir)) {
            throw new Error(`Plugin subdirectory not found: ${source.path}`);
          }
          try {
            fs.renameSync(subdir, finalDest);
          } catch (error) {
            if (!fs.existsSync(finalDest)) throw error;
          }
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } else {
          try {
            fs.renameSync(tmpDir, finalDest);
          } catch (error) {
            if (!fs.existsSync(finalDest)) throw error;
            return { source: source.original, name: pluginName, sha: actualSha, root: finalDest };
          }
        }
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
      const pkg = source.original.replace(/^npm:/, "");
      const spec = source.ref ? `${pkg}@${source.ref}` : pkg;
      const tmpDir = fs.mkdtempSync(path.join(this.cacheRoot, TMP_PREFIX));
      try {
        const { stdout } = await execFileAsync("npm", ["pack", spec, "--ignore-scripts", "--json", "--pack-destination", tmpDir], { timeout: 120000 });
        const packed = JSON.parse(stdout) as Array<{ filename?: string; version?: string; integrity?: string }>;
        const filename = packed[0]?.filename;
        if (!filename) throw new Error(`npm did not produce an archive for ${spec}`);
        const archive = path.join(tmpDir, filename);
        const actualSha = `npm-${packed[0]?.version ?? source.ref ?? "latest"}-${crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex")}`;
        const finalDest = this.shaDir(srcDir, actualSha);
        if (!fs.existsSync(finalDest)) {
          ensureDir(finalDest);
          await execFileAsync("tar", ["-xzf", archive, "--strip-components=1", "-C", finalDest], { timeout: 30000 });
        }
        this.updateRef(srcDir, actualSha);
        return { source: source.original, name: pluginName, sha: actualSha, root: finalDest };
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
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
  const hash = crypto.createHash("sha256");
  for (const entry of entries) {
    if (entry.name.startsWith(".git")) continue;
    if (entry.name === ".DS_Store") continue;
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
    if (entry.name === ".DS_Store") continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
