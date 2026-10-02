import type { Task, UpdateTaskInput } from "../domain/task";

/** A secondary failure is diagnostic, never a rejected authority write. */
export async function acceptedWriteEffect(
  label: string,
  effect: () => void | Promise<void>,
): Promise<string | null> {
  try {
    await effect();
    return null;
  } catch (reason) {
    const warning = `Task saved, but ${label}: ${reason instanceof Error ? reason.message : String(reason)}`;
    console.warn(warning, reason);
    return warning;
  }
}

/** One post-acceptance policy for single commands, bulk commands and deletion. */
export class AcceptedTaskEffects {
  constructor(
    private readonly effects: {
      invalidate(ids: string[]): void;
      observe(task: Task): Promise<void> | undefined;
      forget(id: string): Promise<void> | undefined;
      notify(task: Task): Promise<void>;
      removeNotifications(id: string): Promise<void>;
      affectsNotifications(input: UpdateTaskInput): boolean;
    },
  ) {}

  async task(
    task: Task,
    options: { input?: UpdateTaskInput; notify?: boolean } = {},
  ): Promise<Task> {
    const { input } = options;
    const warnings: string[] = [];
    const invalidation = await acceptedWriteEffect(
      "the view could not be refreshed",
      () => this.effects.invalidate([task.id]),
    );
    if (invalidation) warnings.push(invalidation);
    if (!input || taskUpdateAffectsAutoArchive(input)) {
      const warning = await acceptedWriteEffect(
        "automatic archiving could not be scheduled",
        () => this.effects.observe(task),
      );
      if (warning) warnings.push(warning);
    }
    // Reminder reconciliation stays background work; report a failure without
    // holding capture open or making an accepted command reject.
    if (
      options.notify !== false &&
      (!input || this.effects.affectsNotifications(input))
    )
      void acceptedWriteEffect("reminders could not be reconciled", () =>
        this.effects.notify(task),
      );
    return warnings.length
      ? {
          ...task,
          operationWarnings: [...(task.operationWarnings ?? []), ...warnings],
        }
      : task;
  }

  async updated(
    tasks: readonly Task[],
    updates: readonly { id: string; input: UpdateTaskInput }[],
  ): Promise<Task[]> {
    const accepted: Task[] = [];
    for (let index = 0; index < tasks.length; index++)
      accepted.push(
        await this.task(tasks[index]!, { input: updates[index]!.input }),
      );
    return accepted;
  }

  async deleted(id: string): Promise<void> {
    await acceptedWriteEffect("the view could not be refreshed", () =>
      this.effects.invalidate([id]),
    );
    await acceptedWriteEffect("automatic archiving could not be cleared", () =>
      this.effects.forget(id),
    );
    void acceptedWriteEffect("reminders could not be cleared", () =>
      this.effects.removeNotifications(id),
    );
  }
}

function taskUpdateAffectsAutoArchive(input: UpdateTaskInput): boolean {
  return ["status", "completed", "archived"].some((property) =>
    Object.hasOwn(input, property),
  );
}
