import type { TaskViewExecution, TaskViewRow } from "./view";

export interface TaskViewRowGroup {
  key: string;
  values: Record<string, unknown>;
  count: number;
  rows: TaskViewRow[];
}

export function groupTaskViewRows(
  execution: TaskViewExecution,
): TaskViewRowGroup[] {
  if (!execution.groups.length) return [];
  const assigned = new Set<string>();
  const groups = execution.groups.flatMap((group, index) => {
    const entries = Object.entries(group.values);
    if (!entries.length) return [];
    const rows = execution.rows.filter((row) => {
      if (assigned.has(row.task.id)) return false;
      const matches = entries.every(
        ([field, value]) =>
          valueKey(rowGroupValue(row, field)) === valueKey(value),
      );
      if (matches) assigned.add(row.task.id);
      return matches;
    });
    if (!rows.length) return [];
    return [
      {
        key: `${index}:${valueKey(group.values)}`,
        values: group.values,
        count: group.count,
        rows,
      },
    ];
  });
  const ungrouped = execution.rows.filter((row) => !assigned.has(row.task.id));
  if (ungrouped.length)
    groups.push({
      key: "ungrouped",
      values: {},
      count: ungrouped.length,
      rows: ungrouped,
    });
  return groups;
}

function rowGroupValue(row: TaskViewRow, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(row.values, key))
    return row.values[key];
  const field = key.startsWith("note.") ? key.slice("note.".length) : key;
  return row.task.frontmatter[field] ?? null;
}

function valueKey(value: unknown): string {
  return JSON.stringify(value ?? null);
}
