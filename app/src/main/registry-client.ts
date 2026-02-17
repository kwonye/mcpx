const REGISTRY_BASE = "https://registry.modelcontextprotocol.io";
const DEFAULT_LIMIT = 30;

export interface RegistryServerEntry {
  server: {
    name: string;
    title?: string;
    description?: string;
    version: string;
    packages?: RegistryPackage[];
    remotes?: RegistryRemote[];
  };
  _meta?: Record<string, unknown>;
}

export interface RegistryPackage {
  registryType: string;
  registryBaseUrl?: string;
  identifier: string;
  version?: string;
  runtimeHint?: string;
  transport: { type: string; url?: string };
  environmentVariables?: RegistryEnvVar[];
  packageArguments?: RegistryArgument[];
}

export interface RegistryRemote {
  type: string;
  url: string;
  headers?: RegistryHeader[];
  variables?: Record<string, { description?: string; isRequired?: boolean }>;
}

export interface RegistryEnvVar {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
}

export interface RegistryArgument {
  type: "positional" | "named";
  name?: string;
  value?: string;
  valueHint?: string;
  description?: string;
  isRequired?: boolean;
  default?: string;
}

export interface RegistryHeader {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
}

export interface RegistryListResponse {
  servers: RegistryServerEntry[];
  metadata: { count: number; nextCursor: string | null };
}

export interface RegistryDetailResponse {
  server: RegistryServerEntry["server"];
  _meta?: Record<string, unknown>;
}

export async function fetchRegistryServers(
  cursor?: string,
  query?: string,
  limit = DEFAULT_LIMIT
): Promise<RegistryListResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  if (query) params.set("q", query);

  const response = await fetch(`${REGISTRY_BASE}/v0.1/servers?${params}`, {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Registry API error: ${response.status}`);
  }

  return response.json();
}

export async function fetchServerDetail(name: string): Promise<RegistryDetailResponse> {
  const encoded = encodeURIComponent(name);
  const response = await fetch(`${REGISTRY_BASE}/v0.1/servers/${encoded}/versions/latest`, {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Registry API error: ${response.status}`);
  }

  return response.json();
}
