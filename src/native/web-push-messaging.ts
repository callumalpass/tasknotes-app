import type { PluginListenerHandle } from "@capacitor/core";

import { registerTaskNotesServiceWorker } from "../service-worker-registration";

export interface WebPushMessaging {
  isSupported(): boolean;
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  serviceWorker(): Promise<ServiceWorkerRegistration>;
  addListener(
    listener: (event: MessageEvent<unknown>) => void,
  ): Promise<PluginListenerHandle>;
}

export class BrowserWebPushMessaging implements WebPushMessaging {
  isSupported(): boolean {
    return (
      window.isSecureContext &&
      "Notification" in window &&
      "PushManager" in window &&
      "serviceWorker" in navigator
    );
  }

  async checkPermissions(): Promise<{ receive: string }> {
    return { receive: notificationPermission() };
  }

  async requestPermissions(): Promise<{ receive: string }> {
    return {
      receive: permissionStatus(await Notification.requestPermission()),
    };
  }

  serviceWorker(): Promise<ServiceWorkerRegistration> {
    return registerTaskNotesServiceWorker();
  }

  async addListener(
    listener: (event: MessageEvent<unknown>) => void,
  ): Promise<PluginListenerHandle> {
    navigator.serviceWorker.addEventListener("message", listener);
    return {
      remove: async () =>
        navigator.serviceWorker.removeEventListener("message", listener),
    };
  }
}

function notificationPermission(): string {
  return permissionStatus(Notification.permission);
}

function permissionStatus(permission: NotificationPermission): string {
  return permission === "default" ? "prompt" : permission;
}

export const webPushMessaging = new BrowserWebPushMessaging();
