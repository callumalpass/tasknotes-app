import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import {
  MdbaseConnect,
  type MdbaseAuthorizationResult,
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

const COLLECTION_PARAMETER = "collection";

export function savedCloudConnections(): MdbaseConnectionInfo[] {
  return cloudConnect.connections();
}

export function activeCloudConnection(): MdbaseConnection<JsonObject> | null {
  const selected = new URL(location.href).searchParams.get(
    COLLECTION_PARAMETER,
  );
  if (selected) return cloudConnect.connection(selected);
  const saved = cloudConnect.connections();
  if (saved.length !== 1) return null;
  selectCloudConnection(saved[0].collectionId, true);
  return cloudConnect.connection(saved[0].collectionId);
}

export function selectCloudConnection(
  collectionId: string,
  replace = false,
): void {
  const url = cleanAuthorizationParameters(new URL(location.href));
  url.searchParams.set(COLLECTION_PARAMETER, collectionId);
  history[replace ? "replaceState" : "pushState"](null, "", url);
}

export function authorizationReturnTo(): string {
  const url = cleanAuthorizationParameters(new URL(location.href));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function finishAuthorization(
  result: MdbaseAuthorizationResult<JsonObject>,
): MdbaseConnection<JsonObject> {
  const returnTo = cleanAuthorizationParameters(
    new URL(result.returnTo ?? joinBase(""), location.origin),
  );
  returnTo.searchParams.set(
    COLLECTION_PARAMETER,
    result.connection.collectionId,
  );
  history.replaceState(null, "", returnTo);
  return result.connection;
}

export function isCloudCallback(value: string): boolean {
  const url = new URL(value);
  return (
    url.searchParams.has("code") ||
    url.searchParams.has("error") ||
    url.protocol === "dev.tasknotes.app:"
  );
}

export function cleanCallbackUrl(): void {
  history.replaceState(
    null,
    "",
    cleanAuthorizationParameters(new URL(location.href)),
  );
}

function cleanAuthorizationParameters(url: URL): URL {
  for (const parameter of ["code", "state", "error", "error_description"]) {
    url.searchParams.delete(parameter);
  }
  return url;
}

function joinBase(path: string): string {
  const base = import.meta.env.BASE_URL;
  return `${base.endsWith("/") ? base : `${base}/`}${path}`;
}
