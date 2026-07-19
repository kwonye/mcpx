import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConfirmDialog } from "../../src/renderer/components/ConfirmDialog";

beforeEach(() => {
  Object.defineProperty(window, "mcpx", {
    value: {},
    writable: true
  });
});

describe("ConfirmDialog", () => {
  it("renders title and message when open", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        title="Delete Item"
        message="Are you sure you want to delete this item?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText("Delete Item")).toBeDefined();
    expect(screen.getByText("Are you sure you want to delete this item?")).toBeDefined();
  });

  it("fires onConfirm when confirm button is clicked", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        title="Confirm Action"
        message="Proceed?"
        confirmLabel="Yes, proceed"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    const confirmButton = screen.getByText("Yes, proceed") as HTMLButtonElement;
    expect(confirmButton).toBeDefined();

    fireEvent.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("fires onCancel when cancel button is clicked", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        title="Confirm"
        message="Continue?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    const cancelButton = screen.getByText("Cancel") as HTMLButtonElement;
    expect(cancelButton).toBeDefined();

    fireEvent.click(cancelButton);

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
