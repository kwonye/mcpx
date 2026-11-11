/**
 * Runtime argument schemas for every invoke channel. Main-process only (zod is
 * not bundled into the sandboxed preload). `satisfies` keeps each schema in
 * lock-step with the argument tuple declared in `ipc-contract.ts`.
 */
import { z } from "zod";
import { IPC } from "./ipc-channels";
import type { InvokeChannel, IpcArgs } from "./ipc-contract";

const name = z.string().trim().min(1, "Name must not be empty");
const nonEmpty = z.string().min(1);
const path = z.string().trim().min(1, "Path must not be empty");
const secretName = z.string().regex(/^[A-Za-z0-9._-]+$/, "Invalid secret name");
const stringRecord = z.record(z.string(), z.string());

export const httpSpecSchema = z.object({
  transport: z.literal("http"),
  url: z.string().trim().min(1, "URL is required"),
  headers: stringRecord.optional(),
  enabled: z.boolean().optional()
});

export const stdioSpecSchema = z.object({
  transport: z.literal("stdio"),
  command: z.string().trim().min(1, "Command is required"),
  args: z.array(z.string()).optional(),
  env: stringRecord.optional(),
  cwd: z.string().optional(),
  enabled: z.boolean().optional()
});

export const serverSpecSchema = z.discriminatedUnion("transport", [httpSpecSchema, stdioSpecSchema]);

const secretsSchema = z.record(secretName, z.string()).optional();
const pluginComponent = z.enum(["mcpServers", "skills", "hooks", "agents", "commands"]);
const desktopTab = z.enum(["servers", "projects", "plugins", "settings"]);

const none = z.tuple([]);
const one = <T extends z.ZodType>(schema: T) => z.tuple([schema]);

