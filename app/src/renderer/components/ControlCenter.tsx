import { useEffect, useRef, useState } from "react";
import type { AdoptionPlan, HarnessInstallation, ManagementSnapshot } from "@mcpx/core";
import { useManagement } from "../hooks/useManagement";

export function AdoptionReview({ plan, busy, onClose, onApply }: { plan: AdoptionPlan; busy: boolean; onClose: () => void; onApply: (ids: string[]) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(() => new Set(plan.items.filter(item => ["import", "reuse"].includes(item.action)).map(item => item.id)));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="adoption-dialog" aria-labelledby="adoption-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="control-eyebrow">MAKE IT SHARED</div>
    <h2 id="adoption-title">Bring your integrations together</h2>
    <p className="control-subtitle">Review what mcpx will own. Your harnesses will use the managed installation, with an encrypted receipt available in Activity.</p>
    <div className="adoption-items">
      {plan.items.length === 0 && <div className="control-empty"><span className="material-symbols-outlined">check_circle</span><h3>You’re all caught up</h3><p>No supported native installations need adoption.</p></div>}
      {plan.items.map(item => <label key={item.id} className="adoption-item" data-blocked={!["import", "reuse"].includes(item.action)}>
        <input type="checkbox" aria-label={`Adopt ${item.name} from ${item.harness}`} disabled={busy || !["import", "reuse"].includes(item.action)} checked={selected.has(item.id)} onChange={() => setSelected(current => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })} />
        <div><div className="control-row-title">{item.name}<span className="control-chip">{item.kind}</span></div><div className="control-caption">{item.harness} · {item.action === "reuse" ? "Use existing managed copy" : item.action === "import" ? "Native → Managed" : item.action}</div><div className="control-path">{item.path}</div>{item.reason && <p className="control-diagnostic">{item.reason}</p>}</div>
      </label>)}
    </div>
    {plan.errors.length > 0 && <details className="control-diagnostics"><summary>{plan.errors.length} discovery diagnostics</summary>{plan.errors.map((error, index) => <p key={index}>{error}</p>)}</details>}
    <div className="adoption-footer"><span>{selected.size} selected</span><button className="control-button" disabled={busy} onClick={onClose}>Cancel</button><button className="control-button control-button--primary" disabled={busy || selected.size === 0} onClick={() => onApply(Array.from(selected))}>{busy ? "Adopting…" : "Adopt selected"}</button></div>
  </dialog>;
}

function HarnessCard({ harness, busy, onScan, onMode }: { harness: HarnessInstallation; busy: boolean; onScan: () => void; onMode: (mode: HarnessInstallation["mode"]) => void }) {
  return <article className="harness-card">
    <div className="harness-card-top"><span className="harness-monogram">{harness.harness.slice(0, 2).toUpperCase()}</span><span className="control-chip" data-state={harness.detected ? "ready" : "muted"}>{harness.detected ? "Detected" : "Not detected"}</span></div>
    <h3>{harness.label}</h3><p className="control-caption">{harness.scope === "project" ? "Project installation" : "Personal installation"}</p>
    <div className="control-path">{harness.configPath}</div>
    <div className="harness-capabilities">{harness.components.map(component => <span key={component}>{component === "mcp" ? "MCP servers" : "Skills"}</span>)}</div>
    <label className="harness-mode">Synchronization<select aria-label={`Sync mode for ${harness.label}`} value={harness.mode} disabled={busy} onChange={event => onMode(event.target.value as HarnessInstallation["mode"])}><option value="observe">Observe only</option><option value="selected">Manage selected</option><option value="automatic">Automatically adopt</option></select></label>
    <button className="control-button harness-scan" disabled={busy || !harness.detected} onClick={onScan}>Review native installations<span aria-hidden="true">↗</span></button>
  </article>;
}

