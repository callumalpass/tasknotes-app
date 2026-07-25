import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { MdbaseConnect } from "@mdbase/connect";

import type { JsonObject, MdbaseAppManifestV3 } from "@mdbase/connect-protocol";
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
  (bundledManifest as MdbaseAppManifestV3);
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

export function isCloudCallback(value: string): boolean {
  const url = new URL(value);
  return (
    url.searchParams.has("code") ||
    url.searchParams.has("error") ||
    url.protocol === "dev.tasknotes.app:"
  );
}

export function cleanCallbackUrl(): void {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  const base = joinBase("");
  history.replaceState(null, "", base || "/");
}

function joinBase(path: string): string {
  const base = import.meta.env.BASE_URL;
  return `${base.endsWith("/") ? base : `${base}/`}${path}`;
}
