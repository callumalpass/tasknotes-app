import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import {
  buildTaskNotesMdbaseResources,
  patchTaskNotesMdbaseTypeSettings,
} from "@tasknotes/model/mdbase";
import { parse } from "yaml";

import { completeTaskValues } from "../storage/completions";
import { appendViewPage } from "../application/view-query-session";
import { materializeRollingWindow } from "../application/rolling-occurrences";
import { taskCompletion } from "../domain/task-completion";
import {
  findOccurrenceParent,
  occurrenceRecordId,
} from "../domain/task-occurrence";
import { resolveTaskCollectionConfiguration } from "../domain/task-configuration";
import {
  compareTasks,
  selectTaskSummaries,
  taskSearchMetadata,
  taskSearchTokens,
  taskStats,
} from "../domain/task-query";
import { taskRelationships } from "../domain/task-relationships";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import {
  taskNotesDefaultBaseSources,
  taskNotesViewSourcePath,
} from "../domain/default-view-source";
import { summarizeTask, todayString } from "../domain/task";
import { readViewDraft, type EditableViewDraft } from "../domain/view-document";
import { computedViewValues, tasksForViewDraft } from "../domain/view-preview";
import { DemoFileStore } from "./demo-file-store";
import { demoTasks } from "./demo-tasks";

import type {
  CollectionInfo,
  RefreshResult,
  RepositoryConnectionStatus,
  RepositoryChange,
  TaskRepository,
  TaskCreateIntent,
} from "../application/ports/task-repository";
import type {
  CreateTaskInput,
  MaterializeOccurrenceResult,
  Task,
  TaskListQuery,
  TaskStats,
  TaskTimeEntry,
  UpdateTaskInput,
} from "../domain/task";
import type {
  FieldCompletion,
  FieldCompletionRequest,
} from "../domain/completion";
import type { TaskRelationships } from "../domain/task-relationships";
import type {
  TaskCollectionConfiguration,
  TaskModelSettingsPatch,
} from "../domain/task-configuration";
import type {
  ArchiveScratchpadInput,
  ReactivateScratchpadInput,
  ReactivateScratchpadResult,
  SaveScratchpadInput,
  ScratchpadArchiveResult,
  ScratchpadDocument,
  ScratchpadPage,
  ScratchpadPageRequest,
  StartNewScratchpadInput,
  StartNewScratchpadResult,
} from "../domain/scratchpad";
import type {
  CreateScratchImageInput,
  ScratchImage,
} from "../domain/scratch-image";
import type {
  ScratchFeedPage,
  ScratchFeedPageRequest,
} from "../domain/scratch-feed";
import { scratchFeedPage, scratchpadFeedItem } from "../domain/scratch-feed";
import { scratchpadDocumentPath, scratchpadPage } from "../domain/scratchpad";

import type {
  CreateTaskViewSourceInput,
  TaskView,
  TaskViewDocument,
  TaskViewExecution,
  TaskViewSourceDocument,
  UpdateTaskViewSourceInput,
} from "../domain/view";

const MAX_DEMO_TASKS = 5_000;

export class DemoTaskRepository implements TaskRepository {
  readonly files = new DemoFileStore();
  private modelDefinition: Record<string, unknown> =
    buildTaskNotesMdbaseResources({ profiles: ["core-lite"] }).type;
  private model = new TaskNotesTaskModel(
    resolveTaskCollectionConfiguration(this.modelDefinition),
  );
  private readonly listeners = new Set<(change?: RepositoryChange) => void>();
  private operationController = new AbortController();
  private readonly acceptedCreates = new WeakMap<TaskCreateIntent, Task>();
  private readonly tasks = new Map<string, Task>();
  private readonly viewExecutions = new Map<string, TaskViewExecution>();
  private readonly sources = new Map<string, TaskViewSourceDocument>();
  private documents: TaskViewDocument[];
  private readonly scratchpads = new Map<string, ScratchpadDocument>();
  private readonly scratchImages = new Map<string, ScratchImage>();
  private sourceRevision = 1;

