import fs from "node:fs";
import path from "node:path";

import { lockOwnerAlive } from "./file-state.js";

export function withManagedIndexLock<T>(lockPath: string, fn: () => T, timeoutMs = 5000): T {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      fs.writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx" });
      break;
    } catch {
      if (!lockOwnerAlive(lockPath)) {
        try { fs.unlinkSync(lockPath); } catch {}
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for managed-index lock: ${lockPath}`);
      }
    }
  }
  try {
    return fn();
  } finally {
    try { fs.unlinkSync(lockPath); } catch {}
  }
}
