import { connectError } from "@mdbase-dev/connect";
import { describe, expect, it, vi } from "vitest";

import {
  MdbaseNotificationManager,
  mdbaseNotificationData,
  mdbaseWebPushWake,
  type MdbaseNotificationManagerOptions,
} from "./mdbase-notifications";

describe("mdbase native notifications", () => {
  it("requests permission only during explicit enablement and registers FCM", async () => {
    const fixture = manager();
    expect(await fixture.subject.status()).toEqual({
      state: "off",
      optedIn: false,
    });
    expect(fixture.messaging.requestPermissions).not.toHaveBeenCalled();

    expect(await fixture.subject.enable()).toEqual({
      state: "enabled",
      optedIn: true,
    });
    expect(fixture.messaging.requestPermissions).toHaveBeenCalledOnce();
    expect(fixture.messaging.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "mdbase-updates",
        importance: 4,
      }),
    );
    expect(fixture.connect.registerNativeNotifications).toHaveBeenCalledWith({
      token: "fcm-token",
    });
  });

  it("removes the Connect channel before deleting the local token", async () => {
    const order: string[] = [];
    const fixture = manager({
      unregisterNativeNotifications: vi.fn(async () => {
        order.push("connect");
      }),
      deleteToken: vi.fn(async () => {
        order.push("firebase");
      }),
    });
    await fixture.subject.enable();
    await fixture.subject.disable();
    expect(order).toEqual(["connect", "firebase"]);
    expect(fixture.storage.getItem("tasknotes:mdbase-notifications:v1")).toBe(
      null,
    );
  });

  it("requires renewed timer access before asking for notification permission", async () => {
    const fixture = manager({
      connection: vi.fn(() => ({
        collectionId: "collection",
        operations: ["read"],
      })),
    });
    expect(await fixture.subject.enable()).toEqual({
      state: "reauthorization_required",
      optedIn: false,
    });
    expect(fixture.messaging.requestPermissions).not.toHaveBeenCalled();
  });

  it("reports native configuration without performing application discovery", async () => {
    const fixture = manager({
      isConfigured: vi.fn(() => false),
    });

    expect(await fixture.subject.status()).toEqual({
      state: "not_configured",
      optedIn: false,
    });
    expect(fixture.messaging.checkPermissions).not.toHaveBeenCalled();
  });

  it("reports browsers without standards-based push support as unavailable", async () => {
    const fixture = manager({
      isNative: vi.fn(() => false),
      webPushSupported: vi.fn(() => false),
    });

    expect(await fixture.subject.status()).toEqual({
      state: "unavailable",
      optedIn: false,
    });
    expect(fixture.messaging.checkPermissions).not.toHaveBeenCalled();
  });

  it("registers standards-based Web Push from an explicit browser opt-in", async () => {
    const fixture = manager({
      isNative: vi.fn(() => false),
      webPushSupported: vi.fn(() => true),
    });

    expect(await fixture.subject.status()).toEqual({
      state: "off",
      optedIn: false,
    });
    expect(await fixture.subject.enable()).toEqual({
      state: "enabled",
      optedIn: true,
    });
    expect(fixture.webPush.requestPermissions).toHaveBeenCalledOnce();
    expect(fixture.connect.registerNotifications).toHaveBeenCalledWith({
      serviceWorker: fixture.serviceWorker,
    });
    expect(fixture.messaging.requestPermissions).not.toHaveBeenCalled();
    expect(fixture.messaging.getToken).not.toHaveBeenCalled();
  });

  it("unregisters the browser channel and push subscription on opt-out", async () => {
    const fixture = manager({
      isNative: vi.fn(() => false),
      webPushSupported: vi.fn(() => true),
    });
    await fixture.subject.enable();
    await fixture.subject.disable();
    expect(fixture.connect.unregisterNotifications).toHaveBeenCalledWith(
      fixture.serviceWorker,
    );
    expect(fixture.storage.getItem("tasknotes:mdbase-notifications:v1")).toBe(
      null,
    );
  });

  it("does not contact either service when a disconnected collection was not opted in", async () => {
    const fixture = manager();
    await fixture.subject.disableIfEnabled();
    expect(
      fixture.connect.unregisterNativeNotifications,
    ).not.toHaveBeenCalled();
    expect(fixture.messaging.deleteToken).not.toHaveBeenCalled();
  });

  it("refreshes registration without prompting after an opted-in restart", async () => {
    const fixture = manager({
      checkPermissions: vi.fn(async () => ({ receive: "granted" })),
    });
    fixture.storage.setItem("tasknotes:mdbase-notifications:v1", "1");
    await fixture.subject.refreshRegistration();
    expect(fixture.messaging.requestPermissions).not.toHaveBeenCalled();
    expect(fixture.connect.registerNativeNotifications).toHaveBeenCalledWith({
      token: "fcm-token",
    });
  });

  it("requires renewed approval when the grant predates manifest criteria", async () => {
    const fixture = manager({
      registerNativeNotifications: vi.fn(async () => {
        throw connectError(
          "notification_reauthorization_required",
          "Review the updated criteria.",
        );
      }),
    });
    expect(await fixture.subject.enable()).toEqual({
      state: "reauthorization_required",
      optedIn: false,
    });
    expect(
      fixture.storage.getItem("tasknotes:mdbase-notifications:v1"),
    ).toBeNull();
  });

  it("routes only valid content-free mdbase notification data", () => {
    expect(
      mdbaseNotificationData({
        data: {
          type: "mdbase.notification",
          version: "1",
          signal_id: "signal",
          criterion_id: "task.changed",
          cursor: "42",
        },
      }),
    ).toEqual({
      type: "mdbase.notification",
      version: 1,
      signal_id: "signal",
      criterion_id: "task.changed",
      cursor: "42",
    });
    expect(mdbaseNotificationData({ data: { path: "tasks/private.md" } })).toBe(
      null,
    );
  });

  it("routes only valid service-worker wake messages", () => {
    expect(
      mdbaseWebPushWake({
        type: "tasknotes:mdbase-notification",
        opened: true,
        notification: {
          type: "mdbase.notification",
          version: 1,
          signal_id: "signal",
          criterion_id: "task.reminder",
          cursor: "42",
        },
      }),
    ).toEqual({
      opened: true,
      notification: {
        type: "mdbase.notification",
        version: 1,
        signal_id: "signal",
        criterion_id: "task.reminder",
        cursor: "42",
      },
    });
    expect(
      mdbaseWebPushWake({
        type: "tasknotes:mdbase-notification",
        opened: false,
        notification: { path: "tasks/private.md" },
      }),
    ).toBeNull();
  });
});

