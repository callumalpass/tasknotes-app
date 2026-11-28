import type { TaskViewExecution, TaskViewRow } from "./view";

export interface TaskViewRowGroup {
  key: string;
  values: Record<string, unknown>;
  count: number;
  rows: TaskViewRow[];
}

export function groupTaskViewRows(
  execution: Pick<TaskViewExecution, "groups" | "rows">,
): TaskViewRowGroup[] {
  if (!execution.groups.length) return [];
  const groups: TaskViewRowGroup[] = [];
  const byFields = new Map<
    string,
    { fields: string[]; indices: Map<string, number> }
  >();
  execution.groups.forEach((group, sourceIndex) => {
    const fields = Object.keys(group.values).sort();
    if (!fields.length) return;
    const signature = JSON.stringify(fields);
    let lookup = byFields.get(signature);
    if (!lookup) {
      lookup = { fields, indices: new Map() };
      byFields.set(signature, lookup);
    }
    const key = JSON.stringify(
      fields.map((field) => valueKey(group.values[field])),
    );
    if (!lookup.indices.has(key)) lookup.indices.set(key, groups.length);
    groups.push({
      key: `${sourceIndex}:${valueKey(group.values)}`,
      values: group.values,
      count: group.count,
      rows: [],
    });
  });
  // Native groups ordinarily share one field. Only evaluate each distinct
  // field list once per row. The first matching group owns a task's identity,
  // including when the execution contains multiple rows for that identity.
  const assigned = new Map<string, { groupIndex: number; rowIndex: number }>();
  execution.rows.forEach((row, rowIndex) => {
    let first = assigned.get(row.task.id)?.groupIndex ?? Infinity;
    for (const { fields, indices } of byFields.values()) {
      const key = JSON.stringify(
        fields.map((field) => valueKey(rowGroupValue(row, field))),
      );
      const groupIndex = indices.get(key);
      if (groupIndex === undefined || groupIndex >= first) continue;
      first = groupIndex;
      assigned.set(row.task.id, { groupIndex, rowIndex });
    }
  });
  const ungrouped: TaskViewRow[] = [];
  execution.rows.forEach((row, rowIndex) => {
    const match = assigned.get(row.task.id);
    if (!match) ungrouped.push(row);
    else if (match.rowIndex === rowIndex)
      groups[match.groupIndex]!.rows.push(row);
  });
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
