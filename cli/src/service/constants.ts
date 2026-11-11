// Shared identifiers for the OS service and daemon process contract.

/** Consistent with the desktop app's bundle id (app/package.json build.appId). */
export const LAUNCHD_LABEL = "io.github.kwonye.mcpx.gateway";
export const SYSTEMD_UNIT_NAME = "mcpx.service";
export const XDG_AUTOSTART_FILE = "mcpx-gateway.desktop";
export const WINDOWS_TASK_PREFIX = "mcpx-gateway";

/** Another mcpx daemon already holds the instance guard for this user/home. */
export const DAEMON_EXIT_ALREADY_RUNNING = 75;
/** The configured gateway port is held by a process that is not our daemon. */
export const DAEMON_EXIT_PORT_IN_USE = 78;

/** Set in the service definition: the daemon runs under an OS supervisor. */
export const SUPERVISED_ENV = "MCPX_SUPERVISED";
/** Set in the service definition: the daemon writes its own output to this file. */
export const DAEMON_LOG_FILE_ENV = "MCPX_DAEMON_LOG_FILE";
