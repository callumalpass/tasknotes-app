/**
 * Real `runtime.wasm` (the vendored SDK's native Core) opened as an unsynced
 * local collection in Node, on an in-memory SQLite database through the SDK's
 * own app-storage adapter. The browser app does the same over OPFS in a Worker;
 * only the SQLite VFS differs. No network, log, account or trust pins.
 */
import { readFile } from "node:fs/promises";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import {
  connect,
  encode,
  inProcessConnector,
  toValue,
  type MdbaseClient,
} from "@mdbase-dev/sdk";
import { AppWasmRuntime } from "@mdbase-dev/sdk/app-host";
import {
  AppBinaryIndexHost,
  AppSqliteIndex,
  appSqlHost,
  SqliteIndex,
} from "@mdbase-dev/sdk/app-storage";
import {
  buildTaskNotesMdbaseResources,
  type TaskNotesMdbaseOptions,
} from "@tasknotes/model/mdbase";

const RUNTIME = new URL(
  "../../../node_modules/@mdbase-dev/sdk/dist/native/runtime.wasm",
  import.meta.url,
);

// sqlite-wasm ships no usable types for its initializer result.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sqlite: Promise<any> | null = null;
let runtimeBytes: Promise<Buffer> | null = null;

export interface Replica {
  client: MdbaseClient;
  runtime: AppWasmRuntime;
  resources: ReturnType<typeof buildTaskNotesMdbaseResources>;
  contract: { id: string; version: string };
  close(): Promise<void>;
}

export async function openReplica(
  options: { modelConfig?: TaskNotesMdbaseOptions["modelConfig"] } = {},
): Promise<Replica> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sqlite ??= (sqlite3InitModule as any)({ print() {}, printErr() {} });
  runtimeBytes ??= readFile(RUNTIME);
  const s = await sqlite;
  const db = new s.oo1.DB(":memory:");
  const inner = SqliteIndex.open(s, db, { synchronous: "FULL" });
  const index = new AppSqliteIndex(inner);
  const binary = new AppBinaryIndexHost(index);
  const runtime = await AppWasmRuntime.create(
    new Uint8Array(await runtimeBytes),
    {
      import: (exports) => appSqlHost(binary, exports),
      fence: () => binary.fence(),
      get needsRecovery() {
        return binary.needsRecovery;
      },
    },
  );
  runtime.openUnsyncedConsuming({
    collection: crypto.randomUUID(),
    replicaId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    opened: "fresh",
    sqliteVersion: inner.info.sqliteVersion,
  });
  const client = await connect({
    connector: inProcessConnector(runtime),
    app: { name: "contract-view-spike", version: "0" },
    reconnect: false,
  });
  const resources = buildTaskNotesMdbaseResources({
    profiles: ["core-lite"],
    modelConfig: options.modelConfig,
  });
  // Same documents the app's setup writes: config, contract, schemas, type.
  for (const key of [
    "config",
    "contract",
    "taskSchema",
    "bindingSchema",
    "type",
  ] as const) {
    const path = resources.paths[key];
    const doc = resources[`${key}Document`];
    const existing = await client.resources.get(path).catch(() => null);
    await client.resources.put(
      path,
      doc,
      existing ? { baseRevision: existing.revision } : { mustNotExist: true },
    );
  }
  const contract = {
    id: resources.contract.id as string,
    version: resources.contract.version as string,
  };
  return {
    client,
    runtime,
    resources,
    contract,
    async close() {
      client.close?.();
      runtime.dispose();
      index.close();
    },
  };
}

/** JSON with Maps flattened, for printing. */
export function show(value: unknown, space?: number) {
  return JSON.stringify(
    value,
    (_k, v) =>
      v instanceof Map
        ? Object.fromEntries(v)
        : typeof v === "bigint"
          ? String(v)
          : v,
    space,
  );
}

export interface SeedRecord {
  path: string;
  frontmatter: Record<string, unknown>;
  body?: string;
  /** Give the record the `task` type explicitly (default true). */
  typed?: boolean;
}

/** Create raw records, as another client would have written them, in
 * mutations of `batch` creates. Returns record IDs in input order. */
export async function seed(
  client: MdbaseClient,
  records: SeedRecord[],
  batch = 100,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < records.length; i += batch) {
    const ops = records.slice(i, i + batch).map((r) => {
      const id = uuidv7();
      ids.push(id);
      return {
        kind: "create" as const,
        id,
        path: r.path,
        ...(r.typed === false ? {} : { type: "task" }),
        frontmatter: new Map(
          Object.entries(r.frontmatter).map(([k, v]) => [
            k,
            toValue(v as never),
          ]),
        ),
        body: r.body ?? "",
      };
    });
    const writes = await client.submit(ops as never);
    for (const w of writes)
      if (w.receipt.status !== "applied")
        throw new Error(`seed refused: ${show(w.receipt)}`);
  }
  return ids;
}

function uuidv7(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++)
    b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Ordinary TaskNotes frontmatter for task `i`, ~200 bytes encoded. */
export function plainTask(i: number): Record<string, unknown> {
  return {
    id: `task-${i}`,
    title: `Task number ${i}`,
    status: i % 3 === 0 ? "done" : "open",
    priority: ["low", "normal", "high"][i % 3],
    due: `2026-12-${String((i % 28) + 1).padStart(2, "0")}`,
    tags: ["task"],
    projects: [`[[Project ${i % 7}]]`],
    dateCreated: "2026-01-01T00:00:00.000Z",
    dateModified: "2026-01-02T00:00:00.000Z",
    // The app's model refuses a done, non-recurring task without one.
    ...(i % 3 === 0 ? { completedDate: "2026-01-02" } : {}),
  };
}

/** Encoded CBOR size of a record's frontmatter, as the replica stores it. */
export function encodedSize(frontmatter: Record<string, unknown>): number {
  return encode(
    new Map(
      Object.entries(frontmatter).map(([k, v]) => [k, toValue(v as never)]),
    ),
  ).byteLength;
}
