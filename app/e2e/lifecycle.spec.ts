import { test, expect, _electron as electron } from "@playwright/test";
import path from "path";

const mainPath = path.join(__dirname, "../src/main/index.ts");

test.describe("window-all-closed", () => {
  test("should keep app running after window close", async () => {
    // Wave 0 stub: implement in Wave 2
  });
});

test.describe("activate", () => {
  test("should reopen window on dock click", async () => {
    // Wave 0 stub: implement in Wave 2
  });
});

test.describe("before-quit", () => {
  test("should quit entirely on Cmd+Q", async () => {
    // Wave 0 stub: implement in Wave 2
  });
});
