import { runtimeTimezone } from "./runtime-timezone";
import { taskDatePart, type TaskSummary } from "./task";

export function navigationTaskCounts(
  tasks: Iterable<TaskSummary>,
  today: string,
  hidden?: readonly string[],
) {
  const excluded = new Set(hidden);
  let inbox = 0;
  let upcoming = 0;
  const end = new Date(`${today}T12:00:00`);
  end.setDate(end.getDate() + 7);
  const until = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  for (const task of tasks) {
    if (task.archived || task.completed || excluded.has(task.id)) continue;
    if (!task.scheduled && !task.due) inbox++;
    if (
      [task.scheduled, task.due].some((value) => {
        const day = taskDatePart(value, task.timezone);
        return day && day < until;
      })
    )
      upcoming++;
  }
  return { inbox, upcoming };
}

/** One day and deletion mask per index. Owners clear it when task metadata changes. */
export class NavigationCountCache {
  private snapshot?: {
    key: string;
    counts: ReturnType<typeof navigationTaskCounts>;
  };

  read(
    today: string,
    hidden: readonly string[] | undefined,
    tasks: () => Iterable<TaskSummary>,
  ) {
    const key = JSON.stringify([today, runtimeTimezone(), hidden ?? []]);
    if (this.snapshot?.key !== key) {
      this.snapshot = {
        key,
        counts: navigationTaskCounts(tasks(), today, hidden),
      };
    }
    return { ...this.snapshot.counts };
  }

  clear() {
    this.snapshot = undefined;
  }
}
