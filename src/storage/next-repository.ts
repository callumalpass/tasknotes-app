import { Capacitor } from "@capacitor/core";
import {
  MdbaseError,
  toPlain,
  type MdbaseClient,
  type PlainValue,
  type UpdateInput as NativeUpdateInput,
  type wire,
} from "@mdbase-dev/sdk";
import { linksTo } from "@mdbase-dev/connect";
import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import { patchTaskNotesMdbaseTypeSettings } from "@tasknotes/model/mdbase";
import type {
  TaskRepository,
  TaskCreateIntent,
  RepositoryChange,
  RepositoryConnectionStatus,
  RefreshResult,
} from "../application/ports/task-repository";
import type {
  CreateTaskInput,
  UpdateTaskInput,
  Task,
  TaskSummary,
  TaskListQuery,
  TaskTimeEntry,
  MaterializeOccurrenceResult,
} from "../domain/task";
import { summarizeTask } from "../domain/task";
import { taskPathCandidates } from "../domain/task-path-policy";
import type { TaskNotesTaskModel } from "../domain/tasknotes-model";
import type { TaskModelSettingsPatch } from "../domain/task-configuration";
import type {
  FieldCompletionRequest,
  CollectionRecord,
} from "../domain/completion";
import type {
  TaskViewDocument,
  CreateTaskViewSourceInput,
  UpdateTaskViewSourceInput,
} from "../domain/view";
import { taskViewKey } from "../domain/view";
import { taskCompletion } from "../domain/task-completion";
import { taskSearchTokens } from "../domain/task-query";
import {
  findOccurrenceParent,
  occurrenceRecordId,
} from "../domain/task-occurrence";
import {
  newViewSourcePath,
  viewSourceFormat,
  viewSourceRecord,
} from "../domain/default-view-source";
import { normalizePresentationType } from "../domain/view-renderer";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";
import { NextMutations, RejectedNextMutation } from "./next-mutations";
import { nextTaskProviders, type NextTaskProvider } from "./next-task-catalog";
import { nextTaskDocument, nextTaskSummary } from "./next-task-records";
import { ConnectedTaskIndex } from "./connected-task-index";
import {
  connectedTaskRelationships,
  connectedTaskStats,
} from "./connected-task-cache";
import {
  completeTaskValues,
  completeRecords,
  completionLimit,
} from "./completions";

function taskChanges(
  record: wire.RecordView,
  current: Task,
  next: Task,
): NativeUpdateInput {
  const patch: Record<string, PlainValue> = {};
  const unset: string[] = [];
  for (const field of new Set([
    ...Object.keys(current.frontmatter),
    ...Object.keys(next.frontmatter),
  ])) {
    if (
      JSON.stringify(current.frontmatter[field]) ===
      JSON.stringify(next.frontmatter[field])
    )
      continue;
    if (next.frontmatter[field] === undefined) unset.push(field);
    else patch[field] = next.frontmatter[field] as PlainValue;
  }
  return {
    patch,
    unset,
    ...(next.body !== current.body ? { body: next.body } : {}),
    ifRevision: record.revision,
  };
}

interface CachedTask {
  task: TaskSummary;
  recordId: string;
  model: TaskNotesTaskModel;
  typeName: string;
}

export function nativeUnsupported(message: string): MdbaseError {
  return new MdbaseError({
    code: "invalid_request",
    recovery: "fix_request",
    reason: "unsupported",
    message,
  });
}

function plainFields(fields: wire.FmMap): Record<string, unknown> {
  return Object.fromEntries(
    [...fields].map(([key, value]) => [key, toPlain(value)]),
  );
}

/** Direct native SDK implementation of the application port. Dormant: the app
 * still uses its legacy facade until account/consent and release pins are ready.
 * Unsupported native metadata is explicit, never reconstructed in the app.
 */
export class NextTaskRepository implements TaskRepository {
  private scope = new AbortController();
  private disposed = false;
  private providers: NextTaskProvider[] = [];
  private models = new Map<string, TaskNotesTaskModel>();
  private initialization: Promise<void> | null = null;
  private indexLoading: Promise<void> | null = null;
  private indexReady = false;
  private readonly cache = new ConnectedTaskIndex<CachedTask>();
  private readonly mutations: NextMutations;
  private readonly acceptedCreates = new WeakMap<TaskCreateIntent, Task>();
  private readonly listeners = new Set<(change?: RepositoryChange) => void>();
  private readonly stopLink: () => void;
  private status: RepositoryConnectionStatus = { state: "connecting" };
  private viewCatalog: TaskViewDocument[] = [];

