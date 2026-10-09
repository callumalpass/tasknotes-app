import type { AppInstallationScope } from "@mdbase-dev/sdk/app-host";

export interface NextCollectionCreateIntent extends AppInstallationScope {
  readonly version: 1;
  readonly collection: string;
  readonly phase: "prepared" | "attempted" | "completed";
}
const database = "tasknotes.native-collection-create.v1";
const store = "original-creation";
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
function failure(reason: "recovery_required" | "outcome_unknown") {
  return Object.assign(
    new Error("Preserve the original collection creation."),
    { reason },
  );
}
function decode(
  value: unknown,
  scope: AppInstallationScope,
): NextCollectionCreateIntent {
  const r = value as NextCollectionCreateIntent;
  if (
    !r ||
    Object.keys(r).sort().join() !==
      "account,collection,installation,phase,version" ||
    r.version !== 1 ||
    r.account !== scope.account ||
    r.installation !== scope.installation ||
    !uuid.test(r.collection) ||
    r.collection === "00000000-0000-0000-0000-000000000000" ||
    !["prepared", "attempted", "completed"].includes(r.phase)
  )
    throw failure("recovery_required");
  return Object.freeze({ ...r });
}
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    let abandoned = false;
    request.onupgradeneeded = () => request.result.createObjectStore(store);
    request.onblocked = request.onerror = () => {
      abandoned = true;
      reject(failure("recovery_required"));
    };
    request.onsuccess = () => {
      if (abandoned) request.result.close();
      else resolve(request.result);
    };
  });
}
/** One active public creation target per installation, not a credential or
 * authority. Commit its identity before native/HTTP work. Only a completed intent
 * may advance on an explicit new create; uncertain targets are never replaced.
 * Native outcome custody stays in SDK.
 */
export async function collectionCreateIntent(
  scope: AppInstallationScope,
  signal: AbortSignal,
  change: "prepare" | "resume" | "attempt" | "complete",
): Promise<NextCollectionCreateIntent> {
  signal.throwIfAborted();
  if (!uuid.test(scope.account) || !uuid.test(scope.installation))
    throw failure("recovery_required");
  const binding = Object.freeze({
    account: scope.account,
    installation: scope.installation,
  });
  const db = await open();
  try {
    signal.throwIfAborted();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite", { durability: "strict" });
      const abort = () => tx.abort();
      signal.addEventListener("abort", abort, { once: true });
      let result: NextCollectionCreateIntent | undefined;
      let reason: unknown;
      const finish = () => signal.removeEventListener("abort", abort);
      tx.onerror = tx.onabort = () => {
        finish();
        reject(reason ?? failure("recovery_required"));
      };
      tx.oncomplete = () => {
        finish();
        try {
          signal.throwIfAborted();
          if (!result) throw failure("recovery_required");
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };
      const records = tx.objectStore(store);
      const key = JSON.stringify([binding.account, binding.installation]);
      const request = records.get(key);
      request.onsuccess = () => {
        try {
          let current =
            request.result === undefined
              ? undefined
              : decode(request.result, binding);
          if (
            !current ||
            (current.phase === "completed" && change === "prepare")
          ) {
            if (change !== "prepare") throw failure("recovery_required");
            // Preserve completed target metadata when advancing the active intent.
            if (current)
              records.put(
                current,
                JSON.stringify([
                  binding.account,
                  binding.installation,
                  current.collection,
                ]),
              );
            current = decode(
              {
                version: 1,
                ...binding,
                collection: crypto.randomUUID(),
                phase: "prepared",
              },
              binding,
            );
            records.put(current, key);
          }
          if (change === "attempt") {
            if (current.phase !== "prepared") throw failure("outcome_unknown");
            current = { ...current, phase: "attempted" };
            records.put(current, key);
          } else if (change === "complete") {
            if (current.phase === "prepared")
              throw failure("recovery_required");
            current = { ...current, phase: "completed" };
            records.put(current, key);
          }
          result = Object.freeze(current);
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
