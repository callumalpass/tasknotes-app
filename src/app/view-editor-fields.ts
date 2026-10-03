import type { ExpressionField } from "../components/expression-builder";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";

// Editor labels intentionally support bracket references and manual-order names.
// Expression dialects elsewhere have their own property-label policies.
export function humanize(value: string): string {
  if (value.toLocaleLowerCase() === "tasknotes_manual_order")
    return "Manual order";
  const bracket = value.match(
    /^(?:note|file|formula|projection)\[["'](.+)["']\]$/,
  );
  const name = bracket
    ? bracket[1]
    : value.includes(".")
      ? value.split(".").at(-1)!
      : value;
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

export function field(
  key: string,
  label: string,
  type: ExpressionField["type"] = "text",
): ExpressionField {
  return { key, label, type };
}

const defaultFields: ExpressionField[] = [
  field("title", "Title", "text"),
  field("status", "Status", "text"),
  field("priority", "Priority", "text"),
  field("due", "Due", "date"),
  field("scheduled", "Scheduled", "date"),
  field("tags", "Tags", "list"),
  field("projects", "Projects", "list"),
  field("contexts", "Contexts", "list"),
  field("archived", "Archived", "boolean"),
  field("completed", "Completed", "boolean"),
  field("file.name", "File name", "text"),
  field("file.path", "File path", "text"),
];

export function viewFields(
  configuration: TaskCollectionConfiguration,
  sourceProperties: string[],
): ExpressionField[] {
  const statuses = configuration.statuses.map((status) => ({
    value: status.value,
    label: status.label,
  }));
  const priorities = configuration.priorities.map((priority) => ({
    value: priority.value,
    label: priority.label,
  }));
  const mapped = Object.entries(configuration.fieldMapping).map(
    ([label, key]) =>
      field(
        String(key),
        label === "sortOrder" ? "Manual order" : humanize(label),
      ),
  );
  const custom = configuration.userFields.map((item) =>
    field(
      item.key,
      item.displayName,
      item.type === "text" ? "text" : item.type,
    ),
  );
  const candidates = [
    ...defaultFields.map((candidate) =>
      candidate.key === "status"
        ? { ...candidate, options: statuses }
        : candidate.key === "priority"
          ? { ...candidate, options: priorities }
          : candidate,
    ),
    ...mapped,
    ...custom,
    ...sourceProperties.map((key) => field(key, humanize(key))),
  ];
  const unique = new Map<string, ExpressionField>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.key)) unique.set(candidate.key, candidate);
  }
  return [...unique.values()];
}

export function fieldOptions(fields: ExpressionField[]) {
  return fields.map((candidate) => ({
    value: candidate.key,
    label: candidate.label,
  }));
}
