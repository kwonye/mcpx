import { emitKeypressEvents } from "node:readline";
import { controlRequest, ensureControlService, subscribeControlEvents } from "./control.js";
import type { ManagementSnapshot } from "./management.js";
import type { AdoptionPlan } from "./adoption.js";

const views = ["Overview", "Harnesses", "Library", "Projects", "Activity"];
const color = { muted: "\x1b[90m", accent: "\x1b[36m", green: "\x1b[32m", reset: "\x1b[0m", bold: "\x1b[1m", selected: "\x1b[7m" };
type TuiRow = { title: string; state: string; detail: string };
interface TuiFrameOptions {
  width: number;
  height: number;
  revision: number;
  view: number;
  summary: string;
  rows: TuiRow[];
  selection: number;
  details: string[];
  status: string;
}

export function renderManagementTuiFrame(frame: TuiFrameOptions): string {
  const width = Math.max(1, frame.width), height = Math.max(1, frame.height);
  const compact = width < 76;
  const clip = (text: string, n: number) => {
    n = Math.max(1, n);
    return text.length > n ? text.slice(0, n - 1) + "…" : text.padEnd(n);
  };
  const lines: string[] = [];
  const indent = width > 1 ? "  " : "";
  const header = width < 44
    ? `${color.bold}${color.accent}${clip(`mcpx · r${frame.revision}`, width)}${color.reset}`
    : `${color.bold}${color.accent}  mcpx${color.reset}  ${color.green}● Connected${color.reset}   ${color.muted}revision ${frame.revision}${color.reset}`;
  lines.push(header);
  lines.push("");

  if (width < 35) {
    lines.push(`${color.bold}${color.accent}${clip(`${indent}${frame.view + 1} ${views[frame.view] ?? ""}`, width)}${color.reset}`);
  } else {
  const labels = width < 54 ? ["Home", "Apps", "Lib", "Proj", "Log"] : compact ? ["Overview", "Harness", "Library", "Projects", "Activity"] : views;
  const nav = labels.map((label, i) => {
    const text = `${i + 1} ${label}`;
    return i === frame.view ? `${color.bold}${color.accent}${text}${color.reset}` : `${color.muted}${text}${color.reset}`;
  }).join(compact ? " " : "   ");
  lines.push(`${indent}${nav}`);
  }
  lines.push(color.muted + "─".repeat(width) + color.reset);
  lines.push(clip(`${indent}${frame.summary}`, width));

  const bodyHeight = Math.max(0, height - 8);
  if (compact) {
    const detailCount = Math.min(frame.details.length, Math.max(0, bodyHeight - 2));
    const dividerCount = detailCount > 0 ? 1 : 0;
    const listCount = Math.max(0, bodyHeight - detailCount - dividerCount);
    const offset = Math.max(0, frame.selection - listCount + 1);
    for (let i = 0; i < listCount; i++) {
      const row = frame.rows[i + offset];
      const text = row ? `${i + offset === frame.selection ? "›" : " "} ${row.title} · ${row.state}` : "";
      lines.push(clip(`${indent}${text}`, width));
    }
    if (dividerCount) lines.push(color.muted + "─".repeat(width) + color.reset);
    for (let i = 0; i < detailCount; i++) lines.push(clip(`${indent}${frame.details[i] ?? ""}`, width));
  } else {
    const left = Math.floor(width * .52);
    const offset = Math.max(0, frame.selection - bodyHeight + 1);
    for (let i = 0; i < bodyHeight; i++) {
      const row = frame.rows[i + offset];
      const title = row ? clip(row.title, Math.max(10, left - 20)) + clip(row.state, 15) : "";
      lines.push(`${row && i + offset === frame.selection ? color.selected : ""}${indent}${clip(title, left - 3)}${color.reset}${color.muted}│${color.reset}${indent}${clip(frame.details[i] ?? "", width - left - 3)}`);
    }
  }

  lines.push(color.muted + "─".repeat(width) + color.reset);
  lines.push(clip(`${indent}${frame.status}`, width));
  const footer = compact ? "/ search  a adopt  s sync  u undo  ? help  q quit" : "/ Search   a Adopt   s Sync   u Undo   ? Help   q Quit";
  lines.push(`${color.muted}${clip(`${indent}${footer}`, width)}${color.reset}`);
  return "\x1b[H" + lines.map(line => line + "\x1b[K").join("\n") + "\x1b[J";
}