export const ipcSchemas = {
  [IPC.OPEN_DASHBOARD]: z.tuple([z.object({ route: z.string().max(64).optional() }).optional()]),
  [IPC.QUIT_APP]: none,

  [IPC.GET_STATUS]: none,
  [IPC.GET_TOKEN_COUNTS]: none,
  [IPC.SYNC_ALL]: none,
  [IPC.DAEMON_START]: none,
  [IPC.DAEMON_STOP]: none,
  [IPC.DAEMON_RESTART]: none,

  [IPC.GET_DESKTOP_SETTINGS]: none,
  [IPC.UPDATE_DESKTOP_SETTINGS]: one(z.object({
    autoUpdateEnabled: z.boolean().optional(),
    startOnLoginEnabled: z.boolean().optional(),
    errorNotificationsEnabled: z.boolean().optional(),
    activeTab: desktopTab.optional()
  }).strict()),
  [IPC.GET_TELEMETRY_STATUS]: none,
  [IPC.ACKNOWLEDGE_TELEMETRY_NOTICE]: none,
  [IPC.UPDATE_TELEMETRY_PREFERENCES]: one(z.object({
    usageAnalyticsEnabled: z.boolean().optional(),
    errorReportingEnabled: z.boolean().optional()
  }).strict()),
  [IPC.RESET_TELEMETRY_ID]: none,
  [IPC.CAPTURE_DESKTOP_TAB_VIEWED]: one(desktopTab),
  [IPC.CHECK_FOR_UPDATES]: none,

  [IPC.PARSE_SERVER_INPUT]: one(z.string().trim().min(1, "Paste a URL or command").max(8192)),
  [IPC.ADD_SERVER]: one(z.object({
    name,
    spec: serverSpecSchema,
    secrets: secretsSchema,
    force: z.boolean().optional()
  })),
  [IPC.UPDATE_SERVER]: z.tuple([name, serverSpecSchema, secretsSchema]),
  [IPC.REMOVE_SERVER]: one(name),
  [IPC.SET_SERVER_ENABLED]: z.tuple([name, z.boolean()]),

  [IPC.CONFIGURE_AUTH]: one(z.object({
    serverName: name,
    headerName: z.string().trim().min(1, "Header name is required"),
    authValue: z.string().min(1, "Token is required"),
    secretName: secretName.optional(),
    raw: z.boolean().optional()
  })),
  [IPC.GET_PENDING_AUTH]: none,
  [IPC.REQUEST_AUTH]: one(name),
  [IPC.DISMISS_AUTH]: one(name),
  [IPC.CHECK_OAUTH_SUPPORT]: one(name),
  [IPC.START_OAUTH]: one(name),
  [IPC.CANCEL_OAUTH]: one(name),
  [IPC.OAUTH_REOPEN]: one(name),

  [IPC.PROJECT_INIT]: z.tuple([path, name]),
  [IPC.PROJECT_REMOVE]: one(path),
  [IPC.PROJECT_SET_SERVER_ENABLED]: z.tuple([path, name, z.boolean()]),
  [IPC.SELECT_DIRECTORY]: none,

  [IPC.LIST_SKILLS]: none,
  [IPC.SAVE_SKILL]: z.tuple([name, z.string()]),
  [IPC.DELETE_SKILL]: one(name),
  [IPC.INSTALL_SKILL]: z.tuple([nonEmpty, z.string().optional()]),
  [IPC.CUSTOMIZE_SKILL]: z.tuple([name, z.string().optional()]),
  [IPC.PIN_SKILL]: one(name),
  [IPC.UNPIN_SKILL]: one(name),
  [IPC.UPDATE_SKILL]: one(name),
  [IPC.ROLLBACK_SKILL]: one(name),

  [IPC.SHARE_EXPORT]: z.tuple([path, z.object({
    skills: z.array(z.string()).optional(),
    plugins: z.array(z.string()).optional()
  }).optional()]),
  [IPC.SHARE_IMPORT]: z.tuple([path, z.object({
    locked: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    inputs: stringRecord.optional()
  }).optional()]),

  [IPC.PLUGIN_LIST]: none,
  [IPC.PLUGIN_INSTALL]: one(z.string().trim().min(1, "Enter a source to install from")),
  [IPC.PLUGIN_UPDATE]: one(name),
  [IPC.PLUGIN_PIN]: one(name),
  [IPC.PLUGIN_UNPIN]: one(name),
  [IPC.PLUGIN_ROLLBACK]: one(name),
  [IPC.PLUGIN_UNINSTALL]: z.tuple([name, z.boolean().optional()]),
  [IPC.PLUGIN_ENABLE]: one(name),
  [IPC.PLUGIN_DISABLE]: one(name),
  [IPC.PLUGIN_APPROVE]: z.tuple([name, pluginComponent]),
  [IPC.PLUGIN_SET_PROJECT_OVERRIDE]: z.tuple([name, path, z.object({
    enabled: z.boolean().optional(),
    components: z.partialRecord(pluginComponent, z.boolean()).optional()
  })]),
  [IPC.PLUGIN_RESET_PROJECT_OVERRIDE]: z.tuple([name, path]),

  [IPC.MARKETPLACE_LIST]: none,
  [IPC.MARKETPLACE_ADD]: one(z.string().trim().min(1, "Enter a source to add")),
  [IPC.MARKETPLACE_REFRESH]: one(name),
  [IPC.MARKETPLACE_REMOVE]: one(name),
  [IPC.MARKETPLACE_SET_AUTO_UPDATE]: z.tuple([name, z.boolean()]),
  [IPC.MARKETPLACE_BROWSE]: z.tuple([z.string().optional()]),
  [IPC.MARKETPLACE_INSPECT_PLUGIN]: one(name),
  [IPC.MARKETPLACE_INSTALL_PLUGIN]: one(name)
} satisfies Record<InvokeChannel, z.ZodType>;

// Compile-time guard: every schema's parsed output must satisfy the argument
// tuple the contract declares for its channel. A mismatch names the channel.
type SchemaMismatch = {
  [C in InvokeChannel]: z.output<(typeof ipcSchemas)[C]> extends IpcArgs<C> ? never : C
}[InvokeChannel];
export const schemaContractCheck: [SchemaMismatch] extends [never] ? true : SchemaMismatch = true;
