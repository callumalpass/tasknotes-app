import { taskDatePart, type TaskSummary } from "./task";

export function navigationTaskCounts(
  tasks: Iterable<TaskSummary>,
  today: string,
) {
  let inbox = 0;
  let upcoming = 0;
  const end = new Date(`${today}T12:00:00`);
  end.setDate(end.getDate() + 7);
  const until = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  for (const task of tasks) {
    if (task.archived || task.completed) continue;
    if (!task.scheduled && !task.due) inbox++;
    if (
      [task.scheduled, task.due].some((value) => {
        const day = taskDatePart(value);
        return day && day < until;
      })
    )
      upcoming++;
  }
  return { inbox, upcoming };
}
