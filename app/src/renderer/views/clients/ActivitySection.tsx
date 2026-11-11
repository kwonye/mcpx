import { useState } from "react";
import { History } from "lucide-react";
import { Button, ConfirmDialog, List, ListRow, Section, StatusLabel, useToast } from "../../components/ui";
import type { Tone } from "../../components/ui/Badge";
import type { Operation } from "../../../shared/ipc-contract";
import { api } from "../../lib/api";
import { relativeTime } from "../../lib/format";
import { invalidate } from "../../lib/query";
import { MANAGEMENT_KEY } from "../../hooks/useManagement";
import { refreshStatus } from "../../hooks/useServers";
import { refreshAddons } from "../../hooks/useAddons";

const PHASE: Record<Operation["phase"], { label: string; tone: Tone }> = {
  prepared: { label: "Ready", tone: "neutral" },
  applying: { label: "In progress", tone: "accent" },
  complete: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  "rolled-back": { label: "Undone", tone: "neutral" },
  "recovery-required": { label: "Needs recovery", tone: "warning" }
};

const VISIBLE = 8;

/** The operations log: what mcpx changed in your apps, with undo for adoptions. */
export function ActivitySection({ operations }: { operations: Operation[] }) {
  const toast = useToast();
  const [showAll, setShowAll] = useState(false);
  const [undoing, setUndoing] = useState<Operation | null>(null);
  const sorted = [...operations].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const shown = showAll ? sorted : sorted.slice(0, VISIBLE);

  return (
    <Section
      title="Recent activity"
      description="Changes mcpx made to your apps. Moves can be undone."
      variant="plain"
      actions={sorted.length > VISIBLE ? <Button size="sm" variant="ghost" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show less" : `Show all ${sorted.length}`}</Button> : undefined}
    >
      {sorted.length === 0 ? (
        <p className="text-muted">Nothing yet.</p>
      ) : (
        <List label="Recent activity">
          {shown.map((operation) => {
            const phase = PHASE[operation.phase] ?? { label: operation.phase, tone: "neutral" as Tone };
            const canUndo = operation.undoable && (operation.phase === "complete" || operation.phase === "recovery-required");
            return (
              <ListRow
                key={operation.id}
                leading={<span className="row-icon"><History size={15} strokeWidth={1.75} /></span>}
                title={operation.label}
                subtitle={[relativeTime(operation.startedAt), operation.message].filter(Boolean).join(" · ")}
                meta={<StatusLabel tone={phase.tone} pulse={operation.phase === "applying"}>{phase.label}</StatusLabel>}
                trailing={canUndo ? <Button size="sm" onClick={() => setUndoing(operation)}>{operation.phase === "recovery-required" ? "Recover" : "Undo"}</Button> : undefined}
              >
                {operation.phase === "applying" && <progress className="activity__progress" max={1} value={operation.progress} aria-label={`${operation.label} progress`} />}
                {operation.details && operation.details.length > 0 && (
                  <ul className="row-note activity__details">{operation.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul>
                )}
              </ListRow>
            );
          })}
        </List>
      )}
      <ConfirmDialog
        open={undoing !== null}
        title={undoing?.phase === "recovery-required" ? "Recover this change?" : "Undo this change?"}
        message="The app settings it changed are restored. Anything you edited since then is kept and reported as a conflict."
        confirmLabel={undoing?.phase === "recovery-required" ? "Recover" : "Undo"}
        onConfirm={async () => {
          if (!undoing) return;
          await api().management.rollback(undoing.id);
          await Promise.all([invalidate(MANAGEMENT_KEY), refreshStatus(), refreshAddons()]);
          toast.success("Change undone");
          setUndoing(null);
        }}
        onCancel={() => setUndoing(null)}
      />
    </Section>
  );
}
