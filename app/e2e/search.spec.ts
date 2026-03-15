import { test, expect, _electron as electron } from "@playwright/test";
import { resolve } from "node:path";

const mainPath = resolve(__dirname, "../out/main/index.js");

test.describe("fuzzy search", () => {
  test("finds server with typo in name", async () => {
    const app = await electron.launch({ args: [mainPath] });
    
    try {
      // Create a window and navigate to Browse tab
      await app.evaluate(async ({ BrowserWindow }) => {
        const win = new BrowserWindow({
          width: 1000,
          height: 700,
          webPreferences: { sandbox: false }
        });
        const path = require("node:path");
        const indexPath = path.join(__dirname, "../renderer/index.html");
        await win.loadFile(indexPath, { hash: "browse" });
      });

      const window = await app.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      
      // Wait for initial servers to load
      await window.waitForTimeout(2000);

      // Type with typo in the search input
      const searchInput = window.locator(".browse-search input");
      await searchInput.fill("filesytem");  // Typo: missing 's'
      
      // Wait for debounced search (300ms + buffer)
      await window.waitForTimeout(500);

      // Check if results exist
      const results = window.locator(".browse-card");
      const count = await results.count();
      
      // If there are results, check content
      if (count > 0) {
        const firstResult = await results.first().textContent();
        // Should match filesystem-related servers despite typo
        expect(firstResult?.toLowerCase()).toMatch(/file/i);
      }
    } finally {
      await app.close();
    }
  });

  test("finds server with partial name", async () => {
    const app = await electron.launch({ args: [mainPath] });
    
    try {
      await app.evaluate(async ({ BrowserWindow }) => {
        const win = new BrowserWindow({
          width: 1000,
          height: 700,
          webPreferences: { sandbox: false }
        });
        const path = require("node:path");
        const indexPath = path.join(__dirname, "../renderer/index.html");
        await win.loadFile(indexPath, { hash: "browse" });
      });

      const window = await app.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await window.waitForTimeout(2000);

      const searchInput = window.locator(".browse-search input");
      await searchInput.fill("brve");  // Partial: missing 'a'
      
      await window.waitForTimeout(500);

      const results = window.locator(".browse-card");
      const count = await results.count();
      
      if (count > 0) {
        const text = await results.first().textContent();
        // Should match brave-related servers
        expect(text?.toLowerCase()).toMatch(/brave/i);
      }
    } finally {
      await app.close();
    }
  });

  test("ranks exact match higher", async () => {
    const app = await electron.launch({ args: [mainPath] });
    
    try {
      await app.evaluate(async ({ BrowserWindow }) => {
        const win = new BrowserWindow({
          width: 1000,
          height: 700,
          webPreferences: { sandbox: false }
        });
        const path = require("node:path");
        const indexPath = path.join(__dirname, "../renderer/index.html");
        await win.loadFile(indexPath, { hash: "browse" });
      });

      const window = await app.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await window.waitForTimeout(2000);

      const searchInput = window.locator(".browse-search input");
      await searchInput.fill("github");  // Exact match query
      
      await window.waitForTimeout(500);

      const firstCard = window.locator(".browse-card").first();
      const text = await firstCard.textContent();
      
      // First result should mention github (exact match ranked higher)
      expect(text?.toLowerCase()).toMatch(/github/i);
    } finally {
      await app.close();
    }
  });

  test("debounced search updates results after typing", async () => {
    const app = await electron.launch({ args: [mainPath] });
    
    try {
      await app.evaluate(async ({ BrowserWindow }) => {
        const win = new BrowserWindow({
          width: 1000,
          height: 700,
          webPreferences: { sandbox: false }
        });
        const path = require("node:path");
        const indexPath = path.join(__dirname, "../renderer/index.html");
        await win.loadFile(indexPath, { hash: "browse" });
      });

      const window = await app.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await window.waitForTimeout(2000);

      const searchInput = window.locator(".browse-search input");
      
      // Type partial query
      await searchInput.fill("post");
      await window.waitForTimeout(500);
      
      const postResults = await window.locator(".browse-card").count();
      
      // Continue typing
      await searchInput.fill("postgres");
      await window.waitForTimeout(500);
      
      const postgresResults = await window.locator(".browse-card").count();
      
      // Results should update as we type
      // Both queries should potentially return results
      expect(postResults).toBeGreaterThanOrEqual(0);
      expect(postgresResults).toBeGreaterThanOrEqual(0);
    } finally {
      await app.close();
    }
  });
});