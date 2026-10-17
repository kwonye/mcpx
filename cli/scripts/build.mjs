import fs from "node:fs";

// Bundler chunks are generated artifacts; clear them so an earlier build with
// different public telemetry settings cannot remain in the package.
fs.rmSync("dist", { recursive: true, force: true });

const build = await Bun.build({
  entrypoints: ["src/cli.ts", "src/core/index.ts", "src/types.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  splitting: true,
  sourcemap: "external",
  external: ["commander", "hono", "zod", "@modelcontextprotocol/client", "@modelcontextprotocol/client/stdio", "@modelcontextprotocol/node", "@modelcontextprotocol/server", "@modelcontextprotocol/server/stdio", "@iarna/toml", "yaml"],
  define: {
    "process.env.MCPX_POSTHOG_PROJECT_TOKEN": JSON.stringify(process.env.MCPX_POSTHOG_PROJECT_TOKEN ?? ""),
    "process.env.POSTHOG_PROJECT_TOKEN": JSON.stringify(process.env.POSTHOG_PROJECT_TOKEN ?? ""),
    "process.env.MCPX_POSTHOG_HOST": JSON.stringify(process.env.MCPX_POSTHOG_HOST ?? ""),
    "process.env.POSTHOG_HOST": JSON.stringify(process.env.POSTHOG_HOST ?? ""),
    "process.env.MCPX_SENTRY_DSN": JSON.stringify(process.env.MCPX_SENTRY_DSN ?? ""),
    "process.env.SENTRY_DSN": JSON.stringify(process.env.SENTRY_DSN ?? ""),
    "process.env.MCPX_SENTRY_RELEASE": JSON.stringify(process.env.MCPX_SENTRY_RELEASE ?? "")
  }
});

if (!build.success) {
  for (const log of build.logs) console.error(log);
  process.exit(1);
}

const declarations = Bun.spawn(["bunx", "tsc", "-p", "tsconfig.json", "--emitDeclarationOnly", "--declaration", "--declarationMap"], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit"
});
if (await declarations.exited !== 0) process.exit(declarations.exitCode ?? 1);
