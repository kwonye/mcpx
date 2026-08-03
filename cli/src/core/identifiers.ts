import { z } from "zod";

const skillIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);

export function validateSkillId(id: string): string {
  const result = skillIdSchema.safeParse(id);
  if (!result.success) {
    throw new Error(`Invalid skill id "${id}". Use letters, numbers, dots, underscores, and hyphens.`);
  }
  return id;
}

export function normalizePluginName(name: string): string {
  const normalized = name
    .replace(/[\\/]/g, "_")
    .replace(/^\.+/, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!normalized) {
    throw new Error(`Invalid plugin name "${name}"`);
  }
  return normalized;
}
