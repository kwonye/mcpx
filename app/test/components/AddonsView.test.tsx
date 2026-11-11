import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { AddonsView } from "../../src/renderer/views/addons/AddonsView";
import { installApi, renderWithProviders, type TestApi } from "./helpers";

let api: TestApi;

const discovered = { skills: [], commands: [], agents: [], hooks: [], mcpServers: [] };
const plugin = (overrides: Record<string, unknown> = {}) => ({
  id: "superpowers", name: "superpowers", source: "obra/superpowers", version: "4.2.0", enabled: true, status: "healthy",
  components: { mcpServers: false, skills: true, hooks: true, agents: false, commands: false }, approvals: {}, discovered,
  projectedClients: ["claude"], installedAt: new Date().toISOString(), previous: { version: "4.1.0" }, ...overrides
});

describe("Add-ons: installed plugins", () => {
  beforeEach(() => {
    api = installApi((mock) => mock.plugins.list.mockResolvedValue([plugin()]));
  });

  it("flags components needing approval and approves them from the detail sheet", async () => {
    renderWithProviders(<AddonsView />);
    expect(await screen.findByText("Needs approval")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "superpowers details" }));
    const sheet = await screen.findByRole("dialog", { name: "superpowers" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.plugins.approve).toHaveBeenCalledWith("superpowers", "hooks"));
    expect(await screen.findByText("Approved hooks for superpowers")).toBeInTheDocument();
  });

  it("keeps advanced actions in the item menu with success feedback", async () => {
    api.plugins.rollback.mockResolvedValue({ version: "4.1.0" });
    renderWithProviders(<AddonsView />);
    fireEvent.click(await screen.findByRole("button", { name: "More actions for superpowers" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Roll back to v4.1.0" }));
    await waitFor(() => expect(api.plugins.rollback).toHaveBeenCalledWith("superpowers"));
    expect(await screen.findByText("Rolled superpowers back to v4.1.0")).toBeInTheDocument();
  });

  it("uninstalls after confirmation, keeping data", async () => {
    renderWithProviders(<AddonsView />);
    fireEvent.click(await screen.findByRole("button", { name: "More actions for superpowers" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Uninstall" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Uninstall" }));
    await waitFor(() => expect(api.plugins.uninstall).toHaveBeenCalledWith("superpowers", true));
  });

  it("installs from a source and reports failures inline", async () => {
    api.plugins.install.mockRejectedValueOnce(new Error("Repository not found"));
    renderWithProviders(<AddonsView />);
    const input = await screen.findByRole("textbox", { name: "Install from a source" });
    fireEvent.change(input, { target: { value: "acme/nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(await screen.findByText("Repository not found")).toBeInTheDocument();
  });
});

describe("Add-ons: discover and sources", () => {
  beforeEach(() => {
    api = installApi((mock) => {
      mock.marketplaces.list.mockResolvedValue([{ name: "team", displayName: "Team", source: "acme/plugins", builtIn: false, autoUpdate: false, status: "ready", addedAt: "" }]);
      mock.marketplaces.browse.mockResolvedValue([
        { id: "team/sentry", name: "sentry", displayName: "Sentry", marketplace: "team", description: "Errors", tags: [], supportedCapabilities: ["mcpServers"], unsupportedCapabilities: [], compatible: true, installed: false },
        { id: "team/docs", name: "docs", displayName: "Docs", marketplace: "team", description: "Docs", tags: [], supportedCapabilities: [], unsupportedCapabilities: ["agents"], compatible: false, installed: false }
      ]);
      mock.marketplaces.inspect.mockImplementation(async (id: string) => ({ id, name: "sentry", displayName: "Sentry", marketplace: "team", description: "Errors", tags: [], supportedCapabilities: ["mcpServers"], unsupportedCapabilities: [], compatible: true, installed: false, manifest: null, discovered }));
    });
  });

  it("browses, filters and installs with progress and success feedback", async () => {
    renderWithProviders(<AddonsView />);
    fireEvent.click(screen.getByRole("tab", { name: "Discover" }));
    const list = await screen.findByRole("list", { name: "Available plugins" });
    expect(within(list).getByText("Not supported")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search plugins" }), { target: { value: "sentry" } });
    expect(within(list).queryByText("Docs")).not.toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Sentry details" }));
    const sheet = await screen.findByRole("dialog", { name: "Sentry" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Install" }));
    await waitFor(() => expect(api.marketplaces.install).toHaveBeenCalledWith("team/sentry"));
    expect(await screen.findByText("Installed p")).toBeInTheDocument();
  });

  it("refreshes every source from Discover", async () => {
    renderWithProviders(<AddonsView />);
    fireEvent.click(screen.getByRole("tab", { name: "Discover" }));
    fireEvent.click(await screen.findByRole("button", { name: "Check sources for new plugins" }));
    await waitFor(() => expect(api.marketplaces.refresh).toHaveBeenCalledWith("team"));
  });

  it("adds a source with an optional catalog path and toggles auto-update", async () => {
    renderWithProviders(<AddonsView />);
    fireEvent.click(screen.getByRole("tab", { name: /Sources/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Add a source" }), { target: { value: "acme/more" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Catalog file" }), { target: { value: "plugins/marketplace.json" } });
    fireEvent.click(screen.getByRole("button", { name: "Add source" }));
    await waitFor(() => expect(api.marketplaces.add).toHaveBeenCalledWith("acme/more", "plugins/marketplace.json"));
    fireEvent.click(screen.getByRole("switch", { name: "Auto-update Team" }));
    await waitFor(() => expect(api.marketplaces.setAutoUpdate).toHaveBeenCalledWith("team", true));
  });
});

describe("Add-ons: skills", () => {
  beforeEach(() => {
    api = installApi((mock) => mock.skills.list.mockResolvedValue([
      { id: "release-notes", content: "---\nname: release-notes\n---\nBody", source: "authored" },
      { id: "brainstorming", content: "Installed", source: "installed", readOnly: true }
    ]));
  });

  it("validates new skill names instead of silently doing nothing", async () => {
    renderWithProviders(<AddonsView />);
    fireEvent.click(screen.getByRole("tab", { name: /Skills/ }));
    fireEvent.click(await screen.findByRole("button", { name: "New skill" }));
    const dialog = await screen.findByRole("dialog", { name: "New skill" });
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    fireEvent.change(name, { target: { value: "release notes" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findByText('A skill named "release-notes" already exists.')).toBeInTheDocument();
    fireEvent.change(name, { target: { value: "bad_name!" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findByText(/lowercase letters and numbers/)).toBeInTheDocument();
    fireEvent.change(name, { target: { value: "Deploy Checklist" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(api.skills.save).toHaveBeenCalledWith("deploy-checklist", expect.stringContaining("name: deploy-checklist")));
  });

  it("edits and saves a skill", async () => {
    renderWithProviders(<AddonsView />);
    fireEvent.click(screen.getByRole("tab", { name: /Skills/ }));
    const editor = await screen.findByRole("textbox", { name: "Contents of release-notes" });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(editor, { target: { value: "updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.skills.save).toHaveBeenCalledWith("release-notes", "updated"));
  });

  it("shows read-only skills without a Save button and offers an editable copy", async () => {
    renderWithProviders(<AddonsView />);
    fireEvent.click(screen.getByRole("tab", { name: /Skills/ }));
    fireEvent.click(await screen.findByRole("button", { name: "brainstorming" }));
    expect(await screen.findByRole("textbox", { name: "Contents of brainstorming" })).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Make editable copy" }));
    await waitFor(() => expect(api.skills.customize).toHaveBeenCalledWith("brainstorming"));
  });

  it("asks before discarding unsaved edits", async () => {
    renderWithProviders(<AddonsView />);
    fireEvent.click(screen.getByRole("tab", { name: /Skills/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Contents of release-notes" }), { target: { value: "draft" } });
    fireEvent.click(screen.getByRole("tab", { name: "Discover" }));
    expect(screen.getByRole("alertdialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("textbox", { name: "Contents of release-notes" })).toHaveValue("draft");
  });
});

describe("Add-ons: import / export", () => {
  it("previews an import and asks for missing values", async () => {
    api = installApi((mock) => {
      mock.share.import.mockImplementation(async (_dir: string, options?: { dryRun?: boolean }) => options?.dryRun
        ? { importedSkills: ["a"], importedPlugins: [], importedServers: ["linear"], missingInputs: ["LINEAR_API_KEY"] }
        : { importedSkills: ["a"], importedPlugins: [], importedServers: ["linear"], missingInputs: [] });
    });
    renderWithProviders(<AddonsView />);
    fireEvent.click(screen.getByRole("button", { name: "Import / export environment" }));
    fireEvent.click(await screen.findByRole("button", { name: /Import from a folder/ }));
    const review = await screen.findByRole("dialog", { name: "Review import" });
    expect(within(review).getByText(/1 server, 1 skill/)).toBeInTheDocument();
    fireEvent.click(within(review).getByRole("button", { name: "Import" }));
    expect(await within(review).findByText("Required")).toBeInTheDocument();
    fireEvent.change(within(review).getByLabelText("LINEAR_API_KEY"), { target: { value: "lin_1" } });
    fireEvent.click(within(review).getByRole("button", { name: "Import" }));
    await waitFor(() => expect(api.share.import).toHaveBeenLastCalledWith("/Users/ana/src/api", { locked: true, inputs: { LINEAR_API_KEY: "lin_1" } }));
    expect(await screen.findByText("Imported 1 server, 1 skill.")).toBeInTheDocument();
  });
});
