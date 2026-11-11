import { test, expect, type Page } from "@playwright/test";
import { goTo, withDashboard } from "./helpers";

// This spec owns the start/stop transition, so startup must not race it.
const config = { gateway: { port: 38773, autoStart: false } };

async function gatewayLabel(window: Page) {
  const nav = window.getByRole("navigation", { name: "Main" });
  return nav.getByText(/^Gateway (running|stopped)$/);
}

/**
 * Clicks the sidebar's Start/Stop control and waits for the label. The
 * control always re-reads the real daemon state after the call, so a lost
 * start race still converges on the true state; the error (if any) is shown
 * under the control and included in the failure message.
 */
async function toggleTo(window: Page, target: "Gateway running" | "Gateway stopped") {
  const nav = window.getByRole("navigation", { name: "Main" });
  await nav.getByRole("button", { name: target === "Gateway running" ? "Start" : "Stop" }).click();
  try {
    await expect(nav.getByText(target, { exact: true })).toBeVisible({ timeout: 20000 });
  } catch (error) {
    const feedback = await nav.getByRole("alert").textContent().catch(() => null);
    throw new Error(`${error instanceof Error ? error.message : String(error)}${feedback ? `\nGateway error: ${feedback}` : ""}`);
  }
}

test.describe("gateway control", () => {
  test("starting and stopping the gateway from the sidebar", async () => {
    test.setTimeout(90000);
    await withDashboard(async ({ window }) => {
      const label = await gatewayLabel(window);
      await expect(label).toBeVisible({ timeout: 15000 });
      const wasRunning = (await label.textContent())?.includes("running") ?? false;
      await toggleTo(window, wasRunning ? "Gateway stopped" : "Gateway running");
      await toggleTo(window, wasRunning ? "Gateway running" : "Gateway stopped");
    }, { config });
  });

  test("port and process details live in Settings > Advanced", async () => {
    test.setTimeout(60000);
    await withDashboard(async ({ window }) => {
      await goTo(window, "Settings");
      const advanced = window.getByRole("region", { name: "Advanced" });
      await expect(advanced.getByText(/Not running|Listening on port/)).toBeVisible();
      await expect(window.getByRole("navigation", { name: "Main" }).getByText(/port|PID/i)).toHaveCount(0);
    }, { config });
  });
});
