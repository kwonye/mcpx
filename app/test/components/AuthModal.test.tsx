import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AuthModal } from "../../src/renderer/components/AuthModal";
import { IPC } from "../../src/shared/ipc-channels";

beforeEach(() => {
  Object.defineProperty(window, "mcpx", {
    value: {
      invoke: vi.fn(),
      startOauth: vi.fn()
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

  it("calls startOauth when OAuth button is clicked", async () => {
    const onClose = vi.fn();
    const onConfigured = vi.fn();
    (window.mcpx.startOauth as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(
      <AuthModal
        serverName="github"
        oauthLikely={true}
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

  it("calls configure API when manual header form is submitted", async () => {
    const onClose = vi.fn();
    const onConfigured = vi.fn();
    (window.mcpx.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(
      <AuthModal
        serverName="custom-api"
        oauthLikely={false}
        onClose={onClose}
        onConfigured={onConfigured}
      />
    );

    const headerInput = screen.getByLabelText(/Header name/) as HTMLInputElement;
    const authInput = screen.getByLabelText(/Auth value/) as HTMLInputElement;
    const secretInput = screen.getByLabelText(/Secret name/) as HTMLInputElement;
    const configureButton = screen.getByText("Configure Auth") as HTMLButtonElement;

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
        onClose={onClose}
        onConfigured={onConfigured}
      />
    );

    const authInput = screen.getByLabelText(/Auth value/) as HTMLInputElement;
    const configureButton = screen.getByText("Configure Auth") as HTMLButtonElement;

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
});
