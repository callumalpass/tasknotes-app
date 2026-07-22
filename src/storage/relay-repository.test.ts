import type {
  CollectionDescription,
  JsonObject,
  MdbaseConnect,
  MdbaseOperationEnvelope,
  QueryResult,
  RecordResult,
} from "@mdbase/connect";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";
import { describe, expect, it, vi } from "vitest";

import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { CloudTaskRepository } from "./cloud-repository";
import { createConnectTaskRepository } from "./connect-repository";
import { RelayTaskRepository } from "./relay-repository";

describe("relay task repository", () => {
  it("opens, searches, and mutates a TaskNotes collection over live operations", async () => {
    const fixture = relayFixture([
      taskRecord("existing", "Review relay support", "r1"),
    ]);
    const repository = new RelayTaskRepository(fixture.connect);

    await repository.initialize();
    expect(await repository.list({ search: "relay" })).toMatchObject([
      { id: "existing", title: "Review relay support" },
    ]);
    expect(await repository.collectionInfo()).toMatchObject({
      kind: "connect",
      name: "Local tasks",
    });

    const [renamed, detailed] = await Promise.all([
      repository.update("existing", { title: "Ship relay support" }),
      repository.update("existing", { body: "Tested through Connect." }),
    ]);
    expect(renamed.title).toBe("Ship relay support");
    expect(detailed).toMatchObject({
      title: "Ship relay support",
      body: "Tested through Connect.",
    });
    expect(fixture.read).toHaveBeenCalledTimes(1);
    expect(
      fixture.update.mock.calls.map(([input]) => input.if_revision),
    ).toEqual(["r1", "r2"]);

    const created = await repository.create({ title: "New relay task" });
    expect(created.title).toBe("New relay task");
    await repository.delete(created.id);
    expect(await repository.get(created.id)).toBeNull();
    expect(fixture.remove).toHaveBeenCalledWith(
      expect.objectContaining({ if_revision: "r4" }),
    );
    expect(await repository.syncStatus()).toMatchObject({
      mode: "live",
      state: "synced",
      pending: 0,
    });
  });

  it("keeps the current session readable when a refresh cannot reach the connector", async () => {
    const fixture = relayFixture([
      taskRecord("cached", "Visible while unavailable", "r1"),
    ]);
    const repository = new RelayTaskRepository(fixture.connect);
    await repository.initialize();
    fixture.query.mockRejectedValueOnce(
      new TypeError("The computer is unavailable."),
    );

    const refreshed = await repository.refresh();

    expect(refreshed.scanned).toBe(1);
    expect(await repository.get("cached")).toMatchObject({
      title: "Visible while unavailable",
    });
    expect(await repository.syncStatus()).toMatchObject({
      mode: "live",
      state: "offline",
    });
  });

  it("hides hosted-versus-relay selection behind one repository factory", () => {
    const relay = relayFixture([]).connect;
    expect(createConnectTaskRepository(relay)).toBeInstanceOf(
      RelayTaskRepository,
    );
    const hosted = {
      hostedSync: () => ({ collectionId: "hosted", replicaId: "phone" }),
    } as unknown as MdbaseConnect<JsonObject>;
    expect(createConnectTaskRepository(hosted)).toBeInstanceOf(
      CloudTaskRepository,
    );
  });
});

function relayFixture(initial: RecordResult<JsonObject>[]) {
  const records = new Map(initial.map((record) => [record.path, record]));
  let revision = initial.length + 1;
  const describeCollection = vi.fn(async () => description());
  const query = vi.fn(async () =>
    valid<QueryResult<JsonObject>>({
      results: [...records.values()].map((record) => ({
        path: record.path,
        frontmatter: record.frontmatter,
        raw_frontmatter: record.raw_frontmatter,
        body: record.body,
        types: record.types,
        file: record.file,
      })),
      meta: { total_count: records.size, has_more: false, snapshot: "tasks-1" },
    }),
  );
  const read = vi.fn(async ({ path }: { path: string }) => {
    const record = records.get(path);
    if (!record) throw new Error("Task not found.");
    return valid(record);
  });
  const create = vi.fn(
    async (input: {
      path?: string;
      type?: string;
      frontmatter: JsonObject;
      body?: string;
    }) => {
      const path = input.path ?? `tasks/${crypto.randomUUID()}.md`;
      const record: RecordResult<JsonObject> = {
        path,
        frontmatter: structuredClone(input.frontmatter),
        body: input.body ?? "",
        types: [input.type ?? "task"],
        revision: `r${revision++}`,
      };
      records.set(path, record);
      return valid(record);
    },
  );
  const update = vi.fn(
    async (input: {
      path: string;
      patch: JsonObject;
      body?: string;
      if_revision?: string;
    }) => {
      const current = records.get(input.path);
      if (!current) throw new Error("Task not found.");
      if (input.if_revision !== current.revision)
        throw new Error("Revision conflict.");
      const frontmatter = structuredClone(current.frontmatter);
      for (const [key, value] of Object.entries(input.patch)) {
        if (value === null) delete frontmatter[key];
        else frontmatter[key] = structuredClone(value);
      }
      const record: RecordResult<JsonObject> = {
        ...current,
        frontmatter,
        body: input.body ?? current.body,
        revision: `r${revision++}`,
      };
      records.set(input.path, record);
      return valid(record);
    },
  );
  const remove = vi.fn(
    async (input: { path: string; if_revision?: string }) => {
      const current = records.get(input.path);
      if (!current) throw new Error("Task not found.");
      if (input.if_revision !== current.revision)
        throw new Error("Revision conflict.");
      records.delete(input.path);
      return valid({ path: input.path, deleted: true });
    },
  );
  const connect = {
    hostedSync: () => null,
    connection: () => ({ route: "relay" }),
    describe: describeCollection,
    query,
    read,
    create,
    update,
    delete: remove,
  } as unknown as MdbaseConnect<JsonObject>;
  return { connect, query, read, create, update, remove };
}

function taskRecord(
  id: string,
  title: string,
  revision: string,
): RecordResult<JsonObject> {
  const task = new TaskNotesTaskModel().create(
    { title },
    { id, now: "2026-07-22T00:00:00.000Z" },
  );
  return {
    path: task.path,
    frontmatter: structuredClone(task.frontmatter) as JsonObject,
    body: task.body,
    types: ["task"],
    revision,
  };
}

function description(): CollectionDescription {
  const generated = buildTaskNotesMdbaseResources({ profiles: ["core-lite"] });
  const type = generated.type as unknown as {
    schema: { value: JsonObject };
    collection?: JsonObject;
    "x-tasknotes": JsonObject;
  };
  return {
    protocol_version: 2,
    collection_id: "local-tasks",
    display_name: "Local tasks",
    spec_version: "0.3.0",
    operations: ["describe", "query", "read", "create", "update", "delete"],
    change_cursor: 0,
    types: [
      {
        name: "task",
        version: 1,
        schema: type.schema.value,
        collection: type.collection,
        extensions: { "x-tasknotes": type["x-tasknotes"] },
      },
    ],
    contracts: [
      {
        id: "tasknotes.task",
        version: 1,
        type_name: "task",
        extension: "x-tasknotes",
        configuration: type["x-tasknotes"],
      },
    ],
  };
}

function valid<Result>(result: Result): MdbaseOperationEnvelope<Result> {
  return { valid: true, result, diagnostics: [] };
}
