import site from "./generated/site.json";
import * as authorization from "./authorization";

export { base64url, challenge, consumeTransaction } from "./authorization";

export function assertOrigin(): void {
  authorization.assertOrigin(site.origin);
}

export function authorizeTodoist(): Promise<void> {
  return authorization.authorizeTodoist({
    origin: site.origin,
    metadataPath: "/oauth/todoist-client.json",
    callbackPath: "/auth/todoist/callback",
  });
}

export function completeTodoist(): Promise<string> {
  const url = new URL(location.href);
  history.replaceState(null, "", "/");
  return authorization.completeTodoist(url);
}
