import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { parse } from "yaml";

import { completeTaskValues } from "../storage/completions";
import { taskRelationships } from "../domain/task-relationships";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import {
  taskNotesDefaultBaseSources,
  taskNotesViewSourcePath,
} from "../domain/default-view-source";
import { todayString } from "../domain/task";
import { readViewDraft, type EditableViewDraft } from "../domain/view-document";
import { computedViewValues, tasksForViewDraft } from "../domain/view-preview";
import { DemoFileStore } from "./demo-file-store";

import type {
  CollectionInfo,
  RefreshResult,
  RepositoryConnectionStatus,
  TaskRepository,
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
  private model = new TaskNotesTaskModel();
  private readonly listeners = new Set<() => void>();
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
      this.tasks.set(task.id, task);

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

  async initialize(): Promise<void> {}

  async refresh(): Promise<RefreshResult> {
    return { scanned: this.tasks.size, changed: 0, removed: 0, elapsedMs: 2 };
  }

  async list(query: TaskListQuery = {}): Promise<Task[]> {
    const search = query.search?.trim().toLocaleLowerCase();
    const matches = [...this.tasks.values()].filter((task) => {
      if (query.status === "open" && task.completed) return false;
      if (query.status === "completed" && !task.completed) return false;
      if (query.archived === "exclude" && task.archived) return false;
      if (query.archived === "only" && !task.archived) return false;
      if (
        search &&
        ![
          task.title,
          task.body,
          ...task.tags,
          ...task.contexts,
          ...task.projects,
        ].some((value) => value.toLocaleLowerCase().includes(search))
      )
        return false;
      return true;
    });
    return clone(query.limit ? matches.slice(0, query.limit) : matches);
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

  async create(input: CreateTaskInput): Promise<Task> {
    const task = this.model.create(input, {
      id: crypto.randomUUID(),
      now: new Date().toISOString(),
    });
    this.tasks.set(task.id, task);
    this.changed();
    return clone(task);
  }

  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    const current = this.requireTask(id);
    const task = this.model.update(current, input, {
      now: new Date().toISOString(),
    });
    this.tasks.set(id, task);
    this.changed();
    return clone(task);
  }

  async updateMany(
    updates: readonly { id: string; input: UpdateTaskInput }[],
  ): Promise<Task[]> {
    const result = updates.map(({ id, input }) => {
      const task = this.model.update(this.requireTask(id), input, {
        now: new Date().toISOString(),
      });
      this.tasks.set(id, task);
      return task;
    });
    this.changed();
    return clone(result);
  }

  async toggle(id: string, occurrenceDate?: string): Promise<Task> {
    const task = this.model.toggle(this.requireTask(id), {
      now: new Date().toISOString(),
      currentDate: occurrenceDate,
    });
    this.tasks.set(id, task);
    this.changed();
    return clone(task);
  }

  async skip(id: string, occurrenceDate: string): Promise<Task> {
    const task = this.model.skip(this.requireTask(id), {
      now: new Date().toISOString(),
      currentDate: occurrenceDate,
    });
    this.tasks.set(id, task);
    this.changed();
    return clone(task);
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
        (task) => task.recurrenceParent === parentId,
      ),
      { id: crypto.randomUUID(), now: new Date().toISOString() },
    );
    if (result.created) this.tasks.set(result.task.id, result.task);
    this.changed();
    return clone(result);
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
    return this.update(id, { archived });
  }

  async delete(id: string): Promise<void> {
    this.tasks.delete(id);
    this.changed();
  }

  async stats(): Promise<TaskStats> {
    const tasks = [...this.tasks.values()];
    return {
      total: tasks.length,
      open: tasks.filter((task) => !task.completed && !task.archived).length,
      completed: tasks.filter((task) => task.completed).length,
      archived: tasks.filter((task) => task.archived).length,
    };
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

  async executeView(view: TaskView): Promise<TaskViewExecution> {
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
    const current = this.model.configuration();
    const configuration: TaskCollectionConfiguration = {
      ...current,
      defaults: {
        ...current.defaults,
        status: patch.defaultStatus ?? current.defaults.status,
        priority: patch.defaultPriority ?? current.defaults.priority,
      },
      recurrence: {
        ...current.recurrence,
        ...(patch.recurrence ?? {}),
      },
      occurrences: {
        ...current.occurrences,
        ...(patch.occurrences ?? {}),
      },
      timeTracking: {
        ...current.timeTracking,
        ...(patch.timeTracking ?? {}),
      },
      archive: {
        ...current.archive,
        ...(patch.archive ?? {}),
      },
      templating: {
        ...current.templating,
        ...(patch.templating ?? {}),
      },
      linkWriteFormat: patch.links?.writeFormat ?? current.linkWriteFormat,
      statuses: current.statuses.map((status) => ({
        ...status,
        ...(patch.statusAutomation?.[status.value] ?? {}),
      })),
    };
    this.model = new TaskNotesTaskModel(configuration);
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

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private requireTask(id: string): Task {
    const task = this.tasks.get(id);
    if (!task) throw new Error("Task not found.");
    return task;
  }

  private persist(task: Task): Task {
    this.tasks.set(task.id, task);
    this.changed();
    return clone(task);
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
    for (const listener of this.listeners) listener();
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
      properties,
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

function demoTasks(model: TaskNotesTaskModel, count: number): Task[] {
  const configuration = model.configuration();
  const activeStatuses = configuration.statuses.filter(
    (status) => !status.isCompleted && !status.isSkipped,
  );
  const completeStatus =
    configuration.statuses.find((status) => status.isCompleted)?.value ??
    "done";
  const priorities = configuration.priorities.map((priority) => priority.value);
  const today = new Date();
  const titles = [
    "Prepare quarterly planning session",
    "Review the mobile navigation notes",
    "Book the project room",
    "Send the research summary to Rowan",
    "Test reminder delivery on Android",
    "Refine the onboarding copy",
    "Collect examples for the design review",
    "Reconcile the travel receipts",
    "Write the release checklist",
    "Confirm next week’s interviews",
    "Update the field guide",
    "Triage follow-up questions",
  ];
  return Array.from({ length: count }, (_, index) => {
    const completed = index % 11 === 8;
    const status =
      activeStatuses[index % Math.max(1, activeStatuses.length)]?.value ??
      configuration.defaults.status;
    const scheduled =
      index % 5 === 4
        ? undefined
        : dateOffset(
            today,
            (index % 13) - 3,
            index % 4 === 0 ? 9 + (index % 7) : undefined,
          );
    const due =
      index % 3 === 0 ? dateOffset(today, (index % 9) - 2) : undefined;
    let task = model.create(
      {
        title: titles[index] ?? `Review demo task ${index + 1}`,
        status,
        priority:
          priorities[index % Math.max(priorities.length, 1)] ??
          configuration.defaults.priority,
        scheduled,
        due,
        body:
          index === 0
            ? "Bring the open questions, last quarter’s decisions, and a short list of outcomes.\n\n## Notes\n\nKeep the session practical and leave ten minutes for owners and dates."
            : index % 6 === 0
              ? "A deliberately concise note that shows how supporting content sits beneath the task fields."
              : "",
        tags:
          index % 4 === 0
            ? ["work", "review"]
            : index % 4 === 1
              ? ["personal"]
              : ["work"],
        contexts:
          index % 3 === 0
            ? ["office"]
            : index % 3 === 1
              ? ["computer"]
              : ["errands"],
        projects:
          index % 5 === 0
            ? ["[[Projects/Product refresh]]"]
            : index % 5 === 1
              ? ["[[Projects/Field research]]"]
              : index % 5 === 2
                ? ["[[Projects/Operations]]"]
                : [],
        recurrence: index === 4 ? "FREQ=WEEKLY;BYDAY=MO,WE,FR" : undefined,
        reminders:
          index === 0
            ? [
                {
                  id: "demo-reminder",
                  type: "relative",
                  relatedTo: "due",
                  offset: "-PT30M",
                },
              ]
            : [],
        timeEstimate: index % 4 === 0 ? 45 + (index % 3) * 15 : undefined,
        sortOrder: String(count - index).padStart(6, "0"),
      },
      {
        id: index === 0 ? "demo-planning-session" : `demo-task-${index + 1}`,
        now: new Date(today.getTime() - index * 3_600_000).toISOString(),
      },
    );
    if (completed)
      task = model.update(task, {
        status: completeStatus,
      });
    if (index % 13 === 12) task = model.update(task, { archived: true });
    if (index === 1) {
      task = model.replaceTimeEntries(task, [
        {
          startTime: new Date(today.getTime() - 4_200_000).toISOString(),
          endTime: new Date(today.getTime() - 2_400_000).toISOString(),
          description: "Navigation review",
        },
      ]);
    }
    return task;
  });
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

function dateOffset(date: Date, days: number, hour?: number): string {
  const value = new Date(date);
  value.setHours(hour ?? 12, 0, 0, 0);
  value.setDate(value.getDate() + days);
  const day = todayString(value);
  return hour === undefined
    ? day
    : `${day}T${String(hour).padStart(2, "0")}:00`;
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

function clone<T>(value: T): T {
  return structuredClone(value);
}
