import { describe, expect, it } from "bun:test";
import { buildDaemonChildEnv } from "../src/core/daemon.js";

// Port-conflict behaviour (no silent fallback) and the rest of the lifecycle
// are covered with real processes in daemon-lifecycle.test.ts.
describe("daemon utilities", () => {
  it("runs detached CLI children as Node when the parent uses Electron", () => {
    expect(buildDaemonChildEnv({ PATH: "/bin" }, true)).toMatchObject({
      PATH: "/bin",
      MCPX_DAEMON_CHILD: "1",
      ELECTRON_RUN_AS_NODE: "1",
    });
  });
});
