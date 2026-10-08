import intake from "../../vendor/mdbase-app-local-b3e605ac.json";

/** Static content-addressed Vite asset. Importing this module opens NOTHING. */
const artifactUrl = new URL(
  "../../vendor/mdbase-app-runtime-b3e605ac.wasm",
  import.meta.url,
).href;
const unavailable = () =>
  new Error("Local runtime artifact unavailable. Preserve storage and reopen.");
const REQUIRED_EXPORTS = [
  "rt_app_open",
  "rt_app_device_open",
  "rt_app_device_adopt",
  "rt_app_log_generation",
  "rt_app_shutdown",
];

/** Dedicated Worker only, after installation ownership. Returns a fresh
 * owned byte buffer on every call. SDK constructs a fresh native instance;
 * an instantiated app runtime is single-use, even after retirement.
 * No instantiate/SQL/identity/collection fallback or bootstrap is performed here.
 * Artifact SHA-256 is file integrity, never a client-key approval fingerprint.
 */
export async function loadLocalRuntimeArtifact(
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const check = () => {
    if (signal?.aborted) throw unavailable();
  };
  try {
    if (typeof window !== "undefined") throw unavailable();
    check();
    const response = await fetch(artifactUrl, {
      signal,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    check();
    if (!response.ok || response.redirected || !response.body)
      throw unavailable();
    const size = response.headers.get("Content-Length");
    if (
      size !== null &&
      (!/^\d+$/u.test(size) || Number(size) > intake.wasm.bytes)
    )
      throw unavailable();
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      check();
      if (done) break;
      if (value.byteLength > intake.wasm.bytes - total) throw unavailable();
      chunks.push(value.slice());
      total += value.byteLength;
    }
    if (total !== intake.wasm.bytes) throw unavailable();
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    check();
    const hex = Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (hex !== intake.wasm.sha256) throw unavailable();
    const module = await WebAssembly.compile(bytes);
    check();
    const exports = new Set(
      WebAssembly.Module.exports(module)
        .filter((item) => item.kind === "function")
        .map((item) => item.name),
    );
    if (REQUIRED_EXPORTS.some((name) => !exports.has(name)))
      throw unavailable();
    return bytes;
  } catch {
    throw unavailable();
  } finally {
    if (reader) {
      void reader.cancel().catch(() => {});
      try {
        reader.releaseLock();
      } catch {
        /* no native resource has been opened */
      }
    }
  }
}
