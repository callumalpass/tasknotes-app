import { reminderFireTime } from "../domain/reminder";

import type { Task, UpdateTaskInput } from "../domain/task";
import type { TaskRepository } from "../application/ports/task-repository";
import { type MdbaseDesiredTimer } from "@mdbase-dev/connect";
import { cloudSession } from "../cloud/connect";
import { requireConnectOutcome } from "../cloud/outcome";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";
import {
  mdbaseMutationKey,
  runMdbaseMutation,
} from "../storage/mdbase-mutation-coordinator";

const TIMER_NAMESPACE = "task-reminders";
const TIMER_CRITERION = "task.reminder";

export type ReminderAuthority = "none" | "connect";

let connectReconciliation: Promise<void> | null = null;
let requestedReconciliation = 0;
let completedReconciliation = 0;
let latestRepository: TaskRepository | null = null;

export function taskUpdateAffectsNotifications(
  input: UpdateTaskInput,
): boolean {
  return [
    "archived",
    "completed",
    "due",
    "reminders",
    "scheduled",
    "status",
  ].some((property) => Object.hasOwn(input, property));
}

export async function reconcileTaskNotifications(
  repository: TaskRepository,
  authority: ReminderAuthority = "none",
): Promise<void> {
  if (authority !== "connect") return;
  return reconcileConnectNotifications(repository);
}

export async function syncTaskNotifications(
  repository: TaskRepository,
  _task: Task,
  authority: ReminderAuthority = "none",
): Promise<void> {
  if (authority !== "connect") return;
  return reconcileConnectNotifications(repository);
}

export async function removeTaskNotifications(
  repository: TaskRepository,
  _taskId: string,
  authority: ReminderAuthority = "none",
): Promise<void> {
  if (authority !== "connect") return;
  return reconcileConnectNotifications(repository);
}

function reconcileConnectNotifications(
  repository: TaskRepository,
): Promise<void> {
  latestRepository = repository;
  requestedReconciliation += 1;
  if (!connectReconciliation) {
    connectReconciliation = (async () => {
      while (completedReconciliation < requestedReconciliation) {
        const target = requestedReconciliation;
        const current = latestRepository;
        if (!current) return;
        const tasks = await current.list({ status: "open", limit: 50_000 });
        const snapshot = cloudSession.getSnapshot();
        const connection =
          snapshot.status === "ready" ? cloudSession.connection() : null;
        if (!connection) throw new Error("TaskNotes is not connected.");
        const operationInput = {
          namespace: TIMER_NAMESPACE,
          criterionId: TIMER_CRITERION,
          timers: await desiredTaskTimers(tasks),
        };
        const request = {
          timeoutMs: TASKNOTES_REQUEST_BUDGETS.backgroundMs,
        };
        await runMdbaseMutation(
          connection,
          async () => {
            requireConnectOutcome(
              await connection.reconcileTimers(operationInput, request),
            );
          },
          {
            key: mdbaseMutationKey("timers:reconcile", operationInput),
            mapRecovered: () => undefined,
            request,
          },
        );
        completedReconciliation = target;
      }
    })().finally(() => {
      connectReconciliation = null;
    });
  }
  return connectReconciliation;
}

export async function desiredTaskTimers(
  tasks: Task[],
  now = Date.now(),
): Promise<MdbaseDesiredTimer[]> {
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
