import {
  resolveModelConfig,
  isCompletedStatus,
  isSkippedStatus,
  getDefaultCompletedStatus,
  getDefaultSkippedStatus,
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
  buildMaterializeOccurrencePlan,
  buildMaterializedOccurrenceCompletePlan,
  buildMaterializedOccurrenceSkipPlan,
  buildMaterializedOccurrenceUncompletePlan,
  buildMaterializedOccurrenceUnskipPlan,
  buildTaskUpdatePlan,
  recurringCompletePlanToFrontmatterPatch,
  recurringSkippedPlanToFrontmatterPatch,
} from "@tasknotes/model/operations";
import {
  buildDeleteTimeEntryPlan,
  buildStartTimeTrackingPlan,
  buildStopTimeTrackingPlan,
  getActiveTimeEntry,
  replaceTimeEntries,
} from "@tasknotes/model/time";
import { evaluateCoreValidation } from "@tasknotes/model/validation";

import { makeTaskPath, normalizeTaskDateTime } from "./task";
import { expandTaskTemplate } from "./task-template";

import type {
  CreateTaskInput,
  MaterializeOccurrenceResult,
  Task,
  TaskTimeEntry,
  UpdateTaskInput,
} from "./task";
import type { TaskCollectionConfiguration } from "./task-configuration";
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

export interface MaterializedOccurrenceTransition {
  occurrence: Task;
  parent: Task;
  materializeNextDate?: string;
}

export class TaskNotesTaskModel {
  readonly config: TaskCollectionConfiguration;
  private readonly typeName: string;
  private readonly recordsFolder: string;

  constructor(
    config: Partial<TaskCollectionConfiguration> = {},
    options: { typeName?: string; recordsFolder?: string } = {},
  ) {
    this.config = {
      ...resolveModelConfig(config),
      templating: config.templating ?? {
        enabled: false,
        failureMode: "warning_fallback",
        unknownVariablePolicy: "preserve",
      },
      archive: config.archive ?? {
        moveOnArchive: false,
        folder: "TaskNotes/Archive",
      },
    };
    this.typeName = options.typeName ?? "task";
    this.recordsFolder = options.recordsFolder ?? "tasks";
  }

