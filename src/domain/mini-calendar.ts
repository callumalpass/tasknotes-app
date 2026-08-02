import type { CreateTaskInput } from "./task";
import type { TaskView } from "./view";

export function calendarDateDefaults(
  view: TaskView,
  selectedDate: string,
): Partial<CreateTaskInput> {
  const options = view.presentation?.options ?? {};
  if (options.showScheduled !== false) return { scheduled: selectedDate };
  if (options.showDue !== false) return { due: selectedDate };
  return {};
}
