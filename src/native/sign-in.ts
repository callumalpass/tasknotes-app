import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import type { Mdbase } from "@mdbase-dev/sdk";

export const TASKNOTES_NATIVE_RETURN_URL =
  "dev.tasknotes.app://auth/mdbase/callback";

export const nativeSignIn = {
  returnUrl: TASKNOTES_NATIVE_RETURN_URL,
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

/** Warm and cold returns wake the SAME SDK owner; never exchange URL codes. */
export function followNativeSignInReturn(mdbase: Mdbase): () => void {
  let active = true;
  const returned = (url: string) => {
    if (!active || !isNativeSignInReturn(url)) return;
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
