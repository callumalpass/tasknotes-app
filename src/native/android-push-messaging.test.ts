import { describe, expect, it, vi } from "vitest";

import { AndroidPushMessaging } from "./android-push-messaging";

describe("Android push messaging", () => {
  it("registers after installing listeners and returns the FCM token", async () => {
    const fixture = provider();
    fixture.push.register.mockImplementation(async () => {
      fixture.emit("registration", { value: "fcm-token" });
    });

    await expect(fixture.messaging.getToken()).resolves.toEqual({
      token: "fcm-token",
    });
    expect([...fixture.listeners.keys()]).toEqual([
      "registration",
      "registrationError",
    ]);
    expect(fixture.push.register).toHaveBeenCalledOnce();
    expect(fixture.remove).toHaveBeenCalledTimes(2);
  });

  it("surfaces native registration errors instead of hanging", async () => {
    const fixture = provider();
    fixture.push.register.mockImplementation(async () => {
      fixture.emit("registrationError", {
        error: "Google Play services unavailable",
      });
    });

    await expect(fixture.messaging.getToken()).rejects.toThrow(
      "Google Play services unavailable",
    );
    expect(fixture.remove).toHaveBeenCalledTimes(2);
  });

  it("times out when an OEM plugin call never emits a registration result", async () => {
    const fixture = provider(1);

    await expect(fixture.messaging.getToken()).rejects.toThrow(
      "Firebase registration timed out on this device",
    );
    expect(fixture.remove).toHaveBeenCalledTimes(2);
  });

  it("maps official Capacitor push events onto the shared notification shape", async () => {
    const fixture = provider();
    const received = vi.fn();
    const opened = vi.fn();
    const refreshed = vi.fn();

    await fixture.messaging.addListener("notificationReceived", received);
    await fixture.messaging.addListener("notificationActionPerformed", opened);
    await fixture.messaging.addListener("tokenReceived", refreshed);
    fixture.emit("pushNotificationReceived", {
      id: "signal",
      data: { criterion_id: "task.reminder" },
    });
    fixture.emit("pushNotificationActionPerformed", {
      actionId: "tap",
      notification: {
        id: "signal",
        data: { criterion_id: "task.reminder" },
      },
    });
    fixture.emit("registration", { value: "refreshed-token" });

    expect(received).toHaveBeenCalledWith({
      notification: expect.objectContaining({ id: "signal" }),
    });
    expect(opened).toHaveBeenCalledWith({
      notification: expect.objectContaining({ id: "signal" }),
    });
    expect(refreshed).toHaveBeenCalledWith({ token: "refreshed-token" });
  });
});

function provider(timeoutMs = 15_000) {
  const listeners = new Map<string, (event: unknown) => void>();
  const remove = vi.fn(async () => undefined);
  const push = {
    checkPermissions: vi.fn(async () => ({ receive: "prompt" })),
    requestPermissions: vi.fn(async () => ({ receive: "granted" })),
    register: vi.fn(async () => undefined),
    unregister: vi.fn(async () => undefined),
    createChannel: vi.fn(async () => undefined),
    addListener: vi.fn(
      async (eventName: string, listener: (event: never) => void) => {
        listeners.set(eventName, listener as (event: unknown) => void);
        return { remove };
      },
    ),
  };
  const messaging = new AndroidPushMessaging(push as never, timeoutMs);
  const emit = (eventName: string, event: unknown) =>
    listeners.get(eventName)?.(event);
  return { emit, listeners, messaging, push, remove };
}
