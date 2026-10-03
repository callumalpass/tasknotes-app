import type { JsonObject, MdbaseConnection } from "@mdbase-dev/connect";
import { appendViewPage } from "../application/view-query-session";
import { BoundedCache } from "./bounded-cache";
import {
  newViewSourcePath,
  viewSourceFormat,
  viewSourceRecord,
} from "../domain/default-view-source";
import { runtimeTimezone } from "../domain/runtime-timezone";
import type { TaskSummary } from "../domain/task";
import type {
  CreateTaskViewSourceInput,
  TaskView,
  TaskViewDocument,
  TaskViewExecution,
  TaskViewSourceDocument,
  UpdateTaskViewSourceInput,
} from "../domain/view";
import { connectedViewExecutionKey } from "./connected-task-cache";
import {
  mdbaseMutationKey,
  runMdbaseMutation,
} from "./mdbase-mutation-coordinator";
import { operationDiagnostics, validResult } from "./mdbase-operation";
import {
  normalizeViewDocuments,
  normalizeViewExecution,
  type ProviderViewExecution,
  type ProviderViewList,
} from "./views";

const PAGE_SIZE = 1_000;
type ExecutionSlot = { signature: string; execution: TaskViewExecution | null };

// View retention and cursors belong to this instance. Connection cancellation,
// status, task decoding, and mutation recovery remain shared with the facade.
export class MdbaseViewAdapter {
  private catalog: TaskViewDocument[] = [];
  private readonly executions = new BoundedCache<ExecutionSlot>(
    16,
    8 * 1024 * 1024,
    (slot) => (slot.execution ? 2 * JSON.stringify(slot.execution).length : 0),
  );
  private readonly inFlight = new Map<
    string,
    { signal: AbortSignal; promise: Promise<TaskViewExecution> }
  >();

  constructor(
    private readonly connect: MdbaseConnection<JsonObject>,
    private readonly requestOptions: () => { signal: AbortSignal },
    private readonly readTask: (
      record: ProviderViewExecution["results"][number],
    ) => TaskSummary | null,
    private readonly noteFailure: (reason: unknown) => void,
  ) {}

  invalidate(): void {
    this.executions.clear();
  }

  async listViews(): Promise<TaskViewDocument[]> {
    try {
      this.catalog = normalizeViewDocuments(
        validResult(
          await this.connect.listViews(this.requestOptions()),
        ) as ProviderViewList,
      );
      const live = new Set(
        this.catalog.flatMap((document) =>
          document.views.map((view) => view.key),
        ),
      );
      for (const key of this.executions.keys())
        if (!live.has(key)) this.executions.delete(key);
      return structuredClone(this.catalog);
    } catch (reason) {
      this.noteFailure(reason);
      if (this.catalog.length) return structuredClone(this.catalog);
      throw reason;
    }
  }

  async cachedViews(): Promise<TaskViewDocument[]> {
    return structuredClone(this.catalog);
  }

  async cachedViewExecution(view: TaskView): Promise<TaskViewExecution | null> {
    const key = this.executionKey(view, runtimeTimezone());
    const slot = this.executions.get(view.key);
    return slot?.signature === key ? structuredClone(slot.execution) : null;
  }

  async *iterateView(
    view: TaskView,
    options: { signal?: AbortSignal; cumulative?: boolean } = {},
  ): AsyncIterable<TaskViewExecution> {
    const timezone = runtimeTimezone();
    const key = this.executionKey(view, timezone);
    const slot = this.beginExecution(view.key, key);
    const ownerSignal = this.requestOptions().signal;
    const signal = options.signal
      ? AbortSignal.any([ownerSignal, options.signal])
      : ownerSignal;
    let cumulative: TaskViewExecution | null = null;
    const pages = this.connect.executeViewPages(
      { path: view.source.path, view: view.id, timezone, render: false },
      { firstPageSize: 200, pageSize: 200, signal },
    );
    try {
      signal.throwIfAborted();
      for await (const outcome of pages) {
        signal.throwIfAborted();
        const result = validResult(outcome) as ProviderViewExecution;
        const page = normalizeViewExecution(
          view,
          { ...result, diagnostics: operationDiagnostics(outcome) },
          this.readTask,
        );
        cumulative = appendViewPage(cumulative, page);
        this.cacheExecution(view.key, slot, cumulative);
        yield options.cumulative ? cumulative : page;
      }
    } catch (reason) {
      if (!signal.aborted) this.noteFailure(reason);
      throw reason;
    } finally {
      await pages.return(undefined).catch(() => undefined);
    }
  }

  async executeView(view: TaskView): Promise<TaskViewExecution> {
    const timezone = runtimeTimezone();
    const key = this.executionKey(view, timezone);
    const signal = this.requestOptions().signal;
    const pending = this.inFlight.get(key);
    if (pending?.signal === signal) return pending.promise;
    const slot = this.beginExecution(view.key, key);
    const execution = this.executeViewUnlocked(
      view,
      timezone,
      slot,
      signal,
    ).finally(() => {
      if (this.inFlight.get(key)?.promise === execution)
        this.inFlight.delete(key);
    });
    this.inFlight.set(key, { signal, promise: execution });
    return execution;
  }

