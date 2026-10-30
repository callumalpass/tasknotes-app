import type { Notification } from "@capacitor-firebase/messaging";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import {
  parseMdbaseNativeNotification,
  isMdbaseError,
  problemCodeOf,
  type MdbaseApplicationConnection,
  type MdbaseNotification,
} from "@mdbase-dev/sdk";

import { taskNotesMdbase } from "../cloud/tasknotes-application";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";
import {
  androidPushMessaging,
  type NativeMessaging,
  type NativeNotification,
} from "./android-push-messaging";
import { webPushMessaging, type WebPushMessaging } from "./web-push-messaging";

const ENABLED_KEY = "tasknotes:mdbase-notifications:v1";
const CHANNEL_ID = "mdbase-updates";
const PERMISSION_CHECK_TIMEOUT_MS = 10_000;
export type MdbaseNotificationState =
  | "checking"
  | "unavailable"
  | "not_connected"
  | "not_configured"
  | "reauthorization_required"
  | "off"
  | "enabled"
  | "denied"
  | "error";

export interface MdbaseNotificationStatus {
  state: MdbaseNotificationState;
  optedIn: boolean;
}

export interface MdbaseNotificationWake {
  notification: MdbaseNotification;
  opened: boolean;
}

interface NotificationConnect {
  connection(): Pick<MdbaseApplicationConnection, "id" | "timers"> | null;
}

export interface MdbaseNotificationManagerOptions {
  connect: NotificationConnect;
  messaging: NativeMessaging;
  webPush: WebPushMessaging;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  isNative(): boolean;
  isConfigured(): boolean;
}

export class MdbaseNotificationManager {
  constructor(private readonly options: MdbaseNotificationManagerOptions) {}

  async status(): Promise<MdbaseNotificationStatus> {
    const optedIn = this.enabled();
    const runtime = this.runtime();
    if (!runtime) return { state: "unavailable", optedIn: false };
    const connection = this.options.connect.connection();
    if (!connection) return { state: "not_connected", optedIn };
    if (!connection.timers)
      return { state: "reauthorization_required", optedIn: false };
    if (runtime === "native" && !this.options.isConfigured())
      return { state: "not_configured", optedIn };
    const permission = await this.checkPermissions(runtime);
    if (permission.receive === "denied") return { state: "denied", optedIn };
    return {
      state: optedIn && permission.receive === "granted" ? "enabled" : "off",
      optedIn,
    };
  }

  async enable(): Promise<MdbaseNotificationStatus> {
    const runtime = this.runtime();
    if (!runtime) return { state: "unavailable", optedIn: false };
    const connection = this.options.connect.connection();
    if (!connection) return { state: "not_connected", optedIn: false };
    if (!connection.timers)
      return { state: "reauthorization_required", optedIn: false };
    if (runtime === "native" && !this.options.isConfigured())
      return { state: "not_configured", optedIn: false };
    const provider =
      runtime === "native" ? this.options.messaging : this.options.webPush;
    const current = await this.checkPermissions(runtime);
    const permission =
      current.receive === "prompt" ||
      current.receive === "prompt-with-rationale"
        ? await provider.requestPermissions()
        : current;
    if (permission.receive !== "granted")
      return { state: "denied", optedIn: false };
    try {
      await this.registerCurrentInstallation(runtime);
    } catch (error) {
      const code =
        isMdbaseError(error) && error.reason
          ? problemCodeOf(error.reason)
          : null;
      if (
        code === "notifications_consent_required" ||
        code === "timer_channel_reapproval_required"
      ) {
        return { state: "reauthorization_required", optedIn: false };
      }
      if (code === "notifications_unsupported") {
        return { state: "not_configured", optedIn: false };
      }
      throw error;
    }
    this.options.storage.setItem(ENABLED_KEY, "1");
    return { state: "enabled", optedIn: true };
  }

