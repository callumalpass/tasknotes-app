/** UI reload scheduling only, never an authority/currentness substitute.
 * Native changes retire a generation immediately; consumers receive a trailing
 * notification with a maximum delay. READs may await an actual quiet window
 * using their original owner/deadline, without retrying any mutation. */
export class CollectionChangeWindow {
  private trailing?: ReturnType<typeof setTimeout>;
  private maximum?: ReturnType<typeof setTimeout>;
  private changedAt = -Infinity;
  /** Readers waiting for the trailing notification that is still owed. */
  private readonly waiting = new Set<() => void>();
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
    this.release();
  }
  clear(): void {
    clearTimeout(this.trailing);
    clearTimeout(this.maximum);
    this.trailing = this.maximum = undefined;
    this.changedAt = -Infinity;
    this.release();
  }
  private release(): void {
    for (const done of [...this.waiting]) done();
  }
  get unsettled(): boolean {
    return (
      this.trailing !== undefined || performance.now() - this.changedAt < 250
    );
  }
  /** Resolves once the window is quiet and its trailing notification has
   * been delivered. The notification's timer and a reader's own wait end at
   * the same instant; a reader let through first would publish its result
   * and then be told to read again. */
  async quiet(signal: AbortSignal): Promise<void> {
    for (;;) {
      signal.throwIfAborted();
      if (this.trailing !== undefined) {
        await this.notified(signal);
        continue;
      }
      const remaining = 250 - (performance.now() - this.changedAt);
      if (remaining <= 0) return;
      await waitForChangeWindow(remaining, signal);
    }
  }
  private notified(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = () => {
        this.waiting.delete(done);
        signal.removeEventListener("abort", aborted);
        resolve();
      };
      const aborted = () => {
        this.waiting.delete(done);
        reject(signal.reason);
      };
      this.waiting.add(done);
      signal.addEventListener("abort", aborted, { once: true });
    });
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
