import sqliteInit, { type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import sqliteWasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import {
  AppBinaryIndexHost,
  appSqlHost,
  openAppSahpoolIndex,
} from "@mdbase-dev/obsidian-runtime/app-storage";
import type { AppReplicaScope, AppSqlLifetime } from "@mdbase-dev/sdk/app-host";
import { fetchBundledAsset } from "./next-bundled-asset";

const SQLITE_WASM_SHA256 =
  "2ee8f3dab694532afc8840e07703127287662d08b74e6ff50491ce63f00d5752";

/** Called only by the original owned Worker after protected bootstrap. */
export async function openNextCollectionSql({
  scope,
  signal,
}: {
  scope: Readonly<AppReplicaScope>;
  signal: AbortSignal;
}) {
  signal.throwIfAborted();
  if (
    typeof WorkerGlobalScope === "undefined" ||
    !(globalThis instanceof WorkerGlobalScope)
  )
    throw new Error("Native SQL requires the original Worker.");
  const bytes = await fetchBundledAsset(
    sqliteWasmUrl,
    SQLITE_WASM_SHA256,
    1_100_000,
    signal,
  );
  signal.throwIfAborted();
  // The upstream JS accepts Emscripten options although its public declaration
  // omits the argument. Supply only verified bytes and content-free logging.
  const initialize = sqliteInit as unknown as (options: {
    wasmBinary: Uint8Array;
    print(): void;
    printErr(): void;
  }) => Promise<Sqlite3Static>;
  const sqlite = await initialize({
    wasmBinary: bytes,
    print() {},
    printErr() {},
  });
  signal.throwIfAborted();
  const { index, pool } = await openAppSahpoolIndex(sqlite, scope);
  const binary = new AppBinaryIndexHost(index);
  const sql: AppSqlLifetime = {
    import: (exports) => appSqlHost(binary, exports),
    fence: () => binary.fence(),
    get needsRecovery() {
      return binary.needsRecovery;
    },
  };
  let closing: Promise<void> | null = null;
  const close = () =>
    (closing ??= Promise.resolve().then(async () => {
      try {
        // A failed close stays failed: no retry can certify an uncertain shutdown.
        index.close();
        await pool.pauseVfs();
      } catch (error) {
        binary.fence();
        throw error;
      }
    }));
  if (signal.aborted) {
    binary.fence();
    await close();
    signal.throwIfAborted();
  }
  return {
    sql,
    opened: (
      { Fresh: "fresh", Existing: "existing", Unclean: "unclean" } as const
    )[index.info.opened],
    sqliteVersion: index.info.sqliteVersion,
    close,
  };
}
