import { t } from "@lingui/core/macro";

import { directBackendOrigin } from "@tasknotes/direct-sdk/direct";

function invitationDescriptor(href: string, origin: string): string {
  const prefix = origin + "/#mdbase-pair=";
  if (!href.startsWith(prefix)) throw new Error("Invalid invitation site");
  const encoded = href.slice(prefix.length);
  if (/[#/?&=:]/u.test(encoded)) throw new Error("Invalid invitation");
  const descriptor = decodeURIComponent(encoded);
  if (!descriptor.includes("#sha256="))
    throw new Error("Missing invitation pin");
  return directBackendOrigin(descriptor);
}

export function serverDescriptor(input: string): string {
  const address = input.trim();
  return address.includes("#mdbase-pair")
    ? invitationDescriptor(address, location.origin)
    : directBackendOrigin(address);
}

// Remove the fragment even for a rejected invitation, before any route opens.
export function takePairInvitation(page: Window = window): string | undefined {
  const { hash, href, origin, protocol } = page.location;
  if (!hash.startsWith("#mdbase-pair")) return;
  page.history.replaceState(null, "", "/");
  if (page !== page.top || protocol !== "https:")
    throw new Error("Invalid invitation site");
  return invitationDescriptor(href, origin);
}

export function backendHost(server: string): string {
  try {
    return new URL(server).host;
  } catch {
    return "";
  }
}

// Following a second fragment on the same origin need not reload the document.
// Capture it before a workspace router sees the history navigation.
export function onPairInvitation(receive: (descriptor?: string) => void) {
  const handle = (event: Event) => {
    if (!location.hash.startsWith("#mdbase-pair")) return;
    event.stopImmediatePropagation();
    let descriptor;
    try {
      descriptor = takePairInvitation();
    } catch {
      receive();
      return;
    }
    if (descriptor) receive(descriptor);
  };
  window.addEventListener("popstate", handle, true);
  window.addEventListener("hashchange", handle, true);
  return () => {
    window.removeEventListener("popstate", handle, true);
    window.removeEventListener("hashchange", handle, true);
  };
}

export function confirmPairInvitation(server: string) {
  const host = backendHost(server);
  return window.confirm(
    t`Open the invitation from ${host}? This closes the current workspace and discards unsaved edits.`,
  );
}
