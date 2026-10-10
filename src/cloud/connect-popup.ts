import type { AppWebSignInPortal } from "@mdbase-dev/sdk/app-host";

/** Reserve synchronously in the click, before Worker/device-flow awaits.
 * The SDK-validated first-party Connect popup keeps its production opener
 * relationship so the parent can close it after approval. No secrets, storage
 * callbacks or postMessage completion use that relationship. The tab fallback
 * is detached (noopener semantics). Worker navigation checks the CP origin.
 */
export function openConnectPopup(): AppWebSignInPortal {
  let popup: Window | null = null;
  try {
    popup = window.open(
      "",
      "mdbase-connect-authorization",
      "popup,width=620,height=760",
    );
  } catch {
    /* Try a tab. */
  }
  if (!popup) {
    try {
      popup = window.open("", "_blank");
      // Retain the blank handle to navigate after the Worker await, then detach
      // immediately. A literal noopener feature would return no usable handle.
      if (popup) popup.opener = null;
    } catch {
      try {
        popup?.close();
      } catch {
        /* Display cleanup only. */
      }
      popup = null;
    }
  }
  if (!popup) throw new Error("Your browser blocked the sign-in window.");
  const original = popup;
  let closed = false;
  return {
    navigate(uri) {
      if (closed || original.closed) throw new Error("Sign-in window closed.");
      original.location.href = uri;
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        original.close();
      } catch {
        /* Display cleanup does not undo approval. */
      }
    },
  };
}
