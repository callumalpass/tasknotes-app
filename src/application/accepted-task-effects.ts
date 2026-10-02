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
    const tasks = await this.accept(
      [task],
      [options.input],
      options.notify !== false,
    );
    return tasks[0]!;
  }

  private async observe(
    task: Task,
    input: UpdateTaskInput | undefined,
    notify: boolean,
    invalidation: string | null,
  ): Promise<Task> {
    const warnings: string[] = invalidation ? [invalidation] : [];
    if (!input || taskUpdateAffectsAutoArchive(input)) {
      const warning = await acceptedWriteEffect(
        "automatic archiving could not be scheduled",
        () => this.effects.observe(task),
      );
      if (warning) warnings.push(warning);
    }
    // Reminder reconciliation stays background work; report a failure without
    // holding capture open or making an accepted command reject.
    if (notify && (!input || this.effects.affectsNotifications(input)))
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
    return this.accept(
      tasks,
      updates.map(({ input }) => input),
    );
  }

  private async accept(
    tasks: readonly Task[],
    inputs: readonly (UpdateTaskInput | undefined)[],
    notify = true,
  ): Promise<Task[]> {
    if (!tasks.length) return [];
    const invalidation = await acceptedWriteEffect(
      "the view could not be refreshed",
      () => this.effects.invalidate(tasks.map(({ id }) => id)),
    );
    const accepted: Task[] = [];
    for (let index = 0; index < tasks.length; index++)
      accepted.push(
        await this.observe(tasks[index]!, inputs[index], notify, invalidation),
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
