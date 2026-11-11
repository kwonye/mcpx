import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Plus, Trash2 } from "lucide-react";
import { Button, IconButton } from "../../../src/renderer/components/ui";

describe("Button", () => {
  it("renders its label and handles clicks", () => {
    const onClick = vi.fn();
    render(<Button icon={Plus} onClick={onClick}>Add server</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("defaults to type=button so it never submits forms by accident", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "button");
  });

  it("is busy and disabled while loading", () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("IconButton", () => {
  it("is named by its label", () => {
    render(<IconButton icon={Trash2} label="Remove github" />);
    expect(screen.getByRole("button", { name: "Remove github" })).toBeInTheDocument();
  });

  it("shows its label as a tooltip on keyboard focus", () => {
    render(<IconButton icon={Trash2} label="Remove github" />);
    const button = screen.getByRole("button", { name: "Remove github" });
    button.matches = () => true; // jsdom has no :focus-visible
    fireEvent.focus(button);
    expect(screen.getByText("Remove github", { selector: ".ui-tooltip" })).toBeInTheDocument();
  });
});
