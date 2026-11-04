import { useLingui, Trans } from "@lingui/react/macro";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { useRepository } from "./repository-context";
import { taskRecordLink } from "../domain/task-links";
import { completionKey } from "../application/task-mutations";
import { useMutationState } from "../components/use-mutation-state";
import type { TaskCreateIntent } from "../application/ports/task-repository";
import type { Task, TaskSummary } from "../domain/task";

export function TaskSubtasks({
  task,
  subtasks,
  loading,
  error,
  beforeMutation,
  onOpen,
}: {
  task: Task;
  subtasks: TaskSummary[];
  loading: boolean;
  error: Error | null;
  beforeMutation(): Promise<void>;
  onOpen?(task: TaskSummary): void;
}) {
  const { t } = useLingui();
  const { createTask, configuration } = useRepository();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const intent = useRef<TaskCreateIntent | null>(null);
  const pending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const completed = subtasks.filter((task) => task.completed).length;
  const total = subtasks.length;
  const link = taskRecordLink(task, configuration.linkWriteFormat);
  return (
    <section className="task-subtasks" aria-labelledby="task-subtasks-title">
      <header>
        <h2 id="task-subtasks-title">
          <Trans>Subtasks</Trans>
        </h2>
        {!loading && !error && total ? (
          <span>{t`${completed} of ${total}`}</span>
        ) : null}
      </header>
      {loading ? (
        <p className="field-help">
          <Trans>Loading subtasks…</Trans>
        </p>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          {error.message}
        </p>
      ) : null}
      <ul>
        {subtasks.map((child) => (
          <SubtaskRow
            key={child.id}
            task={child}
            beforeMutation={beforeMutation}
            onOpen={onOpen}
          />
        ))}
      </ul>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current || !title.trim() || !link) return;
          pending.current = true;
          setBusy(true);
          setFailure(null);
          try {
            await beforeMutation();
            // The same intent is retained on failure, as in the task actions menu.
            intent.current ??= { id: crypto.randomUUID() };
            await createTask(
              { title: title.trim(), projects: [link] },
              intent.current,
            );
            intent.current = null;
            setTitle("");
            requestAnimationFrame(() => input.current?.focus());
          } catch (reason) {
            setFailure(
              reason instanceof Error ? reason.message : String(reason),
            );
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <Plus size={17} aria-hidden="true" />
        <input
          ref={input}
          aria-label={t({ message: "Subtask title" })}
          placeholder={t({ message: "Add a subtask…" })}
          value={title}
          disabled={busy || !link}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button
          className="text-action"
          type="submit"
          disabled={busy || !title.trim() || !link}
        >
          <Trans>Add subtask</Trans>
        </button>
      </form>
      {failure ? (
        <p className="inline-error" role="alert">
          {failure}
        </p>
      ) : null}
    </section>
  );
}

function SubtaskRow({
  task,
  beforeMutation,
  onOpen,
}: {
  task: TaskSummary;
  beforeMutation(): Promise<void>;
  onOpen?(task: TaskSummary): void;
}) {
  const { t } = useLingui();
  const { mutations, setTaskCompletion } = useRepository();
  const completion = useMutationState(mutations, completionKey(task.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <li>
      <div className="task-subtask-row">
        <button
          className="completion-control"
          type="button"
          aria-pressed={task.completed}
          aria-label={
            task.completed ? t`Reopen ${task.title}` : t`Complete ${task.title}`
          }
          disabled={busy || completion.pending}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await beforeMutation();
              await setTaskCompletion({
                id: task.id,
                completed: !task.completed,
              });
            } catch (reason) {
              setError(
                reason instanceof Error ? reason.message : String(reason),
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <span aria-hidden="true" />
        </button>
        {onOpen ? (
          <button
            className="task-subtask-title"
            type="button"
            onClick={() => onOpen(task)}
          >
            {task.title}
          </button>
        ) : (
          <span>{task.title}</span>
        )}
      </div>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
