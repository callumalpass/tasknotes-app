/// <reference lib="webworker" />

import {
  nativeNotificationData,
  parseNotificationPayload,
  showNotificationPayload,
} from "./native/notification-payload";

import type { MdbaseNativeNotificationData } from "@mdbase-dev/connect";

const worker = self as unknown as ServiceWorkerGlobalScope;
const MESSAGE_TYPE = "tasknotes:mdbase-notification";
const CACHE_PREFIX = "tasknotes-app-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;

worker.addEventListener("install", (event) => {
  event.waitUntil(installAppShell().then(() => worker.skipWaiting()));
});
worker.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([deleteOldCaches(), worker.clients.claim()]).then(
      () => undefined,
    ),
  );
});

worker.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== worker.location.origin) return;
  event.respondWith(fetchResponse(event.request));
});

worker.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

worker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openTaskNotes(notificationData(event.notification.data)));
});

async function installAppShell(): Promise<void> {
  const response = await fetch(
    new URL("offline-assets.json", worker.registration.scope),
  );
  if (!response.ok)
    throw new Error(`Offline asset manifest returned HTTP ${response.status}.`);
  const assets = (await response.json()) as unknown;
  if (
    !Array.isArray(assets) ||
    !assets.every((asset) => typeof asset === "string")
  )
    throw new Error("Offline asset manifest is invalid.");
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(assets);
}

async function navigationResponse(request: Request): Promise<Response> {
  const response = await fetch(request);
  if (cacheable(response)) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(new URL("./", worker.registration.scope), response.clone());
  }
  return response;
}

async function cachedResponse(request: Request): Promise<Response> {
  const cached = await caches.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function fetchResponse(request: Request): Promise<Response> {
  try {
    return request.mode === "navigate"
      ? await navigationResponse(request)
      : await cachedResponse(request);
  } catch {
    if (request.mode !== "navigate") return Response.error();
    try {
      const cached = await caches.match(
        new URL("./", worker.registration.scope),
      );
      if (cached) return cached;
    } catch {
      // Fall through to an explicit response. A rejected FetchEvent turns a
      // recoverable navigation outage into a browser-level network failure.
    }
    return new Response("TaskNotes is temporarily unavailable. Try again.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

function cacheable(response: Response): boolean {
  return (
    response.ok &&
    !response.headers.get("cache-control")?.toLowerCase().includes("no-store")
  );
}

async function deleteOldCaches(): Promise<void> {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)),
  );
}

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
