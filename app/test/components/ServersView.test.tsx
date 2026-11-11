import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ServersView } from "../../src/renderer/views/servers/ServersView";
import { SignInHost } from "../../src/renderer/views/servers/SignInHost";
import { installApi, renderWithProviders, server, statusReport, type TestApi } from "./helpers";

let api: TestApi;

function renderServers() {
  return renderWithProviders(<><ServersView /><SignInHost /></>);
}

describe("ServersView", () => {
  beforeEach(() => {
    api = installApi((mock) => {
      mock.status.get.mockResolvedValue(statusReport({
        servers: [
          server("github"),
          server("linear"),
          server("postgres", { spec: { transport: "stdio", command: "uvx", args: ["mcp-server-postgres"] }, transport: "stdio", target: "uvx mcp-server-postgres" }),
          server("slack", { enabled: false })
        ]
      }));
      mock.status.tokenCounts.mockResolvedValue({
        gatewayRunning: true,
        counts: { github: { tools: 4, resources: 0, prompts: 0, total: 3400 }, postgres: { tools: 0, resources: 0, prompts: 0, total: 0, error: "refused", errorCode: "unreachable" } },
        totalGlobalTokens: 3400,
        totalProjectTokens: {}
      });
      mock.auth.pending.mockResolvedValue([{ serverName: "linear", oauthSupport: "supported" }]);
    });
  });

  it("lists servers with one status vocabulary, attention first", async () => {
    renderServers();
    const list = await screen.findByRole("list", { name: "Servers" });
    await waitFor(() => expect(within(list).getByText("Needs sign-in")).toBeInTheDocument());
    const rows = within(list).getAllByRole("listitem").map((row) => row.textContent);
    expect(rows[0]).toContain("linear");
    expect(rows[1]).toContain("postgres");
    expect(within(list).getByText("Error")).toBeInTheDocument();
    expect(within(list).getByText("Connected")).toBeInTheDocument();
    expect(within(list).getByText("Off")).toBeInTheDocument();
    expect(within(list).getByText("3.4k tokens")).toBeInTheDocument();
  });

  it("shows the shell content before slow context counts arrive", async () => {
    api.status.tokenCounts.mockReturnValue(new Promise(() => {}));
    renderServers();
    expect(await screen.findByRole("list", { name: "Servers" })).toBeInTheDocument();
    expect(screen.getAllByText("Checking").length).toBeGreaterThan(0);
  });

  it("toggles a server with its switch", async () => {
    renderServers();
    fireEvent.click(await screen.findByRole("switch", { name: "slack enabled" }));
    await waitFor(() => expect(api.servers.setEnabled).toHaveBeenCalledWith("slack", true));
  });

  it("shows a toggle failure next to the server", async () => {
    api.servers.setEnabled.mockRejectedValue(new Error("Config is locked"));
    renderServers();
    fireEvent.click(await screen.findByRole("switch", { name: "github enabled" }));
    expect(await screen.findByText("Config is locked")).toBeInTheDocument();
  });

  it("opens sign-in for a server that needs it", async () => {
    renderServers();
    await screen.findByText("Needs sign-in");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const dialog = await screen.findByRole("dialog", { name: "Sign in to linear" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign in with browser" }));
    await waitFor(() => expect(api.auth.startOAuth).toHaveBeenCalledWith("linear"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Signed in to linear")).toBeInTheDocument();
  });

  it("explains the product in its empty state", async () => {
    api.status.get.mockResolvedValue(statusReport());
    renderServers();
    expect(await screen.findByText("Add your first server")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add server" })).toBeInTheDocument();
  });

  it("offers a retry when status cannot load", async () => {
    api.status.get.mockRejectedValueOnce(new Error("config is corrupt"));
    renderServers();
    expect(await screen.findByText("config is corrupt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: "Servers" })).toBeInTheDocument();
  });

  it("opens the detail page and removes a server after confirmation", async () => {
    renderServers();
    fireEvent.click(await screen.findByRole("button", { name: /^github, / }));
    expect(await screen.findByRole("heading", { name: "github", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove…" }));
    const confirm = screen.getByRole("alertdialog", { name: "Remove github?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.servers.remove).toHaveBeenCalledWith("github"));
    expect(await screen.findByText("Removed github")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Servers", level: 1 })).toBeInTheDocument();
  });
});

describe("Add server flow", () => {
  beforeEach(() => {
    api = installApi((mock) => mock.status.get.mockResolvedValue(statusReport({ servers: [server("github")] })));
  });

  async function openAdd() {
    renderServers();
    fireEvent.click(await screen.findByRole("button", { name: "Add server" }));
    return screen.findByRole("dialog", { name: "Add a server" });
  }

  it("parses pasted input, pre-fills details and adds the server", async () => {
    api.servers.parseInput.mockResolvedValue({ kind: "client-command", name: "notion", spec: { transport: "stdio", command: "npx", args: ["-y", "notion-mcp"], env: { NOTION_TOKEN: "abc", REGION: "eu" } } });
    const dialog = await openAdd();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "URL or command" }), { target: { value: "claude mcp add notion -- npx -y notion-mcp" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    const details = await screen.findByRole("dialog", { name: "Check the details" });
    expect(within(details).getByRole("textbox", { name: "Name" })).toHaveValue("notion");
    expect(within(details).getByRole("textbox", { name: "Command" })).toHaveValue("npx");
    expect(within(details).getByRole("button", { name: "Store NOTION_TOKEN as a secret" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(details).getByRole("button", { name: "Add server" }));
    await waitFor(() => expect(api.servers.add).toHaveBeenCalled());
    const request = api.servers.add.mock.calls[0][0];
    expect(request.name).toBe("notion");
    expect(request.spec.env).toEqual({ NOTION_TOKEN: "secret://auth_notion_env_notion_token", REGION: "eu" });
    expect(request.secrets).toEqual({ auth_notion_env_notion_token: "abc" });
    expect(await screen.findByRole("dialog", { name: "notion is ready" })).toBeInTheDocument();
  });

  it("shows parse errors inline", async () => {
    api.servers.parseInput.mockRejectedValue(new Error("Couldn't read that command: missing name"));
    const dialog = await openAdd();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "URL or command" }), { target: { value: "claude mcp add" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await within(dialog).findByText("Couldn't read that command: missing name")).toBeInTheDocument();
  });

  it("validates the name before adding", async () => {
    api.servers.parseInput.mockResolvedValue({ kind: "url", name: "github", spec: { transport: "http", url: "https://x.dev/mcp" } });
    const dialog = await openAdd();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "URL or command" }), { target: { value: "https://x.dev/mcp" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    const details = await screen.findByRole("dialog", { name: "Check the details" });
    const name = within(details).getByRole("textbox", { name: "Name" });
    expect(name).toHaveValue("github-2");
    fireEvent.change(name, { target: { value: "github" } });
    fireEvent.click(within(details).getByRole("button", { name: "Add server" }));
    expect(await within(details).findByText('A server named "github" already exists.')).toBeInTheDocument();
    expect(api.servers.add).not.toHaveBeenCalled();
  });

  it("moves to sign-in when the server asks for it, with a token fallback", async () => {
    api.servers.add.mockResolvedValue({ added: "linear", sync: { results: [] }, authRequired: true, oauthSupport: "unsupported" });
    const dialog = await openAdd();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "URL or command" }), { target: { value: "https://mcp.linear.app/mcp" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Check the details" })).getByRole("button", { name: "Add server" }));
    const signIn = await screen.findByRole("dialog", { name: "Sign in to linear" });
    fireEvent.change(within(signIn).getByLabelText("Token or API key"), { target: { value: "lin_123" } });
    fireEvent.click(within(signIn).getByRole("button", { name: "Save token" }));
    await waitFor(() => expect(api.auth.configure).toHaveBeenCalledWith({ serverName: "linear", headerName: "Authorization", authValue: "lin_123" }));
    expect(await screen.findByRole("dialog", { name: "linear is ready" })).toBeInTheDocument();
  });

  it("opens from a popover intent", async () => {
    let navigate: ((route: string) => void) | undefined;
    api.app.onNavigate.mockImplementation((callback: (route: string) => void) => {
      navigate = callback;
      return () => {};
    });
    renderServers();
    await screen.findByRole("list", { name: "Servers" });
    navigate?.("servers:add");
    expect(await screen.findByRole("dialog", { name: "Add a server" })).toBeInTheDocument();
  });
});

describe("Edit server", () => {
  it("keeps blank secrets and can switch a row to plain text", async () => {
    api = installApi((mock) => mock.status.get.mockResolvedValue(statusReport({
      servers: [server("db", {
        transport: "stdio",
        target: "uvx db",
        spec: { transport: "stdio", command: "uvx", args: ["db"], env: { DB_URL: "secret://auth_db_env_db_url", MODE: "secret://auth_db_env_mode" } },
        authBindings: [{ kind: "env", key: "DB_URL", value: "secret://auth_db_env_db_url" }, { kind: "env", key: "MODE", value: "secret://auth_db_env_mode" }]
      })]
    })));
    renderServers();
    fireEvent.click(await screen.findByRole("button", { name: /^db, / }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Edit db" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Store MODE as a secret" }));
    fireEvent.change(within(dialog).getByLabelText("Value for MODE"), { target: { value: "readonly" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.servers.update).toHaveBeenCalled());
    const [name, spec, secrets] = api.servers.update.mock.calls[0];
    expect(name).toBe("db");
    expect(spec.env).toEqual({ DB_URL: "secret://auth_db_env_db_url", MODE: "readonly" });
    expect(secrets).toEqual({});
  });
});
