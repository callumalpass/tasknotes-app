import { recurrencePreset } from "../domain/recurrence-rule";
import { activeTimeEntry, type Task } from "../domain/task";

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
    values.push(`${humanizeValue(draft.priority)} priority`);
  if (draft.projects.length)
    values.push(listSummary(draft.projects, "project"));
  if (draft.blockedBy.length)
    values.push(
      `${draft.blockedBy.length} ${draft.blockedBy.length === 1 ? "dependency" : "dependencies"}`,
    );
  if (draft.contexts.length)
    values.push(listSummary(draft.contexts, "context"));
  const tags = draft.tags.filter((tag) => tag !== "task");
  if (tags.length)
    values.push(`${tags.length} ${tags.length === 1 ? "tag" : "tags"}`);
  const customCount = Object.values(draft.customProperties).filter(
    (value) => !isEmptyFieldValue(value),
  ).length;
  if (customCount)
    values.push(
      `${customCount} ${customCount === 1 ? "property" : "properties"}`,
    );
  return (
    values.join(" · ") || "Priority, projects, dependencies, contexts and tags"
  );
}

export function timeSummary(task: Task, estimate?: number): string {
  const active = activeTimeEntry(task.timeEntries);
  const values: string[] = [];
  if (active) values.push("Timer running");
  else if (task.timeEntries.length)
    values.push(
      `${task.timeEntries.length} ${task.timeEntries.length === 1 ? "session" : "sessions"}`,
    );
  if (estimate) values.push(`${estimate}m estimate`);
  return values.join(" · ") || "Estimate and work sessions";
}

export function repeatSummary(draft: Draft): string {
  const values: string[] = [];
  if (draft.recurrence) {
    const preset = recurrencePreset(draft.recurrence);
    values.push(
      preset === "advanced" ? "Advanced repeat" : humanizeValue(preset),
    );
  }
  if (draft.reminders.length)
    values.push(
      `${draft.reminders.length} ${draft.reminders.length === 1 ? "reminder" : "reminders"}`,
    );
  return values.join(" · ") || "No repeat or reminder";
}

export function isEmptyFieldValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function listSummary(values: string[], singular: string): string {
  return values.length === 1 ? values[0] : `${values.length} ${singular}s`;
}

function humanizeValue(value: string): string {
  const normalized = value.replaceAll("_", " ").replaceAll("-", " ");
  return normalized
    ? `${normalized[0].toUpperCase()}${normalized.slice(1)}`
    : value;
}
