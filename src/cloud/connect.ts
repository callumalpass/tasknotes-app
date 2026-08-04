import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import {
  MdbaseBrowserSelection,
  MdbaseConnect,
  type MdbaseConnectionInfo,
} from "@mdbase-dev/connect";

import type {
  JsonObject,
  MdbaseAppManifest,
} from "@mdbase-dev/connect-protocol";
import bundledManifest from "../generated/mdbase-app.json";

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
  relayEncryption:
    import.meta.env.MODE === "e2e" &&
    import.meta.env.VITE_MDBASE_REQUIRE_RELAY_ENCRYPTION !== "1"
      ? "disabled"
      : "required",
  navigate: Capacitor.isNativePlatform()
    ? async (url) => Browser.open({ url })
    : undefined,
});

const cloudSelection = new MdbaseBrowserSelection({
  fallbackPath: joinBase(""),
});

export const cloudSession = cloudConnect.application({
  selection: cloudSelection,
  autoSelect: "never",
});

export function cloudControlUrl(): string {
  return serverUrl;
}

export function isHostedCloudConnection(
  connection: Pick<MdbaseConnectionInfo, "authority">,
): boolean {
  return connection.authority.kind === "hosted";
}

export function isCloudCallback(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.searchParams.has("state") &&
      (url.searchParams.has("code") || url.searchParams.has("error"))
    );
  } catch {
    return false;
  }
}

function joinBase(path: string): string {
  const base = import.meta.env.BASE_URL;
  return `${base.endsWith("/") ? base : `${base}/`}${path}`;
}
