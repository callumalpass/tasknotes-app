import { resolveTaskNotesModelConfigFromMdbaseType } from "@tasknotes/model/mdbase";
import { mapTaskToFrontmatter } from "@tasknotes/model/mapping";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";
import type { JsonValue, JsonObject } from "@mdbase-dev/sdk";
import { Validator, type Schema } from "@cfworker/json-schema";
import YAML from "yaml";
import type { SourceData, TodoistTask } from "./todoist";

export type { JsonObject };
export interface DestinationType {
  name: string;
  definition: JsonObject;
  schema: JsonObject;
  fields: Record<string, string>;
  binding?: JsonValue;
  revision?: string;
  digest?: string;
}
export interface ImportOptions {
  folder: string;
  dateTarget: "scheduled" | "due";
  priorities: Record<number, string>;
}
export interface PlannedTask {
  sourceId: string;
  identity: string;
  title: string;
  path: string;
  type: string;
  frontmatter: JsonObject;
  body: string;
  warnings: string[];
  errors: string[];
}
export function modelFor(target: DestinationType) {
  return resolveTaskNotesModelConfigFromMdbaseType({
    ...target.definition,
    schema: { value: target.schema },
    implements: [
      {
        contract: "tasknotes.task",
        version: TASKNOTES_SPEC_VERSION,
        fields: target.fields,
        binding: target.binding,
      },
    ],
  });
}
export function safeFolder(value: string): string {
  const folder = value.trim().replace(/\/$/, "");
  if (
    !folder ||
    folder.startsWith("/") ||
    folder
      .split("/")
      .some(
        (s) =>
          !s ||
          s === "." ||
          s === ".." ||
          s.startsWith(".") ||
          /[\\:*?"<>|\x00-\x1f]/.test(s),
      )
  )
    throw new Error(
      "Choose a relative folder without hidden, empty, or traversal segments.",
    );
  return folder;
}
export async function sourceIdentity(
  userId: string,
  taskId: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify(["todoist", userId, taskId]),
  );
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export function sourceMarker(identity: string) {
  return `<!-- tasknotes-import:todoist:${identity} -->`;
}
export function importedIdentity(body: string): string | undefined {
  return body
    .trimEnd()
    .match(/<!-- tasknotes-import:todoist:([a-f0-9]{64}) -->$/)?.[1];
}

function dateValue(date: string, errors: string[]): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  if (
    /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(date) &&
    Number.isFinite(Date.parse(date))
  )
    return date;
  errors.push(
    "Floating or unrecognized time needs review. This version only imports all-day dates and timestamps with explicit UTC offsets.",
  );
  return undefined;
}
function recurrence(task: TodoistTask, errors: string[]): string | undefined {
  if (!task.due?.is_recurring) return undefined;
  const text = task.due.string?.trim().toLowerCase();
  const rules: Record<string, string> = {
    "every day": "FREQ=DAILY",
    daily: "FREQ=DAILY",
    "every week": "FREQ=WEEKLY",
    weekly: "FREQ=WEEKLY",
  };
  // Fixed-zone repeating times need zone-aware recurrence beyond the portable timestamp.
  if (
    task.due.date.includes("T") ||
    task.due.lang !== "en" ||
    !text ||
    !rules[text]
  ) {
    errors.push(
      `Recurrence requires manual conversion: ${task.due.string || "unknown rule"}. Deselect this task; it will not be silently flattened.`,
    );
    return undefined;
  }
  return rules[text];
}
export async function makePlan(
  source: SourceData,
  selected: Set<string>,
  target: DestinationType,
  options: ImportOptions,
  now = new Date().toISOString(),
): Promise<PlannedTask[]> {
  const folder = safeFolder(options.folder),
    config = modelFor(target),
    fields = target.fields;
  // Interpret schemas without eval/new Function so collection-defined schemas work under CSP.
  const validator = new Validator(target.schema as Schema, "2020-12", false);
  return Promise.all(
    source.tasks
      .filter((t) => selected.has(t.id))
      .map(async (task) => {
        const errors: string[] = [],
          warnings: string[] = [];
        const identity = await sourceIdentity(source.userId, task.id);
        const path = `${folder}/todoist-${identity}.md`;
        if (config.storeTitleInFilename)
          errors.push(
            "Filename-authoritative task types are not supported yet. Choose a frontmatter-title type.",
          );
        if (
          Object.values(fields).some((f) => f.includes(".") || f.includes("["))
        )
          errors.push("Nested contract field mappings are not supported yet.");
        if (task.checked || task.is_completed || task.completed_at)
          errors.push(
            "Completed tasks are not supported in this active-task importer.",
          );
        if (
          config.statuses.find((s) => s.value === config.defaults.status)
            ?.isCompleted
        )
          errors.push(
            "The destination default status is completed. Choose a task type with an active default status.",
          );
        if (task.labels.length && !fields.tags)
          errors.push(
            "Destination does not map tags; refusing to discard Todoist labels.",
          );
        const rule = recurrence(task, errors);
        const due = task.deadline
          ? dateValue(task.deadline.date, errors)
          : undefined;
        const date = task.due ? dateValue(task.due.date, errors) : undefined;
        if (options.dateTarget === "due" && due && date && due !== date)
          errors.push(
            "Task date and deadline differ. Map task dates to scheduled to preserve both.",
          );
        if (rule && options.dateTarget !== "scheduled")
          errors.push("Recurring task dates must map to scheduled.");
        const priority = options.priorities[task.priority];
        if (!config.priorities.some((p) => p.value === priority))
          errors.push(
            `Choose a destination mapping for Todoist API priority ${task.priority}.`,
          );
        const project = source.projects.find((p) => p.id === task.project_id);
        const section = source.sections.find((s) => s.id === task.section_id);
        if (task.parent_id)
          warnings.push(
            "Subtask relationship is preserved as source metadata, not recreated as a TaskNotes dependency.",
          );
        if (section) warnings.push("Section is preserved in the task body.");
        if (project?.parent_id)
          warnings.push(
            "Project hierarchy is preserved as source metadata; no project notes are created.",
          );
        if (task.labels.some((t) => /\s/.test(t)))
          warnings.push(
            "Labels are retained as strings. Check their appearance in your TaskNotes views.",
          );
        const semantic = {
          title: task.content,
          status: config.defaults.status,
          priority,
          scheduled: options.dateTarget === "scheduled" ? date : undefined,
          due: due ?? (options.dateTarget === "due" ? date : undefined),
          tags: task.labels,
          projects: project ? [project.name] : undefined,
          timeEstimate: task.duration
            ? task.duration.amount * (task.duration.unit === "day" ? 1440 : 1)
            : undefined,
          recurrence: rule,
          recurrence_anchor: rule ? ("scheduled" as const) : undefined,
          dateCreated: now,
          dateModified: now,
        };
        const frontmatter = mapTaskToFrontmatter(
          config.fieldMapping,
          semantic,
          config.taskIdentification.method === "tag"
            ? config.taskIdentification.tag
            : undefined,
          config.storeTitleInFilename,
        );
        // The shared mapper writes tags under `tags`; the portable contract may map it elsewhere.
        if (frontmatter.tags && fields.tags && fields.tags !== "tags") {
          frontmatter[fields.tags] = frontmatter.tags;
          delete frontmatter.tags;
        }
        if (config.taskIdentification.method === "property")
          frontmatter[config.taskIdentification.propertyName] =
            config.taskIdentification.propertyValue;
        if (fields.id) frontmatter[fields.id] = crypto.randomUUID();
        for (const [role, value] of Object.entries({
          title: semantic.title,
          priority: semantic.priority,
          scheduled: semantic.scheduled,
          due: semantic.due,
          projects: semantic.projects,
          timeEstimate: semantic.timeEstimate,
          recurrence: rule,
          recurrenceAnchor: semantic.recurrence_anchor,
        })) {
          if (value !== undefined && !fields[role])
            errors.push(
              `Destination does not map ${role}; refusing to discard it.`,
            );
        }
        const lifecycle = target.definition.lifecycle as
          Record<string, unknown> | undefined;
        if (lifecycle)
          warnings.push(
            "Collection lifecycle rules may set creation timestamps and IDs. Original Todoist creation time is preserved below.",
          );
        const validation = validator.validate(frontmatter);
        if (!validation.valid)
          errors.push(
            ...validation.errors.map(
              (e) =>
                `Destination schema ${e.instanceLocation || "/"}: ${e.error}`,
            ),
          );
        const provenance = {
          provider: "todoist",
          account_id: source.userId,
          task_id: task.id,
          project_id: task.project_id,
          project_name: project?.name,
          project_parent_id: project?.parent_id,
          section_id: task.section_id,
          section_name: section?.name,
          parent_id: task.parent_id,
          added_at: task.added_at,
          original_due: task.due,
          original_deadline: task.deadline,
          original_priority: task.priority,
        };
        // JSON is shown as fenced text; source descriptions remain Markdown but are never rendered as HTML here.
        const body = `${task.description}${task.description ? "\n\n" : ""}---\n\n## Imported from Todoist\n\n[Open original task](https://app.todoist.com/app/task/${encodeURIComponent(task.id)})\n\n\`\`\`json\n${JSON.stringify(provenance, null, 2).replace(/`/g, "\\u0060")}\n\`\`\`\n\n${sourceMarker(identity)}\n`;
        return {
          sourceId: task.id,
          identity,
          title: task.content,
          path,
          type: target.name,
          frontmatter: JSON.parse(JSON.stringify(frontmatter)) as JsonObject,
          body,
          warnings,
          errors,
        };
      }),
  );
}
export function markdown(task: PlannedTask): string {
  return `---\n${YAML.stringify(task.frontmatter)}---\n\n${task.body}`;
}
