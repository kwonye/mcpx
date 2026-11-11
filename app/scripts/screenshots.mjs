#!/usr/bin/env node
// Renders every renderer screen in headless Chromium against a stubbed
// window.mcpx and writes PNGs (deviceScaleFactor 2) to docs/screenshots/.
//
//   bun run build        # produces out/renderer
//   node scripts/screenshots.mjs [--only servers] [--out docs/screenshots]
//
// No Electron, no real config: the stub below serves the fixtures in
// screenshot-fixtures.mjs.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as fx from "./screenshot-fixtures.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rendererRoot = join(appRoot, "out", "renderer");
const args = process.argv.slice(2);
const outDir = resolve(appRoot, args.includes("--out") ? args[args.indexOf("--out") + 1] : "docs/screenshots");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

if (!existsSync(join(rendererRoot, "index.html"))) {
  console.error("out/renderer is missing. Run `bun run build` first.");
  process.exit(1);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://x").pathname);
  const file = join(rendererRoot, path === "/" ? "index.html" : path);
  try {
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

/** Runs in the page before any renderer code. Must be self-contained. */
function installStub({ platform, data }) {
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  const ok = (value) => async () => value;
  const listeners = new Set();
  window.mcpx = {
    platform,
    app: {
      openDashboard: ok(undefined),
      quit: ok(undefined),
      onNavigate: (callback) => {
        listeners.add(callback);
        if (data.route) setTimeout(() => callback(data.route), 0);
        return () => listeners.delete(callback);
      },
      selectDirectory: ok("/Users/ana/src/api"),
      checkForUpdates: ok({ status: "up-to-date", message: "You're on the latest version." })
    },
    status: {
      get: async () => { if (data.slowStatus) await wait(60_000); return data.status; },
      tokenCounts: async () => { if (data.slowTokens) await wait(60_000); return data.tokens; },
      syncAll: ok({ results: [], hasErrors: false })
    },
    gateway: { start: ok({}), stop: ok({ stopped: true }), restart: ok({}) },
    management: {
      snapshot: ok(data.snapshot),
      planAdoption: ok(data.plan),
      applyAdoption: ok({}),
      rollback: ok({}),
      setHarnessMode: ok({}),
      onChange: () => () => {}
    },
    secrets: { backend: ok("file"), setBackend: ok({ backend: "keychain", changed: true, migrated: [], preserved: [] }) },
    settings: { get: ok({ autoUpdateEnabled: true, startOnLoginEnabled: true, errorNotificationsEnabled: true, activeTab: "servers" }), update: async (patch) => ({ autoUpdateEnabled: true, startOnLoginEnabled: true, errorNotificationsEnabled: true, ...patch }) },
    telemetry: { status: ok(data.telemetry), acknowledge: ok({}), updatePreferences: ok({}), resetId: ok({}), captureTabViewed: ok(undefined), onChanged: () => () => {} },
    servers: {
      parseInput: ok({ kind: "client-command", name: "notion", spec: { transport: "http", url: "https://mcp.notion.com/mcp", headers: { "Notion-Version": "2022-06-28" } } }),
      add: ok({ added: "notion", sync: { results: [] }, authRequired: true, oauthSupport: "supported" }),
      update: ok({}), remove: ok({}), setEnabled: ok({})
    },
    auth: {
      configure: ok({}), pending: ok(data.pending), onPendingChanged: () => () => {}, request: ok({}), dismiss: ok({}),
      checkOAuthSupport: ok({ support: "supported" }), startOAuth: () => new Promise(() => {}), cancelOAuth: ok({}), reopenOAuth: ok({}), onOAuthProgress: () => () => {}
    },
    projects: { add: ok({}), remove: ok({}), setServerEnabled: ok({}) },
    skills: { list: ok(data.skills), save: ok({}), delete: ok({}), install: ok({}), customize: ok({}), pin: ok({}), unpin: ok({}), update: ok({}), rollback: ok({}) },
    share: { export: ok({}), import: ok({ importedSkills: ["release-notes"], importedPlugins: ["superpowers"], importedServers: ["github", "linear"], missingInputs: ["LINEAR_API_KEY"] }) },
    plugins: { list: ok(data.plugins), install: ok({}), update: ok({}), pin: ok({}), unpin: ok({}), rollback: ok({}), uninstall: ok({}), enable: ok({}), disable: ok({}), approve: ok({}), setProjectOverride: ok({}), resetProjectOverride: ok({}) },
    marketplaces: { list: ok(data.marketplaces), add: ok({}), refresh: ok({ updated: [], errors: [] }), remove: ok({}), setAutoUpdate: ok({}), browse: ok(data.listings), inspect: async (id) => ({ ...data.listings.find((entry) => entry.id === id), manifest: null, discovered: { skills: [], commands: [], agents: [], hooks: [], mcpServers: [] } }), install: ok({}) }
  };
}

function dataFor(scenario = {}) {
  const empty = Boolean(scenario.empty);
  return {
    route: scenario.route ?? null,
    status: fx.statusReport({ empty, running: scenario.running ?? true }),
    tokens: empty ? { gatewayRunning: true, counts: {}, totalGlobalTokens: 0, totalProjectTokens: {} } : fx.tokenCounts,
    snapshot: fx.managementSnapshot({ empty }),
    plan: fx.adoptionPlan,
    pending: empty ? [] : [{ serverName: "linear", oauthSupport: "supported", status: 401 }],
    skills: empty ? [] : fx.skills,
    plugins: empty ? [] : fx.plugins,
    marketplaces: fx.marketplaces,
    listings: fx.listings,
    telemetry: fx.telemetry(!scenario.firstRun),
    slowStatus: Boolean(scenario.slowStatus),
    slowTokens: Boolean(scenario.slowTokens)
  };
}

const nav = (label) => async (page) => page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: label }).click();
const tab = (route, label) => async (page) => { await nav(route)(page); await page.getByRole("tab", { name: new RegExp(`^${label}`) }).click(); };

