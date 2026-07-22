import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

export function selectionFeedback(): void {
  if (!Capacitor.isNativePlatform()) return;
  void Haptics.selectionChanged().catch(() => undefined);
}

export function actionFeedback(): void {
  if (!Capacitor.isNativePlatform()) return;
  void Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
}

export function successFeedback(): void {
  if (!Capacitor.isNativePlatform()) return;
  void Haptics.notification({ type: NotificationType.Success }).catch(
    () => undefined,
  );
}
