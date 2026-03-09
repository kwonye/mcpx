import { test, expect, _electron as electron } from "@playwright/test";
import path from "path";

const mainPath = path.join(__dirname, "../src/main/index.ts");

test.describe("launch reliability", () => {
  test("should launch 10 times consecutively", async () => {
    // Wave 0 stub: implement in Wave 1
    // TODO: Loop 10x: launch app, verify pid, close app
  });
});
