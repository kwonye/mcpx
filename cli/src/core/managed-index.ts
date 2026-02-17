import type { ManagedIndex } from "../types.js";
import { getManagedIndexPath } from "./paths.js";
import { readJsonFile, writeJsonAtomic } from "../util/fs.js";

export function defaultManagedIndex(): ManagedIndex {
  return {
    schemaVersion: 1,
    managed: {}
  };
}

export function loadManagedIndex(filePath = getManagedIndexPath()): ManagedIndex {
  const raw = readJsonFile(filePath, defaultManagedIndex());

  if (!raw || typeof raw !== "object") {
    return defaultManagedIndex();
  }

  if ((raw as { schemaVersion?: number }).schemaVersion !== 1) {
    return defaultManagedIndex();
  }

  return raw as ManagedIndex;
}

export function saveManagedIndex(index: ManagedIndex, filePath = getManagedIndexPath()): void {
  writeJsonAtomic(filePath, index);
}
