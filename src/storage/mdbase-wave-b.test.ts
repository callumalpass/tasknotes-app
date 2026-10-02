import { describe, expect, it } from "vitest";
import { connectError, connectFailure } from "@mdbase-dev/connect-testing";
import {
  deferred,
  mdbaseFixture,
  taskRecord,
  type TestRecord,
} from "../test/mdbase-fixture";
import { MdbaseTaskRepository } from "./mdbase-repository";

function qualified(records: TestRecord[]) {
  const fixture = mdbaseFixture(records);
  fixture.authorityCapabilities.add("query-metadata-v1");
  fixture.authorityCapabilities.add("read-many-documents-v1");
  return { ...fixture, repository: new MdbaseTaskRepository(fixture.connect) };
}

function note(index: number, active = false): TestRecord {
  return {
    path: `scratchpads/${index}.md`,
    revision: `note-r${index}`,
    types: ["tasknotes-scratch"],
    frontmatter: {
      type: "tasknotes-scratch",
      id: `note-${index}`,
      state: active ? "active" : "converted",
      dateCreated: "2026-07-01T00:00:00.000Z",
      dateModified: "2026-07-02T00:00:00.000Z",
    },
    body: `Exact note ${index}\n`,
  };
}

function image(index: number): TestRecord {
  return {
    path: `scratch-images/${index}.md`,
    revision: `image-r${index}`,
    types: ["tasknotes-scratch-image"],
    frontmatter: {
      type: "tasknotes-scratch-image",
      id: `image-${index}`,
      dateCreated: "2026-07-01T00:00:00.000Z",
      dateModified: "2026-07-02T00:00:00.000Z",
      file: `images/${index}.png`,
      digest: `sha256:${"a".repeat(64)}`,
      size: 12,
      mediaType: "image/png",
    },
    body: "",
  };
}

const unavailable = {
  problem_version: 1 as const,
  code: "temporarily_unavailable" as const,
  category: "availability" as const,
  recovery: "retry" as const,
  message: "Batch unavailable",
};

