import {
  resolveModelConfig,
  isCompletedStatus,
  getDefaultCompletedStatus,
} from "@tasknotes/model/config";
import { getCurrentDateString } from "@tasknotes/model/date";
import {
  mapTaskFromFrontmatter,
  mapTaskToFrontmatter,
} from "@tasknotes/model/mapping";
import {
  applyFrontmatterPatch,
  buildRecurringTaskCompletePlan,
  buildRecurringTaskSkippedPlan,
  buildTaskUpdatePlan,
  recurringCompletePlanToFrontmatterPatch,
  recurringSkippedPlanToFrontmatterPatch,
} from "@tasknotes/model/operations";
import { evaluateCoreValidation } from "@tasknotes/model/validation";

import { makeTaskPath, normalizeTaskDateTime } from "./task";

import type { CreateTaskInput, Task, UpdateTaskInput } from "./task";
import type {
  TaskInfo,
  TaskNotesModelConfig,
  TaskValidationIssue,
} from "@tasknotes/model/types";

const READ_ALIASES: Partial<
  Record<keyof TaskNotesModelConfig["fieldMapping"], string[]>
> = {
  completedDate: ["completedDate", "completed_date"],
  dateCreated: ["dateCreated", "date_created"],
  dateModified: ["dateModified", "date_modified"],
  recurrenceAnchor: ["recurrence_anchor", "recurrenceAnchor"],
  completeInstances: ["complete_instances", "completeInstances"],
  skippedInstances: ["skipped_instances", "skippedInstances"],
  recurrenceParent: ["recurrence_parent", "recurrenceParent"],
  occurrenceDate: ["occurrence_date", "occurrenceDate"],
  occurrenceMaterialization: [
    "occurrence_materialization",
    "occurrenceMaterialization",
  ],
  occurrenceNextTrigger: ["occurrence_next_trigger", "occurrenceNextTrigger"],
  occurrenceTemplate: ["occurrence_template", "occurrenceTemplate"],
  occurrencePastHorizon: ["occurrence_past_horizon", "occurrencePastHorizon"],
  occurrenceFutureHorizon: [
    "occurrence_future_horizon",
    "occurrenceFutureHorizon",
  ],
  timeEstimate: ["timeEstimate", "time_estimate"],
  timeEntries: ["timeEntries", "time_entries"],
  blockedBy: ["blockedBy", "blocked_by"],
};

export class TaskNotesValidationError extends Error {
  constructor(readonly issues: TaskValidationIssue[]) {
    super(
      issues
        .map((issue) => `${issue.field ?? issue.code}: ${issue.message}`)
        .join("\n"),
    );
    this.name = "TaskNotesValidationError";
  }
}

export class TaskNotesTaskModel {
  readonly config: TaskNotesModelConfig;
  private readonly typeName: string;
  private readonly recordsFolder: string;

  constructor(
    config: Partial<TaskNotesModelConfig> = {},
    options: { typeName?: string; recordsFolder?: string } = {},
  ) {
    this.config = resolveModelConfig(config);
    this.typeName = options.typeName ?? "task";
    this.recordsFolder = options.recordsFolder ?? "tasks";
  }

  configuration(): TaskNotesModelConfig {
    return resolveModelConfig(this.config);
  }

  read(input: {
    path: string;
    frontmatter: Record<string, unknown>;
    body: string;
  }): Task {
    const readable = this.canonicalizeAliases(input.frontmatter, false);
    const mapped = mapTaskFromFrontmatter(
      this.config.fieldMapping,
      readable,
      input.path,
      this.config.storeTitleInFilename,
      this.config.userFields,
      this.config.statuses,
      this.config.priorities,
    );
    const task = this.completeTaskInfo(mapped, input.path, input.body);
    this.assertValid(task);
    return this.toTask(
      task,
      input.frontmatter,
      integerValue(input.frontmatter.mobileRevision) ?? 1,
    );
  }

  create(
    input: CreateTaskInput,
    context: { id: string; now?: string; currentDate?: string },
  ): Task {
    const title = requiredTitle(input.title);
    const now = context.now ?? new Date().toISOString();
    const info: TaskInfo = {
      id: context.id,
      path: makeTaskPath(title, context.id, this.recordsFolder),
      title,
      status: input.status ?? this.config.defaults.status,
      priority: input.priority ?? this.config.defaults.priority,
      due: normalizeTaskDateTime(input.due),
      scheduled: normalizeTaskDateTime(input.scheduled),
      details: input.body ?? "",
      tags: input.tags,
      contexts: input.contexts,
      projects: input.projects,
      recurrence: input.recurrence,
      recurrence_anchor: input.recurrenceAnchor,
      reminders: input.reminders,
      timeEstimate: input.timeEstimate,
      customProperties: withUserFieldDefaults(
        this.config,
        input.customProperties,
      ),
      dateCreated: now,
      dateModified: now,
      archived: false,
    };
    this.assertValid(info);
    const frontmatter = this.writeFrontmatter({}, info, context.id, 1);
    return this.toTask(info, frontmatter, 1);
  }

