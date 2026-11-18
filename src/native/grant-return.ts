/**
 * Private collection grants approved from the Android app (#492).
 *
 * The approval runs in the system browser (a Custom Tab), so Connect's grant
 * redirect opens TaskNotes' web page there, not in the app. That page cannot
 * reach the app's waiting SDK owner, so for a grant the app asked for (the
 * redirect carries `via=app`) it hands `state` and `code` to the app through
 * its private-use scheme. The app rebuilds the declared https redirect and
 * passes it to the SDK, which checks `state` and exchanges the code with the
 * PKCE verifier only it holds: the code alone grants nothing (RFC 8252 §8.1).
 */

export const TASKNOTES_NATIVE_GRANT_HANDOFF_URL =
  "dev.tasknotes.app://auth/mdbase/grant";

const VIA = "via";
const APP = "app";

/** The manifest's grant redirect for the app, when this build declares one. */
export function nativeGrantReturnUrl(manifest: {
  readonly homepage: string;
  readonly redirect_uris: readonly string[];
}): string | null {
  const expected = new URL(
    `auth/mdbase/callback?${VIA}=${APP}`,
    manifest.homepage,
  ).href;
  return manifest.redirect_uris.includes(expected) ? expected : null;
}

function grantResult(params: URLSearchParams): URLSearchParams | null {
  const state = params.get("state");
  if (!state || (!params.has("code") && !params.has("error"))) return null;
  const result = new URLSearchParams();
  for (const [key, value] of params) if (key !== VIA) result.append(key, value);
  return result;
}

/** On the web page: where to send a grant result the app is waiting for. */
export function nativeGrantHandoff(url: URL): string | null {
  if (url.searchParams.get(VIA) !== APP) return null;
  const result = grantResult(url.searchParams);
  return result ? `${TASKNOTES_NATIVE_GRANT_HANDOFF_URL}?${result}` : null;
}

/** In the app: the https redirect the SDK is waiting for, or null when the
 * opened URL is not a grant hand-off. */
export function grantCallbackFromHandoff(
  value: string,
  grantReturnUrl: string,
): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "dev.tasknotes.app:" ||
    url.host !== "auth" ||
    url.pathname !== "/mdbase/grant" ||
    url.username ||
    url.password ||
    url.hash
  )
    return null;
  const result = grantResult(url.searchParams);
  if (!result) return null;
  const callback = new URL(grantReturnUrl);
  for (const [key, value] of result) callback.searchParams.append(key, value);
  return callback.href;
}
