import { spawnSync } from "node:child_process";
import { z } from "zod";

/** Login-keychain item that holds the whole mcpx secret map for this user. */
export const KEYCHAIN_SERVICE = "com.kwonye.mcpx";
export const KEYCHAIN_ACCOUNT = "secrets";
export const KEYCHAIN_LABEL = "mcpx secrets";

/**
 * `security -i` reads each command with readline() into a 4096-byte buffer
 * (SecurityTool `MAX_LINE_LEN`) and keeps at most 4095 bytes. A line of exactly
 * 4095 bytes leaves the trailing newline unread; the following empty command
 * succeeds and becomes the process exit status. 4094 leaves room for that newline.
 */
export const SECURITY_INTERACTIVE_MAX_LINE = 4094;

/** Upper bound on `secrets.1` … accounts used when one interactive line cannot hold the vault. */
const MAX_KEYCHAIN_CHUNKS = 256;
const CHUNK_MANIFEST_PREFIX = "mcpx-keychain-chunks:";

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

function chunkAccount(index: number): string {
  return `${KEYCHAIN_ACCOUNT}.${index}`;
}

function shellQuote(value: string): string {
  if (value.length === 0 || /['\\\r\n]/.test(value)) {
    throw new Error("The keychain secret payload could not be encoded for the security command.");
  }
  return `'${value}'`;
}

function assertAccountName(account: string): void {
  if (!/^[A-Za-z0-9.]+$/.test(account)) {
    throw new Error("Invalid keychain account name.");
  }
}

/** One `security -i` command. The password is inside the stdin line, never in argv. */
function darwinAddLine(account: string, password: string): string {
  assertAccountName(account);
  return `add-generic-password -s ${KEYCHAIN_SERVICE} -a ${account} -l ${shellQuote(KEYCHAIN_LABEL)} -U -w ${shellQuote(password)}`;
}

function maxDarwinPasswordLength(account: string): number {
  // `shellQuote("x")` contributes the password character plus two quotes.
  const overhead = darwinAddLine(account, "x").length - 1;
  return SECURITY_INTERACTIVE_MAX_LINE - overhead;
}

const CHUNK_PASSWORD_LIMIT = maxDarwinPasswordLength(chunkAccount(MAX_KEYCHAIN_CHUNKS));

function chunkCount(stored: string): number | null {
  if (!stored.startsWith(CHUNK_MANIFEST_PREFIX)) return null;
  const raw = stored.slice(CHUNK_MANIFEST_PREFIX.length);
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1 || count > MAX_KEYCHAIN_CHUNKS) return null;
  return count;
}

function splitPayload(payload: string): string[] {
  const primaryLimit = maxDarwinPasswordLength(KEYCHAIN_ACCOUNT);
  if (payload.length <= primaryLimit) return [payload];
  if (CHUNK_PASSWORD_LIMIT < 1) {
    throw new Error("The macOS security command cannot accept a keychain password on standard input.");
  }
  const chunks: string[] = [];
  for (let offset = 0; offset < payload.length; offset += CHUNK_PASSWORD_LIMIT) {
    chunks.push(payload.slice(offset, offset + CHUNK_PASSWORD_LIMIT));
  }
  if (chunks.length > MAX_KEYCHAIN_CHUNKS) {
    throw new Error(`The keychain secret payload is too large (${payload.length} characters) to store with the macOS security command.`);
  }
  return chunks;
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

function readDarwinItem(account: string): string | null {
  const result = run({
    command: "security",
    args: ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"]
  });
  if (isNotFound(result, "darwin")) return null;
  throwIfFailed(result, "security");
  return result.stdout.trim();
}

/** Raw base64 payload, or null when the primary item is absent. */
function readDarwinPayload(): string | null {
  const primary = readDarwinItem(KEYCHAIN_ACCOUNT);
  if (primary === null) return null;
  const count = chunkCount(primary);
  if (count === null) return primary;
  let payload = "";
  for (let index = 1; index <= count; index++) {
    const part = readDarwinItem(chunkAccount(index));
    if (!part) throw new Error("The keychain secret payload could not be read. Refusing to change it.");
    payload += part;
  }
  return payload;
}

function runSecurityLine(line: string): void {
  if (line.includes("\n") || line.length > SECURITY_INTERACTIVE_MAX_LINE) {
    throw new Error("Refusing to send a keychain command that the macOS security tool would truncate.");
  }
  const result = run({ command: "security", args: ["-i"], input: `${line}\n` });
  throwIfFailed(result, "security");
}

function deleteDarwinAccount(account: string): "deleted" | "missing" {
  const result = run({
    command: "security",
    args: ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account]
  });
  if (isNotFound(result, "darwin")) return "missing";
  throwIfFailed(result, "security");
  return "deleted";
}

