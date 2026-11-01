/// <reference lib="webworker" />

import {
  parseMdbasePush,
  readMdbaseNotificationData,
  showMdbaseNotification,
  type MdbaseNotification,
} from "@mdbase-dev/sdk/notifications";

const worker = self as unknown as ServiceWorkerGlobalScope;
const MESSAGE_TYPE = "tasknotes:mdbase-notification";
// The SDK build hook appends the shared, release-pinned offline shell policy.
// This source owns only TaskNotes notification delivery.

worker.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

worker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    openTaskNotes(readMdbaseNotificationData(event.notification.data)),
  );
});

async function handlePush(event: PushEvent): Promise<void> {
  let payload;
  try {
    payload = event.data?.json();
    parseMdbasePush(payload);
  } catch {
    return;
  }
  const notification = await showMdbaseNotification(
    worker.registration,
    payload,
  );
  await messageClients(notification, false);
}

async function openTaskNotes(
  notification: MdbaseNotification | null,
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
  notification: MdbaseNotification,
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
  notification: MdbaseNotification,
  opened: boolean,
): void {
  client.postMessage({
    type: MESSAGE_TYPE,
    notification,
    opened,
  });
}
