import { afterEach, describe, expect, it } from "bun:test";
import { normalizeLinkContent, pathFingerprint } from "../src/core/file-state.js";
import { snapshotHash, writeSnapshot } from "../src/core/operations.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sha256 } from "../src/util/fs.js";

describe("snapshotHash", () => {
  const original = Object.getOwnPropertyDescriptor(process, "platform");

  afterEach(() => {
    if (original) Object.defineProperty(process, "platform", original);
  });

  it("ignores unix permission bits on Windows", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const strict = snapshotHash({ kind: "file", content: "YQ==", mode: 0o600 });
    const windows = snapshotHash({
      kind: "directory",
      mode: 0o755,
      files: { "SKILL.md": { kind: "file", content: "YQ==", mode: 0o666 } }
    });
    const sameContent = snapshotHash({
      kind: "directory",
      mode: 0o700,
      files: { "SKILL.md": { kind: "file", content: "YQ==", mode: 0o644 } }
    });
    expect(strict).toBe(snapshotHash({ kind: "file", content: "YQ==", mode: 0o666 }));
    expect(windows).toBe(sameContent);
    expect(strict).not.toBe(snapshotHash({ kind: "file", content: "Yg==", mode: 0o666 }));
  });

  it("compares Windows junction targets as paths relative to the link", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    expect(normalizeLinkContent(
      "D:\\workspace\\skills\\review",
      "\\\\?\\D:\\workspace\\data\\mcpx\\skills\\review"
    )).toBe("..\\data\\mcpx\\skills\\review");
    expect(normalizeLinkContent(
      "D:\\workspace\\skills\\review",
      "..\\data\\mcpx\\skills\\review"
    )).toBe("..\\data\\mcpx\\skills\\review");
  });

  it("hashes a Windows link by the relative target stored in the manifest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpx-link-hash-"));
    const link = path.join(root, "obsolete");
    fs.symlinkSync("../canonical", link);
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      expect(pathFingerprint(link)).toBe(sha256("link:..\\canonical"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("writeSnapshot", () => {
  it("replaces and removes a symlink without deleting the directory it points at", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpx-link-replace-"));
    const canonical = path.join(root, "canonical");
    const next = path.join(root, "next");
    const link = path.join(root, "review");
    fs.mkdirSync(canonical, { recursive: true });
    fs.mkdirSync(next, { recursive: true });
    fs.writeFileSync(path.join(canonical, "SKILL.md"), "Keep me");
    fs.writeFileSync(path.join(next, "SKILL.md"), "Version two");
    fs.symlinkSync("canonical", link);
    try {
      writeSnapshot(link, { kind: "link", content: "next" });
      expect(fs.readFileSync(path.join(link, "SKILL.md"), "utf8")).toBe("Version two");
      expect(fs.readFileSync(path.join(canonical, "SKILL.md"), "utf8")).toBe("Keep me");
      writeSnapshot(link, { kind: "missing" });
      expect(fs.existsSync(link)).toBe(false);
      expect(fs.readFileSync(path.join(next, "SKILL.md"), "utf8")).toBe("Version two");
      expect(fs.readFileSync(path.join(canonical, "SKILL.md"), "utf8")).toBe("Keep me");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
