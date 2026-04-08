import type { McpxApi } from "../preload/index";

declare global {
  const __MCPX_DESKTOP_FLAVOR__: "production" | "dev";
  const __MCPX_DESKTOP_PRODUCT_NAME__: string;
  const __MCPX_DESKTOP_DEBUG__: boolean;

  interface Window {
    mcpx: McpxApi;
  }
}
