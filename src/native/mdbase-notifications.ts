import type { Notification } from "@capacitor-firebase/messaging";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { MdbaseError, type TimersApi } from "@mdbase-dev/sdk";

import {
  androidPushMessaging,
  type NativeMessaging,
  type NativeNotification,
} from "./android-push-messaging";
import { webPushMessaging, type WebPushMessaging } from "./web-push-messaging";
import {
  readNotificationData,
  type PrivateNotificationData,
} from "./notification-payload";

const ENABLED_KEY = "tasknotes:mdbase-notifications:v2:";
const CHANNEL_ID = "mdbase-updates";
const PERMISSION_CHECK_TIMEOUT_MS = 10_000;
const CRITERIA = ["task.reminder"];

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
  notification: PrivateNotificationData;
  opened: boolean;
}

export interface MdbaseNotificationScope {
  /** Stable identity including account, collection and original approved grant.
   * A new grant must never inherit consent from an old one. */
  key: string;
  timers: TimersApi | undefined;
}
export interface MdbaseNotificationManagerOptions {
  messaging: NativeMessaging;
  webPush: WebPushMessaging;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  isNative(): boolean;
  isConfigured(): boolean;
}
interface Binding extends MdbaseNotificationScope {
  onOptInChange?: (enabled: boolean) => void | Promise<void>;
  lifetime: AbortController;
  listeners: Set<() => void>;
}
type Runtime = "native" | "web";

export class MdbaseNotificationManager {
  private binding: Binding | null = null;
  // Serialize channel changes across scopes. The installation's push endpoint
  // is shared: collection opt-out must never delete it.
  private tail: Promise<unknown> = Promise.resolve();
  private readonly statusListeners = new Set<() => void | Promise<void>>();

  constructor(private readonly options: MdbaseNotificationManagerOptions) {}

  /** Detach cancels work/listeners, but does not revoke persistent consent or
   * unregister a channel. Explicit sign-out must disable before port teardown. */
  bindScope(
    scope: MdbaseNotificationScope | null,
    onOptInChange?: (enabled: boolean) => void | Promise<void>,
  ): () => void {
    this.detach();
    if (!scope) return () => undefined;
    if (!scope.key) throw new Error("Notification scope identity is required.");
    const binding: Binding = {
      ...scope,
      onOptInChange,
      lifetime: new AbortController(),
      listeners: new Set(),
    };
    this.binding = binding;
    // Scheduling resumes only once restoration confirms permission/registration.
    void this.notifyOptIn(binding, false);
    return () => {
      if (this.binding === binding) this.detach();
    };
  }

  /** Recheck status after channel work settles, including background restoration.
   * Reads never emit, and observing a change never retries registration. */
  subscribeStatus(listener: () => void | Promise<void>): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  async status(): Promise<MdbaseNotificationStatus> {
    const binding = this.binding;
    if (!binding) return { state: "not_connected", optedIn: false };
    const runtime = this.runtime();
    const optedIn = this.enabled(binding);
    if (!runtime) return { state: "unavailable", optedIn };
    if (!binding.timers)
      return { state: "reauthorization_required", optedIn: false };
    if (runtime === "native" && !this.options.isConfigured())
      return { state: "not_configured", optedIn };
    if (this.consent(binding) === "reauthorization_required") {
      await this.notifyOptIn(binding, false);
      return { state: "reauthorization_required", optedIn: false };
    }
    if (
      this.consent(binding) === "pending" ||
      this.consent(binding) === "stopping"
    ) {
      await this.notifyOptIn(binding, false);
      return { state: "error", optedIn: false };
    }
    const permission = await this.checkPermissions(runtime).catch(
      (error: unknown) => {
        void this.notifyOptIn(binding, false);
        throw error;
      },
    );
    this.assertCurrent(binding);
    const enabled = this.enabled(binding) && permission.receive === "granted";
    if (!enabled) await this.notifyOptIn(binding, false);
    if (permission.receive === "denied")
      return { state: "denied", optedIn: this.enabled(binding) };
    return {
      state: enabled ? "enabled" : "off",
      optedIn: this.enabled(binding),
    };
  }

