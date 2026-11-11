import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ClientsView } from "../../src/renderer/views/clients/ClientsView";
import { installApi, renderWithProviders, server, statusReport, type TestApi } from "./helpers";

let api: TestApi;

const harness = (id: string, label: string, overrides: Record<string, unknown> = {}) => ({
  id: `${id}:global`, harness: id, label, scope: "global", configPath: `/Users/ana/.${id}.json`, skillPaths: [], detected: true, mode: "automatic", transports: ["http"], components: ["mcp"], reload: "", ...overrides
});

describe("ClientsView", () => {
  beforeEach(() => {
    api = installApi((mock) => {
      mock.status.get.mockResolvedValue(statusReport({ servers: [server("github")] }));
      mock.management.snapshot.mockResolvedValue({
        revision: 3,
        capturedAt: new Date().toISOString(),
        servers: [], skills: [], packages: [], plugins: [],
        harnesses: [
          harness("claude", "Claude Code", { sync: { status: "SYNCED", lastSyncAt: new Date().toISOString() } }),
          harness("vscode", "VS Code", { sync: { status: "ERROR", message: "mcp.json is not valid JSON" } }),
          harness("kiro", "Kiro", { detected: false, configPath: null }),
          harness("future", "Future App", { sync: { status: "NEEDS_RESTART" } })
        ],
        operations: [{ id: "op-1", label: "Moved 2 items from Cursor into mcpx", phase: "complete", startedAt: new Date().toISOString(), updatedAt: "", progress: 1, undoable: true }]
      });
    });
  });

  it("lists apps with human names and plain sync states", async () => {
    renderWithProviders(<ClientsView />);
    const installed = await screen.findByRole("list", { name: "Installed apps" });
    expect(within(installed).getByText("Claude Code")).toBeInTheDocument();
    expect(within(installed).getByText("Synced")).toBeInTheDocument();
    expect(within(installed).getByText("Sync failed")).toBeInTheDocument();
    expect(within(installed).getByText("mcp.json is not valid JSON")).toBeInTheDocument();
    expect(within(installed).getByText("Needs Restart")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Apps not installed" })).getByText("Not installed")).toBeInTheDocument();
  });

  it("syncs every app on demand", async () => {
    api.status.syncAll.mockResolvedValue({ results: [{ clientId: "claude", status: "SYNCED" }, { clientId: "vscode", status: "ERROR", message: "bad json" }], hasErrors: true });
    renderWithProviders(<ClientsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    expect(await screen.findByText("1 app couldn't be updated")).toBeInTheDocument();
    expect(screen.getByText("VS Code: bad json")).toBeInTheDocument();
  });

  it("changes how mcpx manages an app", async () => {
    renderWithProviders(<ClientsView />);
    const select = await screen.findByRole("combobox", { name: "How mcpx manages Claude Code" });
    fireEvent.change(select, { target: { value: "observe" } });
    await waitFor(() => expect(api.management.setHarnessMode).toHaveBeenCalledWith("claude:global", "observe"));
  });

  it("reviews and adopts existing setups", async () => {
    api.management.planAdoption.mockResolvedValue({
      id: "plan-1", createdAt: "", configHash: "", errors: [],
      items: [
        { id: "a", harness: "cursor", kind: "mcp", name: "notion", path: "/x", nativeKey: "", fingerprint: "", action: "import", canonicalId: "", reload: "" },
        { id: "b", harness: "vscode", kind: "mcp", name: "postgres", path: "/y", nativeKey: "", fingerprint: "", action: "conflict", canonicalId: "", reason: "Different config", reload: "" }
      ]
    });
    renderWithProviders(<ClientsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Find existing setups" }));
    const dialog = await screen.findByRole("dialog", { name: "Bring existing setups into mcpx" });
    expect(within(dialog).getByRole("checkbox", { name: "Move notion from Cursor" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Move postgres from VS Code" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Move selected" }));
    await waitFor(() => expect(api.management.applyAdoption).toHaveBeenCalledWith(expect.objectContaining({ id: "plan-1" }), ["a"]));
  });

  it("undoes an operation from recent activity", async () => {
    renderWithProviders(<ClientsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(api.management.rollback).toHaveBeenCalledWith("op-1"));
  });

  it("falls back to the status report when the background service is down", async () => {
    api.management.snapshot.mockRejectedValue(new Error("connect ENOENT"));
    api.status.get.mockResolvedValue(statusReport({ clients: { cursor: { status: "SYNCED" }, "claude-desktop": { status: "SKIPPED" } } }));
    renderWithProviders(<ClientsView />);
    expect(await screen.findByText("The background service isn't responding")).toBeInTheDocument();
    expect(within(await screen.findByRole("list", { name: "Installed apps" })).getByText("Cursor")).toBeInTheDocument();
  });
});
