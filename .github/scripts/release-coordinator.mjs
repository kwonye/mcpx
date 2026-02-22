#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");

function run(cmd) {
  return execSync(cmd, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function runOrEmpty(cmd) {
  try {
    return run(cmd);
  } catch {
    return "";
  }
}

function readPackageVersion(pathFromRoot) {
  const fullPath = resolve(repoRoot, pathFromRoot);
  const pkg = JSON.parse(readFileSync(fullPath, "utf8"));
  return pkg.version;
}

function parseBoolean(value, flagName) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`Invalid ${flagName} value '${value}'. Expected true or false.`);
}

function parseSemver(input) {
  const trimmed = String(input).trim();
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid semver '${input}'. Expected MAJOR.MINOR.PATCH.`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function formatSemver(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function compareSemver(a, b) {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  return a.patch - b.patch;
}

function maxSemverString(values) {
  const parsed = values.map((value) => parseSemver(value));
  return formatSemver(parsed.sort(compareSemver).at(-1));
}

function bumpPatch(version) {
  return {
    major: version.major,
    minor: version.minor,
    patch: version.patch + 1,
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument '${token}'.`);
    }
    const key = token.slice(2);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}.`);
    }
    args[key] = value;
    i += 1;
  }
  return { command, args };
}

function cmdNextVersion(args) {
  const includeCli = parseBoolean(args["include-cli"], "--include-cli");
  parseBoolean(args["include-desktop"], "--include-desktop");

  const versions = [];

  const cliPackageVersion = readPackageVersion("cli/package.json");
  const appPackageVersion = readPackageVersion("app/package.json");
  versions.push(cliPackageVersion, appPackageVersion);

  const latestTagVersion = runOrEmpty(
    "git tag --list 'v*' | sed 's/^v//' | sort -V | tail -n1",
  );
  versions.push(latestTagVersion || "0.0.0");

  if (includeCli) {
    const npmVersion =
      runOrEmpty("npm view @kwonye/mcpx version 2>/dev/null") || "0.0.0";
    versions.push(npmVersion);
  }

  const base = parseSemver(maxSemverString(versions));
  process.stdout.write(`${formatSemver(bumpPatch(base))}\n`);
}

function cmdTagBody(args) {
  const sourceSha = args["source-sha"];
  const includeCli = parseBoolean(args["include-cli"], "--include-cli");
  const includeDesktop = parseBoolean(
    args["include-desktop"],
    "--include-desktop",
  );
  const version = formatSemver(parseSemver(args.version));

  if (!sourceSha || sourceSha.length === 0) {
    throw new Error("Missing --source-sha value.");
  }

  const lines = [
    "mcpx-release-v1",
    `source_sha=${sourceSha}`,
    `include_cli=${String(includeCli)}`,
    `include_desktop=${String(includeDesktop)}`,
    `version=${version}`,
  ];

  process.stdout.write(`${lines.join("\n")}\n`);
}

function cmdReleaseBody(args) {
  const includeCli = parseBoolean(args["include-cli"], "--include-cli");
  const includeDesktop = parseBoolean(
    args["include-desktop"],
    "--include-desktop",
  );
  const version = formatSemver(parseSemver(args.version));

  const sections = [];
  if (includeCli) {
    sections.push("## CLI\n- Included in this release.");
  }
  if (includeDesktop) {
    sections.push("## Desktop\n- Included in this release.");
  }
  if (sections.length === 0) {
    throw new Error("At least one component must be included.");
  }

  const body = [`Release \`v${version}\``, "", ...sections].join("\n");
  process.stdout.write(`${body}\n`);
}

function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (!command) {
    throw new Error("Missing command. Expected next-version, tag-body, or release-body.");
  }

  if (command === "next-version") {
    cmdNextVersion(args);
    return;
  }
  if (command === "tag-body") {
    cmdTagBody(args);
    return;
  }
  if (command === "release-body") {
    cmdReleaseBody(args);
    return;
  }
  throw new Error(
    `Unknown command '${command}'. Expected next-version, tag-body, or release-body.`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
