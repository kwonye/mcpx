export type DesktopBuildFlavor = "production" | "dev";

export const DESKTOP_BUILD_FLAVOR = __MCPX_DESKTOP_FLAVOR__ satisfies DesktopBuildFlavor;
export const DESKTOP_PRODUCT_NAME = __MCPX_DESKTOP_PRODUCT_NAME__;
export const DESKTOP_DEBUG = __MCPX_DESKTOP_DEBUG__;
export const DESKTOP_MANAGER_NAME = `${DESKTOP_PRODUCT_NAME} Manager`;