  constructor(requestedCount = 50) {
    const count = Math.max(
      1,
      Math.min(
        Number.isFinite(requestedCount) ? Math.floor(requestedCount) : 50,
        MAX_DEMO_TASKS,
      ),
    );
    const configuration = this.model.configuration();
    this.documents = demoViewDocuments(configuration);
    for (const source of taskNotesDefaultBaseSources(configuration)) {
      this.sources.set(source.path, {
        path: source.path,
        format: "obsidian.base",
        revision: "demo-view-1",
        document: source.document,
      });
    }
    this.sources.set("TaskNotes/Views/work-board.base", {
      path: "TaskNotes/Views/work-board.base",
      format: "obsidian.base",
      revision: "demo-view-1",
      document:
        "views:\n  - name: Work board\n    type: tasknotesKanban\n    groupBy:\n      property: status\n    sort:\n      - property: sortOrder\n        direction: DESC\n",
    });
    for (const task of demoTasks(this.model, count))
      this.tasks.set(task.id, this.model.read(task));

    const now = new Date().toISOString();
    const current: ScratchpadDocument = {
      id: "demo-scratchpad",
      path: scratchpadDocumentPath(new Date(now), "demo-scratchpad"),
      revision: "scratch-1",
      state: "active",
      dateCreated: now,
      dateModified: now,
      body: [
        "- [ ] Ask Rowan about the research notes",
        "  - [ ] Pull the last three examples",
        "- Meeting notes for the planning session",
        "  - Decisions belong in the project brief",
        "- [[tasks/prepare-quarterly-planning-session|Prepare quarterly planning session]]",
        "",
      ].join("\n"),
    };
    this.scratchpads.set(current.id, current);
    this.scratchImages.set("demo-scratch-image", {
      kind: "image",
      id: "demo-scratch-image",
      path: "TaskNotes/Scratchpad/Image Metadata/demo-scratch-image.md",
      revision: "scratch-image-1",
      dateCreated: new Date(
        Date.parse(now) - 2 * 24 * 60 * 60 * 1_000,
      ).toISOString(),
      dateModified: new Date(
        Date.parse(now) - 2 * 24 * 60 * 60 * 1_000,
      ).toISOString(),
      file: "TaskNotes/Scratchpad/Images/demo-reference.png",
      digest: `sha256:${"0".repeat(64)}`,
      size: 0,
      mediaType: "image/png",
      width: 4,
      height: 3,
      caption: "Demo image reference",
    });
    for (const historical of [
      demoScratchpad(
        "demo-scratchpad-planning",
        new Date(Date.parse(now) - 24 * 60 * 60 * 1_000).toISOString(),
        "Planning notes",
        "- Agree launch owners\n- [ ] Confirm the review date\n",
      ),
      demoScratchpad(
        "demo-scratchpad-research",
        new Date(Date.parse(now) - 5 * 24 * 60 * 60 * 1_000).toISOString(),
        "Research follow-up",
        "- Three examples stood out\n- [ ] Send Rowan the summary\n",
      ),
    ])
      this.scratchpads.set(historical.id, historical);
  }

  async initialize(options: { deferTaskIndex?: boolean } = {}): Promise<void> {
    this.operationController.signal.throwIfAborted();
    if (!options.deferTaskIndex) await this.maintainRollingOccurrences();
  }

  async refresh(): Promise<RefreshResult> {
    this.operationController.signal.throwIfAborted();
    await this.maintainRollingOccurrences();
    this.emit({ kind: "status" });
    return { scanned: this.tasks.size, changed: 0, removed: 0, elapsedMs: 0 };
  }

  suspend(): void {
    this.operationController.abort(
      new DOMException("TaskNotes moved to the background.", "AbortError"),
    );
  }

  resume(): void {
    if (!this.operationController.signal.aborted) return;
    this.operationController = new AbortController();
    this.emit({ kind: "lifecycle" });
  }

  dispose(): void {
    this.operationController.abort(
      new DOMException("The TaskNotes collection changed.", "AbortError"),
    );
  }

  async listSummaries(query: Omit<TaskListQuery, "search"> = {}) {
    return (await this.list(query)).map(summarizeTask);
  }

  async search(query: TaskListQuery, options: { signal?: AbortSignal } = {}) {
    const tokens = taskSearchTokens(query.search);
    return (await this.list(query, options)).map((task) => ({
      task: summarizeTask(task),
      bodyMatches: tokens.some(
        (token) => !taskSearchMetadata(task).includes(token),
      )
        ? tokens.filter((token) => task.body.toLowerCase().includes(token))
        : [],
    }));
  }

