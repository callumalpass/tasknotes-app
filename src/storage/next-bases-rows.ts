import type { wire } from "@mdbase-dev/sdk";

export interface NativeRowIdentity {
  record: wire.Uuid;
  path: string;
  sourceRevision: wire.Hash;
}

/** Hydrate only selected native IDs using the original held client's READ.
 * No path lookup, full task-index load, body fallback, re-sort or row omission.
 * Native execution and each subsequent READ retain their own authority fences;
 * matching these identities is a consistency check, not new authority.
 */
export async function readNativeRows(
  rows: readonly NativeRowIdentity[],
  read: (id: wire.Uuid, signal: AbortSignal) => Promise<wire.RecordView>,
  owner: AbortSignal,
): Promise<wire.RecordView[]> {
  owner.throwIfAborted();
  const identities = rows.map(({ record, path, sourceRevision }) => ({
    record,
    path,
    sourceRevision,
  }));
  if (new Set(identities.map((row) => row.record)).size !== identities.length)
    throw new Error("Native view returned duplicate record identities.");
  const result = new Array<wire.RecordView>(identities.length);
  const stop = new AbortController();
  const signal = AbortSignal.any([owner, stop.signal]);
  let next = 0;
  const worker = async () => {
    try {
      while (next < identities.length) {
        signal.throwIfAborted();
        const index = next++;
        const identity = identities[index]!;
        const record = await read(identity.record, signal);
        signal.throwIfAborted();
        if (
          record.id !== identity.record ||
          record.path !== identity.path ||
          record.revision !== identity.sourceRevision
        )
          throw new Error("Native view row changed before task hydration.");
        result[index] = record;
      }
    } catch (reason) {
      stop.abort(reason);
      throw reason;
    }
  };
  // Fixed bounded fanout, independent of result size. Wait for all readers to
  // settle on failure so none can write into a returned partial execution.
  const outcomes = await Promise.allSettled(
    Array.from({ length: Math.min(8, identities.length) }, worker),
  );
  owner.throwIfAborted();
  const failed = outcomes.find((outcome) => outcome.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return result;
}
