import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

import type { Task } from "../domain/task";
import type { TaskRepository } from "../storage/repository";
import type { ActionPerformed } from "@capacitor/local-notifications";

const REGISTRY_KEY = "tasknotes:notification-registry:v1";
const CHANNEL_ID = "task-reminders";

export async function reconcileTaskNotifications(
  repository: TaskRepository,
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const tasks = await repository.list({ status: "open", limit: 50_000 });
  const registry = readRegistry();
  const currentIds = Object.values(registry);
  if (currentIds.length)
    await LocalNotifications.cancel({
      notifications: currentIds.map((id) => ({ id })),
    }).catch(() => undefined);
  localStorage.removeItem(REGISTRY_KEY);
  for (const task of tasks) await syncTaskNotifications(task);
}

export async function syncTaskNotifications(task: Task): Promise<void> {
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

  const reminders = task.completed
    ? []
    : task.reminders.filter((reminder) => {
        const timestamp = reminder.absoluteTime
          ? Date.parse(reminder.absoluteTime)
          : Number.NaN;
        return reminder.type === "absolute" && timestamp > Date.now();
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
  const notifications = reminders.map((reminder) => {
    const key = `${task.id}:${reminder.id}`;
    const id = allocateId(key, used);
    registry[key] = id;
    return {
      id,
      title: task.title,
      body: reminder.description ?? "Task reminder",
      schedule: { at: new Date(reminder.absoluteTime!) },
      channelId: CHANNEL_ID,
      extra: { taskId: task.id },
    };
  });
  await LocalNotifications.schedule({ notifications });
  writeRegistry(registry);
}

export async function removeTaskNotifications(taskId: string): Promise<void> {
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
