import type { StdioServerSpec, UpstreamServerSpec } from "../types.js";

export type AuthTargetKind = "header" | "env";

export interface AuthTarget {
  kind: AuthTargetKind;
  key: string;
}

export interface AuthBinding {
  kind: AuthTargetKind;
  key: string;
  value: string;
}

function normalizeNamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "value";
}

function requireNonEmpty(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} must be non-empty.`);
  }

  return normalized;
}

export function toSecretRef(secretName: string): string {
  return `secret://${secretName}`;
}

export function secretRefName(ref: string): string | null {
  if (!ref.startsWith("secret://")) {
    return null;
  }

  const name = ref.slice("secret://".length).trim();
  return name.length > 0 ? name : null;
}

export function defaultAuthSecretName(serverName: string, target: AuthTarget): string {
  return `auth_${normalizeNamePart(serverName)}_${target.kind}_${normalizeNamePart(target.key)}`;
}

export function resolveAuthTarget(spec: UpstreamServerSpec, header?: string, env?: string): AuthTarget {
  if (spec.transport === "http") {
    if (env) {
      throw new Error("--env is only valid for stdio upstreams.");
    }

    return {
      kind: "header",
      key: requireNonEmpty(header ?? "Authorization", "Header name")
    };
  }

  if (header) {
    throw new Error("--header is only valid for HTTP upstreams.");
  }

  return {
    kind: "env",
    key: requireNonEmpty(env, "Env var name")
  };
}

export function applyAuthReference(spec: UpstreamServerSpec, target: AuthTarget, secretRef: string): void {
  if (target.kind === "header") {
    if (spec.transport !== "http") {
      throw new Error(`Cannot set header auth on ${spec.transport} upstream.`);
    }

    const headers = { ...(spec.headers ?? {}) };
    headers[target.key] = secretRef;
    spec.headers = headers;
    return;
  }

  if (spec.transport !== "stdio") {
    throw new Error(`Cannot set env auth on ${spec.transport} upstream.`);
  }

  const env = { ...(spec.env ?? {}) };
  env[target.key] = secretRef;
  spec.env = env;
}

export function removeAuthReference(spec: UpstreamServerSpec, target: AuthTarget): string | null {
  if (target.kind === "header") {
    if (spec.transport !== "http") {
      throw new Error(`Cannot remove header auth from ${spec.transport} upstream.`);
    }

    if (!spec.headers || !(target.key in spec.headers)) {
      return null;
    }

    const previous = spec.headers[target.key] ?? null;
    const next = { ...spec.headers };
    delete next[target.key];
    spec.headers = Object.keys(next).length > 0 ? next : undefined;
    return previous;
  }

  if (spec.transport !== "stdio") {
    throw new Error(`Cannot remove env auth from ${spec.transport} upstream.`);
  }

  if (!spec.env || !(target.key in spec.env)) {
    return null;
  }

  const previous = spec.env[target.key] ?? null;
  const next = { ...spec.env };
  delete next[target.key];
  spec.env = Object.keys(next).length > 0 ? next : undefined;
  return previous;
}

export function listAuthBindings(spec: UpstreamServerSpec): AuthBinding[] {
  if (spec.transport === "http") {
    return Object.entries(spec.headers ?? {}).map(([key, value]) => ({
      kind: "header",
      key,
      value
    }));
  }

  return Object.entries((spec as StdioServerSpec).env ?? {}).map(([key, value]) => ({
    kind: "env",
    key,
    value
  }));
}

export function maybePrefixBearer(target: AuthTarget, value: string, raw = false): string {
  if (raw || target.kind !== "header" || target.key.toLowerCase() !== "authorization") {
    return value;
  }

  if (/^\S+\s+\S+/.test(value)) {
    return value;
  }

  return `Bearer ${value}`;
}
