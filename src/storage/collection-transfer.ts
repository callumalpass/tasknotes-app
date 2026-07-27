import { unwrapOperation, type MdbaseConnection } from "@mdbase/connect";
import type {
  JsonObject,
  MdbaseOperationEnvelope,
  SyncRecord,
} from "@mdbase/connect-protocol";
import {
  IndexedDbReplicaStore,
  OfflineReplica,
  type ReplicaStore,
} from "@mdbase/connect-sync";

import { resolveTaskCollection } from "./tasknotes-collection";

import type { CollectionRecord } from "../domain/completion";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskViewSourceDocument } from "../domain/view";
import type { MarkdownCollection } from "./collection";

export type CollectionTransferPhase =
  "reading" | "checking" | "copying" | "views" | "verifying";

export interface CollectionTransferProgress {
  phase: CollectionTransferPhase;
  completed: number;
  total: number;
}

export interface CollectionTransferResult {
  records: number;
  views: number;
  destinationCollectionId: string;
}

export async function transferLocalCollectionToHosted({
  source,
  destination,
  onProgress,
  replicaStore,
}: {
  source: MarkdownCollection;
  destination: MdbaseConnection<JsonObject>;
  onProgress?(progress: CollectionTransferProgress): void;
  replicaStore?: ReplicaStore<JsonObject>;
}): Promise<CollectionTransferResult> {
  const info = destination.info();
  if (!info || info.route !== "remote")
    throw new Error(
      "Choose a collection hosted by mdbase. Collections on a connected computer are not hosted storage.",
    );
  const sync = destination.sync();
  if (!sync)
    throw new Error(
      "This hosted collection does not provide writable offline sync.",
    );

  onProgress?.({ phase: "reading", completed: 0, total: 1 });
  await source.initialize();
  const [records, viewSources, sourceConfiguration] = await Promise.all([
    source.listCollectionRecords(),
    readLocalViewSources(source),
    Promise.resolve(source.taskConfiguration()),
  ]);
  onProgress?.({ phase: "reading", completed: 1, total: 1 });

  const store =
    replicaStore ??
    new IndexedDbReplicaStore<JsonObject>(
      transferStoreKey(source.identifier(), sync.collectionId, sync.replicaId),
      {
        replicaId: sync.replicaId,
        records: {},
        pending: [],
        conflicts: {},
      },
    );
  const replica = new OfflineReplica<JsonObject>(sync.transport, store);
  const cachedResources = await replica.collectionResources();
  if (cachedResources) await replica.pull();
  else await replica.initialize();
  const resources = await replica.collectionResources();
  if (!resources)
    throw new Error("The hosted collection has no TaskNotes definition.");
  const destinationTask = resolveTaskCollection(resources);

  assertCompatibleConfiguration(
    sourceConfiguration,
    destinationTask.model.configuration(),
  );
  const expected = await transferRecords(
    source.identifier(),
    records,
    destinationTask.typeName,
  );
  assertSupportedTypes(
    expected,
    new Set(resources.types.map((type) => type.name)),
  );

  onProgress?.({ phase: "checking", completed: 0, total: expected.length });
  const existing = await replica.records();
  assertResumableDestination(existing, expected);
  const existingIds = new Set(existing.map((record) => record.record_id));
  onProgress?.({
    phase: "checking",
    completed: expected.length,
    total: expected.length,
  });

  let queued = 0;
  const missing = expected.filter(
    (record) => !existingIds.has(record.record_id),
  );
  for (const record of missing) {
    await replica.queueCreate({
      recordId: record.record_id,
      path: record.path,
      frontmatter: record.frontmatter,
      body: record.body,
      types: record.types,
    });
    queued += 1;
    onProgress?.({
      phase: "copying",
      completed: expected.length - missing.length + queued,
      total: expected.length,
    });
  }
  if (!missing.length)
    onProgress?.({
      phase: "copying",
      completed: expected.length,
      total: expected.length,
    });

  await replica.sync();
  const conflicts = await replica.conflicts();
  if (conflicts.length)
    throw new Error(
      "The hosted collection changed during the transfer. The copied records remain recoverable; retry after reviewing the destination.",
    );

  await copyViewSources(destination, viewSources, onProgress);

  onProgress?.({
    phase: "verifying",
    completed: 0,
    total: expected.length + viewSources.length,
  });
  await replica.pull();
  assertTransferredRecords(await replica.records(), expected);
  await verifyViewSources(destination, viewSources);
  onProgress?.({
    phase: "verifying",
    completed: expected.length + viewSources.length,
    total: expected.length + viewSources.length,
  });

  return {
    records: expected.length,
    views: viewSources.length,
    destinationCollectionId: sync.collectionId,
  };
}

async function readLocalViewSources(
  source: MarkdownCollection,
): Promise<TaskViewSourceDocument[]> {
  return Promise.all(
    (await source.listViewSources()).map((entry) =>
      source.readViewSource(entry.path),
    ),
  );
}

