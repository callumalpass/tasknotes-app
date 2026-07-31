/// <reference lib="webworker" />

import {
  parseMdbasePushPayload,
  showMdbasePushNotification,
  type MdbaseNativeNotificationData,
  type MdbasePushPayload,
} from "@mdbase/connect";

const worker = self as unknown as ServiceWorkerGlobalScope;
const MESSAGE_TYPE = "tasknotes:mdbase-notification";

worker.addEventListener("install", () => worker.skipWaiting());
worker.addEventListener("activate", (event) => {
  event.waitUntil(worker.clients.claim());
});

worker.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

worker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openTaskNotes(notificationData(event.notification.data)));
});

async function handlePush(event: PushEvent): Promise<void> {
  let payload: MdbasePushPayload;
  try {
    payload = parseMdbasePushPayload(event.data?.json());
  } catch {
    return;
  }
  await showMdbasePushNotification(worker.registration, payload);
  await messageClients(nativeData(payload), false);
}

async function openTaskNotes(
  notification: MdbaseNativeNotificationData | null,
): Promise<void> {
  const windows = (await worker.clients.matchAll({
    includeUncontrolled: true,
    type: "window",
  })) as WindowClient[];
  const taskNotes = windows.find((client) =>
    client.url.startsWith(worker.registration.scope),
  );
  if (taskNotes) {
    await taskNotes.focus();
    if (notification) postWake(taskNotes, notification, true);
    return;
  }
  await worker.clients.openWindow(worker.registration.scope);
}

async function messageClients(
  notification: MdbaseNativeNotificationData,
  opened: boolean,
): Promise<void> {
  const windows = await worker.clients.matchAll({
    includeUncontrolled: true,
    type: "window",
  });
  for (const client of windows) postWake(client, notification, opened);
}

function postWake(
  client: Client,
  notification: MdbaseNativeNotificationData,
  opened: boolean,
): void {
  client.postMessage({
    type: MESSAGE_TYPE,
    notification,
    opened,
  });
}

function nativeData(payload: MdbasePushPayload): MdbaseNativeNotificationData {
  return {
    type: payload.type,
    version: payload.version,
    signal_id: payload.signal_id,
    criterion_id: payload.criterion_id,
    cursor: payload.cursor,
  };
}

function notificationData(value: unknown): MdbaseNativeNotificationData | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (
    data.type !== "mdbase.notification" ||
    typeof data.signal_id !== "string" ||
    typeof data.criterion_id !== "string" ||
    typeof data.cursor !== "string"
  )
    return null;
  return {
    type: "mdbase.notification",
    version: 1,
    signal_id: data.signal_id,
    criterion_id: data.criterion_id,
    cursor: data.cursor,
  };
}