  enable(): Promise<MdbaseNotificationStatus> {
    const binding = this.binding;
    return this.enqueue(async () => {
      if (!binding) return { state: "not_connected", optedIn: false };
      this.assertCurrent(binding);
      const runtime = this.runtime();
      if (!runtime) return { state: "unavailable", optedIn: false };
      if (!binding.timers)
        return { state: "reauthorization_required", optedIn: false };
      if (runtime === "native" && !this.options.isConfigured())
        return { state: "not_configured", optedIn: false };
      if (this.consent(binding) === "reauthorization_required")
        return { state: "reauthorization_required", optedIn: false };
      this.requireResolvedConsent(binding);
      const provider =
        runtime === "native" ? this.options.messaging : this.options.webPush;
      const current = await this.checkPermissions(runtime);
      this.assertCurrent(binding);
      const permission =
        current.receive === "prompt" ||
        current.receive === "prompt-with-rationale"
          ? await provider.requestPermissions()
          : current;
      this.assertCurrent(binding);
      if (permission.receive !== "granted") {
        await this.notifyOptIn(binding, false);
        return { state: "denied", optedIn: false };
      }
      try {
        await this.registerCurrentInstallation(binding, runtime);
      } catch (error) {
        const reason = errorReason(error);
        if (
          requiresReauthorization(reason) ||
          (reason === "timer_refused" && errorCode(error) === "unauthenticated")
        )
          return { state: "reauthorization_required", optedIn: false };
        if (reason === "managed_fcm_not_declared")
          return { state: "not_configured", optedIn: false };
        throw error;
      }
      return { state: "enabled", optedIn: true };
    });
  }

  disable(): Promise<MdbaseNotificationStatus> {
    const binding = this.binding;
    return this.enqueue(async () => {
      if (!binding) return { state: "not_connected", optedIn: false };
      this.assertCurrent(binding);
      const runtime = this.runtime();
      if (!runtime) return { state: "unavailable", optedIn: false };
      if (!binding.timers)
        return { state: "reauthorization_required", optedIn: false };
      if (this.consent(binding) === "reauthorization_required")
        throw channelReapprovalError();
      // Persist intent before draining: restart/rotation must not restore it.
      this.options.storage.setItem(this.key(binding), "stopping");
      await this.notifyOptIn(binding, false);
      this.assertCurrent(binding);
      const signal = binding.lifetime.signal;
      try {
        if (runtime === "native") {
          await binding.timers.unregisterFcm({ signal });
        } else {
          // No worker: remove only this grant's channel, not the shared browser
          // subscription used by other opted-in collections.
          await binding.timers.unregisterWebPush(undefined, { signal });
        }
        this.assertCurrent(binding);
      } catch (error) {
        if (requiresReauthorization(errorReason(error)))
          this.options.storage.setItem(
            this.key(binding),
            "reauthorization_required",
          );
        throw error;
      }
      this.options.storage.removeItem(this.key(binding));
      return { state: "off", optedIn: false };
    });
  }

  async disableIfEnabled(): Promise<void> {
    if (this.binding && this.consent(this.binding)) {
      const result = await this.disable();
      // A missing timer grant is not a confirmed unregister either.
      if (result.state !== "off") throw channelReapprovalError();
    }
  }

  refreshRegistration(): Promise<void> {
    const binding = this.binding;
    return this.enqueue(async () => {
      if (!binding) return;
      this.assertCurrent(binding);
      const runtime = this.runtime();
      if (!runtime || !binding.timers || !this.enabled(binding)) return;
      if (runtime === "native" && !this.options.isConfigured()) return;
      const permission = await this.checkPermissions(runtime);
      this.assertCurrent(binding);
      if (permission.receive !== "granted") {
        await this.notifyOptIn(binding, false);
        return;
      }
      await this.registerCurrentInstallation(binding, runtime);
    });
  }

