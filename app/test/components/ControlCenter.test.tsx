import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ControlCenter } from "../../src/renderer/components/ControlCenter";

const { refresh, snapshot } = vi.hoisted(() => ({ refresh: vi.fn().mockResolvedValue(undefined), snapshot: { revision: 3, capturedAt: "2026-10-17T12:00:00Z", harnesses: [{ id: "pi", harness: "pi", label: "Pi", scope: "global", configPath: "/test/.pi/agent/mcp.json", skillPaths: [], detected: true, mode: "selected", transports: ["http"], components: ["mcp", "skill"], reload: "Reload Pi" }], operations: [{ id: "operation", label: "Adopt native integrations", phase: "complete", undoable: true, startedAt: "2026-10-17T12:00:00Z", updatedAt: "2026-10-17T12:00:00Z", progress: 1 }], servers: [], skills: [], packages: [], plugins: [] } }));
vi.mock("../../src/renderer/hooks/useManagement", () => ({ useManagement: () => ({ snapshot, error: null, loading: false, refresh }) }));
const api = { plan: vi.fn(), apply: vi.fn().mockResolvedValue({}), mode: vi.fn().mockResolvedValue({}), rollback: vi.fn().mockResolvedValue({}), sync: vi.fn().mockResolvedValue({ hasErrors: false }) };
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "mcpx", { value: { management: api }, configurable: true });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  api.plan.mockResolvedValue({ id: "plan", items: [ { id: "first", harness: "pi", name: "Docs", kind: "mcp", path: "/test/config", action: "import" }, { id: "second", harness: "pi", name: "Review", kind: "skill", path: "/test/skills", action: "import" } ], errors: [] });
});
describe("integration control center", () => {
  it("reviews native installs and applies only the selected items", async () => {
    render(<ControlCenter view="overview" />);
    fireEvent.click(screen.getByRole("button", { name: /Scan existing installs/i }));
    expect(await screen.findByRole("dialog")).toBeDefined();
    fireEvent.click(screen.getByRole("checkbox", { name: "Adopt Review from pi" }));
    fireEvent.click(screen.getByRole("button", { name: "Adopt selected" }));
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith(expect.objectContaining({ id: "plan" }), ["first"]));
    expect(await screen.findByText(/Adoption complete/)).toBeDefined();
  });
  it("saves an explicit automatic-adoption preference for one harness", async () => {
    render(<ControlCenter view="harnesses" />);
    fireEvent.change(screen.getByRole("combobox", { name: "Sync mode for Pi" }), { target: { value: "automatic" } });
    await waitFor(() => expect(api.mode).toHaveBeenCalledWith("pi", "automatic"));
  });
  it("surfaces an undo conflict and keeps its recovery controls available", async () => {
    api.rollback.mockRejectedValueOnce(new Error("Local edits prevent undo"));
    render(<ControlCenter view="activity" />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo operation" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Local edits prevent undo");
    expect(screen.getByRole("button", { name: "Undo operation" })).toBeDefined();
  });
});
