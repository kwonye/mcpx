/**
 * Integration control center: commands served by the daemon's management API
 * (harness installations, adoption, activity/undo, sync modes, TUI).
 */
import type { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { controlRequest, ensureControlService } from "../core/control.js";
import { runManagementTui } from "../core/tui.js";
import type { AdoptionPlan } from "../core/adoption.js";
import type { CommandContext } from "./shared.js";

export function registerManage(program: Command, { cliPath }: CommandContext): void {
  program.command("tui").description("Open the integration control center").action(() => runManagementTui(cliPath));

  program.command("harnesses").option("--json").description("Inspect harness installations and capabilities").action(async (options: { json?: boolean }) => {
    await ensureControlService(cliPath);
    const snapshot = await controlRequest<any>("snapshot");
    process.stdout.write(options.json ? JSON.stringify(snapshot.harnesses, null, 2) + "\n" : snapshot.harnesses.map((h: any) => `${h.label}  ${h.mode}  ${h.detected ? "detected" : "not detected"}  ${h.configPath ?? ""}`).join("\n") + "\n");
  });

  program.command("adopt")
    .option("--dry-run", "Only preview native ownership transfers")
    .option("--harness <id>", "Limit discovery to a harness installation")
    .option("--apply <plan>", "Apply a previously saved JSON plan")
    .option("--yes", "Apply supported discoveries")
    .option("--json")
    .description("Discover, preview, and adopt native integrations")
    .action(async (options: { dryRun?: boolean; harness?: string; apply?: string; yes?: boolean; json?: boolean }) => {
      await ensureControlService(cliPath);
      if (options.dryRun && (options.apply || options.yes)) throw new Error("--dry-run cannot be combined with --apply or --yes");
      const plan = options.apply ? JSON.parse(fs.readFileSync(path.resolve(options.apply), "utf8")) : await controlRequest<AdoptionPlan>("adoption.plan", [options.harness ? [options.harness] : undefined]);
      if (options.apply || options.yes) {
        const result = await controlRequest("adoption.apply", [plan]);
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else if (options.json) process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
      else {
        for (const item of plan.items) process.stdout.write(`${item.action.padEnd(12)} ${item.harness} · ${item.kind} · ${item.name}${item.reason ? ` — ${item.reason}` : ""}\n`);
        for (const error of plan.errors) process.stderr.write(error + "\n");
        process.stdout.write("Review with mcpx tui, or save --json output and apply it with --apply <plan>.\n");
      }
    });

  program.command("activity").option("--json").action(async (options: { json?: boolean }) => {
    await ensureControlService(cliPath);
    const snapshot = await controlRequest<any>("snapshot");
    process.stdout.write(options.json ? JSON.stringify(snapshot.operations, null, 2) + "\n" : snapshot.operations.map((op: any) => `${op.id}  ${op.phase}  ${op.label}`).join("\n") + "\n");
  });

  program.command("undo <id>").description("Undo an operation using its encrypted receipt").action(async (id: string) => {
    await ensureControlService(cliPath);
    process.stdout.write(JSON.stringify(await controlRequest("operation.rollback", [id]), null, 2) + "\n");
  });

  program.command("harness-mode <id> <mode>").description("Set observe, selected, or automatic synchronization").action(async (id: string, mode: string) => {
    await ensureControlService(cliPath);
    await controlRequest("harness.mode", [id, mode]);
  });
}

/** Top-level commands whose writes are serialized through a control-service lease. */
const MANAGED_ROOTS = new Set(["add", "remove", "enable", "disable", "sync", "skill", "plugin", "project", "secret", "auth", "share"]);

/**
 * Acquire a write lease from the control service for mutating commands, so CLI
 * writes queue behind (and are reported alongside) desktop and automatic work.
 * Returns the lease id, or undefined when no lease applies.
 */
export async function acquireCommandLease(argv: string[], cliPath: string): Promise<string | undefined> {
  if (!MANAGED_ROOTS.has(argv[2]) || argv.includes("--help") || argv.includes("--dry-run")) return undefined;
  if (process.env.MCPX_CONTROL_CHILD === "1" || process.env.MCPX_SKIP_DAEMON_AUTOSTART === "1") return undefined;
  await ensureControlService(cliPath);
  const lease = await controlRequest<string>("lease.acquire", [process.pid, argv[2]]);
  process.env.MCPX_CONTROL_CHILD = "1";
  return lease;
}

export async function releaseCommandLease(lease: string | undefined, succeeded: boolean): Promise<void> {
  if (!lease) return;
  delete process.env.MCPX_CONTROL_CHILD;
  await controlRequest("lease.release", [lease, succeeded]);
}
