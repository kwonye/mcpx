/// <reference path="./build-flags.d.ts" />

export type DesktopBuildFlavor = "production" | "dev";

export const DESKTOP_BUILD_FLAVOR = __MCPX_DESKTOP_FLAVOR__ satisfies DesktopBuildFlavor;
export const DESKTOP_PRODUCT_NAME = __MCPX_DESKTOP_PRODUCT_NAME__;
export const DESKTOP_DEBUG = __MCPX_DESKTOP_DEBUG__;
export const DESKTOP_MANAGER_NAME = DESKTOP_PRODUCT_NAME;
export const TELEMETRY_BUILD_CONFIG = {
  posthogToken: typeof __MCPX_POSTHOG_PROJECT_TOKEN__ === "undefined" ? "" : __MCPX_POSTHOG_PROJECT_TOKEN__,
  posthogHost: typeof __MCPX_POSTHOG_HOST__ === "undefined" ? "" : __MCPX_POSTHOG_HOST__,
  sentryDsn: typeof __MCPX_SENTRY_DSN__ === "undefined" ? "" : __MCPX_SENTRY_DSN__,
  sentryRelease: typeof __MCPX_SENTRY_RELEASE__ === "undefined" ? "" : __MCPX_SENTRY_RELEASE__
} as const;
