import { MdbaseConnectError } from "@mdbase/connect";
import { describe, expect, it, vi } from "vitest";

import {
  MdbaseNotificationManager,
  mdbaseNotificationData,
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
        throw new MdbaseConnectError(
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
    register: vi.fn(async () => ({
      notifications: {
        criteria: [{ id: "task.reminder" }],
        native_delivery: {
          mode: "managed_fcm" as const,
          firebase_project_id: "tasknotes-production",
        },
      },
    })),
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
  const subject = new MdbaseNotificationManager({
    connect,
    messaging,
    storage,
    isNative: () => true,
  } as unknown as MdbaseNotificationManagerOptions);
  return { subject, connect, messaging, storage };
}
