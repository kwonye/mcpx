import type { UpstreamServerSpec } from "@mcpx/core";
import type { RegistryPackage, RegistryRemote } from "./registry-client";

interface SelectedPackage {
  kind: "package";
  package: RegistryPackage;
  remote?: undefined;
}

interface SelectedRemote {
  kind: "remote";
  remote: RegistryRemote;
  package?: undefined;
}

export type SelectedOption = SelectedPackage | SelectedRemote;

export interface RequiredInput {
  name: string;
  description?: string;
  isSecret: boolean;
  kind: "env" | "arg" | "header";
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

  if (option.kind === "package" && option.package.environmentVariables) {
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

  if (option.kind === "remote" && option.remote.headers) {
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

export function mapServerToSpec(
  _name: string,
  option: SelectedOption,
  resolvedValues: Record<string, string>
): UpstreamServerSpec {
  if (option.kind === "remote") {
    const headers: Record<string, string> = {};
    for (const header of option.remote.headers ?? []) {
      const value = resolvedValues[header.name] ?? header.default;
      if (value) headers[header.name] = value;
    }
    return {
      transport: "http",
      url: option.remote.url,
      ...(Object.keys(headers).length > 0 ? { headers } : {})
    };
  }

  const pkg = option.package;
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
