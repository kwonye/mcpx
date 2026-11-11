import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Server } from "lucide-react";
import { Badge, Button, EmptyState, InlineAlert, List, ListRow, SkeletonList, StatusLabel, ToastProvider, Tooltip, useToast, Section, SettingRow, Spinner } from "../../../src/renderer/components/ui";

afterEach(() => vi.useRealTimers());

function ToastTrigger() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.success("Saved github")}>ok</button>
      <button onClick={() => toast.error("Couldn't save", "Disk full")}>fail</button>
    </>
  );
}

describe("Toast", () => {
  it("auto-dismisses success but keeps errors until dismissed", () => {
    vi.useFakeTimers();
    render(<ToastProvider><ToastTrigger /></ToastProvider>);
    fireEvent.click(screen.getByText("ok"));
    fireEvent.click(screen.getByText("fail"));
    expect(screen.getByRole("status")).toHaveTextContent("Saved github");
    expect(screen.getByRole("alert")).toHaveTextContent("Disk full");
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByText("Saved github")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("InlineAlert", () => {
  it("uses role=alert for errors and offers dismiss + action", () => {
    const onDismiss = vi.fn();
    render(<InlineAlert tone="danger" title="Couldn't load" action={<Button>Try again</Button>} onDismiss={onDismiss}>Network down</InlineAlert>);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't loadNetwork down");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe("EmptyState", () => {
  it("explains and offers actions", () => {
    render(<EmptyState icon={Server} title="Add your first server" description="One sentence." actions={<Button>Add server</Button>} />);
    expect(screen.getByText("Add your first server")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add server" })).toBeInTheDocument();
  });
});

describe("List and ListRow", () => {
  it("makes the row body a button and keeps trailing controls separate", () => {
    const onOpen = vi.fn();
    const onTrailing = vi.fn();
    render(
      <List label="Servers">
        <ListRow title="github" subtitle="https://x" onOpen={onOpen} openLabel="github, Connected. Open details" trailing={<button onClick={onTrailing}>Toggle</button>} />
      </List>
    );
    expect(screen.getByRole("list", { name: "Servers" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "github, Connected. Open details" }));
    expect(onOpen).toHaveBeenCalled();
  });

  it("omits the extra area when its children render nothing", () => {
    const { container } = render(<List><ListRow title="x">{false}{null}</ListRow></List>);
    expect(container.querySelector(".ui-row__extra")).toBeNull();
  });
});

describe("Status, badges, skeletons, spinner", () => {
  it("pairs status colour with text", () => {
    render(<StatusLabel tone="warning">Needs sign-in</StatusLabel>);
    expect(screen.getByText("Needs sign-in")).toBeInTheDocument();
  });

  it("renders badges, a single loading status for skeleton lists, and labelled spinners", () => {
    render(<><Badge>Built-in</Badge><SkeletonList label="Loading servers" /><Spinner label="Saving" /></>);
    expect(screen.getByText("Built-in")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading servers" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Saving" })).toBeInTheDocument();
  });
});

describe("Tooltip", () => {
  it("describes its trigger after hover", () => {
    vi.useFakeTimers();
    render(<Tooltip content="Started 5 min ago"><button>Status</button></Tooltip>);
    fireEvent.pointerEnter(screen.getByRole("button").parentElement!);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Started 5 min ago");
    expect(screen.getByRole("button", { name: "Status" })).toHaveAccessibleDescription("Started 5 min ago");
  });
});

describe("Section and SettingRow", () => {
  it("label regions and rows", () => {
    render(<Section title="General"><SettingRow label="Start at login" description="Runs in the background" control={<button>t</button>} /></Section>);
    expect(screen.getByRole("region", { name: "General" })).toHaveTextContent("Start at login");
  });
});