  private async executeViewUnlocked(
    view: TaskView,
    timezone: string,
    slot: ExecutionSlot,
    signal: AbortSignal,
  ): Promise<TaskViewExecution> {
    try {
      signal.throwIfAborted();
      let result: ProviderViewExecution | undefined;
      for await (const outcome of this.connect.executeViewPages(
        { path: view.source.path, view: view.id, timezone, render: false },
        { firstPageSize: PAGE_SIZE, pageSize: PAGE_SIZE, signal },
      )) {
        signal.throwIfAborted();
        const page = validResult(outcome) as ProviderViewExecution & {
          page: number;
        };
        result ??= { results: [], meta: page.meta, diagnostics: [] };
        result.results.push(...page.results);
        result.diagnostics?.push(...operationDiagnostics(outcome));
        result.meta = {
          ...page.meta,
          ...(page.meta.groups === undefined && result.meta.groups
            ? { groups: result.meta.groups }
            : {}),
        };
      }
      signal.throwIfAborted();
      if (!result)
        throw new Error("Saved view execution completed without a page.");
      const execution = normalizeViewExecution(view, result, this.readTask);
      signal.throwIfAborted();
      this.cacheExecution(view.key, slot, execution);
      return execution;
    } catch (reason) {
      this.noteFailure(reason);
      const retained = this.executions.get(view.key);
      if (retained?.signature === slot.signature && retained.execution)
        return { ...structuredClone(retained.execution), stale: true };
      throw reason;
    }
  }

  async readViewSource(path: string): Promise<TaskViewSourceDocument> {
    try {
      return viewSourceDocument(
        validResult(
          await this.connect.read(
            { path, includeDocument: true },
            this.requestOptions(),
          ),
        ),
      );
    } catch (reason) {
      this.noteFailure(reason);
      throw reason;
    }
  }

  /** Saved views are ordinary records: Bases through obsidian.base, others through mdbase.view. */
  async createViewSource(
    input: CreateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument> {
    const path =
      input.path ??
      newViewSourcePath(input.format ?? "obsidian.base", input.name ?? "view");
    const operationInput = {
      path,
      ...viewSourceRecord(path, input.document),
      includeDocument: true,
    };
    return this.mutateSource("view-source:create", operationInput, async () =>
      viewSourceDocument(
        validResult(
          await this.connect.create(operationInput, this.requestOptions()),
        ),
      ),
    );
  }

  /** A whole-document replacement keeps Obsidian's comments and layout. */
  updateViewSource(
    input: UpdateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument> {
    const operationInput = {
      path: input.path,
      document: input.document,
      ifRevision: input.ifRevision,
    };
    return this.mutateSource("view-source:update", operationInput, async () =>
      viewSourceDocument(
        validResult(
          await this.connect.update(operationInput, this.requestOptions()),
        ),
      ),
    );
  }

  deleteViewSource(path: string, ifRevision?: string): Promise<void> {
    const operationInput = { path, ifRevision };
    return this.mutateSource(
      "view-source:delete",
      operationInput,
      async () => {
        validResult(
          await this.connect.delete(operationInput, this.requestOptions()),
        );
      },
      () => undefined,
    );
  }

  private async mutateSource<Result>(
    operation: string,
    input: Record<string, unknown>,
    invoke: () => Promise<Result>,
    recovered?: (result: Result) => Result,
  ): Promise<Result> {
    const applyResult = (result: Result) => {
      this.invalidate();
      return result;
    };
    try {
      return await runMdbaseMutation(
        this.connect,
        async () => applyResult(await invoke()),
        {
          key: mdbaseMutationKey(operation, input),
          request: this.requestOptions(),
          mapRecovered: (result: Result) =>
            applyResult(recovered ? recovered(result) : result),
        },
      );
    } catch (reason) {
      this.noteFailure(reason);
      throw reason;
    }
  }

  private beginExecution(key: string, signature: string): ExecutionSlot {
    const previous = this.executions.get(key);
    const slot = {
      signature,
      execution: previous?.signature === signature ? previous.execution : null,
    };
    this.executions.set(key, slot);
    return slot;
  }

  private cacheExecution(
    key: string,
    slot: ExecutionSlot,
    execution: TaskViewExecution,
  ): void {
    // A newer request, invalidation or eviction owns this identity now.
    if (this.executions.get(key) !== slot) return;
    slot.execution = execution;
    this.executions.set(key, slot);
  }

  private executionKey(view: TaskView, timezone: string): string {
    return `${timezone}\u0000${connectedViewExecutionKey(view)}`;
  }
}

function viewSourceDocument(record: {
  path: string;
  revision: string;
  document?: string;
}): TaskViewSourceDocument {
  return {
    path: record.path,
    format: viewSourceFormat(record.path),
    revision: record.revision,
    document: record.document ?? "",
  };
}
