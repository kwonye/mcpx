import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AuthModal } from "../../src/renderer/components/AuthModal";
import { IPC } from "../../src/shared/ipc-channels";

beforeEach(() => {
  Object.defineProperty(window, "mcpx", {
    value: {
      invoke: vi.fn(),
      startOauth: vi.fn(),
      cancelOauth: vi.fn().mockResolvedValue({ cancelled: true }),
      reopenOauthUrl: vi.fn().mockResolvedValue({ reopened: true }),
      checkOauthSupport: vi.fn().mockResolvedValue({ support: "unknown", resourceMetadata: false, authorizationServerMetadata: false }),
      onOauthProgress: vi.fn(() => () => {})
    },
    writable: true
  });
});

describe("AuthModal", () => {
  it("renders with server name in description", () => {
    const onClose = vi.fn();
    const onConfigured = vi.fn();
    render(
      <AuthModal
        serverName="slack"
        transport="http"
        onClose={onClose}
        onConfigured={onConfigured}
      />
    );

    expect(screen.getByText(/Auth Required/)).toBeDefined();
    // Text is split by strong tag, so check for the parts
    const desc = screen.getByText(/Server/);
    expect(desc.textContent).toContain("slack");
    expect(desc.textContent).toContain("requires authentication to function");
  });

  it("always offers browser sign-in for an HTTP server, even when OAuth support is unknown", () => {
    // Regression test: OAuth support used to gate whether "Sign in with
    // browser" rendered at all, so a bare 401 with no WWW-Authenticate header
    // (support === "unknown"/undetermined) left the user with only the manual
    // token form. The button must always be offered for HTTP servers.
    render(
      <AuthModal
        serverName="github"
        transport="http"
        onClose={vi.fn()}
        onConfigured={vi.fn()}
      />
    );

    expect(screen.getByText("Sign in with browser")).toBeDefined();
  });

  it("does not offer browser sign-in for a stdio server", () => {
    render(
      <AuthModal
        serverName="local-tool"
        transport="stdio"
        onClose={vi.fn()}
        onConfigured={vi.fn()}
      />
    );

    expect(screen.queryByText("Sign in with browser")).toBeNull();
    // Manual form is shown by default for stdio servers (no OAuth option to disclose behind).
    expect(screen.getByLabelText(/Header name/)).toBeDefined();
  });

  it("calls startOauth when the browser sign-in button is clicked", async () => {
    const onClose = vi.fn();
    const onConfigured = vi.fn();
    (window.mcpx.startOauth as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(
      <AuthModal
        serverName="github"
        transport="http"
        oauthSupport="supported"
        onClose={onClose}
        onConfigured={onConfigured}
      />
    );

    const oauthButton = screen.getByText("Sign in with browser") as HTMLButtonElement;
    expect(oauthButton).toBeDefined();

    await act(async () => {
      fireEvent.click(oauthButton);
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(window.mcpx.startOauth).toHaveBeenCalledWith("github");
    expect(onConfigured).toHaveBeenCalled();
  });

  it("shows a recommendation hint when OAuth support is confirmed", () => {
    render(
      <AuthModal
        serverName="github"
        transport="http"
        oauthSupport="supported"
        onClose={vi.fn()}
        onConfigured={vi.fn()}
      />
    );

    expect(screen.getByText(/Recommended/)).toBeDefined();
  });

  it("auto-expands the manual token form when OAuth is unsupported, but still shows the button", () => {
    render(
      <AuthModal
        serverName="custom-api"
        transport="http"
        oauthSupport="unsupported"
        onClose={vi.fn()}
        onConfigured={vi.fn()}
      />
    );

    expect(screen.getByText("Sign in with browser")).toBeDefined();
    expect(screen.getByLabelText(/Auth value/)).toBeDefined();
  });

  it("returns to idle without an error banner when the OAuth login is cancelled", async () => {
    (window.mcpx.startOauth as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('OAuth login for "github" was cancelled.')
    );

    render(
      <AuthModal
        serverName="github"
        transport="http"
        oauthSupport="supported"
        onClose={vi.fn()}
        onConfigured={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Sign in with browser"));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.queryByText(/cancelled/i)).toBeNull();
    // The button is still there, ready to try again.
    expect(screen.getByText("Sign in with browser")).toBeDefined();
  });

  it("shows the error banner when the OAuth login fails for a real reason", async () => {
    (window.mcpx.startOauth as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Discovery failed: ECONNREFUSED")
    );

    render(
      <AuthModal
        serverName="github"
        transport="http"
        oauthSupport="supported"
        onClose={vi.fn()}
        onConfigured={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Sign in with browser"));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getByText(/ECONNREFUSED/)).toBeDefined();
  });

  it("shows a waiting panel with cancel/reopen once the browser step starts", async () => {
    let progressCallback: ((event: unknown) => void) | undefined;
    (window.mcpx.onOauthProgress as ReturnType<typeof vi.fn>).mockImplementation((cb: (event: unknown) => void) => {
      progressCallback = cb;
      return () => {};
    });
    (window.mcpx.startOauth as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {})); // never resolves in this test

    render(
      <AuthModal
        serverName="github"
        transport="http"
        oauthSupport="supported"
        onClose={vi.fn()}
        onConfigured={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Sign in with browser"));

    await act(async () => {
      progressCallback?.({ serverName: "github", phase: "awaiting-browser", authorizationUrl: "https://example.com/authorize", expiresAt: Date.now() + 120_000 });
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getByText("Waiting for your browser…")).toBeDefined();
    expect(screen.getByText("Cancel")).toBeDefined();
    expect(screen.getByText("Reopen link")).toBeDefined();
  });

  it("cancels the in-flight login when the modal is closed while waiting on the browser", async () => {
    let progressCallback: ((event: unknown) => void) | undefined;
    (window.mcpx.onOauthProgress as ReturnType<typeof vi.fn>).mockImplementation((cb: (event: unknown) => void) => {
      progressCallback = cb;
      return () => {};
    });
    (window.mcpx.startOauth as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();

    render(
      <AuthModal
        serverName="github"
        transport="http"
        oauthSupport="supported"
        onClose={onClose}
        onConfigured={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Sign in with browser"));
    await act(async () => {
      progressCallback?.({ serverName: "github", phase: "awaiting-browser", authorizationUrl: "https://example.com/authorize", expiresAt: Date.now() + 120_000 });
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    fireEvent.click(screen.getByText("Cancel"));
    expect(window.mcpx.cancelOauth).toHaveBeenCalledWith("github");
  });

  it("calls configure API when manual header form is submitted", async () => {
    const onClose = vi.fn();
    const onConfigured = vi.fn();
    (window.mcpx.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(
      <AuthModal
        serverName="custom-api"
        transport="http"
        oauthSupport="unsupported"
        onClose={onClose}
        onConfigured={onConfigured}
      />
    );

    const headerInput = screen.getByLabelText(/Header name/) as HTMLInputElement;
    const authInput = screen.getByLabelText(/Auth value/) as HTMLInputElement;
    const secretInput = screen.getByLabelText(/Secret name/) as HTMLInputElement;
    const configureButton = screen.getByText("Save token") as HTMLButtonElement;

    await act(async () => {
      fireEvent.change(headerInput, { target: { value: "X-API-Key" } });
      fireEvent.change(authInput, { target: { value: "secret123" } });
      fireEvent.change(secretInput, { target: { value: "auth_custom_api" } });
      fireEvent.click(configureButton);
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(window.mcpx.invoke).toHaveBeenCalledWith(IPC.CONFIGURE_AUTH, {
      serverName: "custom-api",
      headerName: "X-API-Key",
      authValue: "secret123",
      secretName: "auth_custom_api"
    });

    expect(onConfigured).toHaveBeenCalled();
  });

  it("displays error when configure fails and modal remains dismissable", async () => {
    const onClose = vi.fn();
    const onConfigured = vi.fn();
    (window.mcpx.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Permission denied")
    );

    render(
      <AuthModal
        serverName="api-server"
        transport="http"
        oauthSupport="unsupported"
        onClose={onClose}
        onConfigured={onConfigured}
      />
    );

    const authInput = screen.getByLabelText(/Auth value/) as HTMLInputElement;
    const configureButton = screen.getByText("Save token") as HTMLButtonElement;

    await act(async () => {
      fireEvent.change(authInput, { target: { value: "test-token" } });
      fireEvent.click(configureButton);
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getByText("Permission denied")).toBeDefined();
    expect(onConfigured).not.toHaveBeenCalled();

    // Verify close button is still present and clickable
    const modalHeader = screen.getByText("Auth Required").closest(".modal-header");
    const closeButton = within(modalHeader!).getByRole("button") as HTMLButtonElement;
    expect(closeButton).toBeDefined();
    expect((closeButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();

    // Verify skip button is still present and clickable
    const skipButton = screen.getByText("Skip") as HTMLButtonElement;
    expect(skipButton).toBeDefined();
    expect((skipButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(skipButton);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <AuthModal
        serverName="slack"
        transport="http"
        oauthSupport="unsupported"
        onClose={onClose}
        onConfigured={vi.fn()}
      />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
