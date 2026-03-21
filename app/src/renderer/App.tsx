import { useState } from "react";
import { StatusPopover } from "./components/StatusPopover";
import { Dashboard } from "./components/Dashboard";

export function App() {
  const [view] = useState<"popover" | "dashboard">(() => {
    const hash = window.location.hash.replace("#", "");
    return hash === "popover" ? "popover" : "dashboard";
  });

  if (view === "popover") {
    return <StatusPopover />;
  }

  return <Dashboard />;
}
