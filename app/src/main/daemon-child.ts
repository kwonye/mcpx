import {
  loadConfig,
  runDaemonForeground,
  SecretsManager
} from "@mcpx/core";

function parsePortFromArgs(argv: string[], fallbackPort: number): number {
  const portIndex = argv.indexOf("--port");
  if (portIndex < 0) {
    return fallbackPort;
  }

  const rawPort = argv[portIndex + 1];
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fallbackPort;
  }

  return port;
}

export async function runDaemonChildIfRequested(argv = process.argv): Promise<boolean> {
  if (process.env.MCPX_DAEMON_CHILD !== "1") {
    return false;
  }

  const config = loadConfig();
  const port = parsePortFromArgs(argv, config.gateway.port);
  const secrets = new SecretsManager();
  await runDaemonForeground(config, port, secrets);
  return true;
}