const SCREENS = [
  { name: "servers", run: nav("Servers") },
  { name: "servers-loading", scenario: { slowStatus: true }, run: async () => {} },
  { name: "servers-empty", scenario: { empty: true, firstRun: true }, run: async () => {} },
  { name: "server-detail", run: async (page) => page.getByRole("button", { name: /^postgres,/ }).click() },
  { name: "add-server", run: async (page) => page.getByRole("button", { name: "Add server" }).first().click() },
  { name: "add-server-details", run: async (page) => { await page.getByRole("button", { name: "Add server" }).first().click(); await page.getByRole("textbox", { name: "URL or command" }).fill("claude mcp add --transport http notion https://mcp.notion.com/mcp"); await page.getByRole("button", { name: "Continue" }).click(); } },
  { name: "sign-in", run: async (page) => page.getByRole("button", { name: "Sign in", exact: true }).first().click() },
  { name: "clients", run: nav("Clients") },
  { name: "clients-adoption", run: async (page) => { await nav("Clients")(page); await page.getByRole("button", { name: "Find existing setups" }).click(); } },
  { name: "addons-installed", run: nav("Add-ons") },
  { name: "addons-plugin-detail", run: async (page) => { await nav("Add-ons")(page); await page.getByRole("button", { name: "playwright details" }).click(); } },
  { name: "addons-discover", run: tab("Add-ons", "Discover") },
  { name: "addons-skills", run: tab("Add-ons", "Skills") },
  { name: "addons-sources", run: tab("Add-ons", "Sources") },
  { name: "addons-share", run: async (page) => { await nav("Add-ons")(page); await page.getByRole("button", { name: "Import / export environment" }).click(); } },
  { name: "projects", run: nav("Projects") },
  { name: "settings", run: nav("Settings") },
  { name: "first-run", scenario: { firstRun: true }, run: async (page) => page.getByRole("button", { name: "Choose…" }).click() }
];

const POPOVER = [
  { name: "popover", scenario: {} },
  { name: "popover-empty", scenario: { empty: true } }
];

const PLATFORMS = { darwin: "mac", win32: "windows", linux: "linux" };
const THEMES = ["light", "dark"];

const browser = await chromium.launch();
await mkdir(outDir, { recursive: true });
let count = 0;

async function shoot({ name, platform, theme, scenario, run, popover }) {
  const context = await browser.newContext({
    viewport: popover ? { width: 380, height: 520 } : { width: 1100, height: 720 },
    deviceScaleFactor: 2,
    colorScheme: theme,
    reducedMotion: "reduce"
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(`[${name}] page error:`, error.message));
  await page.addInitScript(installStub, { platform, data: dataFor(scenario) });
  await page.goto(`${base}#${popover ? "popover" : "dashboard"}`);
  await page.waitForTimeout(250);
  if (run) await run(page);
  await page.waitForTimeout(350);
  const file = join(outDir, `${name}--${PLATFORMS[platform]}-${theme}.png`);
  await page.screenshot({ path: file });
  await context.close();
  count += 1;
}

for (const theme of THEMES) {
  for (const platform of Object.keys(PLATFORMS)) {
    for (const screen of SCREENS) {
      if (only && !screen.name.startsWith(only)) continue;
      // Every screen on macOS; window chrome variants on the main screen only.
      if (platform !== "darwin" && !["servers", "server-detail", "add-server"].includes(screen.name)) continue;
      await shoot({ ...screen, platform, theme });
    }
    if (platform === "darwin") {
      for (const screen of POPOVER) {
        if (only && !screen.name.startsWith(only)) continue;
        await shoot({ ...screen, platform, theme, popover: true });
      }
    }
  }
}

await browser.close();
server.close();
console.log(`Wrote ${count} screenshots to ${outDir}`);