  update(
    current: Task,
    input: UpdateTaskInput,
    context: { now?: string; currentDate?: string } = {},
  ): Task {
    const original = this.completeTaskInfo(
      mapTaskFromFrontmatter(
        this.config.fieldMapping,
        this.canonicalizeAliases(current.frontmatter, false),
        current.path,
        this.config.storeTitleInFilename,
        this.config.userFields,
        this.config.statuses,
        this.config.priorities,
      ),
      current.path,
      current.body,
    );
    const now = context.now ?? new Date().toISOString();
    const updates: Partial<TaskInfo> & { details?: string } = {};
    if (input.title !== undefined) updates.title = requiredTitle(input.title);
    if (input.status !== undefined) updates.status = input.status;
    else if (input.completed !== undefined) {
      updates.status = input.completed
        ? getDefaultCompletedStatus(this.config.statuses)
        : this.config.defaults.status;
    }
    if (input.priority !== undefined) updates.priority = input.priority;
    if (input.due !== undefined)
      updates.due = normalizeTaskDateTime(input.due ?? undefined);
    if (input.scheduled !== undefined)
      updates.scheduled = normalizeTaskDateTime(input.scheduled ?? undefined);
    if (input.body !== undefined) updates.details = input.body;
    if (input.tags !== undefined) updates.tags = input.tags;
    if (input.contexts !== undefined) updates.contexts = input.contexts;
    if (input.projects !== undefined) updates.projects = input.projects;
    if (input.recurrence !== undefined)
      updates.recurrence = input.recurrence ?? undefined;
    if (input.recurrenceAnchor !== undefined)
      updates.recurrence_anchor = input.recurrenceAnchor;
    if (input.reminders !== undefined) updates.reminders = input.reminders;
    if (input.timeEstimate !== undefined)
      updates.timeEstimate = input.timeEstimate ?? undefined;
    if (input.customProperties !== undefined)
      updates.customProperties = input.customProperties;

    const plan = buildTaskUpdatePlan({
      originalTask: original,
      updates,
      fieldMapping: this.config.fieldMapping,
      taskTag: this.config.defaults.taskTag,
      storeTitleInFilename: this.config.storeTitleInFilename,
      userFields: this.config.userFields,
      statuses: this.config.statuses,
      now,
      currentDateString: context.currentDate ?? getCurrentDateString(),
      maintainDueDateOffsetInRecurring:
        this.config.recurrence.maintainDueDateOffset,
    });
    this.assertValid(plan.updatedTask);
    const revision = current.revision + 1;
    const base = this.canonicalizeAliases(current.frontmatter, true);
    const patched = applyFrontmatterPatch(base, plan.frontmatterPatch);
    if (input.customProperties !== undefined) {
      for (const field of this.config.userFields) {
        const value = input.customProperties[field.key];
        if (isEmptyCustomValue(value)) delete patched[field.key];
      }
    }
    const frontmatter = this.writeFrontmatter(
      patched,
      plan.updatedTask,
      current.id,
      revision,
    );
    return this.toTask(plan.updatedTask, frontmatter, revision);
  }

  toggle(
    current: Task,
    context: { now?: string; currentDate?: string } = {},
  ): Task {
    if (current.recurrence) {
      const original = this.completeTaskInfo(
        mapTaskFromFrontmatter(
          this.config.fieldMapping,
          this.canonicalizeAliases(current.frontmatter, false),
          current.path,
          this.config.storeTitleInFilename,
          this.config.userFields,
          this.config.statuses,
          this.config.priorities,
        ),
        current.path,
        current.body,
      );
      const now = context.now ?? new Date().toISOString();
      const plan = buildRecurringTaskCompletePlan({
        freshTask: original,
        targetDate: context.currentDate
          ? new Date(`${context.currentDate}T12:00:00Z`)
          : undefined,
        currentTimestamp: now,
        maintainDueDateOffsetInRecurring:
          this.config.recurrence.maintainDueDateOffset,
      });
      const base = this.canonicalizeAliases(current.frontmatter, true);
      const patched = applyFrontmatterPatch(
        base,
        recurringCompletePlanToFrontmatterPatch(plan, this.config.fieldMapping),
      );
      const revision = current.revision + 1;
      const frontmatter = this.writeFrontmatter(
        patched,
        plan.updatedTask,
        current.id,
        revision,
      );
      return this.toTask(plan.updatedTask, frontmatter, revision);
    }
    return this.update(
      current,
      {
        status: current.completed
          ? this.config.defaults.status
          : getDefaultCompletedStatus(this.config.statuses),
      },
      context,
    );
  }

