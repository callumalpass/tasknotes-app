import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Shell caching is exercised once by the SDK's offline-shell worker tests.
// This worker source retains only TaskNotes' notification integration.
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

async function fixture() {
  const handlers = new Map<string, (event: unknown) => void>();
  const client = {
    url: "https://app.tasknotes.dev/",
    focus: vi.fn(async () => undefined),
    postMessage: vi.fn(),
  };
  const registration = {
    scope: "https://app.tasknotes.dev/",
    showNotification: vi.fn(async () => undefined),
  };
  const clients = {
    matchAll: vi.fn(async () => [client]),
    openWindow: vi.fn(async () => undefined),
  };
  vi.stubGlobal("self", {
    registration,
    clients,
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      handlers.set(type, listener);
    },
  });
  await import("./service-worker");
  async function dispatch(type: string, data: object) {
    let settled: Promise<unknown> | undefined;
    handlers.get(type)!({
      ...data,
      waitUntil: (promise: Promise<unknown>) => { settled = promise; },
    });
    await settled;
  }
  return { handlers, client, clients, registration, dispatch };
}
const notification = {
  type: "mdbase.notification",
  version: 1,
  signal_id: "test-signal",
  criterion_id: "test-criterion",
  cursor: "test-cursor",
};

it("retains push delivery and wake messages without a competing shell-cache implementation", async () => {
  const f = await fixture();
  expect([...f.handlers.keys()]).toEqual(["push", "notificationclick"]);
  await f.dispatch("push", { data: { json: () => ({ ...notification, presentation: { title: "Test reminder" } }) } });
  expect(f.registration.showNotification).toHaveBeenCalledWith("Test reminder", { data: notification });
  expect(f.client.postMessage).toHaveBeenCalledWith({ type: "tasknotes:mdbase-notification", notification, opened: false });
  await f.dispatch("push", { data: { json: () => ({ type: "invalid" }) } });
  expect(f.registration.showNotification).toHaveBeenCalledTimes(1);
});

it("focuses the existing app on notification click without navigating or reloading another tab", async () => {
  const f = await fixture();
  const close = vi.fn();
  await f.dispatch("notificationclick", { notification: { close, data: notification } });
  expect(close).toHaveBeenCalledOnce();
  expect(f.client.focus).toHaveBeenCalledOnce();
  expect(f.clients.openWindow).not.toHaveBeenCalled();
  expect(f.client.postMessage).toHaveBeenCalledWith({ type: "tasknotes:mdbase-notification", notification, opened: true });
});