export function ControlCenter({ view, onChanged }: { view: "overview" | "harnesses" | "activity"; onChanged?: () => void }) {
  const { snapshot, error, loading, refresh } = useManagement();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [plan, setPlan] = useState<AdoptionPlan | null>(null);
  const [query, setQuery] = useState("");
  const [showUndetected, setShowUndetected] = useState(false);
  const [undo, setUndo] = useState<string | null>(null);
  async function perform(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setFailure(null); setMessage(null);
    try { await work(); await refresh(); onChanged?.(); }
    catch (error) { setFailure(error instanceof Error ? error.message : "Operation failed"); }
    finally { setBusy(false); }
  }
  const scan = (targets?: string[]) => { void perform(async () => { setPlan(await window.mcpx.management.plan(targets)); }); };
  const title = view === "overview" ? "Everything, connected." : view === "harnesses" ? "Your coding harnesses" : "A clear history of changes";
  if (!snapshot && loading) return <div className="control-empty" role="status">Connecting to your local gateway…</div>;
  if (!snapshot) return <div className="control-empty" role="alert"><h2>Couldn’t reach mcpx</h2><p>{error}</p><button className="control-button" onClick={() => void refresh()}>Try again</button></div>;
  const detected = snapshot.harnesses.filter(h => h.detected);
  const attention = snapshot.operations.filter(operation => ["failed", "recovery-required"].includes(operation.phase));
  const operations = snapshot.operations.filter(op => `${op.label} ${op.phase}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="control-center">
    <div className="control-header"><div><div className="control-eyebrow">YOUR LOCAL CONTROL CENTER</div><h1>{title}</h1><p className="control-subtitle">{view === "overview" ? "Install once. Keep your tools and workflows together across every agent." : view === "harnesses" ? "Choose what mcpx manages, and see where each integration lives." : "Inspect progress, recover interrupted work, and undo an adoption."}</p></div><button className="control-button control-button--primary" disabled={busy} onClick={() => scan()}><span className="material-symbols-outlined">radar</span>{busy ? "Working…" : "Scan existing installs"}</button></div>
    {(error || failure) && <div className="control-notice control-notice--error" role="alert">{failure ?? error}{error && <button onClick={() => void refresh()}>Retry connection</button>}</div>}
    {message && <div className="control-notice" role="status">{message}</div>}
    {view === "overview" && <>
      <div className="control-metrics">{[[snapshot.servers.length, "MCP servers", "hub"], [snapshot.skills.length, "Shared skills", "auto_awesome"], [detected.length, "Harnesses detected", "terminal"], [attention.length, "Need attention", "notifications"]].map(([count, label, icon]) => <div className="control-metric" key={String(label)}><span className="material-symbols-outlined">{icon}</span><strong>{count}</strong><span>{label}</span></div>)}</div>
      <div className="control-feature"><div className="control-feature-icon"><span className="material-symbols-outlined">conversion_path</span></div><div><h2>Already installed somewhere?</h2><p>Bring native MCP servers, skills, and supported packages into mcpx. Review the transfer, keep your settings, and share one managed installation.</p><button className="control-link" disabled={busy} onClick={() => scan()}>Find integrations to consolidate →</button></div></div>
      <div className="control-section-heading"><h2>Connected harnesses</h2><button className="control-button" disabled={busy} onClick={() => void perform(async () => { const result = await window.mcpx.management.sync(); setMessage(result.hasErrors ? "Sync finished with issues. Review harness status and diagnostics." : "Managed integrations are synchronized. Reload affected harness sessions."); })}>Sync managed integrations</button></div>
      <div className="harness-grid">{detected.slice(0, 4).map(harness => <HarnessCard key={harness.id} harness={harness} busy={busy} onScan={() => scan([harness.id])} onMode={mode => void perform(async () => { await window.mcpx.management.mode(harness.id, mode); })} />)}</div>
      {detected.length === 0 && <div className="control-empty"><h3>Your next agent belongs here</h3><p>Install or configure a supported coding harness, then scan to bring its integrations together.</p></div>}
    </>}
    {view === "harnesses" && <><div className="control-toolbar"><input className="control-search" type="search" placeholder="Find a harness or project…" aria-label="Search harnesses" value={query} onChange={event => setQuery(event.target.value)} /><label><input type="checkbox" checked={showUndetected} onChange={event => setShowUndetected(event.target.checked)} /> Show undetected</label></div><div className="harness-grid">{snapshot.harnesses.filter(h => (showUndetected || h.detected) && h.label.toLowerCase().includes(query.toLowerCase())).map(harness => <HarnessCard key={harness.id} harness={harness} busy={busy} onScan={() => scan([harness.id])} onMode={mode => void perform(async () => { await window.mcpx.management.mode(harness.id, mode); setMessage(mode === "automatic" ? "Supported, unambiguous native installs will be adopted automatically. Conflicts stay available for review." : "Synchronization preference saved."); })} />)}</div></>}
    {view === "activity" && <><input className="control-search" type="search" placeholder="Find an operation…" aria-label="Search activity" value={query} onChange={event => setQuery(event.target.value)} /><div className="activity-list">{operations.map(operation => <article className="activity-row" key={operation.id}><span className="activity-dot" data-phase={operation.phase} /><div><div className="control-row-title">{operation.label}<span className="control-chip" data-state={operation.phase === "complete" ? "ready" : "muted"}>{operation.phase.replace(/-/g, " ")}</span></div><p className="control-caption">{new Date(operation.startedAt).toLocaleString()}</p>{operation.details && <ul className="control-caption">{operation.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul>}{operation.message && <p>{operation.message}</p>}{operation.phase === "applying" && <progress aria-label="Operation progress" max="1" value={operation.progress} />}</div>{operation.undoable && ["complete", "recovery-required"].includes(operation.phase) && <button className="control-button" disabled={busy} onClick={() => setUndo(operation.id)}>{operation.phase === "recovery-required" ? "Recover" : "Undo"}</button>}</article>)}</div>{operations.length === 0 && <div className="control-empty"><h3>A fresh start</h3><p>Your changes and adoption receipts will appear here.</p></div>}</>}
    <div className="control-footnote">Local service · revision {snapshot.revision} · updated {new Date(snapshot.capturedAt).toLocaleTimeString()}</div>
    {plan && <AdoptionReview key={plan.id} plan={plan} busy={busy} onClose={() => setPlan(null)} onApply={ids => void perform(async () => { await window.mcpx.management.apply(plan, ids); setPlan(null); setMessage("Adoption complete. Reload the affected harness sessions to use the managed installation."); })} />}
    {undo && <div className="control-undo" role="alertdialog" aria-label="Undo operation"><p>Restore the entries changed by this operation? Later edits to affected values will be preserved and reported as conflicts.</p><button className="control-button" disabled={busy} onClick={() => setUndo(null)}>Cancel</button><button className="control-button control-button--primary" disabled={busy} onClick={() => void perform(async () => { await window.mcpx.management.rollback(undo); setUndo(null); setMessage("Operation undone."); })}>Undo operation</button></div>}
  </section>;
}
