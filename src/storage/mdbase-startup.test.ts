import { expect, it } from "vitest";
import { MdbaseTaskRepository } from "./mdbase-repository";
import { deferred, mdbaseFixture, taskRecord } from "../test/mdbase-fixture";

function setup() {
  const fixture = mdbaseFixture([
    taskRecord("one", "First", "r1"),
    taskRecord("two", "Second", "r2"),
  ]);
  return { ...fixture, repository: new MdbaseTaskRepository(fixture.connect) };
}

it("opens configuration and a view without enumerating task metadata", async () => {
  const fixture = setup();
  await fixture.repository.initialize({ deferTaskIndex: true });
  expect(fixture.describe).toHaveBeenCalledOnce();
  expect(fixture.queryPages).not.toHaveBeenCalled();
  expect(await fixture.repository.listSummaries({ limit: 0 })).toEqual([]);
  const [document] = await fixture.repository.listViews();
  const stream = fixture.repository.iterateView(document.views[0]);
  const iterator = stream[Symbol.asyncIterator]();
  const page = await iterator.next();
  expect(page.value.rows).toMatchObject([
    { task: { id: "one" } },
    { task: { id: "two" } },
  ]);
  expect(page.value.rows[0].task).not.toHaveProperty("body");
  expect(fixture.queryPages).not.toHaveBeenCalled();
  expect(fixture.executeViewPages).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ firstPageSize: 200 }),
  );
  expect((await fixture.repository.get("one"))?.title).toBe("First");
  expect(fixture.read).toHaveBeenCalledOnce();
  expect(fixture.queryPages).not.toHaveBeenCalled();
  await iterator.return?.();
});

it("keeps the first view and its ordinary edits usable while the full index is stalled", async () => {
  const fixture = setup();
  await fixture.repository.initialize({ deferTaskIndex: true });
  const original = fixture.queryPages.getMockImplementation()!;
  const started = deferred<void>();
  const release = deferred<void>();
  fixture.queryPages.mockImplementationOnce((input, options) =>
    (async function* () {
      const iterator = original(input, options);
      const first = await iterator.next();
      started.resolve();
      await release.promise;
      if (!first.done) yield first.value;
    })(),
  );
  let counted = false;
  const stats = fixture.repository.stats().then((value) => {
    counted = true;
    return value;
  });
  const summaries = fixture.repository.listSummaries({ status: "all" });
  const missing = fixture.repository.get("missing");
  await started.promise;
  expect(counted).toBe(false);
  const [document] = await fixture.repository.listViews();
  const stream = fixture.repository.iterateView(document.views[0]);
  const pages = stream[Symbol.asyncIterator]();
  expect((await pages.next()).value.rows).toHaveLength(2);
  const accepted = await fixture.repository.toggle("one", undefined, true);
  expect(accepted.completed).toBe(true);
  expect(counted).toBe(false);
  expect(fixture.queryPages).toHaveBeenCalledOnce();
  release.resolve();
  expect((await summaries).find((task) => task.id === "one")?.completed).toBe(
    true,
  );
  expect(await stats).toMatchObject({ total: 2 });
  expect(await missing).toBeNull();
  expect(await fixture.repository.get("one")).toEqual(accepted);
  await pages.return?.();
});

it("retires view hints when the authoritative index shows that a task was deleted", async () => {
  const fixture = setup();
  await fixture.repository.initialize({ deferTaskIndex: true });
  const [document] = await fixture.repository.listViews();
  await fixture.repository.executeView(document.views[0]);
  fixture.records.delete("tasks/one.md");
  expect(await fixture.repository.stats()).toMatchObject({ total: 1 });
  expect(await fixture.repository.get("one")).toBeNull();
  expect(fixture.read).not.toHaveBeenCalled();
});

it("never edits a replacement record through an old view's path hint", async () => {
  const fixture = setup();
  await fixture.repository.initialize({ deferTaskIndex: true });
  const [document] = await fixture.repository.listViews();
  await fixture.repository.executeView(document.views[0]);
  fixture.records.set("tasks/one.md", {
    ...taskRecord("replacement", "Do not edit me", "r3"),
    path: "tasks/one.md",
  });
  await expect(
    fixture.repository.update("one", { title: "Wrong identity" }),
  ).rejects.toThrow("identity changed");
  expect(fixture.update).not.toHaveBeenCalled();
  expect(await fixture.repository.get("one")).toBeNull();
});

it("does not immediately duplicate the initial snapshot on authorities without a change feed", async () => {
  const fixture = setup();
  await fixture.repository.initialize({ deferTaskIndex: true });
  await fixture.repository.refresh();
  expect(fixture.queryPages).toHaveBeenCalledOnce();
  await fixture.repository.refresh();
  expect(fixture.queryPages).toHaveBeenCalledTimes(2);
});

it("discards a pre-suspension index load without blocking the resumed workspace", async () => {
  const fixture = setup();
  await fixture.repository.initialize({ deferTaskIndex: true });
  const original = fixture.queryPages.getMockImplementation()!;
  const started = deferred<void>();
  const release = deferred<void>();
  fixture.queryPages.mockImplementationOnce((input, options) =>
    (async function* () {
      const page = await original(input, options).next();
      started.resolve();
      await release.promise;
      if (!page.done) yield page.value;
    })(),
  );
  const old = fixture.repository.stats().catch((reason: unknown) => reason);
  await started.promise;
  fixture.repository.suspend();
  fixture.records.set("tasks/one.md", taskRecord("one", "New title", "r3"));
  fixture.repository.resume();
  expect(await fixture.repository.stats()).toMatchObject({ total: 2 });
  release.resolve();
  expect(await old).toMatchObject({ name: "AbortError" });
  expect(
    (await fixture.repository.listSummaries()).find((task) => task.id === "one")
      ?.title,
  ).toBe("New title");
});

it("can rediscover configuration when an initial index query requires a schema refresh", async () => {
  const fixture = setup();
  await fixture.repository.initialize({ deferTaskIndex: true });
  const original = fixture.queryPages.getMockImplementation()!;
  fixture.queryPages.mockImplementation((input, options) =>
    (async function* () {
      if (fixture.describe.mock.calls.length < 2)
        yield await Promise.reject(
          new Error("Rediscover the schema before retrying"),
        );
      yield* original(input, options);
    })(),
  );
  await expect(fixture.repository.stats()).rejects.toThrow(
    "Rediscover the schema",
  );
  await fixture.repository.refresh();
  expect(fixture.describe).toHaveBeenCalledTimes(2);
  expect(await fixture.repository.stats()).toMatchObject({ total: 2 });
  expect(await fixture.repository.connectionStatus()).toMatchObject({
    state: "connected",
  });
});

it("never reports an unloaded index as an empty collection and retries a failed load", async () => {
  const fixture = setup();
  await fixture.repository.initialize({ deferTaskIndex: true });
  fixture.queryPages.mockImplementationOnce(() =>
    (async function* () {
      yield await Promise.reject(new Error("Index unavailable"));
    })(),
  );
  await expect(fixture.repository.stats()).rejects.toThrow("Index unavailable");
  expect(await fixture.repository.stats()).toMatchObject({ total: 2 });
  expect(fixture.queryPages).toHaveBeenCalledTimes(2);
});