  constructor(
    private readonly client: MdbaseClient,
    private readonly displayName: string,
    private readonly accountId: string,
  ) {
    this.mutations = new NextMutations(client);
    this.stopLink = client.onLink((state, reason) => {
      if (this.disposed) return;
      this.status =
        state === "open"
          ? { state: "connected", lastReachedAt: new Date().toISOString() }
          : {
              state: "unavailable",
              message: reason?.message ?? "Mdbase is not reachable.",
            };
      this.emit("status");
    });
  }

  private signal(extra?: AbortSignal): AbortSignal {
    if (this.disposed)
      throw new Error("The native collection instance has been disposed.");
    return AbortSignal.any([
      this.scope.signal,
      ...(extra ? [extra] : []),
      AbortSignal.timeout(TASKNOTES_REQUEST_BUDGETS.foregroundMs),
    ]);
  }

  async initialize(options: { deferTaskIndex?: boolean } = {}): Promise<void> {
    const signal = this.signal();
    signal.throwIfAborted();
    if (!this.initialization) {
      const loading = (async () => {
        const providers = await nextTaskProviders(this.client, signal);
        signal.throwIfAborted();
        this.providers = providers;
        this.models = new Map(providers.map((p) => [p.typeName, p.model]));
        this.reached();
      })().catch((reason) => {
        if (this.initialization === loading) this.initialization = null;
        throw reason;
      });
      this.initialization = loading;
    }
    await this.initialization;
    signal.throwIfAborted();
    if (!options.deferTaskIndex) await this.ensureIndex();
  }

  private async ensureIndex(): Promise<void> {
    const signal = this.signal();
    await this.initialize({ deferTaskIndex: true });
    signal.throwIfAborted();
    if (this.indexReady) return;
    if (this.indexLoading) return this.indexLoading;
    const writes = this.cache.trackWrites();
    const loading = (async () => {
      const snapshot = new Map<string, CachedTask>();
      for await (const page of this.client.pages(
        { types: [...this.models.keys()], limit: 1000 },
        { effective: true },
        signal,
      )) {
        signal.throwIfAborted();
        if (!page.complete)
          throw nativeUnsupported(
            "The replica has not supplied a complete task index.",
          );
        for (const record of page.records) {
          const decoded = this.decodeSummary(record);
          if (decoded) {
            const previous = snapshot.get(decoded.task.id);
            if (previous && previous.recordId !== decoded.recordId)
              throw new Error(
                "Two native records have the same portable TaskNotes identity. Resolve the duplicate before opening this collection.",
              );
            snapshot.set(decoded.task.id, decoded);
          }
        }
      }
      signal.throwIfAborted();
      for (const [id, existing] of this.cache) {
        if (!writes.paths.has(existing.task.path) && !snapshot.has(id))
          this.cache.delete(id);
      }
      for (const [id, value] of snapshot)
        if (!writes.paths.has(value.task.path)) this.cache.set(id, value);
      this.indexReady = true;
      this.reached();
    })().finally(() => {
      writes.stop();
      if (this.indexLoading === loading) this.indexLoading = null;
    });
    this.indexLoading = loading;
    return loading;
  }

  private decodeSummary(record: wire.RecordView): CachedTask | null {
    const task = nextTaskSummary(record, this.models);
    if (!task) return null;
    const typeName = record.types.find((name) => this.models.has(name))!;
    return {
      task,
      recordId: record.id,
      typeName,
      model: this.models.get(typeName)!,
    };
  }

  private remember(record: wire.RecordView): Task {
    const task = nextTaskDocument(record, this.models);
    if (!task)
      throw new Error(
        "The saved record no longer provides the TaskNotes task contract.",
      );
    const typeName = record.types.find((name) => this.models.has(name))!;
    const identity = this.cache.get(task.id);
    if (identity && identity.recordId !== record.id)
      throw new Error(
        "The portable task identity now belongs to a different native record. Refresh before continuing.",
      );
    const previous = this.cache.atPath(task.path);
    if (previous && previous.task.id !== task.id)
      this.cache.delete(previous.task.id);
    this.cache.set(task.id, {
      task: summarizeTask(task),
      recordId: record.id,
      model: this.models.get(typeName)!,
      typeName,
    });
    this.reached();
    return task;
  }