  listen(onWake: (event: MdbaseNotificationWake) => void): () => void {
    const binding = this.binding;
    const runtime = this.runtime();
    if (
      !binding ||
      !runtime ||
      !binding.timers ||
      (runtime === "native" && !this.options.isConfigured())
    )
      return () => undefined;
    let disposed = false;
    const active = () =>
      !disposed && this.binding === binding && !binding.lifetime.signal.aborted;
    const handles: PluginListenerHandle[] = [];
    const keep = async (promise: Promise<PluginListenerHandle>) => {
      try {
        const handle = await promise;
        if (!active()) await handle.remove();
        else handles.push(handle);
      } catch {
        /* status/enable expose initialization failures. */
      }
    };
    const wake = (event: MdbaseNotificationWake | null) => {
      if (!active() || !event) return;
      // A signal contains no task or collection routing data. Read current app
      // state on wake; never use its opaque cursor as task content or identity.
      onWake(event);
      void this.refreshRegistration().catch(() => undefined);
    };
    if (runtime === "native") {
      void keep(
        this.options.messaging.addListener("tokenReceived", ({ token }) => {
          if (!active() || !this.enabled(binding) || !token.trim()) return;
          void this.enqueue(async () => {
            if (!active() || !this.enabled(binding)) return;
            const permission = await this.checkPermissions(runtime);
            if (
              !active() ||
              !this.enabled(binding) ||
              permission.receive !== "granted"
            )
              return;
            await this.registerChannel(binding, () =>
              binding.timers!.registerFcm({
                token,
                criteria: [...CRITERIA],
                signal: binding.lifetime.signal,
              }),
            );
          }).catch(() => undefined);
        }),
      );
      void keep(
        this.options.messaging.addListener(
          "notificationReceived",
          ({ notification }) => {
            const data = mdbaseNotificationData(notification);
            wake(data ? { notification: data, opened: false } : null);
          },
        ),
      );
      void keep(
        this.options.messaging.addListener(
          "notificationActionPerformed",
          ({ notification }) => {
            const data = mdbaseNotificationData(notification);
            wake(data ? { notification: data, opened: true } : null);
          },
        ),
      );
    } else {
      void keep(
        this.options.webPush.addListener(({ data }) =>
          wake(mdbaseWebPushWake(data)),
        ),
      );
    }
    void this.refreshRegistration().catch(() => undefined);
    const dispose = () => {
      disposed = true;
      binding.listeners.delete(dispose);
      for (const handle of handles) void handle.remove().catch(() => undefined);
      handles.length = 0;
    };
    binding.listeners.add(dispose);
    return dispose;
  }

