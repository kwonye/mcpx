import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const packageJsonPath = resolve(repoRoot, "package.json");
const versionTsPath = resolve(repoRoot, "src", "version.ts");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const version = packageJson.version;

if (typeof version !== "string" || version.length === 0) {
  throw new Error("package.json version is missing or invalid");
}

const output = `export const APP_VERSION = ${JSON.stringify(version)};\n`;

const current = readFileSync(versionTsPath, "utf8");
if (current !== output) {
  writeFileSync(versionTsPath, output, "utf8");
}
