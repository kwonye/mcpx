/** Bounds work per upstream instance, including queued requests. */
export class WorkLimiter {
  private active = 0;
  private waiting: Array<{ signal: AbortSignal; grant: () => void; reject: (error: Error) => void; abort: () => void }> = [];
  constructor(private readonly concurrency = 8, private readonly queueLimit = 128) {}
  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.queueLimit) throw new Error("Upstream is busy; its request queue is full.");
      await new Promise<void>((resolve, reject) => {
        const waiter = { signal, grant: resolve, reject, abort: () => { this.waiting = this.waiting.filter(entry => entry !== waiter); reject(new Error("Request cancelled while waiting for the upstream")); } };
        this.waiting.push(waiter);
        signal.addEventListener("abort", waiter.abort, { once: true });
      });
    } else this.active++;
    try { signal.throwIfAborted(); return await work(); }
    finally {
      const next = this.waiting.shift();
      if (next) { next.signal.removeEventListener("abort", next.abort); next.grant(); }
      else this.active--;
    }
  }
}
