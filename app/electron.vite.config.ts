import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const desktopFlavor = process.env.MCPX_DESKTOP_FLAVOR === "dev" ? "dev" : "production";
const desktopProductName = desktopFlavor === "dev" ? "mcpx-dev" : "mcpx";
const desktopDebug = process.env.MCPX_DESKTOP_DEBUG === "1";
const productionSourcemap = desktopDebug ? true : "hidden" as const;
const buildPostHogToken = process.env.MCPX_POSTHOG_PROJECT_TOKEN ?? "";
const buildPostHogHost = process.env.MCPX_POSTHOG_HOST ?? "";
const buildSentryDsn = process.env.MCPX_SENTRY_DSN ?? "";
const buildSentryRelease = process.env.MCPX_SENTRY_RELEASE ?? "";

process.env.VITE_MCPX_DESKTOP_PRODUCT_NAME = desktopProductName;

const define = {
  __MCPX_DESKTOP_FLAVOR__: JSON.stringify(desktopFlavor),
  __MCPX_DESKTOP_PRODUCT_NAME__: JSON.stringify(desktopProductName),
  __MCPX_DESKTOP_DEBUG__: JSON.stringify(desktopDebug),
  __MCPX_POSTHOG_PROJECT_TOKEN__: JSON.stringify(buildPostHogToken),
  __MCPX_POSTHOG_HOST__: JSON.stringify(buildPostHogHost),
  __MCPX_SENTRY_DSN__: JSON.stringify(buildSentryDsn),
  __MCPX_SENTRY_RELEASE__: JSON.stringify(buildSentryRelease)
};

const telemetryDefine = Object.fromEntries([
  ["process.env.MCPX_POSTHOG_PROJECT_TOKEN", process.env.MCPX_POSTHOG_PROJECT_TOKEN],
  ["process.env.POSTHOG_PROJECT_TOKEN", process.env.POSTHOG_PROJECT_TOKEN],
  ["process.env.MCPX_POSTHOG_HOST", process.env.MCPX_POSTHOG_HOST],
  ["process.env.POSTHOG_HOST", process.env.POSTHOG_HOST],
  ["process.env.MCPX_SENTRY_DSN", process.env.MCPX_SENTRY_DSN],
  ["process.env.SENTRY_DSN", process.env.SENTRY_DSN],
  ["process.env.MCPX_SENTRY_RELEASE", process.env.MCPX_SENTRY_RELEASE]
].filter(([, value]) => value !== undefined).map(([key, value]) => [key, JSON.stringify(value)]));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: { ...define, ...telemetryDefine },
    build: {
      sourcemap: productionSourcemap,
      minify: desktopDebug ? false : undefined,
      rollupOptions: {
        external: ["@iarna/toml"]
      }
    },
    resolve: {
      alias: {
        "@mcpx/core": resolve(__dirname, "../cli/src/core/index.ts")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    define: { ...define, ...telemetryDefine },
    build: {
      sourcemap: productionSourcemap,
      minify: desktopDebug ? false : undefined,
      rollupOptions: {
        input: resolve(__dirname, "src/preload/index.ts")
      }
    }
  },
  renderer: {
    plugins: [react()],
    define: { ...define, ...telemetryDefine },
    build: {
      sourcemap: productionSourcemap,
      minify: desktopDebug ? false : undefined
    },
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "src/renderer")
      }
    }
  }
});