  configuration(): TaskCollectionConfiguration {
    return {
      ...resolveModelConfig(this.config),
      templating: { ...this.config.templating },
      archive: { ...this.config.archive },
    };
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
      occurrence_materialization: input.occurrenceMaterialization,
      occurrence_next_trigger: input.occurrenceNextTrigger,
      occurrence_template: input.occurrenceTemplate,
      occurrence_past_horizon: input.occurrencePastHorizon,
      occurrence_future_horizon: input.occurrenceFutureHorizon,
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

  async createWithTemplate(
    input: CreateTaskInput,
    context: { id: string; now?: string; currentDate?: string },
    loadTemplate: (path: string) => Promise<string>,
  ): Promise<Task> {
    const task = this.create(input, context);
    const template = this.config.templating;
    if (!template.enabled || input.useTemplate === false) return task;
    try {
      if (!template.templatePath)
        throw new Error("template_missing: The task template path is missing.");
      const source = await loadTemplate(template.templatePath);
      const expanded = expandTaskTemplate(
        source,
        task,
        input,
        template,
        new Date(context.now ?? new Date().toISOString()),
      );
      const frontmatter = { ...expanded.frontmatter, ...task.frontmatter };
      const body = expanded.body.trim() ? expanded.body : task.body;
      return this.read({ path: task.path, frontmatter, body });
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : `template_parse_failed: ${String(reason)}`;
      if (template.failureMode === "error")
        throw new Error(message, { cause: reason });
      return {
        ...task,
        operationWarnings: [
          message.startsWith("template_")
            ? message
            : `template_parse_failed: ${message}`,
        ],
      };
    }
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
    if (
      original.recurrence_parent &&
      original.occurrence_date &&
      updates.status !== undefined &&
      occurrenceState(original.status, this.config.statuses) !==
        occurrenceState(updates.status, this.config.statuses)
    )
      throw new Error(
        "materialized_occurrence_transition_required: Complete, reopen, skip, or unskip the occurrence through its occurrence operation.",
      );
    if (input.priority !== undefined) updates.priority = input.priority;
    if (input.archived !== undefined) updates.archived = input.archived;
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
    if (input.occurrenceMaterialization !== undefined)
      updates.occurrence_materialization = input.occurrenceMaterialization;
    if (input.occurrenceNextTrigger !== undefined)
      updates.occurrence_next_trigger = input.occurrenceNextTrigger;
    if (input.occurrenceTemplate !== undefined)
      updates.occurrence_template = input.occurrenceTemplate ?? undefined;
    if (input.occurrencePastHorizon !== undefined)
      updates.occurrence_past_horizon =
        input.occurrencePastHorizon ?? undefined;
    if (input.occurrenceFutureHorizon !== undefined)
      updates.occurrence_future_horizon =
        input.occurrenceFutureHorizon ?? undefined;
    if (input.reminders !== undefined) updates.reminders = input.reminders;
    if (input.timeEstimate !== undefined)
      updates.timeEstimate = input.timeEstimate ?? undefined;
    if (input.timeEntries !== undefined)
      updates.timeEntries = normalizeTimeEntries(input.timeEntries);
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
    const updatedTask = this.autoStopAfterCompletion(
      original,
      plan.updatedTask,
      now,
    );
    this.assertValid(updatedTask);
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
      updatedTask,
      current.id,
      revision,
    );
    return this.toTask(updatedTask, frontmatter, revision);
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
      const updatedTask =
        plan.newComplete && this.config.timeTracking.autoStopOnComplete
          ? stopActiveEntry(plan.updatedTask, now)
          : plan.updatedTask;
      const revision = current.revision + 1;
      const frontmatter = this.writeFrontmatter(
        patched,
        updatedTask,
        current.id,
        revision,
      );
      return this.toTask(updatedTask, frontmatter, revision);
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

  async materializeOccurrence(
    parent: Task,
    targetDate: string,
    existingOccurrences: readonly Task[],
    context: { id: string; now?: string },
    loadTemplate?: (path: string) => Promise<string>,
  ): Promise<MaterializeOccurrenceResult> {
    const now = context.now ?? new Date().toISOString();
    const parentInfo = this.taskInfo(parent);
    const occurrenceInfos = existingOccurrences.map((task) =>
      this.taskInfo(task),
    );
    let plan = buildMaterializeOccurrencePlan({
      parentTask: parentInfo,
      targetDate,
      currentTimestamp: now,
      existingOccurrences: occurrenceInfos,
      defaultStatus: this.config.defaults.status,
      defaultPriority: this.config.defaults.priority,
    });
    const existing = plan.existingOccurrence
      ? existingOccurrences.find(
          (task) =>
            task.id === plan.existingOccurrence?.id ||
            task.path === plan.existingOccurrence?.path,
        )
      : undefined;
    if (!plan.created && existing)
      return {
        task: existing,
        created: false,
        warnings: plan.issues.map((issue) => issue.message),
      };

    let templateFrontmatter: Record<string, unknown> = {};
    let templateWarning: string | undefined;
    if (parentInfo.occurrence_template && loadTemplate) {
      try {
        const draft = this.materializedTaskFromPlan(
          plan.occurrenceTask,
          context.id,
          {},
        );
        const source = await loadTemplate(parentInfo.occurrence_template);
        const input = taskAsCreateInput(draft);
        const expanded = expandTaskTemplate(
          source,
          draft,
          input,
          { ...this.config.templating, enabled: true },
          new Date(now),
        );
        templateFrontmatter = expanded.frontmatter;
        const templateInfo: Partial<TaskInfo> = {
          ...mapTaskFromFrontmatter(
            this.config.fieldMapping,
            this.canonicalizeAliases(expanded.frontmatter, false),
            draft.path,
            this.config.storeTitleInFilename,
            this.config.userFields,
            this.config.statuses,
            this.config.priorities,
          ),
          details: expanded.body,
        };
        plan = buildMaterializeOccurrencePlan({
          parentTask: parentInfo,
          targetDate,
          currentTimestamp: now,
          existingOccurrences: occurrenceInfos,
          defaultStatus: this.config.defaults.status,
          defaultPriority: this.config.defaults.priority,
          templateTask: templateInfo,
        });
      } catch (reason) {
        const message =
          reason instanceof Error
            ? reason.message
            : `template_parse_failed: ${reason}`;
        if (this.config.templating.failureMode === "error") throw reason;
        templateWarning = message.startsWith("template_")
          ? message
          : `template_parse_failed: ${message}`;
      }
    }
    const task = this.materializedTaskFromPlan(
      plan.occurrenceTask,
      context.id,
      templateFrontmatter,
    );
    return {
      task,
      created: true,
      warnings: [
        ...plan.issues.map((issue) => issue.message),
        ...(templateWarning ? [templateWarning] : []),
      ],
    };
  }

  transitionMaterializedOccurrence(
    occurrence: Task,
    parent: Task,
    action: "toggle" | "skip",
    context: { now?: string } = {},
  ): MaterializedOccurrenceTransition {
    const now = context.now ?? new Date().toISOString();
    const occurrenceInfo = this.taskInfo(occurrence);
    const parentInfo = this.taskInfo(parent);
    const plan =
      action === "toggle"
        ? isCompletedStatus(occurrenceInfo.status, this.config.statuses)
          ? buildMaterializedOccurrenceUncompletePlan({
              occurrenceTask: occurrenceInfo,
              parentTask: parentInfo,
              activeStatus: this.config.defaults.status,
              currentTimestamp: now,
            })
          : buildMaterializedOccurrenceCompletePlan({
              occurrenceTask: occurrenceInfo,
              parentTask: parentInfo,
              completedStatus: getDefaultCompletedStatus(this.config.statuses),
              currentTimestamp: now,
              maintainDueDateOffsetInRecurring:
                this.config.recurrence.maintainDueDateOffset,
            })
        : isSkippedStatus(occurrenceInfo.status, this.config.statuses)
          ? buildMaterializedOccurrenceUnskipPlan({
              occurrenceTask: occurrenceInfo,
              parentTask: parentInfo,
              activeStatus: this.config.defaults.status,
              currentTimestamp: now,
            })
          : buildMaterializedOccurrenceSkipPlan({
              occurrenceTask: occurrenceInfo,
              parentTask: parentInfo,
              skippedStatus: getDefaultSkippedStatus(this.config.statuses),
              currentTimestamp: now,
              maintainDueDateOffsetInRecurring:
                this.config.recurrence.maintainDueDateOffset,
            });
    const updatedOccurrence = this.autoStopAfterCompletion(
      occurrenceInfo,
      plan.updatedOccurrenceTask,
      now,
    );
    return {
      occurrence: this.finishPlannedTask(occurrence, updatedOccurrence),
      parent: this.finishPlannedTask(parent, plan.updatedParentTask),
      materializeNextDate: plan.materializeNextDate,
    };
  }

  startTimeTracking(
    current: Task,
    context: { now?: string; start?: string; description?: string } = {},
  ): Task {
    const original = this.taskInfo(current);
    if (getActiveTimeEntry(original))
      throw new Error(
        "time_tracking_already_active: This task is already being timed.",
      );
    const now = canonicalMutationInstant(
      context.now ?? new Date().toISOString(),
      original,
    );
    const start = canonicalInstant(context.start ?? now);
    const plan = buildStartTimeTrackingPlan(
      original,
      now,
      start,
      context.description ?? this.config.timeTracking.defaultSessionDescription,
    );
    return this.finishTrackingMutation(current, plan.updatedTask);
  }

  stopTimeTracking(
    current: Task,
    context: { now?: string; stop?: string } = {},
  ): Task {
    const original = this.taskInfo(current);
    const active = getActiveTimeEntry(original);
    if (!active)
      throw new Error("no_active_time_entry: This task has no running timer.");
    const now = canonicalMutationInstant(
      context.now ?? new Date().toISOString(),
      original,
    );
    const stop = canonicalInstant(context.stop ?? now);
    if (new Date(stop).getTime() < new Date(active.startTime).getTime())
      throw new Error(
        "invalid_time_entry: A session cannot end before it starts.",
      );
    const plan = buildStopTimeTrackingPlan(original, active, now, stop);
    return this.finishTrackingMutation(current, plan.updatedTask);
  }

  replaceTimeEntries(
    current: Task,
    entries: readonly TaskTimeEntry[],
    context: { now?: string } = {},
  ): Task {
    const original = this.taskInfo(current);
    const now = canonicalMutationInstant(
      context.now ?? new Date().toISOString(),
      original,
    );
    const updated = replaceTimeEntries(
      original,
      normalizeTimeEntries(entries),
      now,
    );
    return this.finishTrackingMutation(current, updated);
  }

  removeTimeEntry(
    current: Task,
    index: number,
    context: { now?: string } = {},
  ): Task {
    const original = this.taskInfo(current);
    const now = canonicalMutationInstant(
      context.now ?? new Date().toISOString(),
      original,
    );
    const plan = buildDeleteTimeEntryPlan(original, index, now);
    return this.finishTrackingMutation(current, plan.updatedTask);
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
      archived: info.archived,
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
      recurrenceParent: info.recurrence_parent,
      occurrenceDate: info.occurrence_date,
      occurrenceMaterialization:
        info.occurrence_materialization ??
        this.config.occurrences.defaultMaterialization,
      occurrenceNextTrigger:
        info.occurrence_next_trigger ??
        this.config.occurrences.defaultNextTrigger,
      occurrenceTemplate: info.occurrence_template,
      occurrencePastHorizon:
        info.occurrence_past_horizon ?? this.config.occurrences.pastHorizon,
      occurrenceFutureHorizon:
        info.occurrence_future_horizon ?? this.config.occurrences.futureHorizon,
      skipped: isSkippedStatus(info.status, this.config.statuses),
      completeInstances: info.complete_instances ?? [],
      skippedInstances: info.skipped_instances ?? [],
      reminders: info.reminders ?? [],
      timeEstimate: info.timeEstimate,
      timeEntries: normalizeTimeEntries(info.timeEntries ?? []),
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

  private taskInfo(current: Task): TaskInfo {
    return this.completeTaskInfo(
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
  }

  private finishTrackingMutation(current: Task, updated: TaskInfo): Task {
    this.assertValid(updated);
    const revision = current.revision + 1;
    const frontmatter = this.writeFrontmatter(
      this.canonicalizeAliases(current.frontmatter, true),
      updated,
      current.id,
      revision,
    );
    return this.toTask(updated, frontmatter, revision);
  }

  private finishPlannedTask(current: Task, updated: TaskInfo): Task {
    this.assertValid(updated);
    const revision = current.revision + 1;
    const frontmatter = this.writeFrontmatter(
      this.canonicalizeAliases(current.frontmatter, true),
      updated,
      current.id,
      revision,
    );
    return this.toTask(updated, frontmatter, revision);
  }

  private materializedTaskFromPlan(
    planned: Partial<TaskInfo>,
    id: string,
    base: Record<string, unknown>,
  ): Task {
    const title = requiredTitle(planned.title ?? "");
    const info = this.completeTaskInfo(
      {
        ...planned,
        id,
        path: makeTaskPath(title, id, this.recordsFolder),
        title,
        archived: false,
      },
      makeTaskPath(title, id, this.recordsFolder),
      planned.details ?? "",
    );
    this.assertValid(info);
    return this.toTask(info, this.writeFrontmatter(base, info, id, 1), 1);
  }

  recordsFolderPath(): string {
    return this.recordsFolder;
  }

  archiveDestination(task: Task, archived: boolean): string | undefined {
    if (!this.config.archive.moveOnArchive) return undefined;
    const folder = normalizeCollectionFolder(
      archived ? this.config.archive.folder : this.recordsFolder,
    );
    const name = task.path.slice(task.path.lastIndexOf("/") + 1);
    const path = `${folder}/${name}`;
    return path === task.path ? undefined : path;
  }

  private autoStopAfterCompletion(
    original: TaskInfo,
    updated: TaskInfo,
    now: string,
  ): TaskInfo {
    if (
      !this.config.timeTracking.autoStopOnComplete ||
      isCompletedStatus(original.status, this.config.statuses) ||
      !isCompletedStatus(updated.status, this.config.statuses)
    )
      return updated;
    return stopActiveEntry(updated, now);
  }
}

function stopActiveEntry(task: TaskInfo, now: string): TaskInfo {
  const active = getActiveTimeEntry(task);
  if (!active) return task;
  const modified = canonicalMutationInstant(now, task);
  const stop =
    Date.parse(modified) < Date.parse(active.startTime)
      ? canonicalInstant(active.startTime)
      : modified;
  return buildStopTimeTrackingPlan(task, active, stop, stop).updatedTask;
}

function occurrenceState(
  value: string | undefined,
  statuses: TaskNotesModelConfig["statuses"],
): "active" | "completed" | "skipped" {
  if (isCompletedStatus(value, statuses)) return "completed";
  if (isSkippedStatus(value, statuses)) return "skipped";
  return "active";
}

function normalizeTimeEntries(
  entries: readonly TaskTimeEntry[],
): TaskTimeEntry[] {
  let active = 0;
  return entries.map((entry) => {
    const startTime = canonicalInstant(entry.startTime);
    const endTime = entry.endTime ? canonicalInstant(entry.endTime) : undefined;
    if (endTime && new Date(endTime).getTime() < new Date(startTime).getTime())
      throw new Error(
        "invalid_time_entry: A session cannot end before it starts.",
      );
    if (!endTime && ++active > 1)
      throw new Error(
        "multiple_active_time_entries: A task can have only one running timer.",
      );
    return {
      startTime,
      ...(endTime ? { endTime } : {}),
      ...(entry.description === undefined
        ? {}
        : { description: entry.description }),
    };
  });
}

function canonicalInstant(value: string): string {
  const trimmed = value.trim();
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed))
    throw new Error(
      "invalid_datetime_value: Time entries require an explicit timezone.",
    );
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime()))
    throw new Error(
      "invalid_datetime_value: The time entry datetime is invalid.",
    );
  return parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function canonicalMutationInstant(
  value: string,
  task: Partial<TaskInfo>,
): string {
  const candidate = canonicalInstant(value);
  const stored = [task.dateCreated, task.dateModified]
    .map((entry) => (entry ? Date.parse(entry) : Number.NaN))
    .filter(Number.isFinite);
  const minimum = stored.length
    ? Math.max(...stored)
    : Number.NEGATIVE_INFINITY;
  if (Date.parse(candidate) >= minimum) return candidate;
  return new Date(Math.ceil(minimum / 1_000) * 1_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
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

function taskAsCreateInput(task: Task): CreateTaskInput {
  return {
    title: task.title,
    status: task.status,
    priority: task.priority,
    due: task.due,
    scheduled: task.scheduled,
    body: task.body,
    tags: task.tags,
    contexts: task.contexts,
    projects: task.projects,
    reminders: task.reminders,
    timeEstimate: task.timeEstimate,
    customProperties: task.customProperties,
  };
}

function isEmptyCustomValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function normalizeCollectionFolder(value: string): string {
  const normalized = value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "");
  if (
    !normalized ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("archive_path_invalid: The archive folder is unsafe.");
  return normalized;
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
