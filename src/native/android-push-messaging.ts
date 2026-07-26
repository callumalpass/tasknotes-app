import {
  PushNotifications,
  type ActionPerformed,
  type PermissionStatus,
  type PushNotificationSchema,
  type RegistrationError,
  type Token,
} from "@capacitor/push-notifications";
import type { PluginListenerHandle } from "@capacitor/core";

export interface NativeNotification {
  data: unknown;
}

export interface NativeMessaging {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  getToken(): Promise<{ token: string }>;
  deleteToken(): Promise<void>;
  createChannel(options: {
    id: string;
    name: string;
    description: string;
    importance: number;
  }): Promise<void>;
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
}

interface PushProvider {
  checkPermissions(): Promise<PermissionStatus>;
  requestPermissions(): Promise<PermissionStatus>;
  register(): Promise<void>;
  unregister(): Promise<void>;
  createChannel(options: {
    id: string;
    name: string;
    description?: string;
    importance?: 1 | 2 | 3 | 4 | 5;
  }): Promise<void>;
  addListener(
    eventName: "registration",
    listener: (event: Token) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "registrationError",
    listener: (event: RegistrationError) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "pushNotificationReceived",
    listener: (event: PushNotificationSchema) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "pushNotificationActionPerformed",
    listener: (event: ActionPerformed) => void,
  ): Promise<PluginListenerHandle>;
}

const TOKEN_TIMEOUT_MS = 15_000;

export class AndroidPushMessaging implements NativeMessaging {
  constructor(
    private readonly push: PushProvider = PushNotifications,
    private readonly tokenTimeoutMs = TOKEN_TIMEOUT_MS,
  ) {}

  checkPermissions() {
    return this.push.checkPermissions();
  }

  requestPermissions() {
    return this.push.requestPermissions();
  }

  async getToken(): Promise<{ token: string }> {
    let resolveToken!: (token: string) => void;
    let rejectToken!: (reason: Error) => void;
    const token = new Promise<string>((resolve, reject) => {
      resolveToken = resolve;
      rejectToken = reject;
    });
    const handles: PluginListenerHandle[] = [];
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      handles.push(
        await this.push.addListener("registration", ({ value }) => {
          if (value.trim()) resolveToken(value);
          else
            rejectToken(
              new Error("Firebase returned an empty notification token."),
            );
        }),
      );
      handles.push(
        await this.push.addListener("registrationError", ({ error }) => {
          rejectToken(new Error(error || "Firebase registration failed."));
        }),
      );
      timeout = setTimeout(
        () =>
          rejectToken(
            new Error("Firebase registration timed out on this device."),
          ),
        this.tokenTimeoutMs,
      );
      await this.push.register();
      return { token: await token };
    } finally {
      if (timeout) clearTimeout(timeout);
      await Promise.all(handles.map((handle) => handle.remove()));
    }
  }

  deleteToken() {
    return this.push.unregister();
  }

  createChannel(options: {
    id: string;
    name: string;
    description: string;
    importance: number;
  }) {
    return this.push.createChannel({
      ...options,
      importance: options.importance as 1 | 2 | 3 | 4 | 5,
    });
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
  addListener(
    eventName:
      "tokenReceived" | "notificationReceived" | "notificationActionPerformed",
    listener:
      | ((event: { token: string }) => void)
      | ((event: { notification: NativeNotification }) => void),
  ): Promise<PluginListenerHandle> {
    if (eventName === "tokenReceived")
      return this.push.addListener("registration", ({ value }) => {
        (listener as (event: { token: string }) => void)({ token: value });
      });
    if (eventName === "notificationReceived")
      return this.push.addListener("pushNotificationReceived", (notification) =>
        (listener as (event: { notification: NativeNotification }) => void)({
          notification,
        }),
      );
    return this.push.addListener(
      "pushNotificationActionPerformed",
      ({ notification }) =>
        (listener as (event: { notification: NativeNotification }) => void)({
          notification,
        }),
    );
  }
}

export const androidPushMessaging = new AndroidPushMessaging();
