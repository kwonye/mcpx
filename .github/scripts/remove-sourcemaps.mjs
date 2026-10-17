import fs from "node:fs";
import path from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  throw new Error("Usage: remove-sourcemaps.mjs <generated-directory> [...]");
}

function removeMaps(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      removeMaps(target);
    } else if (entry.name.endsWith(".map")) {
      fs.unlinkSync(target);
    }
  }
}

for (const root of roots) removeMaps(root);
