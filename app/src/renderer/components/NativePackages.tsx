import { useState } from "react";
import type { AdoptionPlan } from "@mcpx/core";
import { useManagement } from "../hooks/useManagement";
import { AdoptionReview } from "./ControlCenter";

export function NativePackages() {
  const { snapshot, error, refresh } = useManagement();
  const [plan, setPlan] = useState<AdoptionPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function perform(work: () => Promise<void>) {
    setBusy(true); setFailure(null);
    try { await work(); await refresh(); }
    catch (error) { setFailure((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section>
    <div className="control-section-heading"><div><h2>Native packages</h2><p className="control-caption">Complete harness packages, stored as immutable local revisions.</p></div><button className="control-button" disabled={busy} onClick={() => void perform(async () => { setPlan(await window.mcpx.management.plan()); })}>Review native updates</button></div>
    {(error || failure) && <div className="control-notice control-notice--error" role="alert">{failure ?? error}</div>}
    <div className="harness-grid">{snapshot?.packages.map(pkg => <article className="harness-card" key={pkg.id}><div className="control-row-title">{pkg.name ?? pkg.id}<span className="control-chip">{pkg.harness}</span></div><p className="control-caption">Revision {pkg.fingerprint.slice(0, 12)}</p><div className="control-path">{pkg.root}</div><label className="harness-mode">Keep this revision<input type="checkbox" checked={pkg.pinned} disabled={busy} aria-label={`Pin ${pkg.name ?? pkg.id}`} onChange={event => void perform(async () => { await window.mcpx.management.pinPackage(pkg.id, event.target.checked); })} /></label><p className="control-caption">{pkg.pinned ? "Updates require unpinning this package." : "Native source updates can be adopted through your harness’s sync policy."}</p></article>)}</div>
    {snapshot?.packages.length === 0 && <div className="control-empty"><h3>Your native packages belong here</h3><p>Scan existing installs to adopt supported Claude plugins and Pi packages.</p></div>}
    {plan && <AdoptionReview key={plan.id} plan={plan} busy={busy} onClose={() => setPlan(null)} onApply={ids => void perform(async () => { await window.mcpx.management.apply(plan, ids); setPlan(null); })} />}
  </section>;
}
