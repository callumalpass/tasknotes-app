/// <reference lib="webworker" />

import {
  nativeNotificationData,
  parseNotificationPayload,
  showNotificationPayload,
  readNotificationData,
} from "./native/notification-payload";

import type { PrivateNotificationData } from "./native/notification-payload";

const worker = self as unknown as ServiceWorkerGlobalScope;
const MESSAGE_TYPE = "tasknotes:mdbase-notification";
// The SDK build hook appends the shared, release-pinned offline shell policy.
// This source owns only TaskNotes notification delivery.

worker.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

worker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openTaskNotes(readNotificationData(event.notification.data)));
});

async function handlePush(event: PushEvent): Promise<void> {
  let payload;
  try {
    payload = parseNotificationPayload(event.data?.json());
  } catch {
    return;
  }
  await showNotificationPayload(worker.registration, payload);
  await messageClients(nativeNotificationData(payload), false);
}

async function openTaskNotes(
  notification: PrivateNotificationData | null,
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
  notification: PrivateNotificationData,
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
  notification: PrivateNotificationData,
  opened: boolean,
): void {
  client.postMessage({
    type: MESSAGE_TYPE,
    notification,
    opened,
  });
}
