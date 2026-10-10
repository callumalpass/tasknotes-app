import sqliteInit from "@sqlite.org/sqlite-wasm";
import sqliteWasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import {
  AppWebSignInSession,
  createAppWebCollectionAdapter,
  selectAppEnvironment,
  type AppLockPort,
  type AppWebCollectionHandoff,
  type AppWebNativeCollection,
  type AppWebSignInPortal,
} from "@mdbase-dev/sdk/app-host";
import type { NextInstallationBuildInput } from "./next-installation-protocol";
import { fetchBundledAsset } from "./next-bundled-asset";

const SQLITE_WASM_SHA256 =
  "2ee8f3dab694532afc8840e07703127287662d08b74e6ff50491ce63f00d5752";

/** Trusted Worker configuration, not another HOST, SQL engine or auth owner.
 * The shared session retains leases and shutdown; the shared adapter retains
 * native join, SQL, drive, journal and its two public ports.
 */
export function createTaskNotesWebSignInSession({
  build,
  signal,
  locks,
  openPortal,
  handoff,
  requestedCreateCollections,
}: {
  build: NextInstallationBuildInput;
  signal: AbortSignal;
  locks: AppLockPort | undefined;
  openPortal(): AppWebSignInPortal;
  handoff(value: AppWebCollectionHandoff): void;
  requestedCreateCollections?: boolean;
}): AppWebSignInSession<AppWebNativeCollection> {
  signal.throwIfAborted();
  const selection = selectAppEnvironment({
    environment: build.environment,
    appOrigin: build.appOrigin,
    release: build.release,
  });
  // Caller already authenticated BUILD and checked its bounded artifact hash.
  // Capture bytes before yielding; no discovered runtime or mutable UI loan.
  const runtime = new Uint8Array(build.runtime);
  const fetch: typeof globalThis.fetch = (input, init) =>
    globalThis.fetch(input, init);
  const openCollection = createAppWebCollectionAdapter({
    joinDatabaseName: "tasknotes.native-collection-join.v1",
    setupJournal: {
      databaseName: "tasknotes.native-model-setup.v1",
      applicationNamespace: "tasknotes-web",
      appOrigin: build.appOrigin,
      cpOrigin: selection.cpOrigin,
    },
    sql: {
      wasmSha256: SQLITE_WASM_SHA256,
      maxWasmBytes: 1_100_000,
      loadWasm: ({ signal }) =>
        fetchBundledAsset(sqliteWasmUrl, SQLITE_WASM_SHA256, 1_100_000, signal),
      initialize: sqliteInit as unknown as (options: {
        wasmBinary: Uint8Array;
        print(): void;
        printErr(): void;
      }) => Promise<unknown>,
    },
    fetch,
    allowLoopbackHttp: selection.allowLoopbackHttp,
    handoff,
  });
  return new AppWebSignInSession({
    environment: build.environment,
    release: build.release,
    origin: build.appOrigin,
    cpOrigin: selection.cpOrigin,
    appId: build.appId,
    appName: build.appName,
    signal,
    locks,
    fetch,
    openPortal,
    openCollection,
    ...(requestedCreateCollections === undefined
      ? {}
      : { requestedCreateCollections }),
    loadRuntime: async ({ signal }) => {
      signal.throwIfAborted();
      return new Uint8Array(runtime);
    },
  });
}
