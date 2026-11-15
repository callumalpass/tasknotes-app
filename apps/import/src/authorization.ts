import { z } from "zod";

const KEY = "tasknotes-import.todoist-pkce";
const transactionSchema = z.object({
  state: z.string(),
  verifier: z.string(),
  created: z.number(),
  redirectUri: z.string(),
  clientId: z.string(),
});
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export async function challenge(verifier: string): Promise<string> {
  return base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
}
export function assertOrigin(origin: string): void {
  if (location.origin !== origin)
    throw new Error(
      `Open ${origin} to connect accounts. This build only authorizes its configured origin.`,
    );
}
export async function authorizeTodoist(configuration: {
  origin: string;
  callbackPath: string;
  metadataPath: string;
}): Promise<void> {
  assertOrigin(configuration.origin);
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const clientId = new URL(configuration.metadataPath, configuration.origin)
    .href;
  const redirectUri = new URL(configuration.callbackPath, configuration.origin)
    .href;
  const codeChallenge = await challenge(verifier);
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      state,
      verifier,
      clientId,
      redirectUri,
      created: Date.now(),
    }),
  );
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "data:read",
    state,
    response_type: "code",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  location.assign(`https://app.todoist.com/oauth/authorize?${params}`);
}
export function consumeTransaction(
  url: URL,
  storage: Pick<Storage, "getItem" | "removeItem"> = sessionStorage,
  now = Date.now(),
) {
  const saved = storage.getItem(KEY);
  storage.removeItem(KEY);
  if (!saved)
    throw new Error(
      "This sign-in has no matching browser session. Start again.",
    );
  const tx = transactionSchema.parse(JSON.parse(saved));
  if (
    url.searchParams.get("state") !== tx.state ||
    now - tx.created > 600_000 ||
    now < tx.created ||
    `${url.origin}${url.pathname}` !== tx.redirectUri
  )
    throw new Error("Sign-in verification failed or expired. Start again.");
  if (url.searchParams.has("error"))
    throw new Error(
      "Todoist authorization was declined or unavailable. You can try again.",
    );
  const code = url.searchParams.get("code");
  if (!code) throw new Error("Todoist did not return an authorization code.");
  return { ...tx, code };
}
export async function completeTodoist(url: URL): Promise<string> {
  const tx = consumeTransaction(url);
  const response = await fetch("https://api.todoist.com/oauth/access_token", {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: tx.clientId,
      redirect_uri: tx.redirectUri,
      code: tx.code,
      code_verifier: tx.verifier,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok)
    throw new Error(
      `Todoist sign-in exchange failed (${response.status}). Start again.`,
    );
  const token = z
    .object({
      access_token: z.string().min(1),
      token_type: z.string(),
      scope: z.string().optional(),
    })
    .parse(await response.json());
  if (token.token_type.toLowerCase() !== "bearer")
    throw new Error("Unexpected Todoist token type.");
  if (token.scope && !token.scope.split(/[ ,]+/).includes("data:read"))
    throw new Error("Todoist did not grant read access.");
  // Do not persist access or refresh tokens. Reloading deliberately requires sign-in.
  return token.access_token;
}
