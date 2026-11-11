/**
 * Editing model for a server's environment variables (local commands) or
 * headers (remote URLs). Shared by the add flow and the edit form.
 *
 * Secret semantics (preserved from the original editor): the renderer never
 * receives secret values, so an existing secret row starts blank and a blank
 * secret means "keep the existing secret". Only removing the row deletes it.
 */
import type { StatusAuthBinding, UpstreamServerSpec } from "@mcpx/core";

export type BindingKind = "env" | "header";

export interface KeyValueRow {
  id: string;
  key: string;
  value: string;
  secret: boolean;
  /** The secret:// reference this row had when the editor opened. */
  originalRef?: string;
  /** Written by browser sign-in; shown read-only and passed through untouched. */
  managedByOAuth?: boolean;
}

let rowSeq = 0;
export function newRowId(): string {
  rowSeq += 1;
  return `row-${rowSeq}`;
}

const SECRET_KEY = /(api.?key|token|secret|password|passwd|auth|credential|private.?key|access.?key|bearer)/i;

/** Default for the secret toggle on a new row. */
export function looksSecret(key: string): boolean {
  return SECRET_KEY.test(key);
}

export function emptyRow(kind: BindingKind): KeyValueRow {
  return { id: newRowId(), key: "", value: "", secret: kind === "header" };
}

export function rowsFromBindings(bindings: StatusAuthBinding[], kind: BindingKind): KeyValueRow[] {
  return bindings
    .filter((binding) => binding.kind === kind)
    .map((binding) => {
      const isSecretRef = binding.value.startsWith("secret://");
      return {
        id: newRowId(),
        key: binding.key,
        value: isSecretRef ? "" : binding.value,
        secret: isSecretRef,
        originalRef: isSecretRef ? binding.value : undefined,
        managedByOAuth: binding.value.startsWith("oauth://")
      };
    });
}

/** Rows for values that came from a pasted command (plain text, not yet stored). */
export function rowsFromRecord(record: Record<string, string> | undefined): KeyValueRow[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({
    id: newRowId(),
    key,
    value: value.startsWith("secret://") ? "" : value,
    secret: value.startsWith("secret://") || looksSecret(key),
    originalRef: value.startsWith("secret://") ? value : undefined
  }));
}

export function secretNameFor(serverName: string, kind: BindingKind, key: string): string {
  const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9._-]/g, "_");
  return `auth_${slug(serverName)}_${kind}_${slug(key)}`;
}

export interface BuiltEntries {
  record: Record<string, string> | undefined;
  secrets: Record<string, string>;
  /** Row id -> message, for inline display. */
  errors: Record<string, string>;
}

export function buildEntries(serverName: string, kind: BindingKind, rows: KeyValueRow[]): BuiltEntries {
  const record: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  const errors: Record<string, string> = {};
  const seen = new Set<string>();

  for (const row of rows) {
    const key = row.key.trim();
    if (!key && !row.value) continue;
    if (!key) {
      errors[row.id] = kind === "env" ? "Add a variable name." : "Add a header name.";
      continue;
    }
    if (seen.has(key.toLowerCase())) {
      errors[row.id] = `"${key}" is listed twice.`;
      continue;
    }
    seen.add(key.toLowerCase());

    if (row.managedByOAuth) {
      record[key] = row.originalRef ?? row.value;
      continue;
    }
    if (row.secret) {
      if (row.value) {
        const name = secretNameFor(serverName, kind, key);
        secrets[name] = row.value;
        record[key] = `secret://${name}`;
      } else if (row.originalRef) {
        record[key] = row.originalRef;
      } else {
        errors[row.id] = "Enter a value.";
      }
      continue;
    }
    if (!row.value && row.originalRef) {
      errors[row.id] = "Enter the value to store it as plain text.";
      continue;
    }
    record[key] = row.value;
  }

  return { record: Object.keys(record).length > 0 ? record : undefined, secrets, errors };
}

export interface ServerDraft {
  transport: "http" | "stdio";
  url: string;
  command: string;
  args: string[];
  cwd: string;
  rows: KeyValueRow[];
  enabled?: boolean;
}

export function draftFromSpec(spec: UpstreamServerSpec, rows: KeyValueRow[]): ServerDraft {
  return spec.transport === "http"
    ? { transport: "http", url: spec.url, command: "", args: [], cwd: "", rows, enabled: spec.enabled }
    : { transport: "stdio", url: "", command: spec.command, args: [...(spec.args ?? [])], cwd: spec.cwd ?? "", rows, enabled: spec.enabled };
}

export interface BuiltSpec {
  spec: UpstreamServerSpec;
  secrets: Record<string, string>;
  errors: Record<string, string>;
}

/** Field errors use keys "url", "command" and row ids. */
export function buildSpec(serverName: string, draft: ServerDraft): BuiltSpec {
  const kind: BindingKind = draft.transport === "http" ? "header" : "env";
  const entries = buildEntries(serverName, kind, draft.rows);
  const errors = { ...entries.errors };
  let spec: UpstreamServerSpec;
  if (draft.transport === "http") {
    const url = draft.url.trim();
    if (!url) errors.url = "Enter the server URL.";
    else if (!/^https?:\/\/\S+$/i.test(url)) errors.url = "Use a full http:// or https:// URL.";
    spec = { transport: "http", url, ...(entries.record ? { headers: entries.record } : {}) };
  } else {
    const command = draft.command.trim();
    if (!command) errors.command = "Enter the command that starts the server.";
    const args = draft.args.filter((arg) => arg !== "");
    spec = {
      transport: "stdio",
      command,
      ...(args.length > 0 ? { args } : {}),
      ...(entries.record ? { env: entries.record } : {}),
      ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {})
    };
  }
  if (draft.enabled !== undefined) spec.enabled = draft.enabled;
  return { spec, secrets: entries.secrets, errors };
}

export const SERVER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;

export function validateServerName(name: string, existing: string[]): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the server a name.";
  if (!SERVER_NAME_PATTERN.test(trimmed)) return "Use letters, numbers, dots, dashes or underscores, starting with a letter or number.";
  if (existing.includes(trimmed)) return `A server named "${trimmed}" already exists.`;
  return null;
}
