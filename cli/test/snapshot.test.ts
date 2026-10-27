import { afterEach, describe, expect, it } from "bun:test";
import { snapshotHash } from "../src/core/operations.js";

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
});
