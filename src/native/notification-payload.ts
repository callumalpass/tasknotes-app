import {
  parseMdbasePush,
  parseMdbaseNativeNotification,
} from "@mdbase-dev/sdk/notifications";

/** Wire envelope only: no record identity, paths, task text or deep links. */
export interface PrivateNotificationData {
  type: "mdbase.notification";
  version: 1;
  signal_id: string;
  criterion_id: string;
  cursor: string;
}
export interface PrivatePushPayload extends PrivateNotificationData {
  presentation: { title: string; body?: string; tag?: string };
}

export function parseNotificationPayload(value: unknown): PrivatePushPayload {
  const parsed = parseMdbasePush(value);
  return {
    type: "mdbase.notification",
    version: 1,
    signal_id: parsed.signalId,
    criterion_id: parsed.criterionId,
    cursor: parsed.cursor,
    presentation: parsed.presentation!,
  };
}

export function readNotificationData(
  value: unknown,
): PrivateNotificationData | null {
  try {
    const parsed = parseMdbaseNativeNotification(value);
    return {
      type: "mdbase.notification",
      version: 1,
      signal_id: parsed.signalId,
      criterion_id: parsed.criterionId,
      cursor: parsed.cursor,
    };
  } catch {
    return null;
  }
}

export function showNotificationPayload(
  registration: Pick<ServiceWorkerRegistration, "showNotification">,
  payload: PrivatePushPayload,
): Promise<void> {
  return registration.showNotification(payload.presentation.title, {
    ...(payload.presentation.body ? { body: payload.presentation.body } : {}),
    ...(payload.presentation.tag ? { tag: payload.presentation.tag } : {}),
    data: nativeNotificationData(payload),
  });
}

export function nativeNotificationData(
  payload: PrivatePushPayload,
): PrivateNotificationData {
  return {
    type: payload.type,
    version: payload.version,
    signal_id: payload.signal_id,
    criterion_id: payload.criterion_id,
    cursor: payload.cursor,
  };
}
