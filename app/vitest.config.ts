import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  define: {
    __MCPX_DESKTOP_FLAVOR__: JSON.stringify("production"),
    __MCPX_DESKTOP_PRODUCT_NAME__: JSON.stringify("mcpx"),
    __MCPX_DESKTOP_DEBUG__: JSON.stringify(false)
  },
  test: {
    environment: "jsdom",
    globals: true,
    exclude: ["e2e/**", "node_modules/**"]
  },
  resolve: {
    alias: {
      "@mcpx/core": resolve(__dirname, "../cli/src/core/index.ts")
    }
  }
});
