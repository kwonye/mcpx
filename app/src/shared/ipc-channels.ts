export const IPC = {
  GET_STATUS: "mcpx:get-status",
  GET_SERVERS: "mcpx:get-servers",
  GET_DESKTOP_SETTINGS: "mcpx:get-desktop-settings",
  ADD_SERVER: "mcpx:add-server",
  REMOVE_SERVER: "mcpx:remove-server",
  UPDATE_DESKTOP_SETTINGS: "mcpx:update-desktop-settings",
  SYNC_ALL: "mcpx:sync-all",
  DAEMON_START: "mcpx:daemon-start",
  DAEMON_STOP: "mcpx:daemon-stop",
  DAEMON_RESTART: "mcpx:daemon-restart",
  REGISTRY_LIST: "mcpx:registry-list",
  REGISTRY_GET: "mcpx:registry-get",
  REGISTRY_PREPARE_ADD: "mcpx:registry-prepare-add",
  REGISTRY_CONFIRM_ADD: "mcpx:registry-confirm-add",
  OPEN_DASHBOARD: "mcpx:open-dashboard"
} as const;
