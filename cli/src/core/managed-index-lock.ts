import fs from "node:fs";
import path from "node:path";

function isStale(lockPath: string, maxAgeMs = 5000): boolean {
  try {
    const stat = fs.statSync(lockPath);
    return Date.now() - stat.mtimeMs > maxAgeMs;
  } catch {
    return true;
  }
}

export function withManagedIndexLock<T>(lockPath: string, fn: () => T): T {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      fs.writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx" });
      break;
    } catch {
      if (isStale(lockPath)) {
        try { fs.unlinkSync(lockPath); } catch {}
        continue;
      }
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
