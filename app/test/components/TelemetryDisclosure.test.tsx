import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TelemetryDisclosure } from "../../src/renderer/components/TelemetryDisclosure";

const status = {
  schemaVersion: 1,
  usageAnalyticsEnabled: true,
  errorReportingEnabled: true,
  noticeAcknowledgedVersion: 0,
  installationId: null,
  milestones: {
    first_server_added: false,
    first_sync_succeeded: false,
    first_gateway_request_succeeded: false
  },
  usageActive: false,
  errorsActive: false,
  blockedReason: "notice_required" as const
};

const acknowledgeTelemetryNotice = vi.fn().mockResolvedValue(undefined);
const updateTelemetryPreferences = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "mcpx", {
    value: { acknowledgeTelemetryNotice, updateTelemetryPreferences },
    writable: true
  });
});

describe("TelemetryDisclosure", () => {
  it("blocks the dashboard until the notice is continued", async () => {
    const onComplete = vi.fn();
    render(<TelemetryDisclosure status={status} onComplete={onComplete} />);

    expect(screen.getByRole("heading", { name: /help improve mcpx/i })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(acknowledgeTelemetryNotice).toHaveBeenCalledTimes(1);
      expect(updateTelemetryPreferences).toHaveBeenCalledWith({
        usageAnalyticsEnabled: true,
        errorReportingEnabled: true
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  it("lets users change the two categories independently before continuing", async () => {
    render(<TelemetryDisclosure status={status} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Review settings" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Anonymous usage analytics" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue with these settings" }));

    await waitFor(() => {
      expect(updateTelemetryPreferences).toHaveBeenCalledWith({
        usageAnalyticsEnabled: false,
        errorReportingEnabled: true
      });
    });
  });
});
