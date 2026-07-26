import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

import { reminderFireTime } from "../domain/reminder";

import type { Task } from "../domain/task";
import type { TaskRepository } from "../storage/repository";
import type { ActionPerformed } from "@capacitor/local-notifications";
import type { MdbaseDesiredTimer } from "@mdbase/connect";
import { activeCloudConnection } from "../cloud/connect";

const REGISTRY_KEY = "tasknotes:notification-registry:v1";
const CHANNEL_ID = "task-reminders";
const TIMER_NAMESPACE = "task-reminders";
const TIMER_CRITERION = "task.reminder";

export type ReminderAuthority = "device" | "connect";

let connectReconciliation = Promise.resolve();

export async function reconcileTaskNotifications(
  repository: TaskRepository,
  authority: ReminderAuthority = "device",
): Promise<void> {
  if (authority === "connect") {
    await clearDeviceNotifications();
    return reconcileConnectNotifications(repository);
  }
  if (!Capacitor.isNativePlatform()) return;
  const tasks = await repository.list({ status: "open", limit: 50_000 });
  const registry = readRegistry();
  const currentIds = Object.values(registry);
  if (currentIds.length)
    await LocalNotifications.cancel({
      notifications: currentIds.map((id) => ({ id })),
    }).catch(() => undefined);
  localStorage.removeItem(REGISTRY_KEY);
  for (const task of tasks)
    await syncTaskNotifications(repository, task, "device");
}

export async function syncTaskNotifications(
  repository: TaskRepository,
  task: Task,
  authority: ReminderAuthority = "device",
): Promise<void> {
  if (authority === "connect") return reconcileConnectNotifications(repository);
  if (!Capacitor.isNativePlatform()) return;
  const registry = readRegistry();
  const prefix = `${task.id}:`;
  const previous = Object.entries(registry).filter(([key]) =>
    key.startsWith(prefix),
  );
  if (previous.length) {
    await LocalNotifications.cancel({
      notifications: previous.map(([, id]) => ({ id })),
    }).catch(() => undefined);
    for (const [key] of previous) delete registry[key];
  }

  const reminders =
    task.completed || task.archived
      ? []
      : task.reminders.flatMap((reminder) => {
          const fireAt = reminderFireTime(task, reminder);
          const timestamp = fireAt ? Date.parse(fireAt) : Number.NaN;
          return fireAt && timestamp > Date.now() ? [{ reminder, fireAt }] : [];
        });
  if (!reminders.length) {
    writeRegistry(registry);
    return;
  }

  const permission = await LocalNotifications.checkPermissions();
  const resolved =
    permission.display === "prompt"
      ? await LocalNotifications.requestPermissions()
      : permission;
  if (resolved.display !== "granted") {
    writeRegistry(registry);
    return;
  }
  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: "Task reminders",
    description: "Reminders you set on TaskNotes tasks",
    importance: 4,
  }).catch(() => undefined);
  const used = new Set(Object.values(registry));
  const notifications = reminders.map(({ reminder, fireAt }) => {
    const key = `${task.id}:${reminder.id}`;
    const id = allocateId(key, used);
    registry[key] = id;
    return {
      id,
      title: task.title,
      body: reminder.description ?? "Task reminder",
      schedule: { at: new Date(fireAt) },
      channelId: CHANNEL_ID,
      extra: { taskId: task.id },
    };
  });
  await LocalNotifications.schedule({ notifications });
  writeRegistry(registry);
}

export async function removeTaskNotifications(
  repository: TaskRepository,
  taskId: string,
  authority: ReminderAuthority = "device",
): Promise<void> {
  if (authority === "connect") return reconcileConnectNotifications(repository);
  if (!Capacitor.isNativePlatform()) return;
  const registry = readRegistry();
  const entries = Object.entries(registry).filter(([key]) =>
    key.startsWith(`${taskId}:`),
  );
  if (entries.length)
    await LocalNotifications.cancel({
      notifications: entries.map(([, id]) => ({ id })),
    }).catch(() => undefined);
  for (const [key] of entries) delete registry[key];
  writeRegistry(registry);
}

export async function notificationPermission(): Promise<
  "unavailable" | "prompt" | "granted" | "denied"
> {
  if (!Capacitor.isNativePlatform()) return "unavailable";
  const result = await LocalNotifications.checkPermissions();
  return result.display === "prompt-with-rationale" ? "prompt" : result.display;
}

export function listenForTaskNotificationActions(
  onOpenTask: (taskId: string) => void,
): () => void {
  if (!Capacitor.isNativePlatform()) return () => undefined;
  let disposed = false;
  let remove: (() => Promise<void>) | undefined;
  void LocalNotifications.addListener(
    "localNotificationActionPerformed",
    (action) => {
      const taskId = taskIdFromNotificationAction(action);
      if (taskId) onOpenTask(taskId);
    },
  ).then((handle) => {
    if (disposed) void handle.remove();
    else remove = () => handle.remove();
  });
  return () => {
    disposed = true;
    void remove?.();
  };
}

export function taskIdFromNotificationAction(value: unknown): string | null {
  const extra = (value as Partial<ActionPerformed> | null)?.notification?.extra;
  let record: unknown = extra;
  if (typeof extra === "string") {
    try {
      record = JSON.parse(extra) as unknown;
    } catch {
      return null;
    }
  }
  if (!record || typeof record !== "object" || Array.isArray(record))
    return null;
  const taskId = (record as Record<string, unknown>).taskId;
  return typeof taskId === "string" && taskId.trim() ? taskId : null;
}

function allocateId(key: string, used: Set<number>): number {
  let value = hash(key);
  while (used.has(value)) value = value === 2_147_483_646 ? 1 : value + 1;
  used.add(value);
  return value;
}

function hash(value: string): number {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return (result >>> 0) % 2_147_483_646 || 1;
}

function readRegistry(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(REGISTRY_KEY) ?? "{}");
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

function writeRegistry(value: Record<string, number>): void {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(value));
}

async function clearDeviceNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const ids = Object.values(readRegistry());
  if (ids.length)
    await LocalNotifications.cancel({
      notifications: ids.map((id) => ({ id })),
    }).catch(() => undefined);
  localStorage.removeItem(REGISTRY_KEY);
}

function reconcileConnectNotifications(
  repository: TaskRepository,
): Promise<void> {
  const reconciliation = connectReconciliation
    .catch(() => undefined)
    .then(async () => {
      const tasks = await repository.list({ status: "open", limit: 50_000 });
      const connection = activeCloudConnection();
      if (!connection) throw new Error("TaskNotes is not connected.");
      await connection.reconcileTimers({
        namespace: TIMER_NAMESPACE,
        criterion_id: TIMER_CRITERION,
        timers: await desiredTaskTimers(tasks),
      });
    });
  connectReconciliation = reconciliation;
  return reconciliation;
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
          fire_at: new Date(timestamp).toISOString(),
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
