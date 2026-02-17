import { useEffect, useState } from "react";
import { StatusPopover } from "./components/StatusPopover";
import { Dashboard } from "./components/Dashboard";

export function App(): JSX.Element {
  const [view, setView] = useState<"popover" | "dashboard">("dashboard");

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash === "popover") {
      setView("popover");
    }
  }, []);

  if (view === "popover") {
    return <StatusPopover />;
  }

  return <Dashboard />;
}
