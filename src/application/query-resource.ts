export interface QueryState<T> {
  key: string | null;
  status: "idle" | "loading" | "refreshing" | "success" | "error";
  data: T | null;
  error: Error | null;
  stale: boolean;
}

/** Read lifecycle, separate from data authority. Old requests never publish over newer queries. */
export class QueryResource<T> {
  private state: QueryState<T> = {
    key: null,
    status: "idle",
    data: null,
    error: null,
    stale: false,
  };
  private generation = 0;
  private request: (() => Promise<T>) | null = null;
  private readonly listeners = new Set<() => void>();
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  load(key: string, request: () => Promise<T>) {
    this.request = request;
    const generation = ++this.generation;
    const data = this.state.key === key ? this.state.data : null;
    this.publish({
      key,
      data,
      status: data === null ? "loading" : "refreshing",
      stale: data !== null,
      error: null,
    });
    void Promise.resolve()
      .then(request)
      .then(
        (data) => {
          if (generation === this.generation)
            this.publish({
              key,
              data,
              status: "success",
              stale: false,
              error: null,
            });
        },
        (reason) => {
          if (generation === this.generation)
            this.publish({
              key,
              data,
              status: "error",
              stale: data !== null,
              error:
                reason instanceof Error ? reason : new Error(String(reason)),
            });
        },
      );
  }
  retry = () => {
    if (this.request && this.state.key !== null)
      this.load(this.state.key, this.request);
  };
  cancel = () => {
    this.generation++;
  };
  private publish(state: QueryState<T>) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
