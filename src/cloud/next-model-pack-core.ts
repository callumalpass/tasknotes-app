import { init } from "mdbase";
import wasmUrl from "mdbase/wasm/mdbase-core.wasm?url";
import pin from "../../vendor/mdbase-browser.pin.json";
import { fetchBundledAsset } from "./next-bundled-asset";

let initialized: Promise<void> | undefined;

/** Call BEFORE every use of the imported pure pack helpers. Verified local
 * bytes only: no implicit package fetch, alternate runtime or readiness grant.
 */
export async function initializeModelPackCore(
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  if (!initialized) {
    const loading = (async () => {
      const bytes = await fetchBundledAsset(
        wasmUrl,
        pin.wasmSha256,
        pin.wasmBytes,
        signal,
      );
      signal.throwIfAborted();
      await init({ wasm: bytes });
      signal.throwIfAborted();
    })();
    initialized = loading;
    // A later explicit call may try the same pinned asset after a failure.
    // There is no automatic retry, default URL or substitute module.
    void loading.catch(() => {
      if (initialized === loading) initialized = undefined;
    });
  }
  await initialized;
  signal.throwIfAborted();
}
