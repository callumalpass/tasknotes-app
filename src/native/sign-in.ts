import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import type { Mdbase } from "@mdbase-dev/sdk";
import manifest from "../generated/mdbase-app.json";
import { grantCallbackFromHandoff, nativeGrantReturnUrl } from "./grant-return";

export const TASKNOTES_NATIVE_RETURN_URL =
  "dev.tasknotes.app://auth/mdbase/callback";

const grantReturnUrl = nativeGrantReturnUrl(manifest);

export const nativeSignIn = {
  returnUrl: TASKNOTES_NATIVE_RETURN_URL,
  // Private collection grants come back through the web page's hand-off (#492).
  ...(grantReturnUrl ? { grantReturnUrl } : {}),
  open: (url: string) => Browser.open({ url }),
  close: () => Browser.close(),
};

export function isNativeSignInReturn(value: string): boolean {
  try {
    const url = new URL(value);
    // Query values are not credentials or authority here. The SDK completes
    // sign-in only through its original authenticated pairing poll.
    return (
      url.protocol === "dev.tasknotes.app:" &&
      url.host === "auth" &&
      url.pathname === "/mdbase/callback" &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/** Warm and cold returns wake the SAME SDK owner. Sign-in URL codes are never
 * exchanged here; a Private grant's hand-off goes to the SDK flow waiting for
 * it, which checks its state and holds the only PKCE verifier. */
export function followNativeSignInReturn(
  mdbase: Mdbase,
  deliverGrant: (url: string) => Promise<void> = async (url) =>
    (await import("@mdbase-dev/sdk/app-grant")).deliverAppGrantCallback(url),
): () => void {
  let active = true;
  const returned = (url: string) => {
    if (!active) return;
    const grant = grantReturnUrl
      ? grantCallbackFromHandoff(url, grantReturnUrl)
      : null;
    if (grant) void deliverGrant(grant).catch(() => undefined);
    else if (!isNativeSignInReturn(url)) return;
    void Browser.close().catch(() => undefined);
    mdbase.setForeground(true);
  };
  const listener = App.addListener("appUrlOpen", ({ url }) => returned(url));
  void App.getLaunchUrl()
    .then((launch) => {
      if (launch) returned(launch.url);
    })
    .catch(() => undefined);
  return () => {
    active = false;
    void listener.then((handle) => handle.remove()).catch(() => undefined);
  };
}
