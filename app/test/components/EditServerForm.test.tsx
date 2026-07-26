import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EditServerForm } from "../../src/renderer/components/EditServerForm";

beforeEach(() => {
  Object.defineProperty(window, "mcpx", {
    value: {
      invoke: vi.fn()
    },
    writable: true
  });
});

describe("EditServerForm", () => {
  describe("HTTP transport", () => {
    it("renders populated fields from an http server spec", () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(
        <EditServerForm
          serverName="test-server"
          transport="http"
          target="https://example.com/mcp"
          authBindings={[
            { kind: "header", key: "Authorization", value: "Bearer token123" }
          ]}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      expect(screen.getByDisplayValue("http")).toBeDefined();
      expect(screen.getByDisplayValue("https://example.com/mcp")).toBeDefined();
      expect(screen.getByDisplayValue("Bearer token123")).toBeDefined();
    });

    it("edits a field and submits with updated values", () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(
        <EditServerForm
          serverName="test-server"
          transport="http"
          target="https://old.com"
          authBindings={[]}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      const urlInput = screen.getByDisplayValue("https://old.com") as HTMLInputElement;
      fireEvent.change(urlInput, { target: { value: "https://new.com" } });

      const form = urlInput.closest("form")!;
      fireEvent.submit(form);

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const [spec, secrets] = onSubmit.mock.calls[0];
      expect(spec.transport).toBe("http");
      expect(spec.url).toBe("https://new.com");
      expect(secrets).toEqual({});
    });

    it("fires onCancel without saving", () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(
        <EditServerForm
          serverName="test-server"
          transport="http"
          target="https://example.com"
          authBindings={[]}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      const cancelBtn = screen.getByRole("button", { name: "Cancel" });
      fireEvent.click(cancelBtn);

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("preserves an existing secret-backed header binding when the form is submitted unchanged", () => {
      // Regression test: secret:// values are blanked in the renderer (the
      // secret's actual value never crosses the IPC boundary), but the old
      // submit logic treated that blank as "delete this binding" -- opening
      // an authenticated server and clicking Save Changes with no edits
      // silently stripped its Authorization header from config, and the
      // now-unauthenticated spec was immediately synced to every client.
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(
        <EditServerForm
          serverName="test-server"
          transport="http"
          target="https://example.com"
          authBindings={[
            { kind: "header", key: "Authorization", value: "secret://auth_test-server_header_authorization" }
          ]}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      // The password-typed input is intentionally blank (see comment above);
      // submitting without touching it must still preserve the original ref.
      const form = screen.getByRole("button", { name: "Save Changes" }).closest("form")!;
      fireEvent.submit(form);

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const [spec, secrets] = onSubmit.mock.calls[0];
      expect(spec.headers?.Authorization).toBe("secret://auth_test-server_header_authorization");
      // Nothing new was written to the secret store -- the existing secret is untouched.
      expect(secrets).toEqual({});
    });

    it("overwrites the same secret name when a new value is typed into an existing secret-backed row", () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(
        <EditServerForm
          serverName="test-server"
          transport="http"
          target="https://example.com"
          authBindings={[
            { kind: "header", key: "Authorization", value: "secret://auth_test-server_header_authorization" }
          ]}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      const valueInput = screen.getByPlaceholderText("Value") as HTMLInputElement;
      fireEvent.change(valueInput, { target: { value: "Bearer rotated-token" } });

      const form = screen.getByRole("button", { name: "Save Changes" }).closest("form")!;
      fireEvent.submit(form);

      const [spec, secrets] = onSubmit.mock.calls[0];
      expect(spec.headers?.Authorization).toBe("secret://auth_test-server_header_authorization");
      expect(secrets["auth_test-server_header_authorization"]).toBe("Bearer rotated-token");
    });

    it("drops the binding when an existing secret-backed row is explicitly removed", () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(
        <EditServerForm
          serverName="test-server"
          transport="http"
          target="https://example.com"
          authBindings={[
            { kind: "header", key: "Authorization", value: "secret://auth_test-server_header_authorization" }
          ]}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      fireEvent.click(screen.getByTitle("Remove"));

      const form = screen.getByRole("button", { name: "Save Changes" }).closest("form")!;
      fireEvent.submit(form);

      const [spec] = onSubmit.mock.calls[0];
      expect(spec.headers).toBeUndefined();
    });

    it("builds secret refs for header auth bindings when isSecret is true", () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(
        <EditServerForm
          serverName="test-server"
          transport="http"
          target="https://example.com"
          authBindings={[]}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      const addHeaderBtn = screen.getByRole("button", { name: "+ Add" });
      fireEvent.click(addHeaderBtn);

      const inputs = screen.getAllByPlaceholderText(/Header-Name|Value/);
      const keyInput = inputs[0] as HTMLInputElement;
      const valueInput = inputs[1] as HTMLInputElement;

      fireEvent.change(keyInput, { target: { value: "Authorization" } });
      fireEvent.change(valueInput, { target: { value: "Bearer secret-token" } });

      const form = screen.getByRole("button", { name: "Save Changes" }).closest("form")!;
      fireEvent.submit(form);

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const [spec, secrets] = onSubmit.mock.calls[0];
      expect(spec.transport).toBe("http");
      expect(spec.headers).toBeDefined();
      expect(Object.values(spec.headers || {})[0]).toMatch(/^secret:\/\//);
      expect(Object.keys(secrets).length).toBeGreaterThan(0);
    });
  });

  describe("stdio transport", () => {
    it("renders a stdio spec variant correctly", () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(
        <EditServerForm
          serverName="test-server"
          transport="stdio"
          target="node"
          authBindings={[
            { kind: "env", key: "API_KEY", value: "mykey" }
          ]}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      expect(screen.getByDisplayValue("stdio")).toBeDefined();
      expect(screen.getByDisplayValue("node")).toBeDefined();
      expect(screen.getByDisplayValue("mykey")).toBeDefined();
      expect(screen.queryByLabelText("URL")).toBeNull();
      expect(screen.getByLabelText("Command")).toBeDefined();
    });

    it("submits stdio spec with command and env vars", () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(
        <EditServerForm
          serverName="test-server"
          transport="stdio"
          target="python"
          authBindings={[]}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      const commandInput = screen.getByDisplayValue("python") as HTMLInputElement;
      fireEvent.change(commandInput, { target: { value: "python3" } });

      const argsInput = screen.getByPlaceholderText("e.g., -y @openai/stitch-mcp") as HTMLInputElement;
      fireEvent.change(argsInput, { target: { value: "script.py --verbose" } });

      const form = commandInput.closest("form")!;
      fireEvent.submit(form);

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const [spec, secrets] = onSubmit.mock.calls[0];
      expect(spec.transport).toBe("stdio");
      expect(spec.command).toBe("python3");
      expect(spec.args).toEqual(["script.py", "--verbose"]);
    });

    it("preserves an existing secret-backed env var when the form is submitted unchanged", () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(
        <EditServerForm
          serverName="test-server"
          transport="stdio"
          target="node"
          authBindings={[
            { kind: "env", key: "API_KEY", value: "secret://auth_test-server_env_api_key" }
          ]}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      const form = screen.getByRole("button", { name: "Save Changes" }).closest("form")!;
      fireEvent.submit(form);

      const [spec, secrets] = onSubmit.mock.calls[0];
      expect(spec.env?.API_KEY).toBe("secret://auth_test-server_env_api_key");
      expect(secrets).toEqual({});
    });

    it("creates secret env vars when saving", () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      render(
        <EditServerForm
          serverName="test-server"
          transport="stdio"
          target="node"
          authBindings={[]}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      const addEnvBtn = screen.getByRole("button", { name: "+ Add" });
      fireEvent.click(addEnvBtn);

      const inputs = screen.getAllByPlaceholderText(/KEY|Value/);
      const keyInput = inputs[0] as HTMLInputElement;
      const valueInput = inputs[1] as HTMLInputElement;

      fireEvent.change(keyInput, { target: { value: "API_KEY" } });
      fireEvent.change(valueInput, { target: { value: "my-secret-value" } });

      const form = screen.getByRole("button", { name: "Save Changes" }).closest("form")!;
      fireEvent.submit(form);

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const [spec, secrets] = onSubmit.mock.calls[0];
      expect(spec.transport).toBe("stdio");
      expect(spec.env).toBeDefined();
      expect(Object.values(spec.env || {})[0]).toMatch(/^secret:\/\//);
      expect(Object.keys(secrets).length).toBeGreaterThan(0);
    });
  });
});
