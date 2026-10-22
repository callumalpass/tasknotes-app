import type { TaskViewExecution, TaskViewRow } from "../domain/view";

/** Reuse the previous objects for everything a re-query did not change, so an
 * edit re-renders only the rows it touched. A result identical to the one on
 * screen is returned as the previous object itself.
 */
export function shareUnchangedRows(
  previous: TaskViewExecution | null,
  next: TaskViewExecution,
): TaskViewExecution {
  if (!previous || previous.view.key !== next.view.key) return next;
  const view = sameJson(previous.view, next.view) ? previous.view : next.view;
  const earlier = new Map(previous.rows.map((row) => [row.task.id, row]));
  let changed =
    view !== previous.view || previous.rows.length !== next.rows.length;
  const rows = next.rows.map((row, index): TaskViewRow => {
    const before = earlier.get(row.task.id);
    if (before && sameJson(before, row)) {
      if (previous.rows[index] !== before) changed = true;
      return before;
    }
    changed = true;
    return row;
  });
  if (
    !changed &&
    sameJson(
      { ...previous, view: undefined, rows: undefined },
      { ...next, view: undefined, rows: undefined },
    )
  )
    return previous;
  return { ...next, view, rows };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
