import { describe, expect, it } from "vitest";
import { mdbaseFixture, type TestRecord } from "../test/mdbase-fixture";
import { MdbaseTaskRepository } from "./mdbase-repository";
import { activeScratchpads } from "./scratchpads";

function note(
  id: string,
  state: "active" | "converted" = "active",
  dateModified = "2026-07-01T00:00:00.000Z",
): TestRecord {
  return {
    path: `scratchpads/${id}.md`,
    revision: `r-${id}`,
    types: ["tasknotes-scratch"],
    frontmatter: {
      type: "tasknotes-scratch",
      id,
      state,
      title: `Title ${id}`,
      dateCreated: "2026-06-01T00:00:00.000Z",
      dateModified,
    },
    body: `Notes for ${id}\n`,
  };
}

async function clients(initial: TestRecord[] = []) {
  const fixture = mdbaseFixture(initial);
  const a = new MdbaseTaskRepository(fixture.connect);
  const b = new MdbaseTaskRepository({
    ...fixture.connect,
  } as typeof fixture.connect);
  await Promise.all([a.initialize(), b.initialize()]);
  return { fixture, a, b };
}

function activeNotes(fixture: ReturnType<typeof mdbaseFixture>) {
  return [...fixture.records.values()].filter(
    (record) =>
      record.frontmatter.type === "tasknotes-scratch" &&
      record.frontmatter.state === "active",
  );
}
function newInput(
  current: Awaited<ReturnType<MdbaseTaskRepository["getActiveScratchpad"]>>,
) {
  return {
    id: current.id,
    path: current.path,
    revision: current.revision,
    baseBody: current.body,
    body: current.body,
    title: current.title,
  };
}
function ref(
  current: Awaited<ReturnType<MdbaseTaskRepository["getActiveScratchpad"]>>,
) {
  return { id: current.id, path: current.path, revision: current.revision };
}

