import type { AppReplicaScope } from "@mdbase-dev/sdk/app-host";
const database = "tasknotes.native-collection-join.v1",
  store = "original-join";
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const failure = () =>
  Object.assign(new Error("Preserve the original collection join."), {
    reason: "recovery_required",
  });
/** An explicit approved selection starts ONE durable join operation before HTTP.
 * Missing protected SDK custody is never adopted as a fresh outcome: that SDK
 * gate still independently refuses a fresh open if protected state exists. */
export async function collectionJoinIntent(
  scope: AppReplicaScope,
  signal: AbortSignal,
  change: "prepare" | "complete",
): Promise<"fresh" | "existing"> {
  signal.throwIfAborted();
  const binding = Object.freeze({
    account: scope.account,
    installation: scope.installation,
    collection: scope.collection,
  });
  if (
    Object.values(binding).some(
      (id) => !uuid.test(id) || id === "00000000-0000-0000-0000-000000000000",
    )
  )
    throw failure();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    let abandoned = false;
    request.onupgradeneeded = () => request.result.createObjectStore(store);
    request.onblocked = request.onerror = () => {
      abandoned = true;
      reject(failure());
    };
    request.onsuccess = () => {
      if (abandoned) request.result.close();
      else resolve(request.result);
    };
  });
  try {
    signal.throwIfAborted();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite", { durability: "strict" });
      const abort = () => tx.abort();
      signal.addEventListener("abort", abort, { once: true });
      let mode: "fresh" | "existing" = "existing",
        reason: unknown;
      const finish = () => signal.removeEventListener("abort", abort);
      tx.onabort = tx.onerror = () => {
        finish();
        reject(reason ?? failure());
      };
      tx.oncomplete = () => {
        finish();
        try {
          signal.throwIfAborted();
          resolve(mode);
        } catch (error) {
          reject(error);
        }
      };
      const records = tx.objectStore(store),
        key = JSON.stringify(Object.values(binding)),
        request = records.get(key);
      request.onsuccess = () => {
        try {
          const previous = request.result;
          if (previous === undefined) {
            if (change !== "prepare") throw failure();
            records.add({ version: 1, ...binding, phase: "attempted" }, key);
            mode = "fresh";
          } else {
            if (
              !previous ||
              Object.keys(previous).sort().join() !==
                "account,collection,installation,phase,version" ||
              previous.version !== 1 ||
              Object.entries(binding).some(([k, v]) => previous[k] !== v) ||
              !["attempted", "completed"].includes(previous.phase)
            )
              throw failure();
            if (change === "complete")
              records.put({ ...previous, phase: "completed" }, key);
          }
        } catch (error) {
          reason = error;
          tx.abort();
        }
      };
    });
  } finally {
    db.close();
  }
}
