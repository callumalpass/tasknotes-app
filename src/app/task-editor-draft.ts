import { t } from "@lingui/core/macro";
import { countLabel, type CountKind } from "../i18n/default-labels";
import { recurrenceLabel } from "../i18n/presentation";
import { linkDisplayLabel } from "../domain/completion";
import { isEmptyFieldValue } from "../domain/custom-field-value";
import { recurrencePreset } from "../domain/recurrence-rule";
import {
  activeTimeEntry,
  formatRelativeTaskDate,
  type Task,
} from "../domain/task";
import {
  occurrenceTask,
  taskOccurrenceForDate,
} from "../domain/task-occurrence";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";

export type Draft = Pick<
  Task,
  | "title"
  | "status"
  | "priority"
  | "due"
  | "scheduled"
  | "body"
  | "tags"
  | "contexts"
  | "projects"
  | "assignees"
  | "blockedBy"
  | "recurrence"
  | "recurrenceAnchor"
  | "occurrenceMaterialization"
  | "occurrenceNextTrigger"
  | "occurrenceTemplate"
  | "occurrencePastHorizon"
  | "occurrenceFutureHorizon"
  | "reminders"
  | "timeEstimate"
  | "customProperties"
>;

export function scheduleSummary(
  task: Task,
  draft: Draft,
  configuration: TaskCollectionConfiguration,
  occurrenceDate?: string,
): string {
  const dates =
    occurrenceDate && draft.recurrence
      ? occurrenceTask(
          taskOccurrenceForDate(
            {
              ...task,
              scheduled: draft.scheduled,
              due: draft.due,
              recurrence: draft.recurrence,
            },
            occurrenceDate,
          ),
        )
      : draft;
  return (
    [
      draft.status !== "none" && draft.status !== configuration.defaults.status
        ? (configuration.statuses.find(
            (status) => status.value === draft.status,
          )?.label ?? draft.status)
        : "",
      dates.scheduled
        ? `Scheduled ${formatRelativeTaskDate(dates.scheduled)}`
        : "",
      dates.due ? `Due ${formatRelativeTaskDate(dates.due)}` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "No dates"
  );
}

export function toDraft(task: Task): Draft {
  return {
    title: task.title,
    status: task.status,
    priority: task.priority,
    due: task.due,
    scheduled: task.scheduled,
    body: task.body,
    tags: task.tags ?? [],
    contexts: task.contexts ?? [],
    projects: task.projects ?? [],
    assignees: task.assignees ?? [],
    blockedBy: task.blockedBy ?? [],
    recurrence: task.recurrence,
    recurrenceAnchor: task.recurrenceAnchor,
    occurrenceMaterialization: task.occurrenceMaterialization,
    occurrenceNextTrigger: task.occurrenceNextTrigger,
    occurrenceTemplate: task.occurrenceTemplate,
    occurrencePastHorizon: task.occurrencePastHorizon,
    occurrenceFutureHorizon: task.occurrenceFutureHorizon,
    reminders: task.reminders ?? [],
    timeEstimate: task.timeEstimate,
    customProperties: { ...(task.customProperties ?? {}) },
  };
}

export function organizeSummary(draft: Draft): string {
  const values: string[] = [];
  if (draft.priority !== "normal" && draft.priority !== "none")
    values.push(t`${humanizeValue(draft.priority)} priority`);
  if (draft.assignees?.length)
    values.push(t`${draft.assignees.length} assigned`);
  if (draft.projects.length)
    values.push(listSummary(draft.projects, "project"));
  if (draft.blockedBy.length)
    values.push(countLabel(draft.blockedBy.length, "dependency"));
  if (draft.contexts.length)
    values.push(listSummary(draft.contexts, "context"));
  const tags = draft.tags.filter((tag) => tag !== "task");
  if (tags.length) values.push(countLabel(tags.length, "tag"));
  const customCount = Object.values(draft.customProperties).filter(
    (value) => !isEmptyFieldValue(value),
  ).length;
  if (customCount) values.push(countLabel(customCount, "property"));
  return (
    values.join(" · ") || t`Priority, projects, dependencies, contexts and tags`
  );
}

export function timeSummary(task: Task, estimate?: number): string {
  const active = activeTimeEntry(task.timeEntries);
  const values: string[] = [];
  if (active) values.push(t`Timer running`);
  else if (task.timeEntries.length)
    values.push(countLabel(task.timeEntries.length, "session"));
  if (estimate) values.push(t`${estimate}m estimate`);
  return values.join(" · ") || t`Estimate and work sessions`;
}

export function repeatSummary(draft: Draft): string {
  const values: string[] = [];
  if (draft.recurrence) {
    const preset = recurrencePreset(draft.recurrence);
    values.push(
      preset === "advanced"
        ? t({ message: "Advanced repeat" })
        : recurrenceLabel(draft.recurrence),
    );
  }
  if (draft.reminders.length)
    values.push(countLabel(draft.reminders.length, "reminder"));
  return values.join(" · ") || t`No repeat or reminder`;
}

export { isEmptyFieldValue } from "../domain/custom-field-value";

function listSummary(values: string[], singular: CountKind): string {
  return values.length === 1
    ? linkDisplayLabel(values[0])
    : countLabel(values.length, singular);
}

export function formatOccurrenceDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function humanizeValue(value: string): string {
  const normalized = value.replaceAll("_", " ").replaceAll("-", " ");
  return normalized
    ? `${normalized[0].toUpperCase()}${normalized.slice(1)}`
    : value;
}