export async function runManagementTui(cliPath: string): Promise<void> {
  await ensureControlService(cliPath);
  if (!process.stdin.isTTY || !process.stdout.isTTY) { process.stdout.write(JSON.stringify(await controlRequest("snapshot"), null, 2) + "\n"); return; }
  let data = await controlRequest<ManagementSnapshot>("snapshot");
  let view = 0, selection = 0, search = "", searching = false, busy = false, message = "All integrations, one place.";
  let plan: AdoptionPlan | undefined;
  let help = false, finished = false;
  const chosen = new Set<string>();
  function rows(): Array<{ id: string; title: string; state: string; detail: string; serverName?: string }> {
    if (plan) return plan.items.map(item => ({ id: item.id, title: `${chosen.has(item.id) ? "☑" : "☐"} ${item.name}`, state: item.action, detail: `${item.harness} · ${item.kind}\n${item.path}\n${item.reason ?? "Native installation → mcpx managed"}\n${item.reload}` }));
    if (view === 1 || view === 3) return data.harnesses.filter(h => view !== 3 || h.scope === "project").map(h => ({ id: h.id, title: h.label, state: h.mode, detail: `${h.scope} · ${h.detected ? "Detected" : "Not detected"}\n${h.configPath ?? "No config"}\n${h.components.join(" · ")}\n${h.reload}` }));
    if (view === 4) return data.operations.map(op => ({ id: op.id, title: op.label, state: op.phase, detail: `${new Date(op.startedAt).toLocaleString()}\n${op.message ?? ""}\n${Math.round(op.progress * 100)}%\n${op.id}` }));
    return [...data.servers.map(s => ({ id: s.name, serverName: s.name, title: s.name, state: s.enabled ? "Enabled" : "Disabled", detail: `MCP · ${s.transport}\n${s.scope ?? "All projects"}` })), ...data.skills.map(s => ({ id: s.id, title: s.id, state: "Skill", detail: s.source ?? "Authored" })), ...data.plugins.map(p => ({ id: p.id, title: p.name, state: "Plugin", detail: `${p.version} · ${p.status}` })), ...data.packages.map(p => ({ id: p.id, title: p.id, state: "Package", detail: `${p.harness}\n${p.root}` }))];
  }
  function filtered() { return rows().filter(row => `${row.title} ${row.state}`.toLowerCase().includes(search.toLowerCase())); }
  function draw() {
    if (finished) return;
    const list = filtered();
    selection = Math.min(Math.max(0, selection), Math.max(0, list.length - 1));
    const selected = list[selection];
    const details = (help ? "↑/↓ select · 1–5 views\na scan native installations\ns sync managed integrations\nm cycle selected harness mode\nu undo selected operation\ne toggle selected MCP server\n/ search · Esc back · q quit" : selected?.detail ?? "Install integrations in a harness, then press a to discover them.").split("\n");
    process.stdout.write(renderManagementTuiFrame({
      width: process.stdout.columns || 100,
      height: process.stdout.rows || 24,
      revision: data.revision,
      view,
      summary: plan ? "Review adoption · Space selects · Enter applies" : `${data.servers.length} MCPs · ${data.skills.length} skills · ${data.harnesses.filter(h => h.detected).length} harnesses`,
      rows: list,
      selection,
      details,
      status: searching ? `Search: ${search}▏` : busy ? "Working…" : message
    }));
  }
  async function refresh() { data = await controlRequest<ManagementSnapshot>("snapshot"); draw(); }
  async function action(work: () => Promise<void>) {
    if (busy) return;
    busy = true; draw();
    try { await work(); await refresh(); } catch (error) { message = (error as Error).message; }
    finally { busy = false; draw(); }
  }
  const stopEvents = subscribeControlEvents(() => { void refresh().catch(error => { message = error.message; draw(); }); }, error => { message = `Disconnected: ${error.message}. Press r to retry.`; draw(); });
  process.stdout.write("\x1b[?1049h\x1b[?25l");
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  draw();
  await new Promise<void>(resolve => {
    function cleanup() {
      finished = true;
      stopEvents(); process.stdin.off("keypress", key); process.stdout.off("resize", draw);
      process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write("\x1b[?25h\x1b[?1049l"); resolve();
    }
    function key(text: string, event: { name?: string; ctrl?: boolean }) {
      if (event.ctrl && event.name === "c") return cleanup();
      if (searching) { if (event.name === "escape" || event.name === "return") searching = false; else if (event.name === "backspace") search = search.slice(0, -1); else if (text && !event.ctrl) search += text; selection = 0; draw(); return; }
      if (text === "q") return cleanup();
      if (event.name === "up") selection--;
      else if (event.name === "down") selection++;
      else if (/^[1-5]$/.test(text ?? "")) { view = Number(text) - 1; selection = 0; plan = undefined; search = ""; }
      else if (text === "/") searching = true;
      else if (text === "?") help = !help;
      else if (event.name === "escape") { plan = undefined; search = ""; }
      else if (text === "r") void action(refresh);
      else if (text === "a") void action(async () => { plan = await controlRequest<AdoptionPlan>("adoption.plan", []); chosen.clear(); plan.items.filter(item => ["import", "reuse"].includes(item.action)).forEach(item => chosen.add(item.id)); selection = 0; message = `${plan.items.length} native integrations · ${plan.errors.length} diagnostics`; });
      else if (plan && text === " ") { const id = filtered()[selection]?.id; if (id) chosen.has(id) ? chosen.delete(id) : chosen.add(id); }
      else if (plan && event.name === "return") void action(async () => { await controlRequest("adoption.apply", [plan, Array.from(chosen)]); plan = undefined; message = "Adoption complete. Reload the affected harness sessions."; });
      else if (text === "s") void action(async () => { await controlRequest("sync", []); message = "Synchronization finished. Inspect Activity for details."; });
      else if (text === "u" && view === 4) void action(async () => { await controlRequest("operation.rollback", [filtered()[selection]?.id]); message = "Operation undone."; });
      else if (text === "m" && (view === 1 || view === 3)) void action(async () => { const harness = data.harnesses.find(h => h.id === filtered()[selection]?.id); if (harness) { const modes = ["observe", "selected", "automatic"]; await controlRequest("harness.mode", [harness.id, modes[(modes.indexOf(harness.mode) + 1) % 3]]); } });
      else if (text === "e" && !plan && (view === 0 || view === 2)) void action(async () => { const server = data.servers.find(s => s.name === filtered()[selection]?.serverName); if (server) await controlRequest("server.enabled", [server.name, !server.enabled]); });
      draw();
    }
    process.stdin.on("keypress", key); process.stdout.on("resize", draw);
  });
}
