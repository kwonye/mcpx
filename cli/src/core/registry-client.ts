const REGISTRY_BASE = "https://registry.modelcontextprotocol.io";

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

export interface RegistryServerDetail {
  name: string;
  title?: string;
  description?: string;
  version: string;
  packages?: RegistryPackage[];
  remotes?: RegistryRemote[];
}

export interface RequiredInput {
  name: string;
  description?: string;
  isSecret: boolean;
  kind: "env" | "arg" | "header";
}

export interface SelectedOption {
  kind: "package" | "remote";
  package?: RegistryPackage;
  remote?: RegistryRemote;
}

export async function fetchRegistryServerDetail(name: string): Promise<RegistryServerDetail> {
  const encoded = encodeURIComponent(name);
  const response = await fetch(`${REGISTRY_BASE}/v0.1/servers/${encoded}/versions/latest`, {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Registry API error: ${response.status}`);
  }

  const data = (await response.json()) as { server: RegistryServerDetail };
  return data.server;
}

const PACKAGE_PRIORITY: Record<string, number> = {
  npm: 1,
  pypi: 2,
  nuget: 3,
  oci: 4,
  mcpb: 5
};

const RUNTIME_HINT: Record<string, string> = {
  npm: "npx",
  pypi: "uvx",
  nuget: "dnx"
};

export function selectBestPackage(
  packages: RegistryPackage[] = [],
  remotes: RegistryRemote[] = []
): SelectedOption {
  const stdioPkgs = packages
    .filter((p) => p.transport.type === "stdio")
    .sort((a, b) => (PACKAGE_PRIORITY[a.registryType] ?? 99) - (PACKAGE_PRIORITY[b.registryType] ?? 99));

  if (stdioPkgs.length > 0) {
    return { kind: "package", package: stdioPkgs[0] };
  }

  const httpRemotes = remotes.filter((r) => r.type === "streamable-http" || r.type === "sse");
  if (httpRemotes.length > 0) {
    return { kind: "remote", remote: httpRemotes[0] };
  }

  if (packages.length > 0) {
    return { kind: "package", package: packages[0] };
  }

  if (remotes.length > 0) {
    return { kind: "remote", remote: remotes[0] };
  }

  throw new Error("Server has no packages or remotes");
}

export function extractRequiredInputs(option: SelectedOption): RequiredInput[] {
  const inputs: RequiredInput[] = [];

  if (option.kind === "package" && option.package?.environmentVariables) {
    for (const env of option.package.environmentVariables) {
      if (env.isRequired && !env.default) {
        inputs.push({
          name: env.name,
          description: env.description,
          isSecret: env.isSecret ?? false,
          kind: "env"
        });
      }
    }

    for (const arg of option.package.packageArguments ?? []) {
      if (arg.isRequired && !arg.value && !arg.default) {
        inputs.push({
          name: arg.name ?? arg.valueHint ?? "arg",
          description: arg.description,
          isSecret: false,
          kind: "arg"
        });
      }
    }
  }

  if (option.kind === "remote" && option.remote?.headers) {
    for (const header of option.remote.headers) {
      if (header.isRequired && !header.default) {
        inputs.push({
          name: header.name,
          description: header.description,
          isSecret: header.isSecret ?? false,
          kind: "header"
        });
      }
    }
  }

  return inputs;
}

export function mapRegistryToSpec(
  _name: string,
  option: SelectedOption,
  resolvedValues: Record<string, string>
): { transport: string; command?: string; args?: string[]; url?: string; headers?: Record<string, string>; env?: Record<string, string> } {
  if (option.kind === "remote") {
    const headers: Record<string, string> = {};
    for (const header of option.remote?.headers ?? []) {
      const value = resolvedValues[header.name] ?? header.default;
      if (value) headers[header.name] = value;
    }
    return {
      transport: "http",
      url: option.remote!.url,
      ...(Object.keys(headers).length > 0 ? { headers } : {})
    };
  }

  const pkg = option.package!;
  const runtime = pkg.runtimeHint ?? RUNTIME_HINT[pkg.registryType] ?? "npx";
  const args: string[] = [];

  const identifier = pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier;
  args.push(identifier);

  for (const arg of pkg.packageArguments ?? []) {
    const value = arg.value ?? resolvedValues[arg.name ?? arg.valueHint ?? ""] ?? arg.default;
    if (!value) continue;
    if (arg.type === "named" && arg.name) {
      args.push(arg.name, value);
    } else {
      args.push(value);
    }
  }

  const env: Record<string, string> = {};
  for (const envVar of pkg.environmentVariables ?? []) {
    const value = resolvedValues[envVar.name] ?? envVar.default;
    if (value) env[envVar.name] = value;
  }

  return {
    transport: "stdio",
    command: runtime,
    args,
    ...(Object.keys(env).length > 0 ? { env } : {})
  };
}
