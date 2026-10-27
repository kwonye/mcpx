import { spawnSync } from "node:child_process";
import { z } from "zod";

/** Login-keychain item that holds the whole mcpx secret map for this user. */
export const KEYCHAIN_SERVICE = "com.kwonye.mcpx";
export const KEYCHAIN_ACCOUNT = "secrets";
export const KEYCHAIN_LABEL = "mcpx secrets";

const keychainPayloadSchema = z.object({
  v: z.literal(1),
  secrets: z.record(z.string(), z.string())
});

export interface SecretCommandRequest {
  command: string;
  args: string[];
  input?: string;
}

export interface SecretCommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type SecretCommandRunner = (request: SecretCommandRequest) => SecretCommandResult;

let commandRunner: SecretCommandRunner = defaultSecretCommandRunner;
let platformOverride: NodeJS.Platform | null = null;

/** Test hook. Production code leaves the real `security` / `secret-tool` runner in place. */
export function setSecretCommandRunnerForTests(runner: SecretCommandRunner | null): void {
  commandRunner = runner ?? defaultSecretCommandRunner;
}

/** Test hook. `null` uses `process.platform`. */
export function setSecretKeychainPlatformForTests(platform: NodeJS.Platform | null): void {
  platformOverride = platform;
}

function currentPlatform(): NodeJS.Platform {
  return platformOverride ?? process.platform;
}

function defaultSecretCommandRunner(request: SecretCommandRequest): SecretCommandResult {
  const result = spawnSync(request.command, request.args, {
    encoding: "utf8",
    windowsHide: true,
    ...(request.input !== undefined ? { input: request.input } : {})
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { status: 127, stdout: "", stderr: `${request.command}: not found` };
    }
    throw result.error;
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

export function keychainUnsupportedReason(platform = currentPlatform()): string | null {
  if (platform === "darwin" || platform === "linux") return null;
  return `The keychain backend is not supported on ${platform}. It is available on macOS (Keychain, via the security command) and Linux (libsecret, via secret-tool).`;
}

function assertKeychainSupported(platform: NodeJS.Platform): void {
  const reason = keychainUnsupportedReason(platform);
  if (reason) throw new Error(reason);
}

function missingToolMessage(command: string): string {
  if (command === "secret-tool") {
    return "The keychain backend needs secret-tool from libsecret. Install libsecret-tools (Debian/Ubuntu) or libsecret (Fedora), or run `mcpx secret backend file`.";
  }
  if (command === "security") {
    return "The keychain backend needs the macOS security command, but it was not found on PATH.";
  }
  return `The keychain backend could not run "${command}".`;
}

function throwIfFailed(result: SecretCommandResult, command: string): void {
  if (result.status === 0) return;
  if (result.status === 127) throw new Error(missingToolMessage(command));
  const detail = result.stderr.trim() || `exited ${result.status}`;
  throw new Error(`Keychain command failed (${command}): ${detail}`);
}

function isNotFound(result: SecretCommandResult, platform: NodeJS.Platform): boolean {
  if (result.status === 0 || result.status === 127) return false;
  if (platform === "darwin" && result.status === 44) return true;
  const stderr = result.stderr.toLowerCase();
  return stderr.includes("could not be found") || stderr.includes("item not found");
}

function encodePayload(secrets: Record<string, string>): string {
  return Buffer.from(JSON.stringify({ v: 1, secrets }), "utf8").toString("base64");
}

function decodePayload(stored: string): Record<string, string> {
  const trimmed = stored.trim();
  const unreadable = "The keychain secret payload could not be read. Refusing to change it.";
  if (!trimmed) throw new Error(unreadable);
  try {
    const parsed: unknown = JSON.parse(Buffer.from(trimmed, "base64").toString("utf8"));
    const result = keychainPayloadSchema.safeParse(parsed);
    if (!result.success) throw new Error(unreadable);
    return result.data.secrets;
  } catch (err) {
    if (err instanceof Error && err.message === unreadable) throw err;
    throw new Error(unreadable);
  }
}

function run(request: SecretCommandRequest): SecretCommandResult {
  return commandRunner(request);
}

export function readKeychainSecrets(): Record<string, string> {
  const platform = currentPlatform();
  assertKeychainSupported(platform);
  const command = platform === "darwin" ? "security" : "secret-tool";
  const result = platform === "darwin"
    ? run({ command, args: ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"] })
    : run({ command, args: ["lookup", "service", KEYCHAIN_SERVICE, "account", KEYCHAIN_ACCOUNT] });
  if (isNotFound(result, platform)) return {};
  throwIfFailed(result, command);
  return decodePayload(result.stdout);
}

export function writeKeychainSecrets(secrets: Record<string, string>): void {
  if (Object.keys(secrets).length === 0) {
    clearKeychainSecrets();
    return;
  }
  const platform = currentPlatform();
  assertKeychainSupported(platform);
  const payload = encodePayload(secrets);
  // `security` has no stdin password flag. `-w` puts the secret in argv for
  // the lifetime of that process. The keychain still protects the stored item at rest.
  if (platform === "darwin") {
    const result = run({
      command: "security",
      args: ["add-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-l", KEYCHAIN_LABEL, "-U", "-w", payload]
    });
    throwIfFailed(result, "security");
    return;
  }
  const result = run({
    command: "secret-tool",
    args: ["store", "--label", KEYCHAIN_LABEL, "service", KEYCHAIN_SERVICE, "account", KEYCHAIN_ACCOUNT],
    input: payload
  });
  throwIfFailed(result, "secret-tool");
}

export function clearKeychainSecrets(): void {
  const platform = currentPlatform();
  assertKeychainSupported(platform);
  const command = platform === "darwin" ? "security" : "secret-tool";
  const result = platform === "darwin"
    ? run({ command, args: ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT] })
    : run({ command, args: ["clear", "service", KEYCHAIN_SERVICE, "account", KEYCHAIN_ACCOUNT] });
  if (result.status === 0 || isNotFound(result, platform)) return;
  throwIfFailed(result, command);
}
