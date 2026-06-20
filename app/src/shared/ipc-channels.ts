export const IPC = {
  GET_STATUS: "mcpx:get-status",
  GET_SERVERS: "mcpx:get-servers",
  GET_DESKTOP_SETTINGS: "mcpx:get-desktop-settings",
  ADD_SERVER: "mcpx:add-server",
  UPDATE_SERVER: "mcpx:update-server",
  REMOVE_SERVER: "mcpx:remove-server",
  SET_SERVER_ENABLED: "mcpx:set-server-enabled",
  CONFIGURE_AUTH: "mcpx:configure-auth",
  GET_PENDING_AUTH: "mcpx:get-pending-auth",
  AUTH_REQUIRED: "mcpx:auth-required",
  START_OAUTH: "mcpx:start-oauth",
  DISMISS_AUTH: "mcpx:dismiss-auth",
  UPDATE_DESKTOP_SETTINGS: "mcpx:update-desktop-settings",
  CHECK_FOR_UPDATES: "mcpx:check-for-updates",
  SYNC_ALL: "mcpx:sync-all",
  DAEMON_START: "mcpx:daemon-start",
  DAEMON_STOP: "mcpx:daemon-stop",
  DAEMON_RESTART: "mcpx:daemon-restart",
  OPEN_DASHBOARD: "mcpx:open-dashboard",
  QUIT_APP: "mcpx:quit-app",
  EXECUTE_CLI_COMMAND: "mcpx:execute-cli-command",

  // Skills
  LIST_SKILLS: "mcpx:list-skills",
  GET_SKILL: "mcpx:get-skill",
  SAVE_SKILL: "mcpx:save-skill",
  DELETE_SKILL: "mcpx:delete-skill",

  // Projects
  PROJECT_INIT: "mcpx:project-init",
  PROJECT_REMOVE: "mcpx:project-remove",
  PROJECT_SET_SERVER_ENABLED: "mcpx:project-set-server-enabled",
  SELECT_DIRECTORY: "mcpx:select-directory"
} as const;
