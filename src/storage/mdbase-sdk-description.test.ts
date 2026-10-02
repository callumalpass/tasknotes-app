import { expect, it, vi } from "vitest";
import { MdbaseCollectionClient } from "@mdbase-dev/connect/advanced";
import type { CollectionChange as WireChange } from "@mdbase-dev/connect-protocol";
import { MdbaseTaskRepository } from "./mdbase-repository";
import { mdbaseFixture, taskRecord } from "../test/mdbase-fixture";
import { wireTestDescription } from "../test/sdk-description-fixture";

async function setup() {
  const fixture = mdbaseFixture([taskRecord("one", "One", "r1")]);
  const description = await fixture.describe();
  description.operations.push("changes");
  const events: WireChange[] = [];
  const describes = vi.fn();
  const client = new MdbaseCollectionClient({
    operation: async <Result>(
      operation: string,
      input: unknown,
    ): Promise<Result> => {
      if (operation === "describe") {
        describes();
        return structuredClone(wireTestDescription(description)) as Result;
      }
      if (operation !== "changes") throw new Error("Unexpected operation");
      const after = (input as { after?: number }).after ?? 0;
      return {
        events: events.filter((event) => event.cursor > after),
        cursor: description.changeCursor,
        has_more: false,
        reset: false,
      } as Result;
    },
  });
  fixture.connect.describe = client.describe.bind(client);
  fixture.connect.changes = client.changes.bind(client);
  Object.defineProperty(fixture.connect, "schemaGeneration", {
    get: () => client.schemaGeneration,
  });
  const repository = new MdbaseTaskRepository(fixture.connect);
  await repository.initialize();
  fixture.queryPages.mockClear();
  const change = (type: string, payload: WireChange["payload"]) =>
    events.push({
      cursor: ++description.changeCursor,
      type,
      payload,
      occurred_at: "2026-10-02T00:00:00Z",
    });
  return { ...fixture, description, describes, repository, change };
}

it("reuses cached descriptions and does not rebuild when an unchanged cache expires", async () => {
  const fixture = await setup();
  const before = (await fixture.repository.listSummaries())[0];
  await fixture.repository.refresh();
  await fixture.repository.refresh();
  expect(fixture.describes).toHaveBeenCalledTimes(1);
  expect(fixture.queryPages).not.toHaveBeenCalled();
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 60_001);
  try {
    await fixture.repository.refresh();
    expect(fixture.describes).toHaveBeenCalledTimes(2);
    expect(fixture.queryPages).not.toHaveBeenCalled();
    expect((await fixture.repository.listSummaries())[0]).toBe(before);
  } finally {
    clock.mockRestore();
  }
});

it("applies schema changes discovered by polling before reading their replacement rows", async () => {
  const fixture = await setup();
  fixture.description.displayName = "Renamed collection";
  fixture.change("mdbase.type.changed", { name: "task" });
  await fixture.repository.refresh();
  expect(fixture.describes).toHaveBeenCalledTimes(2);
  expect(fixture.queryPages).toHaveBeenCalledOnce();
  expect((await fixture.repository.collectionInfo()).name).toBe(
    "Renamed collection",
  );
  await fixture.repository.refresh();
  expect(fixture.describes).toHaveBeenCalledTimes(2);
  expect(fixture.queryPages).toHaveBeenCalledOnce();
});

it("refetches view metadata without rebuilding the task index", async () => {
  const fixture = await setup();
  fixture.change("mdbase.view_source.changed", { path: "views/tasks.base" });
  await fixture.repository.refresh();
  expect(fixture.describes).toHaveBeenCalledTimes(2);
  expect(fixture.queryPages).not.toHaveBeenCalled();
});

it("discovers configuration changes on TTL refetch even without an event", async () => {
  const fixture = await setup();
  fixture.description.configuration = { changed: true };
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001);
  try {
    await fixture.repository.refresh();
    expect(fixture.describes).toHaveBeenCalledTimes(2);
    expect(fixture.queryPages).toHaveBeenCalledOnce();
  } finally {
    clock.mockRestore();
  }
});
