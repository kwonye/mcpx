import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ProjectsView } from "../../src/renderer/views/projects/ProjectsView";
import { installApi, renderWithProviders, server, statusReport, type TestApi } from "./helpers";

let api: TestApi;

describe("ProjectsView", () => {
  beforeEach(() => {
    api = installApi((mock) => {
      mock.status.get.mockResolvedValue(statusReport({
        servers: [server("github"), server("postgres"), server("slack", { enabled: false })],
        projects: { "/Users/ana/src/web": { name: "web", path: "/Users/ana/src/web", disabledServers: ["postgres"] } }
      }));
      mock.plugins.list.mockResolvedValue([
        { id: "ctx", name: "context7", version: "1", enabled: true, projectOverrides: { "/Users/ana/src/web": { enabled: false } }, components: {}, discovered: { skills: [], commands: [], agents: [], hooks: [], mcpServers: [] } }
      ]);
    });
  });

  it("can add another project even when one is already selected", async () => {
    renderWithProviders(<ProjectsView />);
    expect(await screen.findByRole("heading", { name: "web" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a project" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Choose…" }));
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("api"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add project" }));
    await waitFor(() => expect(api.projects.add).toHaveBeenCalledWith("/Users/ana/src/api", "api"));
  });

  it("rejects a folder that is already a project", async () => {
    api.app.selectDirectory.mockResolvedValue("/Users/ana/src/web");
    renderWithProviders(<ProjectsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Add project" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a project" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Choose…" }));
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("web"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add project" }));
    expect(await within(dialog).findByText("This folder is already a project.")).toBeInTheDocument();
    expect(api.projects.add).not.toHaveBeenCalled();
  });

  it("explains overrides in plain language and toggles servers per project", async () => {
    renderWithProviders(<ProjectsView />);
    const servers = await screen.findByRole("list", { name: "Servers in web" });
    expect(within(servers).getByText("Off in this project")).toBeInTheDocument();
    expect(within(servers).getByText(/Off everywhere/)).toBeInTheDocument();
    fireEvent.click(within(servers).getByRole("switch", { name: "postgres in web" }));
    await waitFor(() => expect(api.projects.setServerEnabled).toHaveBeenCalledWith("/Users/ana/src/web", "postgres", true));
  });

  it("resets a plugin override to the default", async () => {
    renderWithProviders(<ProjectsView />);
    const addons = await screen.findByRole("list", { name: "Add-ons in web" });
    fireEvent.click(within(addons).getByRole("button", { name: "Use default" }));
    await waitFor(() => expect(api.plugins.resetProjectOverride).toHaveBeenCalledWith("ctx", "/Users/ana/src/web"));
  });

  it("removes a project after confirmation", async () => {
    renderWithProviders(<ProjectsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.projects.remove).toHaveBeenCalledWith("/Users/ana/src/web"));
  });

  it("has an empty state with the add action", async () => {
    api.status.get.mockResolvedValue(statusReport());
    renderWithProviders(<ProjectsView />);
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
  });
});
