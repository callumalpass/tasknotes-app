import type { Notification } from "@capacitor-firebase/messaging";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import {
  MdbaseConnectError,
  parseMdbaseNativeNotificationData,
  type MdbaseConnectionInfo,
  type MdbaseNotificationRegistration,
  type MdbaseNativeNotificationRegistration,
  type MdbaseNativeNotificationData,
} from "@mdbase/connect";

import { cloudSession } from "../cloud/connect";
import {
  androidPushMessaging,
  type NativeMessaging,
  type NativeNotification,
} from "./android-push-messaging";
import { webPushMessaging, type WebPushMessaging } from "./web-push-messaging";

const ENABLED_KEY = "tasknotes:mdbase-notifications:v1";
const CHANNEL_ID = "mdbase-updates";
const TIMER_OPERATIONS = ["reconcile_timers"] as const;

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
  notification: MdbaseNativeNotificationData;
  opened: boolean;
}

interface NotificationConnect {
  connection(): MdbaseConnectionInfo | null;
  registerNotifications(options: {
    serviceWorker: ServiceWorkerRegistration;
  }): Promise<MdbaseNotificationRegistration>;
  unregisterNotifications(
    serviceWorker?: ServiceWorkerRegistration,
  ): Promise<void>;
  registerNativeNotifications(options: {
    token: string;
  }): Promise<MdbaseNativeNotificationRegistration>;
  unregisterNativeNotifications(): Promise<void>;
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
    if (
      TIMER_OPERATIONS.some(
        (operation) => !connection.operations.includes(operation),
      )
    )
      return { state: "reauthorization_required", optedIn: false };
    if (runtime === "native" && !this.options.isConfigured())
      return { state: "not_configured", optedIn };
    const permission =
      runtime === "native"
        ? await this.options.messaging.checkPermissions()
        : await this.options.webPush.checkPermissions();
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
    if (
      TIMER_OPERATIONS.some(
        (operation) => !connection.operations.includes(operation),
      )
    )
      return { state: "reauthorization_required", optedIn: false };
    if (runtime === "native" && !this.options.isConfigured())
      return { state: "not_configured", optedIn: false };
    const provider =
      runtime === "native" ? this.options.messaging : this.options.webPush;
    const current = await provider.checkPermissions();
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
      if (
        error instanceof MdbaseConnectError &&
        error.code === "notification_reauthorization_required"
      ) {
        return { state: "reauthorization_required", optedIn: false };
      }
      if (
        error instanceof MdbaseConnectError &&
        error.code === "managed_fcm_not_declared"
      ) {
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
      await this.options.connect.unregisterNativeNotifications();
      await this.options.messaging.deleteToken();
    } else {
      const serviceWorker = await this.options.webPush.serviceWorker();
      await this.options.connect.unregisterNotifications(serviceWorker);
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
    const permission =
      runtime === "native"
        ? await this.options.messaging.checkPermissions()
        : await this.options.webPush.checkPermissions();
    if (permission.receive !== "granted") return;
    await this.registerCurrentInstallation(runtime);
  }

  listen(onWake: (event: MdbaseNotificationWake) => void): () => void {
    const runtime = this.runtime();
    if (!runtime) return () => undefined;
    let disposed = false;
    const handles: PluginListenerHandle[] = [];
    const keep = async (promise: Promise<PluginListenerHandle>) => {
      const handle = await promise;
      if (disposed) await handle.remove();
      else handles.push(handle);
    };
    if (runtime === "native") {
      void keep(
        this.options.messaging.addListener("tokenReceived", ({ token }) => {
          if (!this.enabled() || !token) return;
          void this.options.connect
            .registerNativeNotifications({ token })
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
      for (const handle of handles) void handle.remove();
      handles.length = 0;
    };
  }

  private enabled(): boolean {
    return this.options.storage.getItem(ENABLED_KEY) === "1";
  }

  private runtime(): "native" | "web" | null {
    if (this.options.isNative()) return "native";
    return this.options.webPush.isSupported() ? "web" : null;
  }

  private async registerCurrentInstallation(
    runtime: "native" | "web",
  ): Promise<void> {
    if (runtime === "web") {
      const serviceWorker = await this.options.webPush.serviceWorker();
      await this.options.connect.registerNotifications({ serviceWorker });
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
    await this.options.connect.registerNativeNotifications({ token });
  }
}

export function mdbaseNotificationData(
  notification: Pick<NativeNotification, "data">,
): MdbaseNativeNotificationData | null {
  try {
    return parseMdbaseNativeNotificationData(notification.data);
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
  const notification = mdbaseNotificationData({ data: message.notification });
  return notification ? { notification, opened: message.opened } : null;
}

class LazyFirebaseMessaging implements NativeMessaging {
  async checkPermissions() {
    return (await firebaseMessaging()).checkPermissions();
  }

  async requestPermissions() {
    return (await firebaseMessaging()).requestPermissions();
  }

  async getToken() {
    return (await firebaseMessaging()).getToken();
  }

  async deleteToken() {
    return (await firebaseMessaging()).deleteToken();
  }

  async createChannel(options: {
    id: string;
    name: string;
    description: string;
    importance: number;
  }) {
    return (await firebaseMessaging()).createChannel(options);
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
    const messaging = await firebaseMessaging();
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

async function firebaseMessaging() {
  return (await import("@capacitor-firebase/messaging")).FirebaseMessaging;
}

export const mdbaseNotifications = new MdbaseNotificationManager({
  connect: {
    connection: () => currentConnection()?.info() ?? null,
    registerNotifications: (options) => {
      const connection = currentConnection();
      if (!connection) throw new Error("TaskNotes is not connected.");
      return connection.registerNotifications(options);
    },
    unregisterNotifications: async (serviceWorker) => {
      await currentConnection()?.unregisterNotifications(serviceWorker);
    },
    registerNativeNotifications: (options) => {
      const connection = currentConnection();
      if (!connection) throw new Error("TaskNotes is not connected.");
      return connection.registerNativeNotifications(options);
    },
    unregisterNativeNotifications: async () => {
      await currentConnection()?.unregisterNativeNotifications();
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

function currentConnection() {
  const snapshot = cloudSession.getSnapshot();
  return snapshot.status === "ready" ? snapshot.connection : null;
}
