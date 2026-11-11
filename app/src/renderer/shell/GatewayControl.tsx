import { Play, Square } from "lucide-react";
import { Button, IconButton, StatusDot, Tooltip } from "../components/ui";
import { api } from "../lib/api";
import { useMutation } from "../lib/query";
import { refreshStatus, useStatus } from "../hooks/useServers";

/** Shared start/stop logic so the sidebar footer and the popover behave identically. */
export function useGatewayToggle() {
  const status = useStatus();
  const running = status.data?.daemon.running;
  const toggle = useMutation(async () => {
    try {
      if (running) await api().gateway.stop();
      else await api().gateway.start();
    } finally {
      // The daemon may have changed state even if the call failed (e.g. an
      // auto-start won the race); always reconcile with reality.
      await refreshStatus();
    }
  });
  return { running, known: status.data !== undefined, toggle };
}

export function GatewayControl({ compact = false }: { compact?: boolean }) {
  const { running, known, toggle } = useGatewayToggle();
  const label = !known ? "Checking gateway" : running ? "Gateway running" : "Gateway stopped";

  return (
    <div className="gateway-control">
      <div className="gateway-control__line">
        <Tooltip content="The local gateway connects your AI apps to every server you add here." side="top" align="start">
          <span className="gateway-control__status" tabIndex={0}>
            <StatusDot tone={!known ? "neutral" : running ? "success" : "neutral"} pulse={!known} />
            <span>{label}</span>
          </span>
        </Tooltip>
        {known && (compact ? (
          <IconButton
            icon={running ? Square : Play}
            label={running ? "Stop gateway" : "Start gateway"}
            size="sm"
            loading={toggle.pending}
            onClick={() => void toggle.run()}
          />
        ) : (
          <Button size="sm" variant="ghost" loading={toggle.pending} onClick={() => void toggle.run()}>
            {running ? "Stop" : "Start"}
          </Button>
        ))}
      </div>
      {toggle.error && (
        <p className="gateway-control__error" role="alert">
          {toggle.error}{" "}
          <button type="button" className="link-button" onClick={toggle.reset}>Dismiss</button>
        </p>
      )}
    </div>
  );
}
