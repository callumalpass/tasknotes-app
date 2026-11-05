import { t } from "@lingui/core/macro";
import type { Task, TaskSummary, UpdateTaskInput } from "../domain/task";
import { rememberUndo } from "./undo-history";

export function rememberTaskEdit({
  before,
  saved,
  input,
  notice,
  getSummary,
  updateTask,
}: {
  before: TaskSummary;
  saved: Task;
  input: UpdateTaskInput;
  notice: string;
  getSummary(id: string): Promise<TaskSummary | null>;
  updateTask(id: string, input: UpdateTaskInput): Promise<Task>;
}) {
  const earlier = Object.fromEntries(
    Object.keys(input).map((field) => [
      field,
      (before as unknown as Record<string, unknown>)[field] ?? null,
    ]),
  ) as UpdateTaskInput;
  const savedRevision = saved.revision;
  rememberUndo({
    label: before.title,
    notice,
    run: async () => {
      const current = await getSummary(saved.id);
      if (!current || current.revision !== savedRevision)
        throw new Error(t`This task changed. Review it before trying again.`);
      return updateTask(saved.id, earlier);
    },
  });
}
