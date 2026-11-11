import { it, expect } from "bun:test";
import { WorkLimiter } from "../src/core/work-limiter.js";
it("bounds active work and removes cancelled queued requests without running them", async () => {
  const limiter = new WorkLimiter(1, 2);
  let finish!: () => void;
  const first = limiter.run(new AbortController().signal, () => new Promise<void>(resolve => { finish = resolve; }));
  const cancelled = new AbortController();
  let ran = false;
  const queued = limiter.run(cancelled.signal, async () => { ran = true; });
  cancelled.abort();
  await expect(queued).rejects.toThrow("cancelled");
  finish(); await first;
  expect(ran).toBe(false);
  expect(await limiter.run(new AbortController().signal, async () => "next")).toBe("next");
});
