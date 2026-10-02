import { reminderFireTime } from "./reminder";
import type { TaskSummary } from "./task";

/** Content-free desired timer membership; delivery remains authority-owned. */
export async function desiredTaskTimers(
  tasks: TaskSummary[],
  now = Date.now(),
): Promise<Array<{ id: string; fireAt: string }>> {
  const desired = tasks.flatMap((task) => {
    if (task.completed || task.archived) return [];
    return task.reminders.flatMap((reminder) => {
      const fireAt = reminderFireTime(task, reminder);
      const timestamp = fireAt ? Date.parse(fireAt) : Number.NaN;
      if (!fireAt || !Number.isFinite(timestamp) || timestamp <= now) return [];
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