describe("scratchpad selection without a coordination record", () => {
  it("chooses last modified, not newest creation date, and preserves all content", async () => {
    const olderCreation = note("edited", "active", "2026-07-03T00:00:00.000Z");
    const newerCreation = note("newer", "active", "2026-07-02T00:00:00.000Z");
    newerCreation.frontmatter.dateCreated = "2026-07-02T00:00:00.000Z";
    const initial = [
      olderCreation,
      newerCreation,
      note("history", "converted", "2030-01-01T00:00:00.000Z"),
    ];
    const before = structuredClone(initial);
    const { fixture, a } = await clients(initial);
    expect((await a.getActiveScratchpad()).id).toBe("edited");
    expect(activeNotes(fixture)).toHaveLength(1);
    expect((await a.listScratchFeed()).items).toHaveLength(2);
    for (const record of before)
      expect(fixture.records.get(record.path)).toMatchObject({
        path: record.path,
        body: record.body,
        frontmatter: {
          id: record.frontmatter.id,
          title: record.frontmatter.title,
          dateCreated: record.frontmatter.dateCreated,
        },
      });
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.remove).not.toHaveBeenCalled();
  });

  it("compares instants across timezone offsets and breaks ties consistently", () => {
    const earlier = note("earlier", "active", "2026-07-01T10:00:00+02:00");
    const later = note("later", "active", "2026-07-01T09:00:00Z");
    expect(activeScratchpads([earlier, later])[0].id).toBe("later");
    const a = note("a");
    const b = note("b");
    expect(activeScratchpads([b, a]).map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
    expect(activeScratchpads([a, b]).map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("ignores an existing coordination record without reading, updating, or deleting it", async () => {
    const legacy: TestRecord = {
      path: "TaskNotes/Scratchpad/Current note.md",
      revision: "legacy-r1",
      types: [],
      body: "Leave this alone.\n",
      frontmatter: {
        kind: "tasknotes.scratchpad-current",
        currentId: "wrong",
        currentPath: "missing.md",
        pending: true,
      },
    };
    const before = structuredClone(legacy);
    const { fixture, a } = await clients([legacy, note("actual")]);
    const first = await a.getActiveScratchpad();
    const next = await a.startNewScratchpad(newInput(first));
    const historical = (await a.getScratchpad(first.id))!;
    await a.reactivateScratchpad({
      current: ref(next.current),
      target: ref(historical),
    });
    expect((await a.getActiveScratchpad()).id).toBe(first.id);
    expect(fixture.records.get(legacy.path)).toEqual(before);
    for (const calls of [
      fixture.read.mock.calls,
      fixture.create.mock.calls,
      fixture.update.mock.calls,
      fixture.remove.mock.calls,
    ])
      for (const [input] of calls) expect(input.path).not.toBe(legacy.path);
    expect(
      fixture.create.mock.calls.every(
        ([input]) => input.type === "tasknotes-scratch",
      ),
    ).toBe(true);
  });

  it("creates ordinary notes with authority-generated IDs and no reservation metadata", async () => {
    const { fixture, a } = await clients();
    const create = fixture.create.getMockImplementation()!;
    fixture.create.mockImplementation(async (...args) =>
      create({
        ...args[0],
        frontmatter: { ...args[0].frontmatter, id: crypto.randomUUID() },
      }),
    );
    const first = await a.getActiveScratchpad();
    expect(fixture.records.get(first.path)?.frontmatter.id).toBe(first.id);
    const next = await a.startNewScratchpad(newInput(first));
    expect((await a.getActiveScratchpad()).id).toBe(next.current.id);
    for (const [input] of fixture.create.mock.calls) {
      expect(input.type).toBe("tasknotes-scratch");
      expect(input.frontmatter).not.toHaveProperty("scratchpadReservationId");
      expect(input.path?.split("/").some((part) => part.startsWith("."))).toBe(
        false,
      );
    }
  });

  it("converges after simultaneous first opens instead of blocking on duplicates", async () => {
    const { fixture, a, b } = await clients();
    await Promise.all([a.getActiveScratchpad(), b.getActiveScratchpad()]);
    const first = await a.getActiveScratchpad();
    const second = await b.getActiveScratchpad();
    expect(first.id).toBe(second.id);
    expect(activeNotes(fixture)).toHaveLength(1);
    expect(fixture.remove).not.toHaveBeenCalled();
  });

  it("reselects after a concurrent edit rather than demoting a newly edited note", async () => {
    const { fixture, a } = await clients([
      note("older"),
      note("winner", "active", "2026-07-02T00:00:00Z"),
    ]);
    const update = fixture.update.getMockImplementation()!;
    let edited = false;
    fixture.update.mockImplementation(async (...args) => {
      if (!edited && args[0].path === "scratchpads/older.md") {
        edited = true;
        const current = fixture.records.get(args[0].path)!;
        await update({
          path: current.path,
          ifRevision: current.revision,
          patch: { dateModified: "2035-01-01T00:00:00Z" },
          body: "Concurrent writing\n",
        });
      }
      return update(...args);
    });
    expect((await a.getActiveScratchpad()).id).toBe("older");
    expect(activeNotes(fixture)).toHaveLength(1);
    expect(fixture.records.get("scratchpads/older.md")?.body).toBe(
      "Concurrent writing\n",
    );
  });

  it("reuses a replacement created by another window during New note", async () => {
    const { fixture, a, b } = await clients([note("current")]);
    const current = await a.getActiveScratchpad();
    const update = fixture.update.getMockImplementation()!;
    let replacementId: string | undefined;
    fixture.update.mockImplementation(async (...args) => {
      const result = await update(...args);
      if (args[0].path === current.path && args[0].patch?.state === "converted")
        replacementId = (await b.getActiveScratchpad()).id;
      return result;
    });
    const result = await a.startNewScratchpad(newInput(current));
    expect(result.current.id).toBe(replacementId);
    expect(fixture.create).toHaveBeenCalledOnce();
    expect(activeNotes(fixture)).toHaveLength(1);
  });

  it("preserves final edits and recovers when New note creation is interrupted", async () => {
    const { fixture, a, b } = await clients([note("current")]);
    const current = await a.getActiveScratchpad();
    fixture.create.mockRejectedValueOnce(new Error("Creation interrupted"));
    await expect(
      a.startNewScratchpad({ ...newInput(current), body: "Final text\n" }),
    ).rejects.toThrow("Creation interrupted");
    const replacement = await b.getActiveScratchpad();
    expect(replacement.id).not.toBe(current.id);
    expect(fixture.records.get(current.path)).toMatchObject({
      body: "Final text\n",
      frontmatter: { state: "converted" },
    });
    expect(activeNotes(fixture)).toHaveLength(1);
  });

  it("reopens a Resume interrupted after promotion by repairing the duplicate", async () => {
    const { fixture, a, b } = await clients([
      note("current"),
      note("old", "converted"),
    ]);
    const current = await a.getActiveScratchpad();
    const old = (await a.getScratchpad("old"))!;
    const update = fixture.update.getMockImplementation()!;
    let failed = false;
    fixture.update.mockImplementation(async (...args) => {
      if (!failed && args[0].path === current.path) {
        failed = true;
        throw new Error("Demotion interrupted");
      }
      return update(...args);
    });
    await expect(
      a.reactivateScratchpad({ current: ref(current), target: ref(old) }),
    ).rejects.toThrow("Demotion interrupted");
    expect(activeNotes(fixture)).toHaveLength(2);
    expect((await b.getActiveScratchpad()).id).toBe(old.id);
    expect(activeNotes(fixture)).toHaveLength(1);
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it("does not create a note when the active-note query is unavailable", async () => {
    const { fixture, a } = await clients();
    fixture.query.mockRejectedValueOnce(new Error("Collection unavailable"));
    await expect(a.getActiveScratchpad()).rejects.toThrow(
      "Collection unavailable",
    );
    expect(fixture.create).not.toHaveBeenCalled();
  });
});
