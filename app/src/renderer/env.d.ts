import type { McpxApi } from "../preload/index";

declare global {
  interface Window {
    mcpx: McpxApi;
  }
}
