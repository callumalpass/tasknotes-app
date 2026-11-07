import { Capacitor } from "@capacitor/core";
import { nativeSignIn } from "../native/sign-in";
import {
  sealedCredentialStore,
  type CredentialStore,
} from "./session-credential";

/** The window Google's consent runs in, opened during the user's gesture. */
export interface AuthorizationWindow {
  show(url: string): void | Promise<void>;
  close(): void;
}

export interface CalendarServiceHost {
  clientKind: "web" | "ios" | "android";
  deviceName: string;
  /** Null on the web, where the session is an HttpOnly cookie. */
  credentials: CredentialStore | null;
  openWindow(): AuthorizationWindow | null;
}

export const webHost: CalendarServiceHost = {
  clientKind: "web",
  deviceName: "TaskNotes web",
  credentials: null,
  openWindow() {
    const popup = window.open(
      "about:blank",
      "_blank",
      "popup,width=520,height=720",
    );
    if (!popup) return null;
    // Sever the opener before navigating.
    popup.opener = null;
    let navigated = false;
    return {
      show(url) {
        popup.location.replace(url);
        navigated = true;
      },
      // Once navigated, COOP has severed the handle; the page says to close.
      close() {
        if (!navigated) popup.close();
      },
    };
  },
};

/** Google refuses OAuth in a WebView, so consent runs in the system browser. */
function nativeHost(platform: "ios" | "android"): CalendarServiceHost {
  return {
    clientKind: platform,
    deviceName: platform === "ios" ? "TaskNotes iOS" : "TaskNotes Android",
    credentials: sealedCredentialStore,
    openWindow: () => ({
      show: (url) => nativeSignIn.open(url),
      close: () => void nativeSignIn.close().catch(() => undefined),
    }),
  };
}

export function currentHost(): CalendarServiceHost {
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android"
    ? nativeHost(platform)
    : webHost;
}
