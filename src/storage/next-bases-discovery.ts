import type { wire } from "@mdbase-dev/sdk";

/** Identity supplied by native discovery, never recovered from path/name. */
export interface NativeViewIdentity {
  record: wire.Uuid;
  path: string;
  sourceRevision: wire.Hash;
  ordinal: number;
}

export interface NativeDiscoveryPage<T extends NativeViewIdentity> {
  views: readonly T[];
  clock: wire.OpClock;
  collectionRevision: wire.Hash;
  continuation: Uint8Array | null;
}

export function nativeViewSelection(view: NativeViewIdentity) {
  return {
    record: view.record,
    sourceRevision: view.sourceRevision,
    ordinal: view.ordinal,
  };
}

/** Pure read-side sequencing of already SDK-decoded native success pages.
 * Native READ/fences/classification remain native; this is not authority proof.
 * Each yielded page is bounded by its native/SDK codec. No whole source reads,
 * catalog substitutes, name/path selectors or silent truncation on empty pages.
 * Callers publish a completed catalog only after exhausting this iterator.
 */
export async function* iterateNativeDiscovery<T extends NativeViewIdentity>(
  readPage: (
    continuation: Uint8Array | null,
  ) => Promise<NativeDiscoveryPage<T>>,
  signal: AbortSignal,
): AsyncIterable<readonly T[]> {
  let continuation: Uint8Array | null = null;
  let cut:
    Pick<NativeDiscoveryPage<T>, "collectionRevision" | "clock"> | undefined;
  let previous: NativeViewIdentity | undefined;
  do {
    signal.throwIfAborted();
    const page = await readPage(continuation);
    signal.throwIfAborted();
    if (
      cut &&
      (cut.collectionRevision !== page.collectionRevision ||
        cut.clock.instant !== page.clock.instant ||
        cut.clock.tz !== page.clock.tz ||
        cut.clock.localDate !== page.clock.localDate)
    )
      throw new Error("Native view discovery changed its captured cut.");
    for (const view of page.views) {
      if (
        previous &&
        (previous.record > view.record ||
          (previous.record === view.record &&
            (previous.ordinal >= view.ordinal ||
              previous.sourceRevision !== view.sourceRevision ||
              previous.path !== view.path)))
      )
        throw new Error("Native view discovery changed its source frontier.");
      previous = { ...nativeViewSelection(view), path: view.path };
    }
    // Do not retain entire earlier pages while continuing the bounded READ.
    cut ??= {
      collectionRevision: page.collectionRevision,
      clock: { ...page.clock },
    };
    continuation =
      page.continuation === null ? null : page.continuation.slice();
    yield page.views;
  } while (continuation !== null);
}
