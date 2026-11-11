import { test, expect } from "@playwright/test";
import { goTo, readConfig, withDashboard } from "./helpers";

// Local commands only: no network access is needed for these flows.
const config = { gateway: { autoStart: false } };

test.describe("add server flow", () => {
  test("adds a local server from a pasted add command and removes it again", async () => {
    test.setTimeout(60000);
    await withDashboard(async ({ window, sandbox }) => {
      await goTo(window, "Servers");
      await expect(window.getByText("Add your first server")).toBeVisible();
      await window.getByRole("button", { name: "Add server" }).first().click();

      const source = window.getByRole("dialog", { name: "Add a server" });
      await source.getByRole("textbox", { name: "URL or command" }).fill("mcpx add e2etest --env API_TOKEN=abc123 -- echo hi");
      await source.getByRole("button", { name: "Continue" }).click();

      const details = window.getByRole("dialog", { name: "Check the details" });
      await expect(details.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("e2etest");
      await expect(details.getByRole("textbox", { name: "Command" })).toHaveValue("echo");
      await details.getByRole("button", { name: "Add server" }).click();

      const done = window.getByRole("dialog", { name: "e2etest is ready" });
      await expect(done).toBeVisible({ timeout: 15000 });
      await done.getByRole("button", { name: "Done" }).click();
      await expect(window.getByRole("button", { name: /^e2etest, / })).toBeVisible();

      const saved = readConfig(sandbox).servers.e2etest;
      expect(saved.command).toBe("echo");
      // Secret-looking values never land in the config as plain text.
      expect(JSON.stringify(saved)).not.toContain("abc123");

      await window.getByRole("button", { name: "More actions for e2etest" }).click();
      await window.getByRole("menuitem", { name: "Remove" }).click();
      await window.getByRole("alertdialog", { name: "Remove e2etest?" }).getByRole("button", { name: "Remove" }).click();
      await expect(window.getByText("Add your first server")).toBeVisible({ timeout: 15000 });
      expect(readConfig(sandbox).servers.e2etest).toBeUndefined();
    }, { config });
  });

  test("shows an inline error for input it can't read", async () => {
    test.setTimeout(60000);
    await withDashboard(async ({ window }) => {
      await window.getByRole("button", { name: "Add server" }).first().click();
      const dialog = window.getByRole("dialog", { name: "Add a server" });
      await dialog.getByRole("textbox", { name: "URL or command" }).fill("claude mcp add");
      await dialog.getByRole("button", { name: "Continue" }).click();
      await expect(dialog.getByRole("alert")).toContainText("Couldn't read that command");
    }, { config });
  });

  test("toggles a server on and off from the list", async () => {
    test.setTimeout(60000);
    await withDashboard(async ({ window, sandbox }) => {
      await window.evaluate(() => window.mcpx.servers.add({ name: "toggle-me", spec: { transport: "stdio", command: "echo" } }));
      await window.reload();
      const toggle = window.getByRole("switch", { name: "toggle-me enabled" });
      await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 15000 });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await expect.poll(() => readConfig(sandbox).servers["toggle-me"].enabled).toBe(false);
    }, { config });
  });
});
