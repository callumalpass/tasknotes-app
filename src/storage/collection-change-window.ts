/** UI reload scheduling only, never an authority/currentness substitute.
 * Native changes retire a generation immediately; consumers receive a trailing
 * notification with a maximum delay. READs may await an actual quiet window
 * using their original owner/deadline, without retrying any mutation. */
export class CollectionChangeWindow {
  private trailing?: ReturnType<typeof setTimeout>;
  private maximum?: ReturnType<typeof setTimeout>;
  private changedAt = -Infinity;
  constructor(private readonly notify: () => void) {}

  changed(): void {
    this.changedAt = performance.now();
    clearTimeout(this.trailing);
    this.trailing = setTimeout(() => this.flush(), 250);
    this.maximum ??= setTimeout(() => this.flush(), 2_000);
  }
  private flush(): void {
    clearTimeout(this.trailing);
    clearTimeout(this.maximum);
    this.trailing = this.maximum = undefined;
    this.notify();
  }
  clear(): void {
    clearTimeout(this.trailing);
    clearTimeout(this.maximum);
    this.trailing = this.maximum = undefined;
    this.changedAt = -Infinity;
  }
  get unsettled(): boolean {
    return performance.now() - this.changedAt < 250;
  }
  async quiet(signal: AbortSignal): Promise<void> {
    for (;;) {
      signal.throwIfAborted();
      const remaining = 250 - (performance.now() - this.changedAt);
      if (remaining <= 0) return;
      await waitForChangeWindow(remaining, signal);
    }
  }
}

export function waitForChangeWindow(
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      resolve();
    }, ms);
    signal.addEventListener("abort", aborted, { once: true });
  });
}
