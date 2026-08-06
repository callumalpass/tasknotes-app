import { completeTaskValues } from "../storage/completions";
import { taskRelationships } from "../domain/task-relationships";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import {
  taskNotesDefaultBaseSources,
  taskNotesViewSourcePath,
} from "../domain/default-view-source";
import { todayString } from "../domain/task";

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
} from "../domain/scratchpad";
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
  private readonly model = new TaskNotesTaskModel();
  private readonly listeners = new Set<() => void>();
  private readonly tasks = new Map<string, Task>();
  private readonly viewExecutions = new Map<string, TaskViewExecution>();
  private readonly sources = new Map<string, TaskViewSourceDocument>();
  private documents: TaskViewDocument[];
  private scratchpad: ScratchpadDocument;
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
    this.scratchpad = {
      id: "demo-scratchpad",
      path: "scratchpads/Scratchpad.md",
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
    const tasks = tasksForView(view, [...this.tasks.values()]);
    const rows = tasks.map((task) => ({
      task,
      values: {
        title: task.title,
        status: task.status,
        priority: task.priority,
        scheduled: task.scheduled ?? null,
        due: task.due ?? null,
        projects: task.projects,
        sortOrder: task.sortOrder ?? null,
      },
    }));
    const groupProperty =
      view.presentation?.type === "tasknotes.kanban"
        ? (view.presentation.mappings.column ?? "status")
        : view.id === "projects"
          ? "projects"
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

  async deleteViewSource(path: string): Promise<void> {
    this.sources.delete(path);
    this.documents = this.documents.filter(
      (document) => document.source.path !== path,
    );
    this.changed();
  }

  async getActiveScratchpad(): Promise<ScratchpadDocument> {
    return clone(this.scratchpad);
  }

  async saveScratchpad(
    input: SaveScratchpadInput,
  ): Promise<ScratchpadDocument> {
    if (input.id !== this.scratchpad.id)
      throw new Error(
        "The active scratchpad changed. Reload it before saving.",
      );
    this.scratchpad = {
      ...this.scratchpad,
      body: input.body,
      revision: `scratch-${Number(this.scratchpad.revision.split("-").at(-1) ?? 1) + 1}`,
      dateModified: new Date().toISOString(),
    };
    this.changed();
    return clone(this.scratchpad);
  }

  async archiveScratchpad(
    input: ArchiveScratchpadInput,
  ): Promise<ScratchpadArchiveResult> {
    const now = new Date().toISOString();
    const archived: ScratchpadDocument = {
      ...this.scratchpad,
      state: "converted",
      title: input.title?.trim() || "Scratchpad",
      body: input.body,
      dateModified: now,
      dateConverted: now,
      revision: "scratch-archived",
    };
    this.scratchpad = {
      id: crypto.randomUUID(),
      path: "scratchpads/Scratchpad.md",
      revision: "scratch-1",
      state: "active",
      dateCreated: now,
      dateModified: now,
      body: "",
    };
    this.changed();
    return clone({ archived, active: this.scratchpad });
  }

  async taskConfiguration(): Promise<TaskCollectionConfiguration> {
    return this.model.configuration();
  }

  async taskModelSettingsAccess() {
    return {
      writable: false,
      source: "Demo task definition",
      reason: "The demo resets when the page reloads.",
    };
  }

  async updateTaskModelSettings(
    patch: TaskModelSettingsPatch,
  ): Promise<TaskCollectionConfiguration> {
    void patch;
    throw new Error("Task definition settings are read-only in the demo.");
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

  private storeSource(path: string, format: string, document: string) {
    const source = {
      path,
      format,
      revision: `demo-view-${++this.sourceRevision}`,
      document,
    };
    this.sources.set(path, source);
    this.documents = this.documents.map((entry) =>
      entry.source.path === path
        ? {
            ...entry,
            source: { ...entry.source, revision: source.revision },
            views: entry.views.map((view) => ({
              ...view,
              source: { ...view.source, revision: source.revision },
            })),
          }
        : entry,
    );
    this.changed();
    return source;
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
    { key: configuration.fieldMapping.status, label: "Status" },
    { key: configuration.fieldMapping.scheduled, label: "Scheduled" },
    { key: configuration.fieldMapping.due, label: "Due" },
    { key: configuration.fieldMapping.priority, label: "Priority" },
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
      options: { create: false },
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

function tasksForView(view: TaskView, tasks: Task[]): Task[] {
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

function clone<T>(value: T): T {
  return structuredClone(value);
}
