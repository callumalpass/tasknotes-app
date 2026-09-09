export interface MutationState {
  pending: boolean;
  error: Error | null;
  warning: string | null;
}
export const idleMutation: MutationState = Object.freeze({
  pending: false,
  error: null,
  warning: null,
});

/** Collection-scoped command lifecycles. Identical explicit intents join;
 * different intents queue rather than being silently dropped. No durable task data.
 */
export class TaskMutations {
  private readonly running = new Map<
    string,
    { identity?: string; promise: Promise<unknown> }
  >();
  private readonly states = new Map<string, MutationState>();
  private readonly listeners = new Map<string, Set<() => void>>();
  snapshot(key: string) {
    return this.states.get(key) ?? idleMutation;
  }
  subscribe(key: string, listener: () => void) {
    const set = this.listeners.get(key) ?? new Set();
    set.add(listener);
    this.listeners.set(key, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(key);
    };
  }
  clear(key: string) {
    if (!this.snapshot(key).pending) {
      this.states.delete(key);
      this.publish(key);
    }
  }
  run<T>(
    key: string,
    operation: () => Promise<T>,
    identity?: string,
  ): Promise<T> {
    const current = this.running.get(key);
    if (current) {
      if (identity !== undefined && identity === current.identity)
        return current.promise as Promise<T>;
    }
    this.states.set(key, { pending: true, error: null, warning: null });
    const ready = current
      ? current.promise.catch(() => undefined)
      : Promise.resolve();
    const promise = ready
      .then(operation)
      .then(
        (result) => {
          if (this.running.get(key)?.promise !== promise) return result;
          const warnings =
            result &&
            typeof result === "object" &&
            "operationWarnings" in result
              ? result.operationWarnings
              : undefined;
          if (Array.isArray(warnings) && warnings.length)
            this.states.set(key, {
              pending: false,
              error: null,
              warning: warnings.join(" "),
            });
          else this.states.delete(key);
          return result;
        },
        (reason) => {
          if (this.running.get(key)?.promise === promise)
            this.states.set(key, {
              pending: false,
              error:
                reason instanceof Error ? reason : new Error(String(reason)),
              warning: null,
            });
          throw reason;
        },
      )
      .finally(() => {
        if (this.running.get(key)?.promise === promise) {
          this.running.delete(key);
          this.publish(key);
        }
      });
    // The controller owns visible failure state, even when a legacy event callback ignores its promise.
    void promise.catch(() => undefined);
    this.running.set(key, { promise, identity });
    this.publish(key);
    return promise;
  }
  private publish(key: string) {
    for (const listener of this.listeners.get(key) ?? []) listener();
  }
}
export function completionKey(id: string, occurrenceDate?: string) {
  return JSON.stringify(["completion", id, occurrenceDate ?? "record"]);
}
export interface CompletionCommand {
  id: string;
  occurrenceDate?: string;
  completed: boolean;
}
