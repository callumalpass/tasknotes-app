import { useLingui, Trans } from "@lingui/react/macro";

import { useTaskRelationships } from "../app/repository-context";
import { SubtaskRow } from "../app/task-subtasks";

import type { TaskSummary } from "../domain/task";

/** The subtasks of a listed task, shown beneath its row on request. */
export function TaskRowSubtasks({
  id,
  task,
  onOpen,
}: {
  id: string;
  task: TaskSummary;
  onOpen(task: TaskSummary): void;
}) {
  const { t } = useLingui();
  const { relationships, loading, error } = useTaskRelationships(task.id);
  const subtasks = relationships.subtasks.filter((child) => !child.archived);
  return (
    <div
      className="task-row-subtasks"
      id={id}
      role="group"
      aria-label={t`Subtasks of ${task.title}`}
    >
      {loading && !subtasks.length ? (
        <p className="field-help">
          <Trans>Loading subtasks…</Trans>
        </p>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          {error.message}
        </p>
      ) : null}
      {subtasks.length ? (
        <ul>
          {subtasks.map((child) => (
            <SubtaskRow key={child.id} task={child} onOpen={onOpen} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
