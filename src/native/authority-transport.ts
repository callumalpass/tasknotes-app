import { Capacitor, registerPlugin } from "@capacitor/core";
import { AUTHORITY_PROOF_HEADERS } from "@mdbase-dev/connect-protocol";

export interface NativeAuthorityHttp {
  request(options: {
    id: string;
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<{
    url: string;
    status: number;
    headers: Record<string, string>;
    body: string;
  }>;
  cancel(options: { id: string }): Promise<void>;
}

const nativeHttp = registerPlugin<NativeAuthorityHttp>(
  "TaskNotesAuthorityHttp",
);

/** Only the SDK's key-bound authority HTTP requests need a native origin. */
export function createNativeAuthorityFetch(
  browserFetch: typeof fetch,
  transport: NativeAuthorityHttp,
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const signedAuthorityRequest =
      url.protocol === "https:" &&
      /^\/v1\/authorities\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(operations|sync|files)(\/|$)/i.test(
        url.pathname,
      ) &&
      /^Bearer \S+$/i.test(request.headers.get("authorization") ?? "") &&
      Object.values(AUTHORITY_PROOF_HEADERS).every((header) =>
        request.headers.has(header),
      );
    if (!signedAuthorityRequest) return browserFetch(request);
    if (request.credentials === "include")
      throw new TypeError("Native authority requests cannot include cookies.");
    if (request.signal.aborted) throw abortReason(request.signal);
    const body = request.body
      ? encodeBytes(new Uint8Array(await request.arrayBuffer()))
      : undefined;
    if (request.signal.aborted) throw abortReason(request.signal);
    const id = crypto.randomUUID();
    let abort: () => void = () => undefined;
    try {
      const response = await new Promise<
        Awaited<ReturnType<NativeAuthorityHttp["request"]>>
      >((resolve, reject) => {
        abort = () => {
          reject(abortReason(request.signal));
          // Bridge calls are ordered. Cancel the actual URLSession task, not
          // merely the JS waiter: write-outcome/recovery budgets stay intact.
          void transport.cancel({ id }).catch(() => undefined);
        };
        request.signal.addEventListener("abort", abort, { once: true });
        void transport
          .request({
            id,
            url: request.url,
            method: request.method,
            headers: Object.fromEntries(request.headers),
            ...(body === undefined ? {} : { body }),
          })
          .then(resolve, reject);
      });
      if (request.signal.aborted) throw abortReason(request.signal);
      // Request proofs bind the exact target. Never forward credentials/proofs
      // through redirects, including same-host redirects to another path.
      if (
        response.url !== request.url ||
        (response.status >= 300 &&
          response.status < 400 &&
          response.status !== 304)
      )
        throw new TypeError(
          "Native authority requests cannot follow redirects.",
        );
      const empty =
        request.method === "HEAD" || [204, 205, 304].includes(response.status);
      const result = new Response(empty ? null : decodeBytes(response.body), {
        status: response.status,
        headers: response.headers,
      });
      Object.defineProperty(result, "url", { value: response.url });
      return result;
    } finally {
      request.signal.removeEventListener("abort", abort);
    }
  };
}

/** Native-only, proof-scoped replacement; ordinary web traffic is untouched. */
export function installNativeAuthorityTransport(): void {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios")
    return;
  window.fetch = createNativeAuthorityFetch(
    window.fetch.bind(window),
    nativeHttp,
  );
}

function abortReason(signal: AbortSignal): unknown {
  // The native deployment floor includes WebKit versions without throwIfAborted
  // or custom abort reasons. Preserve supplied reasons, otherwise use Fetch's
  // standard AbortError rather than depending on those newer APIs.
  return (
    signal.reason ?? new DOMException("The request was aborted.", "AbortError")
  );
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return btoa(binary);
}

function decodeBytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