describe("negotiated TaskNotes reads", () => {
  it("preserves configured providers, literal custom keys, aliases and nulls in a narrow index", async () => {
    const first = taskRecord("first", "First", "r1");
    first.frontmatter = {
      ...first.frontmatter,
      timeEstimate: null,
      time_estimate: 99,
      bulk: "x".repeat(8192),
    };
    const second = taskRecord("second", "Second", "r2");
    second.types = ["custom-task"];
    second.frontmatter = {
      ...second.frontmatter,
      "task.title": "Custom title",
      "effort.value": 7,
      bulk: "x".repeat(8192),
    };
    delete second.frontmatter.dateModified;
    second.frontmatter.date_modified = "2026-07-29T00:00:00Z";
    const narrow = qualified([first, second]);
    const legacy = mdbaseFixture([first, second]);
    const description = await narrow.describe();
    const customType = structuredClone(description.types[0]);
    customType.name = "custom-task";
    customType.schema = {
      ...customType.schema,
      properties: { "effort.value": { type: "number" } },
    };
    description.types.push(customType);
    const implementation = structuredClone(
      description.contracts[0].implementations[0],
    );
    implementation.typeName = "custom-task";
    implementation.fields = { ...implementation.fields, title: "task.title" };
    description.contracts[0].implementations.push(implementation);
    narrow.describe.mockResolvedValue(description);
    legacy.describe.mockResolvedValue(description);
    const oldRepository = new MdbaseTaskRepository(legacy.connect);
    await Promise.all([
      narrow.repository.initialize(),
      oldRepository.initialize(),
    ]);
    const actual = await narrow.repository.listSummaries({ status: "all" });
    const expected = await oldRepository.listSummaries({ status: "all" });
    expect(
      actual.map(({ frontmatter, ...task }) => {
        void frontmatter;
        return task;
      }),
    ).toEqual(
      expected.map(({ frontmatter, ...task }) => {
        void frontmatter;
        return task;
      }),
    );
    expect(actual.find((task) => task.id === "second")).toMatchObject({
      title: "Custom title",
      customProperties: { "effort.value": 7 },
    });
    expect(
      actual.find((task) => task.id === "first")?.timeEstimate,
    ).toBeUndefined();
    expect(actual.find((task) => task.id === "second")?.updatedAt).toBe(
      "2026-07-29T00:00:00Z",
    );
    expect(
      actual.every(
        (task) => !("bulk" in task.frontmatter) && !("body" in task),
      ),
    ).toBe(true);
    expect(narrow.queryPages).toHaveBeenCalledWith(
      expect.objectContaining({
        output: "metadata",
        types: ["task", "custom-task"],
      }),
      expect.anything(),
    );
    expect(
      legacy.queryPages.mock.calls.every(
        ([input]) => input?.output === undefined,
      ),
    ).toBe(true);
    expect(legacy.readDocuments).not.toHaveBeenCalled();
    expect(narrow.read).not.toHaveBeenCalled();
    await narrow.repository.update("first", { title: "Edited" });
    expect(narrow.read).toHaveBeenCalledOnce(); // A query token is not a document.
    expect(narrow.records.get(first.path)?.frontmatter.bulk).toBe(
      first.frontmatter.bulk,
    );
  });

  it("surfaces discovery and advertised metadata failures without retrying an ordinary query", async () => {
    const fixture = qualified([taskRecord("one", "One", "r1")]);
    await fixture.repository.initialize({ deferTaskIndex: true });
    fixture.supportsAuthorityFeature.mockResolvedValueOnce(
      connectFailure(unavailable),
    );
    await expect(fixture.repository.stats()).rejects.toThrow(
      "Batch unavailable",
    );
    expect(fixture.queryPages).not.toHaveBeenCalled();
    fixture.queryPages.mockImplementationOnce(() =>
      (async function* () {
        yield connectFailure(unavailable);
      })(),
    );
    await expect(fixture.repository.stats()).rejects.toThrow(
      "Batch unavailable",
    );
    expect(fixture.queryPages).toHaveBeenCalledOnce();
    expect(fixture.queryPages.mock.calls[0][0]?.output).toBe("metadata");
  });

  it("uses the hydration content/revision pair, reindexes changed metadata, and avoids revision rereads", async () => {
    const records = Array.from({ length: 205 }, (_, i) => ({
      ...taskRecord(`id-${i}`, `Task ${i}`, `r${i}`),
      body: `Exact body ${i}\n`,
    }));
    const fixture = qualified(records);
    await fixture.repository.initialize();
    const summaries = await fixture.repository.listSummaries({ status: "all" });
    const target = summaries.at(-1)!;
    const current = fixture.records.get(target.path)!;
    fixture.records.set(target.path, {
      ...current,
      revision: "r-new",
      body: "New exact body\n",
      frontmatter: { ...current.frontmatter, title: "External title" },
    });
    const tasks = await fixture.repository.list({ status: "all" });
    expect(tasks.map((task) => task.id)).toEqual(
      summaries.map((task) => task.id),
    );
    expect(tasks.at(-1)).toMatchObject({
      title: "External title",
      body: "New exact body\n",
    });
    expect(
      (await fixture.repository.listSummaries({ status: "all" })).find(
        (task) => task.id === target.id,
      )?.title,
    ).toBe("External title");
    expect(fixture.readDocuments).toHaveBeenCalledTimes(3);
    expect(
      fixture.readDocuments.mock.calls.every(
        ([input]) => input.paths.length <= 100,
      ),
    ).toBe(true);
    await fixture.repository.update(target.id, { priority: "high" });
    expect(fixture.read).not.toHaveBeenCalled();
    expect(fixture.update.mock.calls[0][0]).toMatchObject({
      ifRevision: "r-new",
      body: "New exact body\n",
    });
    // Desired-state operations still require a fresh authority read.
    await fixture.repository.toggle(target.id, undefined, true);
    expect(fixture.read).toHaveBeenCalledOnce();
    // Revision-bearing hydration does not widen the 64-document LRU.
    await fixture.repository.update(tasks[0].id, { title: "Evicted document" });
    expect(fixture.read).toHaveBeenCalledTimes(2);
  });

  it("does not install a delayed batch over an accepted local edit", async () => {
    const record = {
      ...taskRecord("one", "One", "r1"),
      body: "Original body\n",
    };
    const fixture = qualified([record]);
    await fixture.repository.initialize();
    await fixture.repository.stats();
    const started = deferred<void>();
    const release = deferred<void>();
    const read = fixture.readDocuments.getMockImplementation()!;
    fixture.readDocuments.mockImplementationOnce(async (input) => {
      const result = await read(input);
      started.resolve();
      await release.promise;
      return result;
    });
    const loading = fixture.repository.list({ status: "all" });
    await started.promise;
    const accepted = await fixture.repository.update("one", {
      title: "Local edit",
    });
    release.resolve();
    expect(await loading).toEqual([accepted]);
    expect(await fixture.repository.get("one")).toEqual(accepted);
  });

  it("does not cache partial bodies or treat failed batches as missing", async () => {
    const fixture = qualified(
      Array.from({ length: 101 }, (_, i) =>
        taskRecord(`id-${i}`, `Task ${i}`, `r${i}`),
      ),
    );
    await fixture.repository.initialize();
    await fixture.repository.stats();
    const read = fixture.readDocuments.getMockImplementation()!;
    fixture.readDocuments
      .mockImplementationOnce(read)
      .mockRejectedValueOnce(connectError("connector_busy", "Batch busy"));
    await expect(fixture.repository.list({ status: "all" })).rejects.toThrow(
      "Batch busy",
    );
    expect((await fixture.repository.stats()).total).toBe(101);
    await fixture.repository.get("id-0");
    expect(fixture.read).toHaveBeenCalledOnce();
  });

  it("batches Scratchpad history and images without changing the current-note lifecycle", async () => {
    const initial = [
      note(0, true),
      ...Array.from({ length: 205 }, (_, i) => note(i + 1)),
      ...Array.from({ length: 150 }, (_, i) => image(i)),
    ];
    const fixture = qualified(initial);
    await fixture.repository.initialize();
    let page = await fixture.repository.listScratchFeed({ limit: 100 });
    expect(page.current.id).toBe("note-0");
    const items = [...page.items];
    while (page.nextCursor) {
      page = await fixture.repository.listScratchFeed({
        limit: 100,
        cursor: page.nextCursor,
      });
      items.push(...page.items);
    }
    expect(items).toHaveLength(355);
    for (const record of initial.slice(1))
      expect(
        items.find((item) => item.id === record.frontmatter.id),
      ).toMatchObject({ path: record.path, revision: record.revision });
    expect(fixture.read).toHaveBeenCalledOnce(); // Existing active-note fast path.
    expect(fixture.readDocuments).toHaveBeenCalledTimes(5);
    expect(
      fixture.readMany.mock.calls.every(
        ([, options]) =>
          options?.concurrency === 4 && options.frontmatterMode === "persisted",
      ),
    ).toBe(true);
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.update).not.toHaveBeenCalled();
  });

  it("surfaces history batch failure without point-read fallback or replacement notes", async () => {
    const fixture = qualified([note(0, true), note(1)]);
    await fixture.repository.initialize();
    fixture.readDocuments.mockRejectedValueOnce(
      connectError("connector_busy", "History busy"),
    );
    await expect(fixture.repository.listScratchFeed()).rejects.toThrow(
      "History busy",
    );
    expect(fixture.read).toHaveBeenCalledOnce();
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.update).not.toHaveBeenCalled();
  });

  it("does not mistake a vanished history candidate for a complete snapshot", async () => {
    const fixture = qualified([note(0, true), note(1)]);
    await fixture.repository.initialize();
    const read = fixture.readDocuments.getMockImplementation()!;
    fixture.readDocuments.mockImplementationOnce(async (input) => {
      fixture.records.delete("scratchpads/1.md");
      return read(input);
    });
    await expect(fixture.repository.listScratchFeed()).rejects.toThrow(
      "no longer available",
    );
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.read).toHaveBeenCalledOnce();
  });

  it("stops queued history batches on lifecycle cancellation", async () => {
    const fixture = qualified([
      note(0, true),
      ...Array.from({ length: 450 }, (_, i) => note(i + 1)),
    ]);
    await fixture.repository.initialize();
    const started = deferred<void>();
    const release = deferred<void>();
    const read = fixture.readDocuments.getMockImplementation()!;
    fixture.readDocuments.mockImplementation(async (input) => {
      if (fixture.readDocuments.mock.calls.length === 4) started.resolve();
      await release.promise;
      return read(input);
    });
    const loading = fixture.repository.listScratchFeed();
    const rejected = expect(loading).rejects.toBeDefined();
    await started.promise;
    fixture.repository.suspend();
    release.resolve();
    await rejected;
    expect(fixture.readDocuments).toHaveBeenCalledTimes(4);
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it("uses bounded legacy history reads after authority support is withdrawn", async () => {
    const fixture = qualified([note(0, true), note(1), image(0)]);
    await fixture.repository.initialize();
    await fixture.repository.listScratchFeed();
    fixture.authorityCapabilities.clear();
    fixture.readDocuments.mockClear();
    fixture.read.mockClear();
    expect((await fixture.repository.listScratchpads()).documents).toHaveLength(
      2,
    );
    expect(fixture.readDocuments).not.toHaveBeenCalled();
    expect(fixture.read).toHaveBeenCalledTimes(3); // Active lookup plus two history candidates.
  });
});
