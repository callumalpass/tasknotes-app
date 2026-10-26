import { t } from "@lingui/core/macro";
import { builtInFieldLabel } from "../i18n/default-labels";
import type { ExpressionField } from "../components/expression-builder";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";

// Editor labels intentionally support bracket references and manual-order names.
// Expression dialects elsewhere have their own property-label policies.
export function humanize(value: string): string {
  if (value.toLocaleLowerCase() === "tasknotes_manual_order")
    return t({ message: "Manual order" });
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

function defaultFields(): ExpressionField[] {
  return [
    field("title", t({ message: "Title" }), "text"),
    field("status", t({ message: "Status" }), "text"),
    field("priority", t({ message: "Priority" }), "text"),
    field("due", t({ message: "Due" }), "date"),
    field("scheduled", t({ message: "Scheduled" }), "date"),
    field("tags", t({ message: "Tags" }), "list"),
    field("projects", t({ message: "Projects" }), "list"),
    field("contexts", t({ message: "Contexts" }), "list"),
    field("archived", t({ message: "Archived" }), "boolean"),
    field("completed", t({ message: "Completed" }), "boolean"),
    field("file.name", t({ message: "File name" }), "text"),
    field("file.path", t({ message: "File path" }), "text"),
  ];
}

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
        label === "sortOrder"
          ? t({ message: "Manual order" })
          : (builtInFieldLabel(label) ?? humanize(label)),
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
    ...defaultFields().map((candidate) =>
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
