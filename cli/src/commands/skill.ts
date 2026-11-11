import type { Command } from "commander";
import { loadConfig } from "../core/config.js";
import { mutateConfig } from "../core/config-store.js";
import { listSkills, getSkill, saveSkill, deleteSkill, customizeSkill, installSkillFromSource, pinSkill, unpinSkill, updateSkill, rollbackSkill } from "../core/skills.js";
import { SecretsManager } from "../core/secrets.js";
import { synchronizeClients } from "../core/sync.js";
import { captureTelemetryEvent, durationBucket } from "../core/telemetry.js";
import { ensureExitCodeForSyncFailures, type CommandContext } from "./shared.js";
import { recordTelemetryOperationFailure } from "./telemetry-support.js";

export function registerSkill(program: Command, _ctx: CommandContext): void {
  const skill = program.command("skill").description("Manage shared agent skills");

  skill
    .command("ls")
    .description("List all skills")
    .action(() => {
      const skills = listSkills();
      if (skills.length === 0) {
        process.stdout.write("No skills found.\n");
        return;
      }
      for (const s of skills) {
        process.stdout.write(`- ${s.id}\n`);
      }
    });

  skill
    .command("add <id>")
    .description("Add a new skill")
    .action(async (id: string) => {
      const startedAt = Date.now();
      const existing = getSkill(id);
      if (existing) {
        process.stderr.write(`Skill "${id}" already exists.\n`);
        recordTelemetryOperationFailure("skill_add", { code: "validation_error" }, startedAt);
        process.exitCode = 1;
        return;
      }
      saveSkill(id, `---\nname: ${id}\ndescription: Instructions for using ${id}.\n---\n\nAdd your instructions here.`);
      const summary = await synchronizeClients();
      ensureExitCodeForSyncFailures(summary.hasErrors);
      process.stdout.write(`Skill "${id}" created.\n`);
      captureTelemetryEvent({
        name: "operation_completed",
        properties: { operation: "skill_add", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
      });
    });

  skill
    .command("rm <id>")
    .description("Remove a skill")
    .action(async (id: string) => {
      const startedAt = Date.now();
      if (!getSkill(id)) {
        process.stderr.write(`Skill "${id}" not found.\n`);
        recordTelemetryOperationFailure("skill_remove", { code: "validation_error" }, startedAt);
        process.exitCode = 1;
        return;
      }
      deleteSkill(id);
      const summary = await synchronizeClients();
      ensureExitCodeForSyncFailures(summary.hasErrors);
      process.stdout.write(`Skill "${id}" removed.\n`);
      captureTelemetryEvent({
        name: "operation_completed",
        properties: { operation: "skill_remove", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
      });
    });

  skill
    .command("customize <id>")
    .option("--name <name>", "Name for the authored copy")
    .description("Create an editable authored copy of an installed skill")
    .action((id: string, options: { name?: string }) => {
      const customized = customizeSkill(id, options.name ?? id);
      process.stdout.write(`Skill "${customized.id}" is now editable.\n`);
    });

  skill
    .command("install <source>")
    .option("--skill <name>", "Skill directory name when a source contains multiple skills")
    .description("Install an Agent Skill package from a local, Git, GitHub, or npm source")
    .action(async (source: string, options: { skill?: string }) => {
      try {
        const installed = await installSkillFromSource(source, options.skill);
        const summary = await synchronizeClients();
        ensureExitCodeForSyncFailures(summary.hasErrors);
        process.stdout.write(`Skill installed: ${installed.id}\n`);
      } catch (error) {
        process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    });

  skill.command("pin <id>").description("Pin an installed skill at its current revision").action((id: string) => { pinSkill(id); process.stdout.write(`Skill pinned: ${id}\n`); });
  skill.command("unpin <id>").description("Allow an installed skill to update").action((id: string) => { unpinSkill(id); process.stdout.write(`Skill unpinned: ${id}\n`); });
  skill.command("update <id>").description("Update an installed skill from its source").action(async (id: string) => { const skill = await updateSkill(id); const summary = await synchronizeClients(); ensureExitCodeForSyncFailures(summary.hasErrors); process.stdout.write(`Skill updated: ${skill.id}\n`); });
  skill.command("rollback <id>").description("Restore the previous installed skill revision").action(async (id: string) => { const skill = rollbackSkill(id); const summary = await synchronizeClients(); ensureExitCodeForSyncFailures(summary.hasErrors); process.stdout.write(`Skill rolled back: ${skill.id}\n`); });
}
