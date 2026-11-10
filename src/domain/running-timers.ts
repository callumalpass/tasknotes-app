import { activeTimeEntry } from "./task";

import type { TaskSummary } from "./task";

export interface RunningTimer {
  id: string;
  title: string;
  startTime: string;
}

/** Tasks with an open time entry, the most recently started first. */
export function runningTimers(tasks: Iterable<TaskSummary>): RunningTimer[] {
  const running: RunningTimer[] = [];
  for (const task of tasks) {
    const entry = activeTimeEntry(task.timeEntries);
    if (entry)
      running.push({
        id: task.id,
        title: task.title,
        startTime: entry.startTime,
      });
  }
  return running.sort(
    (left, right) =>
      right.startTime.localeCompare(left.startTime) ||
      left.id.localeCompare(right.id),
  );
}