  async list(
    query: TaskListQuery = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<Task[]> {
    this.operationController.signal.throwIfAborted();
    options.signal?.throwIfAborted();
    if (query.assignedTo !== undefined)
      throw new Error("The demo collection has no people or assignments.");
    const matches = selectTaskSummaries(
      [...this.tasks.values()].sort(compareTasks),
      query,
      (task, token) =>
        taskSearchMetadata(task).includes(token) ||
        this.requireTask(task.id).body.toLowerCase().includes(token),
    );
    return clone(matches.map((task) => this.requireTask(task.id)));
  }

  async getSummary(id: string) {
    const task = this.tasks.get(id);
    return task ? summarizeTask(clone(task)) : null;
  }

  async get(id: string): Promise<Task | null> {
    return clone(this.tasks.get(id) ?? null);
  }

  async relationships(id: string): Promise<TaskRelationships> {
    const current = this.tasks.get(id);
    if (!current)
      return { blockedBy: [], blocking: [], subtasks: [], projectTasks: [] };
    return clone(taskRelationships(current, [...this.tasks.values()]));
  }

  async completeField(
    request: FieldCompletionRequest,
  ): Promise<FieldCompletion[]> {
    if (request.kind === "values")
      return completeTaskValues([...this.tasks.values()], request);
    const query = request.query?.trim().toLocaleLowerCase() ?? "";
    return [...this.tasks.values()]
      .filter(
        (task) =>
          !query ||
          task.title.toLocaleLowerCase().includes(query) ||
          task.path.toLocaleLowerCase().includes(query),
      )
      .slice(0, request.limit ?? 12)
      .map((task) => ({
        kind: "record" as const,
        value: `[[${task.path.replace(/\.md$/i, "")}|${task.title}]]`,
        label: task.title,
        detail: task.path,
        path: task.path,
        taskId: task.id,
      }));
  }

  async create(
    input: CreateTaskInput,
    intent?: TaskCreateIntent,
  ): Promise<Task> {
    const accepted = intent && this.acceptedCreates.get(intent);
    if (accepted) return clone(accepted);
    const task = this.persist(
      this.model.create(input, {
        id: crypto.randomUUID(),
        now: new Date().toISOString(),
      }),
    );
    const saved = await this.withRollingWarnings(task);
    if (intent) this.acceptedCreates.set(intent, saved);
    return saved;
  }

  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    const current = this.requireTask(id);
    const task = this.model.update(current, input, {
      now: new Date().toISOString(),
    });
    return this.withRollingWarnings(this.persist(task));
  }

  async updateMany(
    updates: readonly { id: string; input: UpdateTaskInput }[],
  ): Promise<Task[]> {
    if (!updates.length) return [];
    const result = updates.map(({ id, input }) => {
      const task = this.model.read(
        this.model.update(this.requireTask(id), input, {
          now: new Date().toISOString(),
        }),
      );
      this.tasks.set(id, task);
      return task;
    });
    this.changed();
    return Promise.all(result.map((task) => this.withRollingWarnings(task)));
  }

  async toggle(
    id: string,
    occurrenceDate?: string,
    completed?: boolean,
  ): Promise<Task> {
    const current = this.requireTask(id);
    if (current.recurrenceParent && current.occurrenceDate)
      return this.transitionMaterialized(current, "toggle", completed);
    if (
      completed !== undefined &&
      taskCompletion(current, occurrenceDate) === completed
    )
      return clone(current);
    const task = this.model.toggle(current, {
      now: new Date().toISOString(),
      currentDate: occurrenceDate,
    });
    return this.persist(task);
  }

  async skip(id: string, occurrenceDate: string): Promise<Task> {
    const current = this.requireTask(id);
    if (current.recurrenceParent && current.occurrenceDate)
      return this.transitionMaterialized(current, "skip");
    return this.persist(
      this.model.skip(current, {
        now: new Date().toISOString(),
        currentDate: occurrenceDate,
      }),
    );
  }

  private async transitionMaterialized(
    current: Task,
    action: "toggle" | "skip",
    completed?: boolean,
  ): Promise<Task> {
    const parent = findOccurrenceParent([...this.tasks.values()], current);
    if (!parent)
      throw new Error(
        "invalid_recurrence_parent: The occurrence parent could not be resolved.",
      );
    if (
      action === "toggle" &&
      completed !== undefined &&
      current.completed === completed
    )
      return clone(current);
    const transition = this.model.transitionMaterializedOccurrence(
      current,
      this.requireTask(parent.id),
      action,
      { now: new Date().toISOString() },
    );
    const occurrence = this.model.read(transition.occurrence);
    this.tasks.set(occurrence.id, occurrence);
    this.tasks.set(parent.id, this.model.read(transition.parent));
    this.changed();
    if (transition.materializeNextDate)
      await this.materializeOccurrence(
        parent.id,
        transition.materializeNextDate,
      );
    return clone(occurrence);
  }