  private detach(): void {
    const binding = this.binding;
    if (!binding) return;
    void this.notifyOptIn(binding, false);
    this.binding = null;
    binding.lifetime.abort();
    for (const dispose of binding.listeners) dispose();
  }
  private async notifyOptIn(binding: Binding, enabled: boolean): Promise<void> {
    if (this.binding !== binding || binding.lifetime.signal.aborted) return;
    try {
      // Scheduling errors belong to the repository; never turn a confirmed
      // channel registration into a failed/unknown registration outcome.
      // false must pause new schedules and naturally drain the active request:
      // aborting its promise does not free the SDK's single-flight port slot.
      await binding.onOptInChange?.(enabled);
    } catch {
      /* The caller reports scheduling errors separately. */
    }
  }
  private assertCurrent(binding: Binding): void {
    if (this.binding !== binding || binding.lifetime.signal.aborted)
      throw new Error(
        "The notification scope changed. Try again in the current collection.",
      );
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work).finally(() => {
      for (const listener of [...this.statusListeners]) {
        try {
          // Observers must not delay the queue or change an acknowledged outcome.
          void Promise.resolve(listener()).catch(() => undefined);
        } catch {
          /* A failed observer is not a failed channel mutation. */
        }
      }
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
  private key(binding: Binding): string {
    return ENABLED_KEY + encodeURIComponent(binding.key);
  }
  private consent(binding: Binding): string | null {
    return this.options.storage.getItem(this.key(binding));
  }
  private enabled(binding: Binding): boolean {
    return this.consent(binding) === "1";
  }
  private requireResolvedConsent(binding: Binding): void {
    if (this.consent(binding) === "reauthorization_required")
      throw channelReapprovalError();
    if (
      this.consent(binding) === "pending" ||
      this.consent(binding) === "stopping"
    )
      throw new Error(
        "Notification registration is unresolved. Turn reminders off before enabling again.",
      );
  }
  private runtime(): Runtime | null {
    if (this.options.isNative()) return "native";
    return this.options.webPush.isSupported() ? "web" : null;
  }
  private async checkPermissions(runtime: Runtime) {
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
    binding: Binding,
    runtime: Runtime,
  ): Promise<void> {
    if (runtime === "web") {
      const serviceWorker = await this.options.webPush.serviceWorker();
      this.assertCurrent(binding);
      await this.registerChannel(binding, () =>
        binding.timers!.registerWebPush({
          serviceWorker,
          criteria: [...CRITERIA],
          signal: binding.lifetime.signal,
        }),
      );
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
    this.assertCurrent(binding);
    const { token } = await this.options.messaging.getToken();
    this.assertCurrent(binding);
    if (!token.trim())
      throw new Error("Firebase did not return a notification token.");
    await this.registerChannel(binding, () =>
      binding.timers!.registerFcm({
        token,
        criteria: [...CRITERIA],
        signal: binding.lifetime.signal,
      }),
    );
  }
  private async registerChannel(
    binding: Binding,
    register: () => Promise<unknown>,
  ): Promise<void> {
    this.assertCurrent(binding);
    this.requireResolvedConsent(binding);
    const previous = this.consent(binding);
    // A crash, an ambiguous response, or scope cancellation after dispatch must
    // never silently opt in or retry registration on the next wake/restart.
    this.options.storage.setItem(this.key(binding), "pending");
    await this.notifyOptIn(binding, false);
    this.assertCurrent(binding);
    try {
      await register();
      this.assertCurrent(binding);
      this.options.storage.setItem(this.key(binding), "1");
      void this.notifyOptIn(binding, true);
    } catch (error) {
      const reason = errorReason(error);
      if (
        requiresReauthorization(reason) ||
        (reason === "timer_refused" && errorCode(error) === "unauthenticated")
      ) {
        this.assertCurrent(binding);
        this.options.storage.setItem(
          this.key(binding),
          "reauthorization_required",
        );
        throw error;
      }
      if (
        binding.lifetime.signal.aborted ||
        errorCode(error) === "outcome_unknown"
      )
        throw error;
      // The pinned SDK reports confirmed HTTP refusals as timer_refused with
      // several different codes. Pre-dispatch validation/busy errors are safe
      // too; never mistake an outcome_unknown code's more specific reason for
      // a confirmed refusal.
      if (
        reason === "timer_refused" ||
        reason === "timer_port_busy" ||
        reason === "managed_fcm_not_declared" ||
        [
          "permission_denied",
          "unauthenticated",
          "unauthorized",
          "invalid_request",
          "cancelled",
        ].includes(errorCode(error) ?? "")
      ) {
        this.assertCurrent(binding);
        if (previous) this.options.storage.setItem(this.key(binding), previous);
        else this.options.storage.removeItem(this.key(binding));
        // The rejected replacement did not change the acknowledged channel.
        // Restore scheduling too, not only the persisted opt-in display.
        if (previous === "1") void this.notifyOptIn(binding, true);
      }
      throw error;
    }
  }
}

function requiresReauthorization(reason: string | undefined): boolean {
  return (
    reason === "timer_channel_reapproval_required" ||
    reason === "notification_reauthorization_required"
  );
}

function channelReapprovalError(): MdbaseError {
  return new MdbaseError({
    code: "outcome_unknown",
    reason: "timer_channel_reapproval_required",
    recovery: "resolve_outcome",
    message:
      "Reminder channel removal is unconfirmed. Review access to approve a fresh grant.",
  });
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  return (error as { code?: string }).code;
}

function errorReason(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { code?: string; reason?: string };
  return value.reason ?? value.code;
}

export function mdbaseNotificationData(
  notification: Pick<NativeNotification, "data">,
): PrivateNotificationData | null {
  return readNotificationData(notification.data);
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
  const notification = readNotificationData(message.notification);
  return notification ? { notification, opened: message.opened } : null;
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
