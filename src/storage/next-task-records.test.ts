import { connect, type MdbaseClient, type PlainValue } from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { nextTaskDocument, nextTaskSummary } from "./next-task-records";

const clients: MdbaseClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

async function fixture() {
  const model = new TaskNotesTaskModel();
  const models = new Map([["task", model]]);
  const client = await connect({
    connector: new MemoryReplica().connector(),
    app: { name: "tasknotes-test", version: "test" },
    reconnect: false,
  });
  clients.push(client);
  const portableId = crypto.randomUUID();
  const source = model.create(
    {
      title: "Native SDK task",
      body: "Do not discard this body",
      tags: ["one", "two"],
    },
    { id: portableId },
  );
  const write = await client.create({
    type: "task",
    path: source.path,
    frontmatter: source.frontmatter as Record<string, PlainValue>,
    body: source.body,
  });
  await write.confirmed;
  const id = write.records[0]!.id;
  return { model, models, client, id, portableId, source };
}

describe("native v2 TaskNotes record projection (protocol stand-in, not LAB)", () => {
  it("decodes SDK maps into a task and uses replica identity", async () => {
    const f = await fixture();
    const record = await f.client.get(f.id, { body: true });
    const task = nextTaskDocument(record, f.models)!;
    expect(record.frontmatter).toBeInstanceOf(Map);
    expect(task.id).toBe(f.id);
    expect(task.id).not.toBe(f.portableId);
    expect(task.path).toBe(f.source.path);
    expect(task.title).toBe("Native SDK task");
    expect(task.body).toBe("Do not discard this body");
    expect(task.tags).toEqual(["one", "two", "task"]);
    expect(task.frontmatter.id).toBe(f.portableId);
  });

  it("uses the replica's effective fields without computing collection defaults", async () => {
    const f = await fixture();
    const record = await f.client.get(f.id, { body: true });
    const effective = new Map(record.frontmatter);
    effective.set("title", "Replica-resolved title");
    expect(nextTaskSummary({ ...record, effective }, f.models)!.title).toBe(
      "Replica-resolved title",
    );
    expect(nextTaskDocument({ ...record, effective }, f.models)!.title).toBe(
      "Replica-resolved title",
    );
    expect(record.frontmatter.get("title")).toBe("Native SDK task");
  });

  it("does not represent an unfetched body as empty", async () => {
    const f = await fixture();
    const record = await f.client.get(f.id);
    expect(record.body).toBeUndefined();
    const summary = nextTaskSummary(record, f.models)!;
    expect(summary.title).toBe("Native SDK task");
    expect(summary).not.toHaveProperty("body");
    expect(() => nextTaskDocument(record, f.models)).toThrow(
      "complete task body",
    );
  });

  it("accepts an explicitly fetched empty body", async () => {
    const f = await fixture();
    const observed = await f.client.get(f.id, { body: true });
    const write = await f.client.update(observed, { body: "" });
    await write.confirmed;
    expect(
      nextTaskDocument(await f.client.get(f.id, { body: true }), f.models)!
        .body,
    ).toBe("");
  });

  it("ignores records which the replica did not classify as a task", async () => {
    const f = await fixture();
    const record = await f.client.get(f.id);
    expect(
      nextTaskSummary({ ...record, types: ["note"] }, f.models),
    ).toBeNull();
    expect(
      nextTaskDocument({ ...record, types: ["note"] }, f.models),
    ).toBeNull();
  });

  it("refuses ambiguous task implementations instead of selecting the first", async () => {
    const f = await fixture();
    const record = await f.client.get(f.id, { body: true });
    const models = new Map([
      ["task", f.model],
      ["todo", f.model],
    ]);
    expect(() =>
      nextTaskDocument({ ...record, types: ["task", "todo"] }, models),
    ).toThrow("more than one");
    expect(() =>
      nextTaskSummary({ ...record, types: ["task", "todo"] }, models),
    ).toThrow("more than one");
  });
});
