import { spawnSync } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Every launchctl / systemctl / schtasks call goes through this, so tests can inject a fake. */
export type CommandRunner = (command: string, args: string[]) => RunResult;

export interface CommandRecord {
  command: string;
  args: string[];
  code: number;
  stderr?: string;
}

export const defaultCommandRunner: CommandRunner = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  return {
    code: result.status ?? (result.error ? 127 : 1),
    stdout: result.stdout ?? "",
    stderr: result.stderr || result.error?.message || ""
  };
};
