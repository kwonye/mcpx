import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Button, ConfirmDialog, Dialog } from "../../../src/renderer/components/ui";

describe("Dialog", () => {
  it("renders a labelled modal dialog and focuses its first field", () => {
    render(
      <Dialog open onClose={() => {}} title="Add a server" description="Paste anything">
        <input aria-label="Source" />
      </Dialog>
    );
    const dialog = screen.getByRole("dialog", { name: "Add a server" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Paste anything");
    expect(screen.getByRole("textbox", { name: "Source" })).toHaveFocus();
  });

  it("closes on Escape and from the close button", () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="T"><p>Body</p></Dialog>);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("cannot be dismissed while not dismissible", () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="T" dismissible={false}><p>Body</p></Dialog>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("traps Tab focus inside the dialog", () => {
    render(
      <Dialog open onClose={() => {}} title="T" footer={<Button>Last</Button>}>
        <input aria-label="First" />
      </Dialog>
    );
    screen.getByRole("button", { name: "Last" }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
  });

  it("restores focus to the trigger when closed", () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <>
          <button>Trigger</button>
          <Dialog open={open} onClose={() => {}} title="T"><input aria-label="Inside" /></Dialog>
        </>
      );
    }
    const { rerender } = render(<Harness open={false} />);
    screen.getByRole("button", { name: "Trigger" }).focus();
    rerender(<Harness open />);
    expect(screen.getByRole("textbox", { name: "Inside" })).toHaveFocus();
    rerender(<Harness open={false} />);
    expect(screen.getByRole("button", { name: "Trigger" })).toHaveFocus();
  });
});

describe("ConfirmDialog", () => {
  it("focuses Cancel for destructive confirmations", () => {
    render(<ConfirmDialog open title="Remove github?" message="Gone." destructive onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("alertdialog", { name: "Remove github?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("shows a failed confirmation inside the dialog and stays open", async () => {
    const onConfirm = vi.fn(async () => {
      throw new Error("Server is in use");
    });
    render(<ConfirmDialog open title="Remove?" message="m" confirmLabel="Remove" onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Server is in use"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