  async materializeOccurrence(
    parentId: string,
    occurrenceDate: string,
  ): Promise<MaterializeOccurrenceResult> {
    const parent = this.requireTask(parentId);
    const result = await this.model.materializeOccurrence(
      parent,
      occurrenceDate,
      [...this.tasks.values()].filter(
        (task) => findOccurrenceParent([parent], task)?.id === parentId,
      ),
      {
        id: await occurrenceRecordId(parentId, occurrenceDate),
        now: new Date().toISOString(),
      },
    );
    if (!result.created) return clone(result);
    const task = this.persist(result.task);
    return clone({ ...result, task });
  }

  async startTimeTracking(id: string, description?: string): Promise<Task> {
    return this.persist(
      this.model.startTimeTracking(this.requireTask(id), {
        now: new Date().toISOString(),
        description,
      }),
    );
  }

  async stopTimeTracking(id: string): Promise<Task> {
    return this.persist(
      this.model.stopTimeTracking(this.requireTask(id), {
        now: new Date().toISOString(),
      }),
    );
  }

  async replaceTimeEntries(
    id: string,
    entries: TaskTimeEntry[],
  ): Promise<Task> {
    return this.persist(
      this.model.replaceTimeEntries(this.requireTask(id), entries, {
        now: new Date().toISOString(),
      }),
    );
  }

  async removeTimeEntry(id: string, index: number): Promise<Task> {
    return this.persist(
      this.model.removeTimeEntry(this.requireTask(id), index, {
        now: new Date().toISOString(),
      }),
    );
  }

  async setArchived(id: string, archived: boolean): Promise<Task> {
    const task = this.model.update(
      this.requireTask(id),
      { archived },
      { now: new Date().toISOString() },
    );
    const destination = this.model.archiveDestination(task, archived);
    return this.persist(destination ? { ...task, path: destination } : task);
  }

  async delete(id: string): Promise<void> {
    if (this.tasks.delete(id)) this.changed();
  }

  async stats(): Promise<TaskStats> {
    return taskStats(this.tasks.values());
  }

  async cachedViews(): Promise<TaskViewDocument[]> {
    return clone(this.documents);
  }

  async listViews(): Promise<TaskViewDocument[]> {
    return clone(this.documents);
  }

  async cachedViewExecution(view: TaskView): Promise<TaskViewExecution | null> {
    return clone(this.viewExecutions.get(view.key) ?? null);
  }

  async *iterateView(
    view: TaskView,
    options: { signal?: AbortSignal } = {},
  ): AsyncIterable<TaskViewExecution> {
    const signal = options.signal
      ? AbortSignal.any([this.operationController.signal, options.signal])
      : this.operationController.signal;
    signal.throwIfAborted();
    const execution = await this.executeView(view);
    let cumulative: TaskViewExecution | null = null;
    for (
      let offset = 0;
      offset < Math.max(1, execution.rows.length);
      offset += 200
    ) {
      signal.throwIfAborted();
      const page = {
        ...execution,
        rows: execution.rows.slice(offset, offset + 200),
        hasMore: offset + 200 < execution.rows.length,
      };
      cumulative = appendViewPage(cumulative, page);
      this.viewExecutions.set(view.key, cumulative);
      yield clone(page);
    }
  }

  async executeView(view: TaskView): Promise<TaskViewExecution> {
    this.operationController.signal.throwIfAborted();
    const draft = this.viewDraft(view);
    const tasks = this.tasksForView(view, draft);
    const rows = tasks.map((task) => ({
      task,
      values: {
        ...taskViewValues(task),
        ...(draft ? computedViewValues(draft, task) : {}),
      },
    }));
    const groupProperty =
      view.presentation?.type === "tasknotes.kanban"
        ? (view.presentation.mappings.column ?? "status")
        : view.presentation?.type === "tasknotes.projects"
          ? this.model.configuration().fieldMapping.projects
          : null;
    const groupValues = groupProperty
      ? uniqueValues(
          rows.flatMap((row) => {
            const value = row.values[groupProperty as keyof typeof row.values];
            return Array.isArray(value) ? value : [value];
          }),
        )
      : [];
    const execution: TaskViewExecution = {
      view,
      rows: clone(rows),
      totalCount: rows.length,
      hasMore: false,
      groups: groupValues.map((value) => ({
        values: { [groupProperty!]: value },
        count: rows.filter((row) => {
          const current = row.values[groupProperty as keyof typeof row.values];
          return Array.isArray(current)
            ? current.some((candidate) => sameValue(candidate, value))
            : sameValue(current, value);
        }).length,
        summaries: {},
      })),
    };
    this.viewExecutions.set(view.key, execution);
    return clone(execution);
  }

