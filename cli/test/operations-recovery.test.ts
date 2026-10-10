import { it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { setupTempEnv } from "./helpers.js";
import { applyWrites, listOperations, markInterruptedOperations, rollbackOperation, snapshot } from "../src/core/operations.js";

it("restores a directory when replacement failed between removal and rename", () => {
  const env = setupTempEnv("operation-directory-gap-");
  const rename = fs.renameSync;
  try {
    const directory = path.join(env.root, "native-skill");
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, "SKILL.md"), "Keep my skill");
    fs.renameSync = ((from, to) => { if (String(to) === directory) throw new Error("Injected rename failure"); rename(from, to); }) as typeof rename;
    expect(() => applyWrites("Directory replacement", [{ path: directory, before: snapshot(directory), after: { kind: "link", content: "managed-skill" } }])).toThrow("Injected rename failure");
    fs.renameSync = rename;
    expect(fs.existsSync(directory)).toBe(false);
    const operation = listOperations().find(operation => operation.label === "Directory replacement")!;
    expect(operation.phase).toBe("recovery-required");
    rollbackOperation(operation.id);
    expect(fs.readFileSync(path.join(directory, "SKILL.md"), "utf8")).toBe("Keep my skill");
  } finally { fs.renameSync = rename; env.restore(); }
});

it.skipIf(process.platform === "win32")("recovers a process killed between two filesystem commits", () => {
  const env = setupTempEnv("operation-crash-");
  try {
    const first = path.join(env.root, "first.txt"), second = path.join(env.root, "second.txt");
    fs.writeFileSync(first, "first before"); fs.writeFileSync(second, "second before");
    const source = path.join(env.root, "crash.ts");
    fs.writeFileSync(source, `import fs from "node:fs";\nimport { applyWrites, snapshot, textSnapshot } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/core/operations.ts"))};\nconst original = fs.renameSync;\nfs.renameSync = function (from, to) { original(from, to); if (String(to) === ${JSON.stringify(first)}) process.kill(process.pid, "SIGKILL"); };\napplyWrites("Crash recovery test", [${JSON.stringify(first)}, ${JSON.stringify(second)}].map(file => ({ path: file, before: snapshot(file), after: textSnapshot("after") })));`);
    const result = Bun.spawnSync([process.execPath, source], { env: process.env, cwd: env.root });
    expect(result.success).toBe(false);
    expect(fs.readFileSync(first, "utf8")).toBe("after");
    expect(fs.readFileSync(second, "utf8")).toBe("second before");
    markInterruptedOperations();
    const interrupted = listOperations().find(operation => operation.label === "Crash recovery test")!;
    expect(interrupted.phase).toBe("recovery-required");
    rollbackOperation(interrupted.id);
    expect(fs.readFileSync(first, "utf8")).toBe("first before");
    expect(fs.readFileSync(second, "utf8")).toBe("second before");
  } finally { env.restore(); }
});