function manager(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const storage = localStorage;
  storage.clear();
  const connect = {
    connection:
      overrides.connection ??
      vi.fn(() => ({
        collectionId: "collection",
        operations: ["reconcile_timers"],
      })),
    registerNotifications:
      overrides.registerNotifications ?? vi.fn(async () => ({})),
    unregisterNotifications:
      overrides.unregisterNotifications ?? vi.fn(async () => undefined),
    registerNativeNotifications:
      overrides.registerNativeNotifications ?? vi.fn(async () => ({})),
    unregisterNativeNotifications:
      overrides.unregisterNativeNotifications ?? vi.fn(async () => undefined),
  };
  const messaging = {
    checkPermissions:
      overrides.checkPermissions ?? vi.fn(async () => ({ receive: "prompt" })),
    requestPermissions:
      overrides.requestPermissions ??
      vi.fn(async () => ({ receive: "granted" })),
    getToken: vi.fn(async () => ({ token: "fcm-token" })),
    deleteToken: overrides.deleteToken ?? vi.fn(async () => undefined),
    createChannel: vi.fn(async () => undefined),
    addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
  };
  const serviceWorker = {} as ServiceWorkerRegistration;
  const webPush = {
    isSupported: overrides.webPushSupported ?? vi.fn(() => false),
    checkPermissions:
      overrides.webPushCheckPermissions ??
      vi.fn(async () => ({ receive: "prompt" })),
    requestPermissions:
      overrides.webPushRequestPermissions ??
      vi.fn(async () => ({ receive: "granted" })),
    serviceWorker: vi.fn(async () => serviceWorker),
    addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
  };
  const subject = new MdbaseNotificationManager({
    connect,
    messaging,
    webPush,
    storage,
    isNative: overrides.isNative ?? (() => true),
    isConfigured: overrides.isConfigured ?? (() => true),
  } as unknown as MdbaseNotificationManagerOptions);
  return { subject, connect, messaging, webPush, serviceWorker, storage };
}
