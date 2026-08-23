import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import {
  MdbaseBrowserSelection,
  MdbaseConnect,
  type ConnectRequestOptions,
  type JsonObject,
  type MdbaseAppManifest,
  type MdbaseConnectionInfo,
} from "@mdbase-dev/connect";
import bundledManifest from "../generated/mdbase-app.json";
import { requireConnectOutcome } from "./outcome";
import { TASKNOTES_REQUEST_BUDGETS } from "./request-budgets";

const serverUrl =
  import.meta.env.VITE_MDBASE_CONNECT_URL ?? "https://connect.mdbase.dev";
const loopbackUrl =
  import.meta.env.VITE_MDBASE_CONNECT_LOOPBACK_URL ?? "http://127.0.0.1:28485";
const manifest =
  import.meta.env.VITE_MDBASE_MANIFEST_URL ??
  (import.meta.env.MODE === "e2e"
    ? `${location.origin}${joinBase(".well-known/mdbase-app.json")}`
    : (bundledManifest as MdbaseAppManifest));
const redirectUri = Capacitor.isNativePlatform()
  ? "dev.tasknotes.app://auth/mdbase/callback"
  : `${location.origin}${joinBase("auth/mdbase/callback")}`;

export const cloudConnect = new MdbaseConnect<JsonObject>({
  serverUrl,
  loopbackUrl,
  manifest,
  redirectUri,
  timeouts: {
    requestMs: TASKNOTES_REQUEST_BUDGETS.foregroundMs,
    watchStartMs: TASKNOTES_REQUEST_BUDGETS.watchStartMs,
    uploadMs: TASKNOTES_REQUEST_BUDGETS.uploadMs,
    syncMs: TASKNOTES_REQUEST_BUDGETS.syncMs,
  },
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

export async function startCloudSession(
  options?: ConnectRequestOptions,
): Promise<void> {
  requireConnectOutcome(await cloudSession.start(options));
}

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
