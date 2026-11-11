import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Badge, Button, Checkbox, Dialog, EmptyState, InlineAlert, useToast } from "../../components/ui";
import type { AdoptionPlan } from "../../../shared/ipc-contract";
import { api } from "../../lib/api";
import { clientName } from "../../lib/domain";
import { plural, tildify } from "../../lib/format";
import { invalidate, useMutation } from "../../lib/query";
import { MANAGEMENT_KEY } from "../../hooks/useManagement";
import { refreshStatus } from "../../hooks/useServers";
import { refreshAddons } from "../../hooks/useAddons";

const KIND_LABEL: Record<string, string> = { mcp: "Server", skill: "Skill", package: "Package" };
const ACTION_COPY: Record<string, string> = {
  import: "Move into mcpx",
  reuse: "Already in mcpx — use the shared copy",
  conflict: "Conflicts with something already in mcpx",
  unsupported: "Can't be moved"
};

const selectable = (action: string) => action === "import" || action === "reuse";

/**
 * Review of servers and skills that were installed directly into an app.
 * Adopting moves them into mcpx so every app shares one copy; the operation
 * is recorded in Recent activity and can be undone.
 */
export function AdoptionDialog({ plan, onClose }: { plan: AdoptionPlan; onClose: () => void }) {
  const toast = useToast();
  const [selected, setSelected] = useState(() => new Set(plan.items.filter((item) => selectable(item.action)).map((item) => item.id)));

  const apply = useMutation(async () => {
    await api().management.applyAdoption(plan, Array.from(selected));
    await Promise.all([invalidate(MANAGEMENT_KEY), refreshStatus(), refreshAddons()]);
    toast.success(`Moved ${plural(selected.size, "item")} into mcpx`, "Restart the affected apps to use the shared copies. You can undo this from Recent activity.");
    onClose();
  });

  const toggle = (id: string, on: boolean) => setSelected((current) => {
    const next = new Set(current);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Bring existing setups into mcpx"
      description="These were added to an app directly. Move them into mcpx and every app shares one copy, with your settings kept."
      size="lg"
      dismissible={!apply.pending}
      footer={plan.items.length > 0 ? (
        <>
          <span className="adoption__count">{selected.size} selected</span>
          <Button variant="ghost" onClick={onClose} disabled={apply.pending}>Cancel</Button>
          <Button variant="primary" loading={apply.pending} disabled={selected.size === 0} onClick={() => void apply.run()}>Move selected</Button>
        </>
      ) : <Button variant="primary" onClick={onClose}>Done</Button>}
    >
      <div className="form-stack">
        {plan.items.length === 0 ? (
          <EmptyState size="sm" icon={CheckCircle2} title="You're all caught up" description="Nothing found that isn't already managed by mcpx." />
        ) : (
          <div className="adoption__items">
            {plan.items.map((item) => (
              <Checkbox
                key={item.id}
                checked={selected.has(item.id)}
                disabled={apply.pending || !selectable(item.action)}
                onCheckedChange={(on) => toggle(item.id, on)}
                aria-label={`Move ${item.name} from ${clientName(item.harness)}`}
                description={
                  <>
                    {clientName(item.harness)} · {ACTION_COPY[item.action] ?? item.action}
                    <br />
                    <span className="mono-subtle">{tildify(item.path)}</span>
                    {item.reason && <><br /><span className="adoption__reason">{item.reason}</span></>}
                  </>
                }
              >
                {item.name} <Badge>{KIND_LABEL[item.kind] ?? item.kind}</Badge>
              </Checkbox>
            ))}
          </div>
        )}
        {plan.errors.length > 0 && (
          <details className="adoption__diagnostics">
            <summary>{plural(plan.errors.length, "app")} couldn't be read</summary>
            <ul>{plan.errors.map((error, index) => <li key={index}>{error}</li>)}</ul>
          </details>
        )}
        {apply.error && <InlineAlert tone="danger" title="Couldn't move them">{apply.error}</InlineAlert>}
      </div>
    </Dialog>
  );
}