async function transferRecords(
  sourceId: string,
  records: CollectionRecord[],
  destinationTaskType: string,
): Promise<Array<SyncRecord<JsonObject>>> {
  const result: Array<SyncRecord<JsonObject>> = [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const record of records) {
    const recordId = await stableRecordId(sourceId, record);
    if (ids.has(recordId))
      throw new Error(
        `The local collection contains the same record identity more than once: ${recordId}.`,
      );
    if (paths.has(record.path))
      throw new Error(
        `The local collection contains the same path more than once: ${record.path}.`,
      );
    ids.add(recordId);
    paths.add(record.path);
    result.push({
      record_id: recordId,
      path: record.path,
      revision: "transfer:source",
      frontmatter: structuredClone(record.frontmatter) as JsonObject,
      body: record.body ?? "",
      types: mapRecordTypes(record.types, destinationTaskType),
    });
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

function mapRecordTypes(
  sourceTypes: string[],
  destinationTaskType: string,
): string[] {
  return [
    ...new Set(
      sourceTypes.map((type) => (type === "task" ? destinationTaskType : type)),
    ),
  ];
}

async function stableRecordId(
  sourceId: string,
  record: CollectionRecord,
): Promise<string> {
  const declared = record.frontmatter.id;
  if (typeof declared === "string" && UUID.test(declared)) return declared;
  const input = new TextEncoder().encode(`${sourceId}\0${record.path}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest.slice(0, 16)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertCompatibleConfiguration(
  source: TaskCollectionConfiguration,
  destination: TaskCollectionConfiguration,
): void {
  if (canonical(source) === canonical(destination)) return;
  throw new Error(
    "This local collection has TaskNotes model settings that differ from the hosted collection. Move it after the hosted type contract supports those settings.",
  );
}

function assertSupportedTypes(
  records: Array<SyncRecord<JsonObject>>,
  supported: Set<string>,
): void {
  const missing = [
    ...new Set(
      records.flatMap((record) =>
        record.types.filter((type) => !supported.has(type)),
      ),
    ),
  ].sort();
  if (!missing.length) return;
  throw new Error(
    `The hosted collection does not provide these local record types: ${missing.join(", ")}.`,
  );
}

function assertResumableDestination(
  existing: Array<SyncRecord<JsonObject>>,
  expected: Array<SyncRecord<JsonObject>>,
): void {
  const expectedById = new Map(
    expected.map((record) => [record.record_id, record]),
  );
  for (const record of existing) {
    const source = expectedById.get(record.record_id);
    if (!source || !sameRecord(record, source))
      throw new Error(
        "Move to an empty hosted collection. The selected destination already contains different records.",
      );
  }
}

function assertTransferredRecords(
  actual: Array<SyncRecord<JsonObject>>,
  expected: Array<SyncRecord<JsonObject>>,
): void {
  if (actual.length !== expected.length)
    throw new Error(
      "The hosted collection did not contain the expected number of records after transfer.",
    );
  const actualById = new Map(
    actual.map((record) => [record.record_id, record]),
  );
  for (const source of expected) {
    const transferred = actualById.get(source.record_id);
    if (!transferred || !sameRecord(transferred, source))
      throw new Error(
        `The hosted copy of ${source.path} did not match the local record.`,
      );
  }
}

function sameRecord(
  left: SyncRecord<JsonObject>,
  right: SyncRecord<JsonObject>,
): boolean {
  return (
    left.path === right.path &&
    left.body === right.body &&
    canonical(left.frontmatter) === canonical(right.frontmatter) &&
    canonical([...left.types].sort()) === canonical([...right.types].sort())
  );
}

async function copyViewSources(
  destination: MdbaseConnection<JsonObject>,
  sources: TaskViewSourceDocument[],
  onProgress?: (progress: CollectionTransferProgress) => void,
): Promise<void> {
  const existing = validated(await destination.listViews()).views;
  const existingPaths = new Set(existing.map((view) => view.source.path));
  let completed = 0;
  for (const source of sources) {
    if (existingPaths.has(source.path)) {
      const current = validated(
        await destination.readViewSource({ path: source.path }),
      );
      if (current.document !== source.document)
        throw new Error(
          `The hosted collection already has a different saved view at ${source.path}.`,
        );
    } else {
      validated(
        await destination.createViewSource({
          path: source.path,
          format: source.format,
          document: source.document,
        }),
      );
    }
    completed += 1;
    onProgress?.({
      phase: "views",
      completed,
      total: sources.length,
    });
  }
  if (!sources.length) onProgress?.({ phase: "views", completed: 0, total: 0 });
}

async function verifyViewSources(
  destination: MdbaseConnection<JsonObject>,
  sources: TaskViewSourceDocument[],
): Promise<void> {
  for (const source of sources) {
    const current = validated(
      await destination.readViewSource({ path: source.path }),
    );
    if (current.document !== source.document)
      throw new Error(
        `The hosted copy of ${source.path} did not match the local saved view.`,
      );
  }
}

function validated<Result>(envelope: MdbaseOperationEnvelope<Result>): Result {
  if (!envelope.valid)
    throw new Error(
      envelope.diagnostics.map((diagnostic) => diagnostic.message).join(" ") ||
        "The hosted collection rejected the transfer.",
    );
  return unwrapOperation(envelope);
}

function transferStoreKey(
  sourceId: string,
  collectionId: string,
  replicaId: string,
): string {
  return `tasknotes-transfer:${sourceId}:${collectionId}:${replicaId}`;
}

function canonical(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)]),
  );
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