  skip(
    current: Task,
    context: { now?: string; currentDate?: string } = {},
  ): Task {
    if (!current.recurrence) throw new Error("Task is not recurring.");
    const original = this.completeTaskInfo(
      mapTaskFromFrontmatter(
        this.config.fieldMapping,
        this.canonicalizeAliases(current.frontmatter, false),
        current.path,
        this.config.storeTitleInFilename,
        this.config.userFields,
        this.config.statuses,
        this.config.priorities,
      ),
      current.path,
      current.body,
    );
    const now = context.now ?? new Date().toISOString();
    const plan = buildRecurringTaskSkippedPlan({
      freshTask: original,
      targetDate: context.currentDate
        ? new Date(`${context.currentDate}T12:00:00Z`)
        : undefined,
      currentTimestamp: now,
      maintainDueDateOffsetInRecurring:
        this.config.recurrence.maintainDueDateOffset,
    });
    const base = this.canonicalizeAliases(current.frontmatter, true);
    const patched = applyFrontmatterPatch(
      base,
      recurringSkippedPlanToFrontmatterPatch(plan, this.config.fieldMapping),
    );
    const revision = current.revision + 1;
    const frontmatter = this.writeFrontmatter(
      patched,
      plan.updatedTask,
      current.id,
      revision,
    );
    return this.toTask(plan.updatedTask, frontmatter, revision);
  }

  private completeTaskInfo(
    mapped: Partial<TaskInfo>,
    path: string,
    body: string,
  ): TaskInfo {
    const normalized = { ...mapped } as Partial<TaskInfo> &
      Record<string, unknown>;
    for (const field of this.config.userFields) delete normalized[field.key];
    return {
      ...normalized,
      id: normalized.id,
      path,
      title: normalized.title ?? "",
      status: normalized.status ?? "",
      priority: normalized.priority ?? this.config.defaults.priority,
      archived: normalized.archived ?? false,
      details: body,
    };
  }

  private toTask(
    info: TaskInfo,
    frontmatter: Record<string, unknown>,
    revision: number,
  ): Task {
    return {
      id: info.id ?? info.path,
      path: info.path,
      title: info.title,
      status: info.status,
      completed: isCompletedStatus(info.status, this.config.statuses),
      priority: info.priority,
      due: info.due,
      scheduled: info.scheduled,
      body: info.details ?? "",
      createdAt: info.dateCreated ?? "",
      updatedAt: info.dateModified ?? "",
      completedDate: info.completedDate,
      tags: info.tags ?? [],
      contexts: info.contexts ?? [],
      projects: info.projects ?? [],
      recurrence: info.recurrence,
      recurrenceAnchor: info.recurrence_anchor,
      completeInstances: info.complete_instances ?? [],
      skippedInstances: info.skipped_instances ?? [],
      reminders: info.reminders ?? [],
      timeEstimate: info.timeEstimate,
      customProperties: info.customProperties ?? {},
      revision,
      frontmatter,
    };
  }

  private writeFrontmatter(
    base: Record<string, unknown>,
    info: Partial<TaskInfo>,
    id: string,
    revision: number,
  ): Record<string, unknown> {
    return {
      ...base,
      ...mapTaskToFrontmatter(
        this.config.fieldMapping,
        info,
        this.config.defaults.taskTag,
        this.config.storeTitleInFilename,
        this.config.userFields,
      ),
      type: this.typeName,
      id,
      mobileRevision: revision,
    };
  }

  private canonicalizeAliases(
    source: Record<string, unknown>,
    removeAliases: boolean,
  ): Record<string, unknown> {
    const result = { ...source };
    for (const [role, aliases] of Object.entries(READ_ALIASES) as [
      keyof TaskNotesModelConfig["fieldMapping"],
      string[],
    ][]) {
      const canonical = this.config.fieldMapping[role];
      if (!Object.prototype.hasOwnProperty.call(result, canonical)) {
        const alias = aliases.find((candidate) =>
          Object.prototype.hasOwnProperty.call(result, candidate),
        );
        if (alias) result[canonical] = result[alias];
      }
      if (removeAliases) {
        for (const alias of aliases)
          if (alias !== canonical) delete result[alias];
      }
    }
    return result;
  }

  private assertValid(task: Partial<TaskInfo>): void {
    const validation = evaluateCoreValidation(task, this.config.statuses);
    if (!validation.valid)
      throw new TaskNotesValidationError(validation.issues);
  }
}

function withUserFieldDefaults(
  config: TaskNotesModelConfig,
  supplied: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const values: Record<string, unknown> = {};
  for (const field of config.userFields) {
    if (field.defaultValue !== undefined)
      values[field.key] = field.defaultValue;
  }
  Object.assign(values, supplied);
  return Object.keys(values).length ? values : undefined;
}

function isEmptyCustomValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function requiredTitle(value: string): string {
  const title = value.trim();
  if (!title) throw new Error("A task title is required.");
  return title;
}

function integerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}
