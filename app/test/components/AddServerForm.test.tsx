import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AddServerForm } from "../../src/renderer/components/AddServerForm";

describe("AddServerForm", () => {
  it("auto-submits with empty values when no required inputs", () => {
    const onSubmit = vi.fn();
    render(
      <AddServerForm requiredInputs={[]} onSubmit={onSubmit} onCancel={() => {}} />
    );
    expect(onSubmit).toHaveBeenCalledWith({});
  });

  it("renders input fields for required values", () => {
    render(
      <AddServerForm
        requiredInputs={[
          { name: "API_KEY", description: "Your API key", isSecret: true, kind: "env" }
        ]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByLabelText(/^API_KEY/)).toBeDefined();
    expect(screen.getByText("Your API key")).toBeDefined();
  });

  it("uses password input for secret fields", () => {
    render(
      <AddServerForm
        requiredInputs={[
          { name: "TOKEN", description: "Secret token", isSecret: true, kind: "env" }
        ]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    );
    const input = screen.getByLabelText(/^TOKEN/) as HTMLInputElement;
    expect(input.type).toBe("password");
  });

  it("uses text input for non-secret fields", () => {
    render(
      <AddServerForm
        requiredInputs={[
          { name: "PROJECT_ID", description: "Your project ID", isSecret: false, kind: "env" }
        ]}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    );
    const input = screen.getByLabelText(/^PROJECT_ID/) as HTMLInputElement;
    expect(input.type).toBe("text");
  });
});