  async disable(): Promise<MdbaseNotificationStatus> {
    const runtime = this.runtime();
    if (!runtime) return { state: "unavailable", optedIn: false };
    if (runtime === "native") {
      await this.timers().unregisterFcm({ signal: this.deadline() });
      await this.options.messaging.deleteToken();
    } else {
      const serviceWorker = await this.options.webPush.serviceWorker();
      await this.timers().unregisterWebPush(serviceWorker, {
        signal: this.deadline(),
      });
    }
    this.options.storage.removeItem(ENABLED_KEY);
    return this.status();
  }

  async disableIfEnabled(): Promise<void> {
    if (!this.runtime() || !this.enabled()) return;
    await this.disable();
  }

  async refreshRegistration(): Promise<void> {
    const runtime = this.runtime();
    if (!runtime || !this.enabled() || !this.options.connect.connection())
      return;
    if (runtime === "native" && !this.options.isConfigured()) return;
    const permission = await this.checkPermissions(runtime);
    if (permission.receive !== "granted") return;
    await this.registerCurrentInstallation(runtime);
  }

  listen(onWake: (event: MdbaseNotificationWake) => void): () => void {
    const runtime = this.runtime();
    if (!runtime || (runtime === "native" && !this.options.isConfigured()))
      return () => undefined;
    let disposed = false;
    const handles: PluginListenerHandle[] = [];
    const keep = async (promise: Promise<PluginListenerHandle>) => {
      try {
        const handle = await promise;
        if (disposed) await handle.remove();
        else handles.push(handle);
      } catch {
        // Listening is best-effort; status/enable expose initialization failures.
      }
    };
    if (runtime === "native") {
      void keep(
        this.options.messaging.addListener("tokenReceived", ({ token }) => {
          if (!this.enabled() || !token) return;
          void this.options.connect
            .connection()
            ?.timers?.registerFcm({ token, signal: this.deadline() })
            .catch(() => undefined);
        }),
      );
      void keep(
        this.options.messaging.addListener(
          "notificationReceived",
          ({ notification }) => {
            const data = mdbaseNotificationData(notification);
            if (data) onWake({ notification: data, opened: false });
          },
        ),
      );
      void keep(
        this.options.messaging.addListener(
          "notificationActionPerformed",
          ({ notification }) => {
            const data = mdbaseNotificationData(notification);
            if (data) onWake({ notification: data, opened: true });
          },
        ),
      );
    } else {
      void keep(
        this.options.webPush.addListener(({ data }) => {
          const wake = mdbaseWebPushWake(data);
          if (wake) onWake(wake);
        }),
      );
    }
    void this.refreshRegistration().catch(() => undefined);
    return () => {
      disposed = true;
      for (const handle of handles) void handle.remove().catch(() => undefined);
      handles.length = 0;
    };
  }

  private timers() {
    const timers = this.options.connect.connection()?.timers;
    if (!timers)
      throw new Error("TaskNotes is not connected to reminder delivery.");
    return timers;
  }

  private deadline(): AbortSignal {
    return AbortSignal.timeout(TASKNOTES_REQUEST_BUDGETS.backgroundMs);
  }

  private enabled(): boolean {
    return this.options.storage.getItem(ENABLED_KEY) === "1";
  }

  private runtime(): "native" | "web" | null {
    if (this.options.isNative()) return "native";
    return this.options.webPush.isSupported() ? "web" : null;
  }

  private async checkPermissions(runtime: "native" | "web") {
    const provider =
      runtime === "native" ? this.options.messaging : this.options.webPush;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        provider.checkPermissions(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  "Checking notification permission timed out. Try again.",
                ),
              ),
            PERMISSION_CHECK_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async registerCurrentInstallation(
    runtime: "native" | "web",
  ): Promise<void> {
    if (runtime === "web") {
      const serviceWorker = await this.options.webPush.serviceWorker();
      await this.timers().registerWebPush({
        serviceWorker,
        signal: this.deadline(),
      });
      return;
    }
    await this.options.messaging
      .createChannel({
        id: CHANNEL_ID,
        name: "Task reminders",
        description: "Reminders scheduled by TaskNotes through mdbase",
        importance: 4,
      })
      .catch(() => undefined);
    const { token } = await this.options.messaging.getToken();
    if (!token.trim())
      throw new Error("Firebase did not return a notification token.");
    await this.timers().registerFcm({ token, signal: this.deadline() });
  }
}

