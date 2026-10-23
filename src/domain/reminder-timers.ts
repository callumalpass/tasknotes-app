import { reminderFireTime } from "./reminder";
import type { TaskSummary } from "./task";

/** Legacy repository planning; retain its future-only behavior until that
 * adapter is removed. NEXT reconciles complete membership instead. */
export async function desiredTaskTimers(
  tasks: TaskSummary[],
  now = Date.now(),
): Promise<Array<{ id: string; fireAt: string }>> {
  return (await taskTimerMembership(tasks)).filter(
    (timer) => Date.parse(timer.fireAt) > now,
  );
}

/** Complete content-free membership, including overdue reminders. The authority
 * preserves known overdue/fired history without backfilling unseen past timers. */
export async function taskTimerMembership(
  tasks: TaskSummary[],
): Promise<Array<{ id: string; fireAt: string }>> {
  const desired = tasks.flatMap((task) => {
    if (task.completed || task.archived) return [];
    return task.reminders.flatMap((reminder) => {
      const fireAt = reminderFireTime(task, reminder);
      const timestamp = fireAt ? Date.parse(fireAt) : Number.NaN;
      if (!fireAt || !Number.isFinite(timestamp)) return [];
      return [
        {
          sourceId: JSON.stringify([task.id, reminder.id]),
          fireAt: new Date(timestamp).toISOString(),
        },
      ];
    });
  });
  return Promise.all(
    desired.map(async ({ sourceId, ...timer }) => ({
      ...timer,
      id: await stableTimerId(sourceId),
    })),
  );
}

async function stableTimerId(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
