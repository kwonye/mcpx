/**
 * Every IPC channel between the renderer/preload and the main process.
 *
 * Request/response shapes live in `ipc-contract.ts`; runtime argument
 * validation (zod) lives in `ipc-schemas.ts` and is applied by every handler
 * in `src/main/ipc-handlers.ts`. Keys marked "event" are main -> renderer
 * broadcasts rather than invoke/handle pairs.
 */
export const IPC = {
  // App + window
  OPEN_DASHBOARD: "mcpx:open-dashboard",
  QUIT_APP: "mcpx:quit-app",
  /** event: main -> dashboard, payload is one route string (see DashboardRoute). */
  NAVIGATE: "navigate",

  // Status + gateway
  GET_STATUS: "mcpx:get-status",
  GET_TOKEN_COUNTS: "mcpx:get-token-counts",
  SYNC_ALL: "mcpx:sync-all",
  DAEMON_START: "mcpx:daemon-start",
  DAEMON_STOP: "mcpx:daemon-stop",
  DAEMON_RESTART: "mcpx:daemon-restart",

  // Local management service (harnesses, adoption, activity)
  MANAGEMENT_SNAPSHOT: "mcpx:management-snapshot",
  ADOPTION_PLAN: "mcpx:adoption-plan",
  ADOPTION_APPLY: "mcpx:adoption-apply",
  OPERATION_ROLLBACK: "mcpx:operation-rollback",
  HARNESS_SET_MODE: "mcpx:harness-set-mode",
  /** event: main -> all windows when the management service reports a change. */
  MANAGEMENT_EVENT: "mcpx:management-event",

  // Secrets storage
  GET_SECRET_BACKEND: "mcpx:get-secret-backend",
  SET_SECRET_BACKEND: "mcpx:set-secret-backend",

  // Desktop settings + telemetry
  GET_DESKTOP_SETTINGS: "mcpx:get-desktop-settings",
  UPDATE_DESKTOP_SETTINGS: "mcpx:update-desktop-settings",
  GET_TELEMETRY_STATUS: "mcpx:get-telemetry-status",
  ACKNOWLEDGE_TELEMETRY_NOTICE: "mcpx:acknowledge-telemetry-notice",
  UPDATE_TELEMETRY_PREFERENCES: "mcpx:update-telemetry-preferences",
  RESET_TELEMETRY_ID: "mcpx:reset-telemetry-id",
  CAPTURE_DESKTOP_TAB_VIEWED: "mcpx:capture-desktop-tab-viewed",
  /** event: main -> all windows, payload TelemetryStatus. */
  TELEMETRY_CHANGED: "mcpx:telemetry-changed",
  CHECK_FOR_UPDATES: "mcpx:check-for-updates",

  // Servers
  PARSE_SERVER_INPUT: "mcpx:parse-server-input",
  ADD_SERVER: "mcpx:add-server",
  UPDATE_SERVER: "mcpx:update-server",
  REMOVE_SERVER: "mcpx:remove-server",
  SET_SERVER_ENABLED: "mcpx:set-server-enabled",

  // Auth
  CONFIGURE_AUTH: "mcpx:configure-auth",
  GET_PENDING_AUTH: "mcpx:get-pending-auth",
  /** event: main -> all windows, payload PendingAuthEntry[]. */
  AUTH_STATE_CHANGED: "mcpx:auth-state-changed",
  REQUEST_AUTH: "mcpx:request-auth",
  DISMISS_AUTH: "mcpx:dismiss-auth",
  CHECK_OAUTH_SUPPORT: "mcpx:check-oauth-support",
  START_OAUTH: "mcpx:start-oauth",
  CANCEL_OAUTH: "mcpx:cancel-oauth",
  OAUTH_REOPEN: "mcpx:oauth-reopen",
  /** event: main -> all windows, payload OAuthProgressPayload. */
  OAUTH_PROGRESS: "mcpx:oauth-progress",

  // Projects
  PROJECT_INIT: "mcpx:project-init",
  PROJECT_REMOVE: "mcpx:project-remove",
  PROJECT_SET_SERVER_ENABLED: "mcpx:project-set-server-enabled",
  SELECT_DIRECTORY: "mcpx:select-directory",

  // Skills
  LIST_SKILLS: "mcpx:list-skills",
  SAVE_SKILL: "mcpx:save-skill",
  DELETE_SKILL: "mcpx:delete-skill",
  INSTALL_SKILL: "mcpx:install-skill",
  CUSTOMIZE_SKILL: "mcpx:customize-skill",
  PIN_SKILL: "mcpx:pin-skill",
  UNPIN_SKILL: "mcpx:unpin-skill",
  UPDATE_SKILL: "mcpx:update-skill",
  ROLLBACK_SKILL: "mcpx:rollback-skill",

  // Environment sharing
  SHARE_EXPORT: "mcpx:share-export",
  SHARE_IMPORT: "mcpx:share-import",

  // Plugins
  PLUGIN_LIST: "mcpx:plugin-list",
  PLUGIN_INSTALL: "mcpx:plugin-install",
  PLUGIN_UPDATE: "mcpx:plugin-update",
  PLUGIN_PIN: "mcpx:plugin-pin",
  PLUGIN_UNPIN: "mcpx:plugin-unpin",
  PLUGIN_ROLLBACK: "mcpx:plugin-rollback",
  PLUGIN_UNINSTALL: "mcpx:plugin-uninstall",
  PLUGIN_ENABLE: "mcpx:plugin-enable",
  PLUGIN_DISABLE: "mcpx:plugin-disable",
  PLUGIN_APPROVE: "mcpx:plugin-approve",
  PLUGIN_SET_PROJECT_OVERRIDE: "mcpx:plugin-set-project-override",
  PLUGIN_RESET_PROJECT_OVERRIDE: "mcpx:plugin-reset-project-override",

  // Marketplaces (add-on sources)
  MARKETPLACE_LIST: "mcpx:marketplace-list",
  MARKETPLACE_ADD: "mcpx:marketplace-add",
  MARKETPLACE_REFRESH: "mcpx:marketplace-refresh",
  MARKETPLACE_REMOVE: "mcpx:marketplace-remove",
  MARKETPLACE_SET_AUTO_UPDATE: "mcpx:marketplace-set-auto-update",
  MARKETPLACE_BROWSE: "mcpx:marketplace-browse",
  MARKETPLACE_INSPECT_PLUGIN: "mcpx:marketplace-inspect-plugin",
  MARKETPLACE_INSTALL_PLUGIN: "mcpx:marketplace-install-plugin"
} as const;

export type IpcChannelKey = keyof typeof IPC;
export type IpcChannel = (typeof IPC)[IpcChannelKey];

/** Routes the main process may send on IPC.NAVIGATE. */
export const DASHBOARD_ROUTES = ["servers", "clients", "addons", "projects", "settings"] as const;
export type DashboardRoute = (typeof DASHBOARD_ROUTES)[number];
/**
 * Optional intent suffix the desktop app itself uses (e.g. the popover's
 * "Add server" sends "servers:add"). Renderers ignore unknown suffixes.
 */
export type DashboardIntent = DashboardRoute | `${DashboardRoute}:${string}`;
