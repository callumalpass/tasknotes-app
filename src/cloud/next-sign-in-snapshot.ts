import type { AppWebSignInSnapshot } from "@mdbase-dev/sdk/app-host";

const uuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value) &&
  value !== "00000000-0000-0000-0000-000000000000";
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const ids = (value: unknown) =>
  Array.isArray(value) && value.length <= 1000 && value.every(uuid);
const text = (value: unknown, max: number) =>
  typeof value === "string" && value.length <= max;
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
/** Validate public presentation pushes separately from command replies. This
 * is a UI message-shape check, not another sign-in or namespace authority. */
export function isNextSignInSnapshot(
  value: unknown,
  cpOrigin: string,
): value is AppWebSignInSnapshot {
  try {
    if (
      !object(value) ||
      !keys(value, [
        "status",
        "signIn",
        "collections",
        "selectedCollectionId",
        "problem",
        "timing",
      ]) ||
      ![
        "not_started",
        "starting",
        "signed_out",
        "authorizing",
        "unselected",
        "opening",
        "setup_required",
        "ready",
        "blocked",
        "closed",
      ].includes(value.status as string) ||
      !(
        value.selectedCollectionId === null || uuid(value.selectedCollectionId)
      ) ||
      !(
        value.problem === null ||
        (text(value.problem, 64) && /^[a-z_]+$/.test(value.problem as string))
      ) ||
      !Array.isArray(value.collections) ||
      value.collections.length > 1000 ||
      !value.collections.every(
        (item) =>
          object(item) &&
          keys(item, ["collectionId", "displayName", "role"]) &&
          uuid(item.collectionId) &&
          text(item.displayName, 4096) &&
          ["owner", "editor", "viewer"].includes(item.role as string),
      )
    )
      return false;
    if (value.timing !== null) {
      if (
        !object(value.timing) ||
        !keys(value.timing, ["firstScreenMs", "readyMs"]) ||
        ![value.timing.firstScreenMs, value.timing.readyMs].every(
          (time) =>
            time === null ||
            (typeof time === "number" && Number.isFinite(time) && time >= 0),
        )
      )
        return false;
    }
    if (value.signIn === null) return true;
    const view = value.signIn;
    if (
      !object(view) ||
      !keys(view, [
        "requestId",
        "installationId",
        "deviceId",
        "appId",
        "kind",
        "verificationUri",
        "state",
        "accountId",
        "accountEmail",
        "collectionSelection",
        "collectionIds",
        "createCollections",
        "requestedCreateCollections",
      ]) ||
      !uuid(view.requestId) ||
      !uuid(view.installationId) ||
      !uuid(view.deviceId) ||
      !text(view.appId, 256) ||
      !["app-runtime", "mobile"].includes(view.kind as string) ||
      ![
        "pending",
        "account_selected",
        "account_confirmed",
        "awaiting_approval",
        "paired",
      ].includes(view.state as string) ||
      !(view.accountId === null || uuid(view.accountId)) ||
      !(
        view.accountEmail === undefined ||
        view.accountEmail === null ||
        text(view.accountEmail, 320)
      ) ||
      !ids(view.collectionIds) ||
      typeof view.createCollections !== "boolean" ||
      typeof view.requestedCreateCollections !== "boolean" ||
      !text(view.verificationUri, 8192)
    )
      return false;
    const uri = new URL(view.verificationUri as string);
    if (uri.origin !== cpOrigin || uri.username || uri.password) return false;
    if (
      view.collectionSelection !== undefined &&
      view.collectionSelection !== null
    ) {
      const selection = view.collectionSelection;
      if (
        !object(selection) ||
        !keys(selection, [
          "requestId",
          "selectedCollectionId",
          "createdCollectionIds",
        ]) ||
        !uuid(selection.requestId) ||
        !(
          selection.selectedCollectionId === null ||
          uuid(selection.selectedCollectionId)
        ) ||
        !ids(selection.createdCollectionIds)
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
