import type { RecordView, wire } from "@mdbase-dev/sdk";

/** What a task summary needs from a row: its identity, catalog types and the
 * effective properties the summary decoder reads. */
export type NativeRowRecord = Pick<
  RecordView,
  "id" | "path" | "revision" | "types" | "frontmatter"
>;

export interface NativeRowIdentity {
  record: wire.Uuid;
  path: string;
  sourceRevision: wire.Hash;
}

/** A row as either SDK build returns it. The self-hosted entry's direct SDK
 * (vendor/sdk-self-hosted-*, built before `rowProperties`) neither types nor
 * projects these fields; drop the optional shape once it is rebuilt. */
export type MaybeProjectedRow = NativeRowIdentity & {
  types?: readonly string[];
  properties?: NativeRowRecord["frontmatter"];
};

/** Rows whose READ already projected catalog types and the requested effective
 * properties, so no per-row get follows. `null` when the rows carry no
 * projection (a replica or SDK without `rowProperties`): hydrate them instead. */
export function projectedNativeRows(
  rows: readonly MaybeProjectedRow[],
): NativeRowRecord[] | null {
  const projected = rows.filter(
    (row) => row.types !== undefined && row.properties !== undefined,
  );
  if (projected.length !== rows.length) {
    if (projected.length) throw new Error("Native view rows mix projections.");
    return null;
  }
  return rows.map((row) => ({
    id: row.record,
    path: row.path,
    revision: row.sourceRevision,
    types: [...row.types!],
    frontmatter: row.properties!,
  }));
}

/** Gets in flight while hydrating rows: the SDK's `readMany` bound. Through a
 * relayed connected computer every batch costs a round trip (#449). */
export const NATIVE_ROW_FANOUT = 16;

/** Hydrate only selected native IDs using the original held client's READ.
 * No path lookup, full task-index load, body fallback, re-sort or row omission.
 * Native execution and each subsequent READ retain their own authority fences;
 * matching these identities is a consistency check, not new authority.
 */
export async function readNativeRows(
  rows: readonly NativeRowIdentity[],
  read: (id: wire.Uuid, signal: AbortSignal) => Promise<RecordView>,
  owner: AbortSignal,
): Promise<RecordView[]> {
  owner.throwIfAborted();
  const identities = rows.map(({ record, path, sourceRevision }) => ({
    record,
    path,
    sourceRevision,
  }));
  if (new Set(identities.map((row) => row.record)).size !== identities.length)
    throw new Error("Native view returned duplicate record identities.");
  const result = new Array<RecordView>(identities.length);
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
    Array.from(
      { length: Math.min(NATIVE_ROW_FANOUT, identities.length) },
      worker,
    ),
  );
  owner.throwIfAborted();
  const failed = outcomes.find((outcome) => outcome.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return result;
}
