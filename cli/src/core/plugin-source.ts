import type { PluginSource, PluginSourceType } from "../types.js";

const GITHUB_RE = /^(?:github\.com\/)?([a-zA-Z0-9][\w.-]*\/[a-zA-Z0-9][\w.-]*?)(?:@([\w./-]+))?$/;
const GIT_URL_RE = /^https?:\/\/.*\.git(?:\?.*)?(?:\/\/.*)?$/;
const SCP_GIT_RE = /^[\w.-]+@[\w.-]+:[\w./-]+$/;
const NPM_RE = /^npm:(@?[\w.-]+(?:\/[\w.-]+)?)(?:@([\w.-]+))?$/;
const MARKETPLACE_RE = /^marketplace:([\w.-]+)$/;

export function parseSource(source: string): PluginSource {
  const github = source.match(GITHUB_RE);
  if (github) {
    return {
      type: "github",
      original: source,
      ref: github[2] || undefined,
    };
  }

  if (NPM_RE.test(source)) {
    const npm = source.match(NPM_RE)!;
    return {
      type: "npm",
      original: source,
      ref: npm[2] || undefined,
    };
  }

  if (MARKETPLACE_RE.test(source)) {
    return {
      type: "marketplace",
      original: source,
    };
  }

  if (source.startsWith("/") || source.startsWith("./") || source.startsWith("../") || source === "." || source === "..") {
    return {
      type: "local",
      original: source,
    };
  }

  if (GIT_URL_RE.test(source) || SCP_GIT_RE.test(source)) {
    return {
      type: "git",
      original: source,
    };
  }

  return {
    type: "git",
    original: source,
  };
}

export function sourceCacheKey(source: PluginSource): string {
  // Strip ref for deterministic key; ref is resolved later
  const base = source.type === "github"
    ? `github/${source.original.split("@")[0]}`
    : source.type === "npm"
    ? `npm/${source.original.replace(/^npm:/, "").split("@")[0]}`
    : source.type === "local"
    ? `local/${source.original.replace(/[^a-zA-Z0-9_/-]/g, "_")}`
    : `git/${source.original.replace(/[^a-zA-Z0-9_./@-]/g, "_")}`;
  return base;
}

export function sourceDisplayName(source: PluginSource): string {
  switch (source.type) {
    case "github":
      return source.original.split("@")[0];
    case "npm": {
      const m = source.original.match(NPM_RE)!;
      return m[1];
    }
    case "marketplace":
      return source.original.replace(/^marketplace:/, "");
    case "local":
      return source.original;
    case "git":
    case "git-subdir":
      return source.original;
  }
}
