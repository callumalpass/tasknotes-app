import { useEffect, useMemo, useState } from "react";
import type { TimersApi } from "@mdbase-dev/sdk";

import {
  MdbaseNotificationManager,
  type MdbaseNotificationManagerOptions,
} from "./mdbase-notifications";
import { androidPushMessaging } from "./android-push-messaging";

const TOKEN_KEY = "tasknotes.test.fcm_token";
const WAKE_KEY = "tasknotes.test.notification_wake";

export function AndroidNotificationSmoke() {
  const manager = useMemo(() => createManager(), []);
  const [status, setStatus] = useState("Ready to register");

  useEffect(
    () =>
      manager.listen(({ notification }) => {
        if (notification.criterion_id !== "task.reminder") return;
        localStorage.setItem(WAKE_KEY, JSON.stringify(notification));
        setStatus("Foreground reminder received");
      }),
    [manager],
  );

  async function start() {
    setStatus("Registering with Firebase");
    try {
      const next = await manager.enable();
      setStatus(
        next.state === "enabled"
          ? "FCM token registered"
          : `Registration stopped: ${next.state}`,
      );
    } catch (error) {
      setStatus(
        `Registration failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return (
    <main className="opening-screen">
      <h1>TaskNotes Android notification smoke</h1>
      <p role="status">{status}</p>
      <button
        className="text-action"
        type="button"
        onClick={() => void start()}
      >
        Start notification smoke
      </button>
    </main>
  );
}

function createManager(): MdbaseNotificationManager {
  const options = {
    messaging: androidPushMessaging,
    webPush: {
      isSupported: () => false,
      checkPermissions: async () => ({ receive: "denied" }),
      requestPermissions: async () => ({ receive: "denied" }),
      serviceWorker: async () => {
        throw new Error("Web Push is outside the Android smoke test.");
      },
      addListener: async () => ({ remove: async () => undefined }),
    },
    storage: localStorage,
    isNative: () => true,
    isConfigured: () => true,
  } as unknown as MdbaseNotificationManagerOptions;
  const manager = new MdbaseNotificationManager(options);
  manager.bindScope({
    key: "android-smoke",
    timers: {
      registerFcm: async ({ token }: { token: string }) => {
        localStorage.setItem(TOKEN_KEY, token);
        return {};
      },
      unregisterFcm: async () => undefined,
    } as unknown as TimersApi,
  });
  return manager;
}