export function mdbaseNotificationData(
  notification: Pick<NativeNotification, "data">,
): MdbaseNotification | null {
  try {
    return parseMdbaseNativeNotification(notification.data);
  } catch {
    return null;
  }
}

export function mdbaseWebPushWake(
  value: unknown,
): MdbaseNotificationWake | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (
    message.type !== "tasknotes:mdbase-notification" ||
    typeof message.opened !== "boolean"
  )
    return null;
  const notification = message.notification as MdbaseNotification | undefined;
  if (
    notification?.version !== 1 ||
    typeof notification.signalId !== "string" ||
    typeof notification.criterionId !== "string" ||
    typeof notification.cursor !== "string"
  )
    return null;
  return { notification, opened: message.opened };
}

class LazyFirebaseMessaging implements NativeMessaging {
  async checkPermissions() {
    return (await firebaseMessaging()).FirebaseMessaging.checkPermissions();
  }

  async requestPermissions() {
    return (await firebaseMessaging()).FirebaseMessaging.requestPermissions();
  }

  async getToken() {
    return (await firebaseMessaging()).FirebaseMessaging.getToken();
  }

  async deleteToken() {
    return (await firebaseMessaging()).FirebaseMessaging.deleteToken();
  }

  async createChannel(options: {
    id: string;
    name: string;
    description: string;
    importance: number;
  }) {
    return (await firebaseMessaging()).FirebaseMessaging.createChannel(options);
  }

  addListener(
    eventName: "tokenReceived",
    listener: (event: { token: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "notificationReceived",
    listener: (event: { notification: NativeNotification }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "notificationActionPerformed",
    listener: (event: { notification: NativeNotification }) => void,
  ): Promise<PluginListenerHandle>;
  async addListener(
    eventName:
      "tokenReceived" | "notificationReceived" | "notificationActionPerformed",
    listener:
      | ((event: { token: string }) => void)
      | ((event: { notification: NativeNotification }) => void),
  ): Promise<PluginListenerHandle> {
    const { FirebaseMessaging: messaging } = await firebaseMessaging();
    if (eventName === "tokenReceived")
      return messaging.addListener(
        eventName,
        listener as (event: { token: string }) => void,
      );
    if (eventName === "notificationReceived")
      return messaging.addListener(
        eventName,
        listener as (event: { notification: Notification }) => void,
      );
    return messaging.addListener(
      eventName,
      listener as (event: {
        actionId: string;
        inputValue?: string;
        notification: Notification;
      }) => void,
    );
  }
}

function firebaseMessaging() {
  // Return the namespace, never the Capacitor proxy: resolving a promise with
  // the proxy invokes its synthetic `then` method and leaves the loader pending.
  return import("@capacitor-firebase/messaging");
}

export const mdbaseNotifications = new MdbaseNotificationManager({
  connect: {
    connection: () => {
      const phase = taskNotesMdbase().getSnapshot().phase;
      return phase.kind === "ready" ? phase.connection : null;
    },
  },
  messaging:
    Capacitor.getPlatform() === "android"
      ? androidPushMessaging
      : new LazyFirebaseMessaging(),
  webPush: webPushMessaging,
  storage: localStorage,
  isNative: () => Capacitor.isNativePlatform(),
  isConfigured: () =>
    Capacitor.getPlatform() === "android"
      ? Capacitor.isPluginAvailable("PushNotifications")
      : Capacitor.isPluginAvailable("FirebaseMessaging"),
});
