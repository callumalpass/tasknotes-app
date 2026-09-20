import { describe, expect, it } from "vitest";
import { connectSuccess } from "@mdbase-dev/connect-testing";
import { MdbaseTaskRepository } from "./mdbase-repository";
import { deferred, mdbaseFixture, taskRecord } from "../test/mdbase-fixture";

function setup(body = "Keep this exact body.\n\n- [ ] Important\n") {
  const record = { ...taskRecord("one", "One", "r1"), body };
  const fixture = mdbaseFixture([record]);
  return {
    ...fixture,
    record,
    repository: new MdbaseTaskRepository(fixture.connect),
  };
}

describe("metadata and complete document boundaries", () => {
  it("opens and lists metadata without requesting or inventing a body", async () => {
    const fixture = setup();
    await fixture.repository.initialize();
    const summaries = await fixture.repository.listSummaries({ status: "all" });
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).not.toHaveProperty("body");
    expect(fixture.read).not.toHaveBeenCalled();
    expect(fixture.queryPages).toHaveBeenCalledWith(
      expect.objectContaining({ includeBody: false }),
      expect.anything(),
    );
    const document = await fixture.repository.get("one");
    expect(document?.body).toBe(fixture.record.body);
    expect(fixture.read).toHaveBeenCalledOnce();
    expect(await fixture.repository.get("one")).toBe(document);
    expect(fixture.read).toHaveBeenCalledOnce();
    expect((await fixture.repository.listSummaries())[0]).not.toHaveProperty(
      "body",
    );
  });

  it("coalesces simultaneous point reads and explicitly batches complete-list requests", async () => {
    const fixture = setup();
    await fixture.repository.initialize();
    const [first, second] = await Promise.all([
      fixture.repository.get("one"),
      fixture.repository.get("one"),
    ]);
    expect(first).toBe(second);
    expect(fixture.read).toHaveBeenCalledOnce();
    const other = setup();
    await other.repository.initialize();
    expect((await other.repository.list())[0].body).toBe(other.record.body);
    expect(other.read).not.toHaveBeenCalled();
    expect(other.queryPages.mock.calls[1][0]).toMatchObject({
      includeBody: true,
      where: `file.path == ${JSON.stringify(other.record.path)}`,
    });
  });

  it("does not retain a response that completes after collection disposal", async () => {
    const fixture = setup();
    await fixture.repository.initialize();
    const release = deferred<void>();
    const read = fixture.read.getMockImplementation()!;
    fixture.read.mockImplementationOnce(async (input) => {
      const result = await read(input);
      await release.promise;
      return result;
    });
    const detail = fixture.repository.get("one");
    fixture.repository.dispose();
    const rejected = expect(detail).rejects.toMatchObject({
      name: "AbortError",
    });
    fixture.repository.resume();
    expect((await fixture.repository.get("one"))?.body).toBe(
      fixture.record.body,
    );
    release.resolve();
    await rejected;
    expect(fixture.read).toHaveBeenCalledTimes(2);
  });

  it("hydrates before a metadata-only mutation and preserves exact Markdown", async () => {
    const fixture = setup();
    await fixture.repository.initialize();
    await fixture.repository.update("one", { title: "Renamed title" });
    expect(fixture.read).toHaveBeenCalledOnce();
    expect(fixture.update.mock.calls[0][0]).toMatchObject({
      body: fixture.record.body,
      ifRevision: "r1",
    });
    expect(fixture.records.get(fixture.record.path)?.body).toBe(
      fixture.record.body,
    );
    expect((await fixture.repository.listSummaries())[0]).not.toHaveProperty(
      "body",
    );
  });

  it("fails closed when an authority omits the body, but accepts an observed empty body", async () => {
    const fixture = setup("");
    await fixture.repository.initialize();
    fixture.read.mockResolvedValueOnce({
      valid: true,
      diagnostics: [],
      result: { ...fixture.record, body: undefined },
    } as never);
    await expect(
      fixture.repository.update("one", { title: "Must not save" }),
    ).rejects.toThrow("complete task body");
    expect(fixture.update).not.toHaveBeenCalled();
    expect((await fixture.repository.get("one"))?.body).toBe("");
  });

  it("does not let a delayed detail read replace an accepted completion", async () => {
    const fixture = setup();
    await fixture.repository.initialize();
    const started = deferred<void>();
    const release = deferred<void>();
    const read = fixture.read.getMockImplementation()!;
    fixture.read.mockImplementationOnce(async (input) => {
      const result = await read(input);
      started.resolve();
      await release.promise;
      return result;
    });
    const detail = fixture.repository.get("one");
    await started.promise;
    const accepted = await fixture.repository.toggle("one", undefined, true);
    release.resolve();
    expect(await detail).toMatchObject({
      completed: true,
      body: fixture.record.body,
    });
    expect(await fixture.repository.get("one")).toEqual(accepted);
  });

  it("a body-only external change evicts the hydrated document despite unchanged metadata", async () => {
    const fixture = setup();
    const description = await fixture.describe();
    description.operations.push("changes");
    fixture.describe.mockResolvedValue(description);
    Object.assign(fixture.connect, {
      changes: async () =>
        connectSuccess({
          events: [
            {
              cursor: 1,
              type: "mdbase.record.modified",
              occurredAt: "2026-09-20T00:00:00Z",
              payload: { path: fixture.record.path },
            },
          ],
          cursor: 1,
          reset: false,
          hasMore: false,
        }),
    });
    await fixture.repository.initialize();
    await fixture.repository.get("one");
    fixture.records.set(fixture.record.path, {
      ...fixture.record,
      body: "External body edit",
      revision: "r2",
    });
    await fixture.repository.refresh();
    expect((await fixture.repository.get("one"))?.body).toBe(
      "External body edit",
    );
    expect(fixture.read).toHaveBeenCalledTimes(2);
  });

  it("evicts old bodies at the repository boundary and rehydrates before editing", async () => {
    const records = Array.from({ length: 65 }, (_, index) => ({
      ...taskRecord(`id-${index}`, `Task ${index}`, `r${index}`),
      path: `tasks/${index}.md`,
      body: `Exact body ${index}`,
    }));
    const fixture = mdbaseFixture(records);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    for (const record of records)
      await repository.get(String(record.frontmatter.id));
    expect(fixture.read).toHaveBeenCalledTimes(65);
    await repository.update("id-0", { title: "Updated" });
    expect(fixture.read).toHaveBeenCalledTimes(66);
    expect(fixture.update.mock.calls[0][0].body).toBe("Exact body 0");
    expect(
      (await repository.listSummaries({ status: "all", limit: 100 })).every(
        (task) => !("body" in task),
      ),
    ).toBe(true);
  });
});
