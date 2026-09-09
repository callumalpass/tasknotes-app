import type { TaskRepository } from "./ports/task-repository";
import type {
  TaskView,
  TaskViewExecution,
  TaskViewSourceDocument,
} from "../domain/view";

export function appendViewPage(
  previous: TaskViewExecution | null,
  page: TaskViewExecution,
): TaskViewExecution {
  if (!previous) return page;
  return {
    ...page,
    rows: [...previous.rows, ...page.rows],
    records: [...(previous.records ?? []), ...(page.records ?? [])],
    groups: page.groups.length ? page.groups : previous.groups,
    hasSkippedRecords: previous.hasSkippedRecords || page.hasSkippedRecords,
  };
}

/** Owns a caller-driven read cursor. First page paints without draining the authority;
 * further pages are requested explicitly, never by each row or each section.
 */
export class ViewQuerySession {
  private readonly controller = new AbortController();
  private iterator: AsyncIterator<TaskViewExecution> | null = null;
  private execution: TaskViewExecution | null = null;
  private cached: TaskViewExecution | null = null;
  private acceptingCached = true;
  private running: Promise<void> | null = null;
  private source: Promise<TaskViewSourceDocument> | null = null;
  constructor(
    private readonly repository: TaskRepository,
    private readonly view: TaskView,
    private readonly observer: {
      result(execution: TaskViewExecution): void;
      error(reason: unknown): void;
      pending(pending: boolean): void;
    },
    private readonly minimumRows = 0,
  ) {}
  get currentResult() {
    return this.controller.signal.aborted ? null : this.execution;
  }
  readSource() {
    return (this.source ??= this.repository.readViewSource(
      this.view.source.path,
    ));
  }
  private get cachedRows() {
    return this.cached?.rows.length ?? 0;
  }
  get canLoadMore() {
    return Boolean(
      this.iterator &&
      this.execution?.hasMore &&
      !this.controller.signal.aborted,
    );
  }
  start() {
    return this.run(async () => {
      this.controller.signal.throwIfAborted();
      const previousRows = this.execution?.rows.length ?? 0;
      await this.iterator?.return?.().catch(() => undefined);
      this.controller.signal.throwIfAborted();
      this.iterator = null;
      this.execution = null;
      this.cached = null;
      this.acceptingCached = true;
      void this.repository
        .cachedViewExecution(this.view)
        .then((cached) => {
          if (
            !cached ||
            !this.acceptingCached ||
            this.execution ||
            this.controller.signal.aborted
          )
            return;
          this.cached = cached;
          this.observer.result({ ...cached, stale: true });
        })
        .catch(() => undefined);
      this.controller.signal.throwIfAborted();
      if (
        this.view.presentation?.type === "tasknotes.task-list" &&
        this.repository.iterateView
      ) {
        const pages = this.repository.iterateView(this.view, {
          signal: this.controller.signal,
        });
        this.iterator = pages[Symbol.asyncIterator]();
        // Refresh the already-visible prefix without shrinking a warm workspace to page one.
        const target = Math.max(
          this.minimumRows,
          previousRows,
          this.cachedRows,
        );
        do {
          await this.advance();
        } while (
          this.execution!.hasMore &&
          this.execution!.rows.length < target
        );
      } else this.execution = await this.repository.executeView(this.view);
      this.controller.signal.throwIfAborted();
      this.observer.result(this.execution!);
    });
  }
  async loadAll(): Promise<boolean> {
    if (this.running) await this.running;
    if (this.controller.signal.aborted) return false;
    if (this.canLoadMore)
      await this.run(async () => {
        while (this.execution?.hasMore) {
          await this.advance();
          this.observer.result(this.execution!);
        }
      });
    return Boolean(
      this.execution &&
      !this.execution.hasMore &&
      !this.controller.signal.aborted,
    );
  }
  loadMore() {
    if (this.running) return this.running;
    if (!this.canLoadMore) return Promise.resolve();
    return this.run(async () => {
      await this.advance();
      this.observer.result(this.execution!);
    });
  }
  close() {
    this.controller.abort();
    void this.iterator?.return?.().catch(() => undefined);
  }
  private async advance() {
    const next = await this.iterator!.next();
    this.controller.signal.throwIfAborted();
    if (next.done) {
      if (!this.execution) throw new Error("The saved view returned no page.");
      if (this.execution.hasMore)
        throw new Error(
          "The saved view ended before all remaining results were delivered. Retry the view.",
        );
    } else {
      this.execution = appendViewPage(this.execution, next.value);
      if (!this.execution.hasMore) await this.iterator!.return?.();
    }
  }
  private run(operation: () => Promise<void>): Promise<void> {
    if (this.running) return this.running;
    if (this.controller.signal.aborted) return Promise.resolve();
    this.observer.pending(true);
    const promise = Promise.resolve()
      .then(operation)
      .catch((reason) => {
        if (this.controller.signal.aborted) return;
        const previous = this.execution ?? this.cached;
        if (previous) this.observer.result({ ...previous, stale: true });
        this.observer.error(reason);
        // A failed single-use cursor is not replayed. Retry starts a fresh session.
        void this.iterator?.return?.().catch(() => undefined);
        this.iterator = null;
      })
      .finally(() => {
        this.acceptingCached = false;
        this.running = null;
        if (!this.controller.signal.aborted) this.observer.pending(false);
      });
    this.running = promise;
    return promise;
  }
}
