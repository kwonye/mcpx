import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SignInPanel } from "../../src/renderer/views/servers/SignInPanel";
import { installApi, type TestApi } from "./helpers";
import type { OAuthProgressPayload } from "../../src/shared/ipc-contract";

let api: TestApi;
let emit: (event: OAuthProgressPayload) => void = () => {};

describe("SignInPanel", () => {
  beforeEach(() => {
    api = installApi((mock) => {
      mock.auth.onOAuthProgress.mockImplementation((callback: (event: OAuthProgressPayload) => void) => {
        emit = callback;
        return () => {};
      });
    });
  });

  it("always offers browser sign-in for URL servers, refining the hint after discovery", async () => {
    render(<SignInPanel serverName="linear" transport="http" onSignedIn={() => {}} />);
    expect(screen.getByRole("button", { name: "Sign in with browser" })).toBeInTheDocument();
    expect(await screen.findByText(/Recommended/)).toBeInTheDocument();
  });

  it("shows browser progress with reopen and cancel, and reports cancel when unmounted mid-flow", async () => {
    api.auth.startOAuth.mockReturnValue(new Promise(() => {}));
    const onRunningChange = vi.fn();
    render(<SignInPanel serverName="linear" transport="http" oauthSupport="supported" onSignedIn={() => {}} onRunningChange={onRunningChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with browser" }));
    act(() => emit({ serverName: "linear", phase: "awaiting-browser", expiresAt: Date.now() + 90_000 }));
    expect(screen.getByText(/Waiting for you to finish/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open the page again" }));
    expect(api.auth.reopenOAuth).toHaveBeenCalledWith("linear");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.auth.cancelOAuth).toHaveBeenCalledWith("linear");
    const cancel = onRunningChange.mock.calls.at(-1)?.[0];
    expect(typeof cancel).toBe("function");
  });

  it("shows OAuth failures but stays quiet on user cancel", async () => {
    api.auth.startOAuth.mockRejectedValueOnce(new Error("invalid_client"));
    render(<SignInPanel serverName="linear" transport="http" oauthSupport="supported" onSignedIn={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with browser" }));
    expect(await screen.findByText("invalid_client")).toBeInTheDocument();
    const cancelled = Object.assign(new Error("Login cancelled"), { name: "OAuthCancelledError" });
    api.auth.startOAuth.mockRejectedValueOnce(cancelled);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with browser" }));
    await waitFor(() => expect(screen.queryByText("Login cancelled")).not.toBeInTheDocument());
  });

  it("stores a token for a local command as an environment variable", async () => {
    const onSignedIn = vi.fn();
    render(<SignInPanel serverName="github" transport="stdio" onSignedIn={onSignedIn} />);
    expect(screen.queryByRole("button", { name: "Sign in with browser" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Token or API key"), { target: { value: "ghp_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save token" }));
    expect(await screen.findByText(/Enter the environment variable/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Environment variable" }), { target: { value: "GITHUB_TOKEN" } });
    fireEvent.click(screen.getByRole("button", { name: "Save token" }));
    await waitFor(() => expect(api.auth.configure).toHaveBeenCalledWith({ serverName: "github", envName: "GITHUB_TOKEN", authValue: "ghp_1" }));
    expect(onSignedIn).toHaveBeenCalled();
  });
});
