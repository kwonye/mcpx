import { test, expect, _electron as electron } from "@playwright/test";
import path from "path";

const mainPath = path.join(__dirname, "../src/main/index.ts");

test.describe("render", () => {
  test("should render dashboard content", async () => {
    // Wave 0 stub: implement in Wave 2
    // TODO: Verify #root exists, Dashboard renders, no blank screen
  });
});
