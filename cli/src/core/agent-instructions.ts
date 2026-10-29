import fs from "node:fs";
import path from "node:path";

/** Return applicable AGENTS.md files from broadest to nearest scope. */
export function readAgentInstructions(projectRoot: string, target = projectRoot): Array<{ path: string; content: string }> {
  const root = fs.realpathSync(projectRoot);
  if (!fs.statSync(root).isDirectory()) throw new Error("Project root must be a directory");
  const resolved = fs.realpathSync(target);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error("Instruction target is outside the project");
  let directory = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  const instructions: Array<{ path: string; content: string }> = [];
  while (true) {
    const file = path.join(directory, "AGENTS.md");
    if (fs.existsSync(file)) {
      const real = fs.realpathSync(file);
      if (real !== root && !real.startsWith(root + path.sep)) throw new Error("AGENTS.md link is outside the project");
      instructions.unshift({ path: file, content: fs.readFileSync(file, "utf8") });
    }
    if (directory === root) break;
    directory = path.dirname(directory);
  }
  return instructions;
}
