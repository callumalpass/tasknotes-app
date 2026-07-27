import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import {
  MdbaseBrowserLocation,
  MdbaseConnect,
  type MdbaseConnection,
  type MdbaseConnectionInfo,
} from "@mdbase/connect";

import type { JsonObject, MdbaseAppManifest } from "@mdbase/connect-protocol";
import bundledManifest from "../generated/mdbase-app.json";

export const CLOUD_OPERATIONS = [
  "describe",
  "changes",
  "read",
  "query",
  "list_views",
  "execute_view",
  "read_view_source",
  "create_view_source",
  "update_view_source",
  "delete_view_source",
  "create",
  "update",
  "delete",
  "rename",
  "reconcile_timers",
  "sync",
] as const;

const serverUrl =
  import.meta.env.VITE_MDBASE_CONNECT_URL ?? "https://connect.mdbase.dev";
const manifest =
  import.meta.env.VITE_MDBASE_MANIFEST_URL ??
  (bundledManifest as MdbaseAppManifest);
const redirectUri = Capacitor.isNativePlatform()
  ? "dev.tasknotes.app://auth/mdbase/callback"
  : `${location.origin}${joinBase("auth/mdbase/callback")}`;

export const cloudConnect = new MdbaseConnect<JsonObject>({
  serverUrl,
  manifest,
  redirectUri,
  navigate: Capacitor.isNativePlatform()
    ? async (url) => Browser.open({ url })
    : undefined,
});

const cloudLocation = new MdbaseBrowserLocation(cloudConnect, {
  fallbackPath: joinBase(""),
});

export function savedCloudConnections(): MdbaseConnectionInfo[] {
  return cloudConnect.connections();
}

export function authorizeCloudCollection(
  collectionId?: string,
): ReturnType<typeof cloudConnect.authorize> {
  return cloudConnect.authorize({
    operations: [...CLOUD_OPERATIONS],
    ...(collectionId ? { collectionId } : {}),
    returnTo: authorizationReturnTo(),
  });
}

export function activeCloudConnection(): MdbaseConnection<JsonObject> | null {
  return cloudLocation.activeConnection();
}

export function selectCloudConnection(
  collectionId: string,
  replace = false,
): void {
  cloudLocation.selectConnection(collectionId, { replace });
}

export function authorizationReturnTo(): string {
  return cloudLocation.authorizationReturnTo();
}

export function completeCloudAuthorization(
  callbackUrl: string,
): Promise<MdbaseConnection<JsonObject>> {
  return cloudLocation.completeAuthorization(callbackUrl);
}

export function isCloudCallback(value: string): boolean {
  return cloudLocation.isAuthorizationCallback(value);
}

export function cleanCallbackUrl(): void {
  cloudLocation.clearAuthorizationCallback();
}

export function selectedCloudCollectionId(): string | null {
  return cloudLocation.selectedCollectionId();
}

export function onCloudConnectionChange(
  listener: (connection: MdbaseConnection<JsonObject> | null) => void,
): () => void {
  return cloudLocation.onChange(({ connection }) => listener(connection));
}

function joinBase(path: string): string {
  const base = import.meta.env.BASE_URL;
  return `${base.endsWith("/") ? base : `${base}/`}${path}`;
}