  async readViewSource(path: string): Promise<TaskViewSourceDocument> {
    const source = this.sources.get(path);
    if (!source) throw new Error(`Demo view source not found: ${path}`);
    return clone(source);
  }

  async createViewSource(
    input: CreateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument> {
    const path =
      input.path ?? `TaskNotes/Views/demo-${this.sourceRevision}.base`;
    const source = this.storeSource(
      path,
      input.format ?? "obsidian.base",
      input.document,
      input.name,
    );
    return clone(source);
  }

  async updateViewSource(
    input: UpdateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument> {
    const current = this.sources.get(input.path);
    if (!current) throw new Error(`Demo view source not found: ${input.path}`);
    if (input.ifRevision && current.revision !== input.ifRevision)
      throw new Error(
        "This view changed after it was opened. Reload it and try again.",
      );
    return clone(this.storeSource(input.path, current.format, input.document));
  }

  async deleteViewSource(path: string, ifRevision?: string): Promise<void> {
    const current = this.sources.get(path);
    if (!current) throw new Error(`Demo view source not found: ${path}`);
    if (ifRevision && current.revision !== ifRevision)
      throw new Error(
        "This view changed after it was opened. Reload it and try again.",
      );
    this.sources.delete(path);
    this.documents = this.documents.filter(
      (document) => document.source.path !== path,
    );
    this.changed();
  }

  async listScratchFeed(
    request: ScratchFeedPageRequest = {},
  ): Promise<ScratchFeedPage> {
    const current = await this.getActiveScratchpad();
    return clone(
      scratchFeedPage(
        current,
        [
          ...[...this.scratchpads.values()]
            .filter((item) => item.id !== current.id)
            .map(scratchpadFeedItem),
          ...this.scratchImages.values(),
        ],
        request,
      ),
    );
  }

  async createScratchImage(
    input: CreateScratchImageInput,
  ): Promise<ScratchImage> {
    const image: ScratchImage = {
      kind: "image",
      ...input,
      revision: `scratch-image-${this.scratchImages.size + 1}`,
      dateModified: input.dateCreated,
    };
    this.scratchImages.set(image.id, image);
    this.changed();
    return clone(image);
  }

  async getScratchImage(
    id: string,
    path?: string,
  ): Promise<ScratchImage | null> {
    const image = this.scratchImages.get(id);
    return clone(image && (!path || image.path === path) ? image : null);
  }

  async removeScratchImage(
    image: Pick<ScratchImage, "id" | "path" | "revision">,
  ): Promise<void> {
    const current = this.scratchImages.get(image.id);
    if (
      !current ||
      current.path !== image.path ||
      current.revision !== image.revision
    )
      throw new Error(
        "The image feed record changed. Reload it before removing.",
      );
    this.scratchImages.delete(image.id);
    this.changed();
  }

  async listScratchpads(
    request: ScratchpadPageRequest = {},
  ): Promise<ScratchpadPage> {
    return clone(scratchpadPage([...this.scratchpads.values()], request));
  }

  async getScratchpad(id: string): Promise<ScratchpadDocument | null> {
    return clone(this.scratchpads.get(id) ?? null);
  }

  async getActiveScratchpad(): Promise<ScratchpadDocument> {
    const current = [...this.scratchpads.values()].find(
      (document) => document.state === "active",
    );
    if (!current) throw new Error("The current scratchpad is unavailable.");
    return clone(current);
  }

  async saveScratchpad(
    input: SaveScratchpadInput,
  ): Promise<ScratchpadDocument> {
    const current = this.scratchpads.get(input.id);
    if (!current || current.path !== input.path)
      throw new Error("This scratchpad changed. Reload it before saving.");
    if (current.revision !== input.revision && current.body !== input.baseBody)
      throw new Error(
        "This scratchpad changed after it was opened. Reload it before saving.",
      );
    const title =
      input.title === undefined ? current.title : input.title.trim();
    const saved = {
      ...current,
      ...(title !== undefined ? { title } : {}),
      body: input.body,
      revision: `scratch-${Number(current.revision.split("-").at(-1) ?? 1) + 1}`,
      dateModified: new Date().toISOString(),
    };
    this.scratchpads.set(saved.id, saved);
    this.changed();
    return clone(saved);
  }

  async startNewScratchpad(
    input: StartNewScratchpadInput,
  ): Promise<StartNewScratchpadResult> {
    const current = await this.getActiveScratchpad();
    if (input.id !== current.id || input.revision !== current.revision)
      throw new Error(
        "The current scratchpad changed. Reload it before saving.",
      );
    const now = new Date().toISOString();
    const title =
      input.title === undefined ? current.title : input.title.trim();
    const previous: ScratchpadDocument = {
      ...current,
      state: "converted",
      ...(title !== undefined ? { title } : {}),
      body: input.body,
      dateModified: now,
      dateConverted: now,
      revision: "scratch-2",
    };
    const nextId = crypto.randomUUID();
    const next: ScratchpadDocument = {
      id: nextId,
      path: scratchpadDocumentPath(new Date(now), nextId),
      revision: "scratch-1",
      state: "active",
      dateCreated: now,
      dateModified: now,
      body: "",
    };
    this.scratchpads.set(previous.id, previous);
    this.scratchpads.set(next.id, next);
    this.changed();
    return clone({ previous, current: next });
  }

  async reactivateScratchpad(
    input: ReactivateScratchpadInput,
  ): Promise<ReactivateScratchpadResult> {
    const current = this.scratchpads.get(input.current.id);
    const target = this.scratchpads.get(input.target.id);
    if (
      !current ||
      current.path !== input.current.path ||
      current.revision !== input.current.revision ||
      current.state !== "active"
    )
      throw new Error("The current scratchpad changed. Reload it.");
    if (
      !target ||
      target.path !== input.target.path ||
      target.revision !== input.target.revision ||
      target.state !== "converted" ||
      target.id === current.id
    )
      throw new Error("This previous scratchpad changed. Reload it.");

    const now = new Date().toISOString();
    const previous: ScratchpadDocument = {
      ...current,
      state: "converted",
      revision: nextScratchpadRevision(current.revision),
      dateModified: now,
      dateConverted: now,
    };
    const resumed: ScratchpadDocument = {
      ...target,
      state: "active",
      revision: nextScratchpadRevision(target.revision),
      dateModified: now,
    };
    this.scratchpads.set(previous.id, previous);
    this.scratchpads.set(resumed.id, resumed);
    this.changed();
    return clone({ previous, current: resumed });
  }

  async archiveScratchpad(
    input: ArchiveScratchpadInput,
  ): Promise<ScratchpadArchiveResult> {
    const result = await this.startNewScratchpad(input);
    return clone({ archived: result.previous, active: result.current });
  }

  async taskConfiguration(): Promise<TaskCollectionConfiguration> {
    return this.model.configuration();
  }

  async taskModelSettingsAccess() {
    return {
      writable: true,
      source: "Demo collection settings",
    };
  }

  async updateTaskModelSettings(
    patch: TaskModelSettingsPatch,
  ): Promise<TaskCollectionConfiguration> {
    this.modelDefinition = patchTaskNotesMdbaseTypeSettings(
      this.modelDefinition,
      patch,
    );
    this.model = new TaskNotesTaskModel(
      resolveTaskCollectionConfiguration(this.modelDefinition),
    );
    for (const [id, task] of this.tasks)
      this.tasks.set(id, this.model.read(task));
    this.changed();
    return this.model.configuration();
  }

  async collectionInfo(): Promise<CollectionInfo> {
    return {
      kind: "connect",
      id: "tasknotes-demo",
      name: "TaskNotes demo",
      location: "Disposable demo collection",
      runtime: "browser",
    };
  }

  async connectionStatus(): Promise<RepositoryConnectionStatus> {
    return { state: "connected", lastReachedAt: new Date().toISOString() };
  }

  subscribe(listener: (change?: RepositoryChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private requireTask(id: string): Task {
    const task = this.tasks.get(id);
    if (!task) throw new Error("Task not found.");
    return task;
  }

  private async maintainRollingOccurrences(): Promise<void> {
    for (const task of [...this.tasks.values()]) {
      if (task.recurrence && task.occurrenceMaterialization === "rolling")
        await this.withRollingWarnings(task);
    }
  }

  private async withRollingWarnings(task: Task): Promise<Task> {
    if (!task.recurrence || task.occurrenceMaterialization !== "rolling")
      return clone(task);
    const warnings = await materializeRollingWindow(task, (parentId, date) =>
      this.materializeOccurrence(parentId, date),
    );
    if (!warnings.length) return clone(task);
    const retained = { ...task, operationWarnings: warnings };
    this.tasks.set(task.id, retained);
    this.changed();
    return clone(retained);
  }

  private persist(task: Task): Task {
    // Match the real adapter's accepted-record decoding, including membership tags.
    const accepted = this.model.read(task);
    this.tasks.set(accepted.id, accepted);
    this.changed();
    return clone(accepted);
  }

  private storeSource(
    path: string,
    format: string,
    document: string,
    name?: string,
  ) {
    const source = {
      path,
      format,
      revision: `demo-view-${++this.sourceRevision}`,
      document,
    };
    this.sources.set(path, source);
    this.syncViewDocument(source, name);
    this.changed();
    return source;
  }

  private syncViewDocument(
    source: TaskViewSourceDocument,
    requestedName?: string,
  ): void {
    const current = this.documents.find(
      (document) => document.source.path === source.path,
    );
    const identities = sourceViewIdentities(source, requestedName);
    const sourceReference = {
      path: source.path,
      format: source.format,
      revision: source.revision,
      writable: true,
    };
    const views = identities.map(({ id, name }) => {
      const previous =
        current?.views.find((candidate) => candidate.id === id) ??
        (identities.length === 1 ? current?.views[0] : undefined);
      const draft = readViewDraft(source, id);
      const presentationType =
        previous?.presentation?.type === "tasknotes.projects" &&
        draft.renderer === "tasknotes.task-list"
          ? "tasknotes.projects"
          : draft.renderer;
      const mappings: Record<string, string> =
        presentationType === "tasknotes.kanban" && draft.groupProperty
          ? { column: draft.groupProperty }
          : {};
      return {
        key: `${source.path}#${id}`,
        documentId: current?.id ?? viewIdentifier(requestedName ?? name),
        documentName: requestedName ?? name,
        id,
        name: draft.name,
        properties: draft.properties.map((key) => ({ key })),
        sort: draft.sort,
        source: sourceReference,
        presentation: {
          type: presentationType,
          mappings,
          options: structuredClone(draft.options),
        },
      };
    });
    const document: TaskViewDocument = {
      id:
        current?.id ??
        viewIdentifier(requestedName ?? views[0]?.name ?? "View"),
      name:
        requestedName ??
        (views.length === 1 ? views[0]!.name : (current?.name ?? "Views")),
      source: sourceReference,
      views,
    };
    this.documents = current
      ? this.documents.map((entry) =>
          entry.source.path === source.path ? document : entry,
        )
      : [...this.documents, document];
  }

  private viewDraft(view: TaskView): EditableViewDraft | null {
    const source = this.sources.get(view.source.path);
    if (!source) return null;
    try {
      return readViewDraft(source, view.id);
    } catch {
      return null;
    }
  }

  private tasksForView(
    view: TaskView,
    draft: EditableViewDraft | null,
  ): Task[] {
    const tasks = [...this.tasks.values()];
    const evaluated = draft ? tasksForViewDraft(draft, tasks) : null;
    if (evaluated) return evaluated;
    return fallbackTasksForView(view, tasks);
  }

  private changed(): void {
    this.viewExecutions.clear();
    this.emit({ kind: "data" });
  }

  private emit(change: RepositoryChange): void {
    for (const listener of this.listeners) listener(change);
  }
}

function demoViewDocuments(
  configuration: TaskCollectionConfiguration,
): TaskViewDocument[] {
  const properties = [
    { key: configuration.fieldMapping.title, label: "Task" },
    { key: configuration.fieldMapping.scheduled, label: "Scheduled" },
    { key: configuration.fieldMapping.due, label: "Due" },
  ];
  const definitions = [
    {
      id: "today",
      name: "Today",
      type: "tasknotes.task-list",
      options: { sections: "day" },
    },
    {
      id: "upcoming",
      name: "Upcoming",
      type: "tasknotes.calendar",
      options: {
        calendarView: "listWeek",
        listDayCount: 7,
        showScheduled: true,
        showDue: true,
      },
    },
    {
      id: "calendar",
      name: "Calendar",
      type: "tasknotes.calendar",
      options: {
        calendarView: "dayGridMonth",
        showScheduled: true,
        showDue: true,
      },
    },
    {
      id: "projects",
      name: "Projects",
      type: "tasknotes.projects",
      options: {},
    },
    {
      id: "archive",
      name: "Archive",
      type: "tasknotes.task-list",
      options: { create: false },
    },
  ];
  const defaults = definitions.map((definition) => {
    const path = taskNotesViewSourcePath(definition.name);
    const source = {
      path,
      format: "obsidian.base",
      revision: "demo-view-1",
      writable: true,
    };
    const view = {
      key: `${path}#${definition.id}`,
      documentId: definition.id,
      documentName: definition.name,
      id: definition.id,
      name: definition.name,
      // Matches the starter Today view, which also shows each task's project.
      properties:
        definition.id === "today"
          ? [...properties, { key: configuration.fieldMapping.projects }]
          : properties,
      sort: [{ property: "sortOrder", direction: "desc" as const }],
      source,
      presentation: {
        type: definition.type,
        mappings: {},
        options: definition.options,
      },
    };
    return { id: definition.id, name: definition.name, source, views: [view] };
  });
  const boardPath = "TaskNotes/Views/work-board.base";
  const boardSource = {
    path: boardPath,
    format: "obsidian.base",
    revision: "demo-view-1",
    writable: true,
  };
  return [
    ...defaults,
    {
      id: "work-board",
      name: "Work",
      source: boardSource,
      views: [
        {
          key: `${boardPath}#work-board`,
          documentId: "work-board",
          documentName: "Work",
          id: "work-board",
          name: "Work board",
          properties,
          sort: [{ property: "sortOrder", direction: "desc" as const }],
          source: boardSource,
          presentation: {
            type: "tasknotes.kanban",
            mappings: { column: configuration.fieldMapping.status },
            options: {},
          },
        },
      ],
    },
  ];
}

function fallbackTasksForView(view: TaskView, tasks: Task[]): Task[] {
  const active = tasks.filter((task) => !task.archived && !task.completed);
  if (view.id === "archive") return tasks.filter((task) => task.archived);
  if (view.id === "projects")
    return active.filter((task) => task.projects.length);
  if (view.id === "work-board") return tasks.filter((task) => !task.archived);
  if (view.id === "today") {
    const today = todayString();
    return active.filter((task) => {
      const value = task.scheduled ?? task.due;
      return !value || value.slice(0, 10) <= today;
    });
  }
  return active;
}

function sourceViewIdentities(
  source: TaskViewSourceDocument,
  requestedName?: string,
): Array<{ id: string; name: string }> {
  if (source.format === "obsidian.base") {
    const value = parse(source.document) as { views?: unknown };
    const names = Array.isArray(value?.views)
      ? value.views.map((candidate) =>
          candidate && typeof candidate === "object" && "name" in candidate
            ? String(candidate.name)
            : "View",
        )
      : [];
    const seen = new Map<string, number>();
    return names.map((name) => {
      const base = viewIdentifier(name);
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      return { id: count === 1 ? base : `${base}-${count}`, name };
    });
  }
  const frontmatter = parseFrontmatter(source.document).frontmatter as {
    views?: unknown;
  };
  return Array.isArray(frontmatter.views)
    ? frontmatter.views.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const record = candidate as Record<string, unknown>;
        const name =
          typeof record.name === "string"
            ? record.name
            : (requestedName ?? "View");
        const id =
          typeof record.id === "string" ? record.id : viewIdentifier(name);
        return [{ id, name }];
      })
    : [];
}

function viewIdentifier(value: string): string {
  const normalized = value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_.:]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(normalized) ? normalized : `view-${normalized}`;
}

function taskViewValues(task: Task): Record<string, unknown> {
  const values: Record<string, unknown> = {
    ...structuredClone(task.frontmatter),
    ...structuredClone(task.customProperties),
    title: task.title,
    status: task.status,
    priority: task.priority,
    scheduled: task.scheduled ?? null,
    due: task.due ?? null,
    projects: [...task.projects],
    contexts: [...task.contexts],
    tags: [...task.tags],
    archived: task.archived,
    completed: task.completed,
    sortOrder: task.sortOrder ?? null,
  };
  for (const [key, value] of Object.entries(values))
    values[`note.${key}`] = structuredClone(value);
  return values;
}

function uniqueValues(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value ?? null);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function demoScratchpad(
  id: string,
  dateCreated: string,
  title: string,
  body: string,
): ScratchpadDocument {
  return {
    id,
    path: scratchpadDocumentPath(new Date(dateCreated), id),
    revision: "scratch-1",
    state: "converted",
    dateCreated,
    dateModified: dateCreated,
    dateConverted: dateCreated,
    title,
    body,
  };
}

function nextScratchpadRevision(revision: string): string {
  return `scratch-${Number(revision.split("-").at(-1) ?? 1) + 1}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