function deleteExtraChunks(firstIndex: number): void {
  for (let index = firstIndex; index <= MAX_KEYCHAIN_CHUNKS; index++) {
    if (deleteDarwinAccount(chunkAccount(index)) === "missing") return;
  }
}

function clearDarwinItems(): void {
  deleteDarwinAccount(KEYCHAIN_ACCOUNT);
  deleteExtraChunks(1);
}

/**
 * `security add-generic-password -w <secret>` puts the secret in argv, where
 * `ps` can read it. `-w` with no value prompts through getpass(), which reads
 * `/dev/tty` (so a pipe is ignored whenever a terminal exists) and keeps only
 * `_PASSWORD_LEN` (128) characters. `security -i` reads the whole command from
 * the stdin pipe instead. A vault that does not fit on one line is split across
 * `secrets.1` … and the primary item stores only the chunk count.
 */
function writeDarwinPayload(payload: string): void {
  const chunks = splitPayload(payload);
  if (chunks.length === 1) {
    const only = chunks[0];
    if (only === undefined) throw new Error("The keychain secret payload could not be encoded for the security command.");
    runSecurityLine(darwinAddLine(KEYCHAIN_ACCOUNT, only));
    deleteExtraChunks(1);
    return;
  }
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    if (chunk === undefined) throw new Error("The keychain secret payload could not be encoded for the security command.");
    runSecurityLine(darwinAddLine(chunkAccount(index + 1), chunk));
  }
  runSecurityLine(darwinAddLine(KEYCHAIN_ACCOUNT, `${CHUNK_MANIFEST_PREFIX}${chunks.length}`));
  deleteExtraChunks(chunks.length + 1);
}

function writeDarwinSecrets(payload: string): void {
  if (payload.length <= maxDarwinPasswordLength(KEYCHAIN_ACCOUNT)) {
    writeDarwinPayload(payload);
    return;
  }
  const backup = readDarwinPayload();
  try {
    writeDarwinPayload(payload);
  } catch (err) {
    try {
      if (backup === null) clearDarwinItems();
      else writeDarwinPayload(backup);
    } catch (restoreErr) {
      const detail = restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
      throw new Error(`Keychain write failed and the previous keychain copy could not be restored: ${detail}`);
    }
    throw err;
  }
}

export function readKeychainSecrets(): Record<string, string> {
  const platform = currentPlatform();
  assertKeychainSupported(platform);
  if (platform === "darwin") {
    const payload = readDarwinPayload();
    if (payload === null) return {};
    return decodePayload(payload);
  }
  const result = run({ command: "secret-tool", args: ["lookup", "service", KEYCHAIN_SERVICE, "account", KEYCHAIN_ACCOUNT] });
  if (isNotFound(result, platform)) return {};
  throwIfFailed(result, "secret-tool");
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
  if (platform === "darwin") {
    writeDarwinSecrets(payload);
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
  if (platform === "darwin") {
    clearDarwinItems();
    return;
  }
  const result = run({ command: "secret-tool", args: ["clear", "service", KEYCHAIN_SERVICE, "account", KEYCHAIN_ACCOUNT] });
  if (result.status === 0 || isNotFound(result, platform)) return;
  throwIfFailed(result, "secret-tool");
}
