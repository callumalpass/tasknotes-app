import type { MdbaseConnection } from "@mdbase/connect";
import type {
  JsonObject,
  CreateViewSourceInput,
  ReadViewSourceInput,
  SavedViewSourceDocument,
  SyncCollectionResources,
} from "@mdbase/connect-protocol";
import {
  MemoryAuthority,
  MemoryReplicaStore,
  type SyncTransport,
} from "@mdbase/connect-sync";
import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { describe, expect, it } from "vitest";

import { MemoryVault } from "../test/memory-vault";
import { MarkdownCollection } from "./collection";
import { transferLocalCollectionToHosted } from "./collection-transfer";

describe("local to hosted collection transfer", () => {
  it("preserves record identities, paths, bodies, and saved views", async () => {
    const source = await localCollection();
    const destination = await hostedDestination(source.collection);

    const result = await transferLocalCollectionToHosted({
      source: source.collection,
      destination: destination.connection,
      replicaStore: destination.store,
    });

    expect(result).toEqual({
      records: 2,
      views: 1,
      destinationCollectionId: destination.collectionId,
    });
    expect(
      destination.authority.serialize().records.map((record) => ({
        id: record.record_id,
        path: record.path,
        title: record.frontmatter.title,
        body: record.body,
      })),
    ).toEqual([
      {
        id: expect.stringMatching(UUID),
        path: "notes/context.md",
        title: undefined,
        body: "# Context\n\nLinked note.",
      },
      {
        id: source.taskId,
        path: "tasks/source.md",
        title: "Source task",
        body: "Keep this body.",
      },
    ]);
    expect(destination.views.get("views/tasks.base")?.document).toBe(
      await source.vault.readText("views/tasks.base"),
    );

    await expect(
      transferLocalCollectionToHosted({
        source: source.collection,
        destination: destination.connection,
        replicaStore: destination.store,
      }),
    ).resolves.toMatchObject({ records: 2, views: 1 });
  });

  it("refuses a different non-empty destination without changing the source", async () => {
    const source = await localCollection();
    const destination = await hostedDestination(source.collection);
    destination.authority.seed([
      {
        record_id: crypto.randomUUID(),
        path: "tasks/existing.md",
        frontmatter: { title: "Already here" },
        body: "",
        types: ["task"],
      },
    ]);

    await expect(
      transferLocalCollectionToHosted({
        source: source.collection,
        destination: destination.connection,
        replicaStore: destination.store,
      }),
    ).rejects.toThrow("Move to an empty hosted collection");

    expect(await source.vault.readText("tasks/source.md")).toContain(
      "Source task",
    );
  });

  it("retains queued records and resumes after an interrupted upload", async () => {
    const source = await localCollection();
    const destination = await hostedDestination(source.collection);
    let interrupted = false;
    const transport: SyncTransport<JsonObject> = {
      ...destination.transport,
      mutate: async (mutation) => {
        if (!interrupted) {
          interrupted = true;
          throw new Error("Connection interrupted");
        }
        return destination.transport.mutate(mutation);
      },
    };
    const connection = connectedDestination(
      destination.collectionId,
      destination.replicaId,
      transport,
      destination.views,
    );

    await expect(
      transferLocalCollectionToHosted({
        source: source.collection,
        destination: connection,
        replicaStore: destination.store,
      }),
    ).rejects.toThrow("Connection interrupted");

    await expect(
      transferLocalCollectionToHosted({
        source: source.collection,
        destination: destination.connection,
        replicaStore: destination.store,
      }),
    ).resolves.toMatchObject({ records: 2 });
    expect(destination.authority.serialize().records).toHaveLength(2);
  });
});

async function localCollection() {
  const vault = new MemoryVault();
  const collection = new MarkdownCollection(vault);
  await collection.initialize();
  const taskId = crypto.randomUUID();
  const task = await collection.createTask(
    {
      title: "Source task",
      body: "Keep this body.",
    },
    taskId,
    "2026-07-27T10:00:00.000Z",
  );
  task.path = "tasks/source.md";
  await collection.write(task);
  await vault.writeText("notes/context.md", "# Context\n\nLinked note.");
  await vault.writeText(
    "views/tasks.base",
    "views:\n  - type: table\n    name: Tasks\n",
  );
  return { collection, taskId, vault };
}

async function hostedDestination(source: MarkdownCollection) {
  const collectionId = crypto.randomUUID();
  const replicaId = crypto.randomUUID();
  const authority = new MemoryAuthority<JsonObject>({
    id: collectionId,
    resources: await resourcesFrom(source),
  });
  authority.registerReplica({
    id: replicaId,
    name: "TaskNotes transfer",
    mode: "read_write",
    allowedTypes: [],
  });
  const transport = authority.transport(replicaId);
  const views = new Map<string, SavedViewSourceDocument>();
  const store = new MemoryReplicaStore<JsonObject>({
    replicaId,
    records: {},
    pending: [],
    conflicts: {},
  });
  return {
    authority,
    collectionId,
    connection: connectedDestination(collectionId, replicaId, transport, views),
    replicaId,
    store,
    transport,
    views,
  };
}

function connectedDestination(
  collectionId: string,
  replicaId: string,
  transport: SyncTransport<JsonObject>,
  views: Map<string, SavedViewSourceDocument>,
): MdbaseConnection<JsonObject> {
  const valid = <Result>(result: Result) => ({
    valid: true as const,
    result,
    diagnostics: [],
  });
  return {
    collectionId,
    info: () => ({
      collectionId,
      displayName: "Hosted tasks",
      operations: [],
      scope: { contracts: [], access: "full_collection" },
      route: "remote",
      directAccess: "disabled",
    }),
    sync: () => ({ collectionId, replicaId, transport }),
    listViews: async () =>
      valid({
        views: [...views.values()].map((source) => ({
          id: source.path,
          name: source.path,
          source: { ...source, writable: true },
          views: [{ id: "view", name: "View", properties: [] }],
        })),
        meta: { total_count: views.size },
      }),
    readViewSource: async ({ path }: ReadViewSourceInput) => {
      const source = views.get(path);
      if (!source) throw new Error("View source not found.");
      return valid(source);
    },
    createViewSource: async (input: CreateViewSourceInput) => {
      const path = input.path ?? "views/view.base";
      if (views.has(path)) throw new Error("View source already exists.");
      const source = {
        path,
        format: input.format ?? "obsidian.base",
        revision: `view:${views.size + 1}`,
        document: input.document,
      };
      views.set(path, source);
      return valid(source);
    },
  } as unknown as MdbaseConnection<JsonObject>;
}

async function resourcesFrom(
  collection: MarkdownCollection,
): Promise<SyncCollectionResources> {
  const type = parseFrontmatter(await collection.readText("_types/task.md"))
    .frontmatter as {
    name: string;
    version: number;
    schema: { value: JsonObject };
    collection?: JsonObject;
    "x-tasknotes": JsonObject;
  };
  return {
    revision: crypto.randomUUID(),
    spec_version: "0.3.0",
    types: [
      {
        name: type.name,
        version: type.version,
        schema: type.schema.value,
        collection: type.collection,
        extensions: { "x-tasknotes": type["x-tasknotes"] },
        definition: type,
      },
    ],
    contracts: [
      {
        id: "tasknotes.task",
        version: 1,
        type_name: type.name,
        extension: "x-tasknotes",
        configuration: type["x-tasknotes"],
      },
    ],
  };
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
