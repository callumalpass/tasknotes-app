/** Transport integrity only; release authentication precedes this fixed asset
 * intake. No redirects, ambient credentials or unbounded response allocation. */
export async function fetchBundledAsset(
  url: string,
  expectedHash: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  signal.throwIfAborted();
  const destination = new URL(url, globalThis.location.href);
  if (
    destination.origin !== globalThis.location.origin ||
    destination.search ||
    destination.hash ||
    !/^[0-9a-f]{64}$/.test(expectedHash) ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 3_300_000
  )
    throw new Error("Bundled asset binding failed.");
  const response = await globalThis.fetch(destination.href, {
    signal,
    credentials: "omit",
    redirect: "error",
  });
  if (!response.ok || !response.body)
    throw new Error("Bundled asset unavailable.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      length += next.value.length;
      if (length > maxBytes)
        throw new Error("Bundled asset exceeds its bound.");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  signal.throwIfAborted();
  if (!length || hash !== expectedHash)
    throw new Error("Bundled asset integrity failed.");
  return bytes;
}