  private async current(id: string, signal: AbortSignal) {
    await this.ensureIndex();
    signal.throwIfAborted();
    const entry = this.cache.get(id);
    if (!entry) throw new Error("The task is no longer available.");
    const record = await this.client.get(
      entry.recordId,
      { body: true, effective: true },
      signal,
    );
    signal.throwIfAborted();
    const task = this.remember(record);
    if (task.id !== id)
      throw new Error(
        "The portable task identity changed. Refresh before editing.",
      );
    return { record, task, model: entry.model };
  }

  async refresh(): Promise<RefreshResult> {
    const signal = this.signal();
    const start = performance.now();
    const before = new Map(
      [...this.cache].map(([id, value]) => [id, JSON.stringify(value.task)]),
    );
    await this.indexLoading;
    signal.throwIfAborted();
    this.initialization = null;
    this.indexReady = false;
    await this.initialize();
    signal.throwIfAborted();
    const changed = [...this.cache].filter(
      ([id, value]) => before.get(id) !== JSON.stringify(value.task),
    ).length;
    const removed = [...before.keys()].filter(
      (id) => !this.cache.has(id),
    ).length;
    this.emit("data");
    return {
      scanned: this.cache.size,
      changed,
      removed,
      elapsedMs: Math.round(performance.now() - start),
    };
  }

  async listSummaries(
    query: Omit<TaskListQuery, "search"> = {},
  ): Promise<TaskSummary[]> {
    if (query.limit === 0) return [];
    const signal = this.signal();
    await this.ensureIndex();
    signal.throwIfAborted();
    const paths = await this.assignedPaths(query.assignedTo, signal);
    signal.throwIfAborted();
    return this.cache.list(query, undefined, paths);
  }

  private async assignedPaths(
    personPath?: string,
    signal: AbortSignal = this.signal(),
  ): Promise<Set<string> | undefined> {
    if (personPath === undefined) return undefined;
    const paths = new Set<string>();
    for (const provider of this.providers) {
      for await (const page of this.client.pages(
        {
          types: [provider.typeName],
          where: linksTo(
            provider.model.config.fieldMapping.assignees,
            personPath,
            { multiple: true },
          ),
          limit: 1000,
        },
        undefined,
        signal,
      )) {
        signal.throwIfAborted();
        if (!page.complete)
          throw nativeUnsupported(
            "The replica has not supplied complete assignment matches.",
          );
        page.records.forEach((record) => paths.add(record.path));
      }
    }
    return paths;
  }

  async search(query: TaskListQuery, options: { signal?: AbortSignal } = {}) {
    const signal = this.signal(options.signal);
    await this.ensureIndex();
    signal.throwIfAborted();
    const tokens = taskSearchTokens(query.search);
    const matches = new Map<string, Set<string>>();
    for (const token of tokens) {
      const ids = new Set<string>();
      for await (const page of this.client.pages(
        {
          types: [...this.models.keys()],
          where: `file.body.lower().contains(${JSON.stringify(token)})`,
          limit: 1000,
        },
        undefined,
        signal,
      )) {
        signal.throwIfAborted();
        if (!page.complete)
          throw nativeUnsupported(
            "The replica has not supplied complete search matches.",
          );
        page.records.forEach((record) => ids.add(record.path));
      }
      matches.set(token, ids);
    }
    const paths = await this.assignedPaths(query.assignedTo, signal);
    signal.throwIfAborted();
    return this.cache
      .list(
        query,
        (task, token) => matches.get(token)?.has(task.path) ?? false,
        paths,
      )
      .map((task) => ({
        task,
        bodyMatches: tokens.filter((token) =>
          matches.get(token)?.has(task.path),
        ),
      }));
  }

