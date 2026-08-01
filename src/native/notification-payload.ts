import type {
  MdbaseNativeNotificationData,
  MdbasePushPayload,
} from "@mdbase/connect";

export function parseNotificationPayload(value: unknown): MdbasePushPayload {
  if (!value || typeof value !== "object")
    throw new Error("The push payload is not an object.");
  const payload = value as Partial<MdbasePushPayload>;
  if (
    payload.type !== "mdbase.notification" ||
    payload.version !== 1 ||
    typeof payload.signal_id !== "string" ||
    typeof payload.criterion_id !== "string" ||
    typeof payload.cursor !== "string" ||
    !payload.presentation ||
    typeof payload.presentation.title !== "string"
  )
    throw new Error("The push payload is not an mdbase notification.");
  return payload as MdbasePushPayload;
}

export function showNotificationPayload(
  registration: Pick<ServiceWorkerRegistration, "showNotification">,
  payload: MdbasePushPayload,
): Promise<void> {
  return registration.showNotification(payload.presentation.title, {
    ...(payload.presentation.body ? { body: payload.presentation.body } : {}),
    ...(payload.presentation.tag ? { tag: payload.presentation.tag } : {}),
    data: nativeNotificationData(payload),
  });
}

export function nativeNotificationData(
  payload: MdbasePushPayload,
): MdbaseNativeNotificationData {
  return {
    type: payload.type,
    version: payload.version,
    signal_id: payload.signal_id,
    criterion_id: payload.criterion_id,
    cursor: payload.cursor,
  };
}
