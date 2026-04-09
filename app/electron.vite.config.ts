import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const desktopFlavor = process.env.MCPX_DESKTOP_FLAVOR === "dev" ? "dev" : "production";
const desktopProductName = desktopFlavor === "dev" ? "mcpx-dev" : "mcpx";
const desktopDebug = process.env.MCPX_DESKTOP_DEBUG === "1";

process.env.VITE_MCPX_DESKTOP_PRODUCT_NAME = desktopProductName;

const define = {
  __MCPX_DESKTOP_FLAVOR__: JSON.stringify(desktopFlavor),
  __MCPX_DESKTOP_PRODUCT_NAME__: JSON.stringify(desktopProductName),
  __MCPX_DESKTOP_DEBUG__: JSON.stringify(desktopDebug)
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define,
    build: {
      sourcemap: desktopDebug,
      minify: desktopDebug ? false : undefined
    },
    resolve: {
      alias: {
        "@mcpx/core": resolve(__dirname, "../cli/src/core/index.ts")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    define,
    build: {
      sourcemap: desktopDebug,
      minify: desktopDebug ? false : undefined,
      rollupOptions: {
        input: resolve(__dirname, "src/preload/index.ts")
      }
    }
  },
  renderer: {
    plugins: [react()],
    define,
    build: {
      sourcemap: desktopDebug,
      minify: desktopDebug ? false : undefined
    },
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "src/renderer")
      }
    }
  }
});