  async list(
    query: TaskListQuery = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<Task[]> {
    const signal = this.signal(options.signal);
    const selected = query.search?.trim()
      ? (await this.search(query, options)).map((r) => r.task)
      : await this.listSummaries(query);
    const out: Task[] = [];
    for (const task of selected) {
      signal.throwIfAborted();
      out.push((await this.current(task.id, signal)).task);
    }
    return out;
  }

  async get(id: string): Promise<Task | null> {
    const signal = this.signal();
    await this.ensureIndex();
    signal.throwIfAborted();
    if (!this.cache.has(id)) return null;
    return (await this.current(id, signal)).task;
  }

  async getSummary(id: string): Promise<TaskSummary | null> {
    const signal = this.signal();
    await this.ensureIndex();
    signal.throwIfAborted();
    const entry = this.cache.get(id);
    if (!entry) return null;
    const record = await this.client.find(
      entry.recordId,
      { effective: true },
      signal,
    );
    signal.throwIfAborted();
    if (!record) {
      this.cache.delete(id);
      return null;
    }
    const decoded = this.decodeSummary(record);
    if (!decoded)
      throw new Error("The record no longer provides the task contract.");
    if (decoded.task.id !== id) this.cache.delete(id);
    const identity = this.cache.get(decoded.task.id);
    if (identity && identity.recordId !== record.id)
      throw new Error(
        "Two native records have the same portable TaskNotes identity.",
      );
    this.cache.set(decoded.task.id, decoded);
    if (decoded.task.id !== id)
      throw new Error(
        "The portable task identity changed. Refresh before continuing.",
      );
    return decoded.task;
  }

  async relationships(id: string) {
    const signal = this.signal();
    await this.ensureIndex();
    signal.throwIfAborted();
    return connectedTaskRelationships(this.cache.values(), id);
  }

  async completeField(request: FieldCompletionRequest) {
    const signal = this.signal();
    await this.ensureIndex();
    signal.throwIfAborted();
    if (request.kind === "values")
      return completeTaskValues(
        [...this.cache.values()].map((r) => r.task),
        request,
      );
    const text = request.query?.trim().toLowerCase();
    const result = await this.client.query(
      {
        ...(request.targetTypes?.length ? { types: request.targetTypes } : {}),
        ...(text
          ? {
              where: `file.path.lower().contains(${JSON.stringify(text)}) || ("title" in record && record.title.lower().contains(${JSON.stringify(text)}))`,
            }
          : {}),
        limit: Math.max(completionLimit(request) * 4, 48),
        order_by: ["file.path"],
      },
      { effective: true },
      signal,
    );
    signal.throwIfAborted();
    const records: CollectionRecord[] = result.records.map((r) => ({
      path: r.path,
      label: String(plainFields(r.effective ?? r.frontmatter).title ?? r.path),
      frontmatter: plainFields(r.effective ?? r.frontmatter),
      types: r.types,
    }));
    return completeRecords(
      records,
      request,
      this.providers[0]!.model.config.linkWriteFormat,
    ).map((completion) => {
      const task = completion.path
        ? this.cache.atPath(completion.path)?.task
        : undefined;
      return task ? { ...completion, taskId: task.id } : completion;
    });
  }

  async create(
    input: CreateTaskInput,
    intent: TaskCreateIntent = { id: crypto.randomUUID() },
  ): Promise<Task> {
    const owner = this.scope.signal;
    owner.throwIfAborted();
    const accepted = this.acceptedCreates.get(intent);
    if (accepted) return accepted;
    await this.initialize({ deferTaskIndex: true });
    owner.throwIfAborted();
    const task = await this.mutations
      .run(
        {
          key: JSON.stringify(["task:create", intent.id]),
          requestId: intent.authorityRequestId,
          prepare: async (mutationId, signal) => {
            const provider = this.providers[0]!;
            const task = await this.availableTaskPath(
              await provider.model.createWithTemplate(
                input,
                { id: intent.id },
                (path) => this.template(path, signal),
              ),
              signal,
            );
            signal.throwIfAborted();
            return () => {
              intent.authorityRequestId = mutationId;
              return this.client.create(
                {
                  id: intent.id,
                  type: provider.typeName,
                  path: task.path,
                  frontmatter: task.frontmatter as Record<string, PlainValue>,
                  body: task.body,
                },
                { mutationId, signal },
              );
            };
          },
          confirmed: async (_receipt, signal) => {
            const record = await this.client.get(
              intent.id,
              { body: true, effective: true },
              signal,
            );
            signal.throwIfAborted();
            return this.remember(record);
          },
        },
        this.scope.signal,
      )
      .catch((reason: unknown) => {
        if (
          reason instanceof RejectedNextMutation &&
          reason.mutationId === intent.authorityRequestId
        )
          delete intent.authorityRequestId;
        throw reason;
      });
    owner.throwIfAborted();
    this.acceptedCreates.set(intent, task);
    delete intent.authorityRequestId;
    this.emit("data");
    return task;
  }

  private async availableTaskPath(
    task: Task,
    signal: AbortSignal,
  ): Promise<Task> {
    for (const path of taskPathCandidates(task.path)) {
      const occupied = await this.client.find({ path }, undefined, signal);
      signal.throwIfAborted();
      if (!occupied) return path === task.path ? task : { ...task, path };
    }
    throw new Error(
      "task_path_collision: Could not allocate a unique task path.",
    );
  }

  private async template(path: string, signal: AbortSignal): Promise<string> {
    const record = await this.client.get({ path }, { document: true }, signal);
    signal.throwIfAborted();
    if (record.document === undefined)
      throw new Error("The replica did not supply the template source.");
    return record.document;
  }

  private mutateTask(
    id: string,
    key: string,
    mutate: (task: Task, model: TaskNotesTaskModel) => Task,
  ): Promise<Task> {
    let recordId: string | undefined = this.cache.get(id)?.recordId;
    return this.mutations.run(
      {
        key,
        prepare: async (mutationId, signal) => {
          const current = await this.current(id, signal);
          recordId = current.record.id;
          const next = mutate(current.task, current.model);
          if (next === current.task) return { value: current.task };
          return () =>
            this.client.update(
              current.record,
              taskChanges(current.record, current.task, next),
              { mutationId, signal },
            );
        },
        confirmed: async (_receipt, signal) => {
          if (!recordId)
            throw new Error(
              "The confirmed task identity cannot be resolved. Refresh before continuing.",
            );
          const record = await this.client.get(
            recordId,
            { body: true, effective: true },
            signal,
          );
          signal.throwIfAborted();
          const task = this.remember(record);
          this.emit("data");
          return task;
        },
      },
      this.scope.signal,
    );
  }

  update(id: string, input: UpdateTaskInput) {
    return this.mutateTask(
      id,
      JSON.stringify(["task:update", id, input]),
      (task, model) =>
        model.update(task, input, { now: new Date().toISOString() }),
    );
  }
  async updateMany(updates: readonly { id: string; input: UpdateTaskInput }[]) {
    const out: Task[] = [];
    for (const update of updates)
      out.push(await this.update(update.id, update.input));
    return out;
  }

  async toggle(
    id: string,
    occurrenceDate?: string,
    completed?: boolean,
  ): Promise<Task> {
    const task = await this.get(id);
    if (!task) throw new Error("The task is no longer available.");
    if (task.recurrenceParent && task.occurrenceDate)
      throw nativeUnsupported(
        "Materialized occurrence transitions need the native atomic recurrence adapter.",
      );
    if (
      completed !== undefined &&
      taskCompletion(task, occurrenceDate) === completed
    )
      return task;
    return this.mutateTask(
      id,
      JSON.stringify(["task:toggle", id, occurrenceDate, completed]),
      (current, model) =>
        completed !== undefined &&
        taskCompletion(current, occurrenceDate) === completed
          ? current
          : model.toggle(current, {
              now: new Date().toISOString(),
              currentDate: occurrenceDate,
            }),
    );
  }
  async skip(id: string, occurrenceDate: string): Promise<Task> {
    const task = await this.get(id);
    if (task?.recurrenceParent)
      throw nativeUnsupported(
        "Materialized occurrence transitions need the native atomic recurrence adapter.",
      );
    return this.mutateTask(
      id,
      JSON.stringify(["task:skip", id, occurrenceDate]),
      (current, model) =>
        model.skip(current, {
          now: new Date().toISOString(),
          currentDate: occurrenceDate,
        }),
    );
  }
  async materializeOccurrence(
    parentId: string,
    occurrenceDate: string,
  ): Promise<MaterializeOccurrenceResult> {
    const owner = this.scope.signal;
    owner.throwIfAborted();
    const recordId = await occurrenceRecordId(parentId, occurrenceDate);
    owner.throwIfAborted();
    let warnings: string[] = [];
    return this.mutations.run<MaterializeOccurrenceResult>(
      {
        key: JSON.stringify(["task:materialize", parentId, occurrenceDate]),
        prepare: async (mutationId, signal) => {
          const parent = await this.current(parentId, signal);
          const existing = [...this.cache.values()]
            .map((value) => value.task)
            .filter(
              (task) =>
                findOccurrenceParent([parent.task], task)?.id === parentId,
            );
          const result = await parent.model.materializeOccurrence(
            parent.task,
            occurrenceDate,
            existing,
            { id: recordId, now: new Date().toISOString() },
            (path) => this.template(path, signal),
          );
          if (!result.created)
            return {
              value: {
                ...result,
                task: (await this.current(result.task.id, signal)).task,
              },
            };
          const created = await this.availableTaskPath(result.task, signal);
          warnings = result.warnings;
          return () =>
            this.client.create(
              {
                id: recordId,
                type: this.cache.get(parentId)!.typeName,
                path: created.path,
                frontmatter: created.frontmatter as Record<string, PlainValue>,
                body: created.body,
              },
              { mutationId, signal },
            );
        },
        confirmed: async (_r, signal) => {
          const record = await this.client.get(
            recordId,
            { body: true, effective: true },
            signal,
          );
          signal.throwIfAborted();
          const task = this.remember(record);
          this.emit("data");
          return { task, created: true, warnings };
        },
      },
      this.scope.signal,
    );
  }
  startTimeTracking(id: string, description?: string) {
    return this.mutateTask(
      id,
      JSON.stringify(["task:track", id, description]),
      (task, model) =>
        model.startTimeTracking(task, {
          now: new Date().toISOString(),
          description,
        }),
    );
  }
  stopTimeTracking(id: string) {
    return this.mutateTask(
      id,
      JSON.stringify(["task:stop", id]),
      (task, model) =>
        model.stopTimeTracking(task, { now: new Date().toISOString() }),
    );
  }
  replaceTimeEntries(id: string, entries: TaskTimeEntry[]) {
    return this.mutateTask(
      id,
      JSON.stringify(["task:entries", id, entries]),
      (task, model) =>
        model.replaceTimeEntries(task, entries, {
          now: new Date().toISOString(),
        }),
    );
  }
  removeTimeEntry(id: string, index: number) {
    return this.mutateTask(
      id,
      JSON.stringify(["task:remove-entry", id, index]),
      (task, model) =>
        model.removeTimeEntry(task, index, { now: new Date().toISOString() }),
    );
  }
  async setArchived(id: string, archived: boolean): Promise<Task> {
    let recordId: string | undefined;
    return this.mutations.run(
      {
        key: JSON.stringify(["task:archive", id, archived]),
        prepare: async (mutationId, signal) => {
          const current = await this.current(id, signal);
          recordId = current.record.id;
          const next = current.model.update(
            current.task,
            { archived },
            { now: new Date().toISOString() },
          );
          const destination = current.model.archiveDestination(next, archived);
          const ops: wire.Op[] = [
            this.client.updateOp(
              current.record,
              taskChanges(current.record, current.task, next),
            ),
          ];
          if (destination && destination !== current.record.path)
            ops.push({
              kind: "rename",
              id: current.record.id,
              from: current.record.path,
              to: destination,
              updateRefs: true,
            });
          // One atomic mutation; a retry cannot repeat the archive patch before
          // recovering an uncertain rename. The update carries the observed CAS.
          return async () =>
            (await this.client.submit(ops, { mutationId, signal }))[0]!;
        },
        confirmed: async (_r, signal) => {
          if (!recordId)
            throw new Error(
              "The archived native record identity was not retained.",
            );
          const record = await this.client.get(
            recordId,
            { body: true, effective: true },
            signal,
          );
          signal.throwIfAborted();
          const saved = this.remember(record);
          this.emit("data");
          return saved;
        },
      },
      this.scope.signal,
    );
  }
  async delete(
    id: string,
    options: { authorityRequestId?: string } = {},
  ): Promise<void> {
    const owner = this.scope.signal;
    owner.throwIfAborted();
    await this.ensureIndex();
    owner.throwIfAborted();
    if (!this.cache.has(id) && !options.authorityRequestId) return;
    await this.mutations.run(
      {
        key: JSON.stringify(["task:delete", id]),
        requestId: options.authorityRequestId,
        prepare: async (mutationId, signal) => {
          const current = await this.current(id, signal);
          return () =>
            this.client.delete(current.record, {
              ifRevision: current.record.revision,
              mutationId,
              signal,
            });
        },
        confirmed: async () => {
          this.cache.delete(id);
          this.emit("data");
        },
      },
      this.scope.signal,
    );
  }

  async stats() {
    const signal = this.signal();
    await this.ensureIndex();
    signal.throwIfAborted();
    return connectedTaskStats(this.cache.values());
  }
  async taskConfiguration() {
    const signal = this.signal();
    await this.initialize({ deferTaskIndex: true });
    signal.throwIfAborted();
    return this.providers[0]!.model.configuration();
  }
  async taskModelSettingsAccess() {
    const signal = this.signal();
    await this.initialize({ deferTaskIndex: true });
    signal.throwIfAborted();
    const source = this.providers[0]!.sourcePath;
    if (!this.client.hello.grant.capabilities.includes("definitions.manage"))
      return {
        writable: false as const,
        source,
        reason: "Task model settings need definition management access.",
      };
    try {
      await this.client.resources.get(source, signal);
      signal.throwIfAborted();
      return { writable: true as const, source };
    } catch (reason) {
      if (reason instanceof MdbaseError && reason.code === "forbidden")
        return {
          writable: false as const,
          source,
          reason: "Task model settings need definition access.",
        };
      throw reason;
    }
  }
  async updateTaskModelSettings(patch: TaskModelSettingsPatch) {
    const owner = this.scope.signal;
    owner.throwIfAborted();
    await this.initialize({ deferTaskIndex: true });
    owner.throwIfAborted();
    const source = this.providers[0]!.sourcePath;
    await this.mutations.run(
      {
        key: JSON.stringify(["task:settings", patch]),
        prepare: async (mutationId, signal) => {
          const resource = await this.client.resources.get(source, signal);
          if (resource.text === undefined)
            throw new Error("The replica did not supply the task type source.");
          const parsed = parseFrontmatter(resource.text);
          const text = serializeMarkdownDocument(
            patchTaskNotesMdbaseTypeSettings(parsed.frontmatter, patch),
            parsed.body,
          );
          return () =>
            this.client.resources.put(source, text, {
              baseRevision: resource.revision,
              mutationId,
              signal,
            });
        },
        confirmed: async (_r, signal) => {
          const providers = await nextTaskProviders(this.client, signal);
          signal.throwIfAborted();
          this.providers = providers;
          this.models = new Map(providers.map((p) => [p.typeName, p.model]));
          this.indexReady = false;
        },
      },
      this.scope.signal,
    );
    this.emit("data");
    return this.taskConfiguration();
  }

  async cachedViews() {
    return structuredClone(this.viewCatalog);
  }
  async listViews(): Promise<TaskViewDocument[]> {
    const signal = this.signal();
    const result = await this.client.views.list(undefined, signal);
    signal.throwIfAborted();
    if (!result.complete)
      throw nativeUnsupported(
        "The replica did not supply a complete view catalog.",
      );
    this.viewCatalog = result.sources.map((source) => ({
      id: source.id,
      name: source.name,
      source: { ...source.source },
      views: source.views.map((view) => {
        const raw =
          view.presentation === undefined
            ? undefined
            : toPlain(view.presentation);
        if (
          raw !== undefined &&
          (!raw || typeof raw !== "object" || Array.isArray(raw))
        )
          throw new Error("The replica returned an invalid view presentation.");
        const presentation = raw as
          | {
              type?: string;
              fallback?: string;
              mappings?: Record<string, string>;
              options?: Record<string, unknown>;
            }
          | undefined;
        return {
          key: taskViewKey(source.source.path, view.id),
          documentId: source.id,
          documentName: source.name,
          id: view.id,
          name: view.name,
          properties: structuredClone(view.properties),
          source: { ...source.source },
          ...(presentation
            ? {
                presentation: {
                  type: normalizePresentationType(presentation.type ?? ""),
                  ...(presentation.fallback
                    ? { fallback: presentation.fallback }
                    : {}),
                  mappings: presentation.mappings ?? {},
                  options: presentation.options ?? {},
                },
              }
            : {}),
        };
      }),
    }));
    return structuredClone(this.viewCatalog);
  }
  async cachedViewExecution() {
    return null;
  }
  async executeView(): Promise<never> {
    throw nativeUnsupported(
      "Native complete view counts, groups and summaries are not available in the pinned SDK/backend.",
    );
  }
  async readViewSource(path: string) {
    return this.client.views.readSource({ path }, this.signal());
  }
  async createViewSource(input: CreateTaskViewSourceInput) {
    const format =
      input.format ??
      (input.path ? viewSourceFormat(input.path) : "obsidian.base");
    const path =
      input.path ?? newViewSourcePath(format, input.name ?? "New view");
    viewSourceRecord(path, input.document);
    return this.mutations.run(
      {
        key: JSON.stringify(["view:create", path, input.document]),
        prepare: async (mutationId, signal) => () =>
          this.client.create(
            {
              path,
              document: input.document,
            },
            { mutationId, signal },
          ),
        confirmed: async (_r, signal) =>
          this.client.views.readSource({ path }, signal),
      },
      this.scope.signal,
    );
  }
  async updateViewSource(input: UpdateTaskViewSourceInput) {
    return this.mutations.run(
      {
        key: JSON.stringify(["view:update", input]),
        prepare: async (mutationId, signal) => {
          const source = await this.client.views.readSource(
            { path: input.path },
            signal,
          );
          if (input.ifRevision && input.ifRevision !== source.revision)
            throw new Error(
              "The view source changed. Reload it before saving.",
            );
          return () =>
            this.client.replaceDocument(source.record, input.document, {
              ifRevision: input.ifRevision ?? source.revision,
              mutationId,
              signal,
            });
        },
        confirmed: async (_r, signal) =>
          this.client.views.readSource({ path: input.path }, signal),
      },
      this.scope.signal,
    );
  }
  async deleteViewSource(path: string, ifRevision?: string) {
    await this.mutations.run(
      {
        key: JSON.stringify(["view:delete", path, ifRevision]),
        prepare: async (mutationId, signal) => {
          const source = await this.client.views.readSource({ path }, signal);
          if (ifRevision && ifRevision !== source.revision)
            throw new Error(
              "The view source changed. Reload it before deleting.",
            );
          return () =>
            this.client.delete(source.record, {
              ifRevision: ifRevision ?? source.revision,
              mutationId,
              signal,
            });
        },
        confirmed: async () => {
          this.viewCatalog = this.viewCatalog.filter(
            (document) => document.source.path !== path,
          );
        },
      },
      this.scope.signal,
    );
    this.emit("data");
  }

  async collectionInfo() {
    return {
      kind: "connect" as const,
      id: `next:${this.accountId}:${this.client.collection}`,
      name: this.displayName,
      location: this.displayName,
      runtime: Capacitor.isNativePlatform()
        ? ("native" as const)
        : ("browser" as const),
    };
  }
  async connectionStatus() {
    return this.status;
  }
  subscribe(listener: (change?: RepositoryChange) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  suspend() {
    this.scope.abort(
      new DOMException("TaskNotes moved to the background.", "AbortError"),
    );
  }
  resume() {
    if (this.disposed)
      throw new Error("The native collection instance has been disposed.");
    if (this.scope.signal.aborted) {
      this.scope = new AbortController();
      this.initialization = null;
      this.indexReady = false;
      this.indexLoading = null;
      this.emit("lifecycle");
    }
  }
  dispose() {
    this.disposed = true;
    this.scope.abort();
    this.stopLink();
    this.client.close();
    this.cache.clear();
    this.viewCatalog = [];
    this.listeners.clear();
  }
  private reached() {
    this.status = {
      state: "connected",
      lastReachedAt: new Date().toISOString(),
    };
  }
  private emit(kind: RepositoryChange["kind"]) {
    if (!this.disposed)
      this.listeners.forEach((listener) => listener({ kind }));
  }
}
