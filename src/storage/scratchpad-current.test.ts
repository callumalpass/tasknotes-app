import { connectError } from "@mdbase-dev/connect-testing";
import { describe, expect, it } from "vitest";
import {
  deferred,
  mdbaseFixture,
  type TestRecord,
} from "../test/mdbase-fixture";
import { MdbaseTaskRepository } from "./mdbase-repository";
import { SCRATCHPAD_CURRENT_PATH } from "./scratchpad-current";

function note(
  id: string,
  state: "active" | "converted" = "converted",
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
      dateCreated: "2026-07-01T00:00:00.000Z",
      dateModified: "2026-07-02T00:00:00.000Z",
    },
    body: `Notes for ${id}\n`,
  };
}

async function clients(records: TestRecord[] = []) {
  const fixture = mdbaseFixture(records);
  // Distinct SDK connections model separate tabs/devices, not a shared lock.
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

describe("authority-coordinated scratchpad lifecycle", () => {
  it("uses visible record paths accepted by Connect throughout the lifecycle", async () => {
    const { fixture, a, b } = await clients();
    await expect(
      fixture.connect.read({ path: "TaskNotes/Scratchpad/.current.md" }),
    ).rejects.toThrow("hidden filesystem components");
    await expect(
      fixture.connect.create({
        path: "TaskNotes/Scratchpad/.current.md",
        frontmatter: {},
        body: "",
      }),
    ).rejects.toThrow("hidden filesystem components");
    fixture.read.mockClear();
    fixture.create.mockClear();
    const first = await a.getActiveScratchpad();
    const next = await a.startNewScratchpad(newInput(first));
    const historical = (await b.getScratchpad(first.id))!;
    await b.reactivateScratchpad({
      current: ref(next.current),
      target: ref(historical),
    });
    expect((await a.getActiveScratchpad()).id).toBe(first.id);
    expect(activeNotes(fixture)).toHaveLength(1);
    for (const calls of [
      fixture.read.mock.calls,
      fixture.create.mock.calls,
      fixture.update.mock.calls,
    ]) {
      for (const [input] of calls)
        expect(
          input.path?.split("/").some((component) => component.startsWith(".")),
        ).toBe(false);
    }
  });

  it("creates only one note when two clients open an empty collection", async () => {
    const { fixture, a, b } = await clients();
    const [first, second] = await Promise.all([
      a.getActiveScratchpad(),
      b.getActiveScratchpad(),
    ]);
    expect(first.id).toBe(second.id);
    expect(activeNotes(fixture)).toHaveLength(1);
    expect(
      [...fixture.records.values()].filter(
        (record) => record.frontmatter.type === "tasknotes-scratch",
      ),
    ).toHaveLength(1);
    expect((await a.listScratchFeed()).items).toEqual([]);
  });

  it("uses authority-generated IDs instead of assuming on_create preserves the supplied UUID", async () => {
    const { fixture, a, b } = await clients();
    const create = fixture.create.getMockImplementation()!;
    fixture.create.mockImplementation(async (...args) => {
      const [input] = args;
      return create(
        input.type === "tasknotes-scratch"
          ? {
              ...input,
              frontmatter: { ...input.frontmatter, id: crypto.randomUUID() },
            }
          : input,
      );
    });
    const [first, second] = await Promise.all([
      a.getActiveScratchpad(),
      b.getActiveScratchpad(),
    ]);
    expect(first.id).toBe(second.id);
    expect(first.id).not.toBe(
      fixture.records.get(first.path)?.frontmatter.scratchpadReservationId,
    );
    const result = await a.startNewScratchpad(newInput(first));
    expect(
      fixture.records.get(SCRATCHPAD_CURRENT_PATH)?.frontmatter.currentId,
    ).toBe(result.current.id);
    expect((await b.getActiveScratchpad()).id).toBe(result.current.id);
    expect(activeNotes(fixture)).toHaveLength(1);
  });

  it("recovers a generated identity after interruption between creation and pointer binding", async () => {
    const { fixture, a, b } = await clients();
    const create = fixture.create.getMockImplementation()!;
    fixture.create.mockImplementation(async (...args) => {
      const [input] = args;
      return create(
        input.type === "tasknotes-scratch"
          ? {
              ...input,
              frontmatter: {
                ...input.frontmatter,
                id: "authority-generated-id",
              },
            }
          : input,
      );
    });
    fixture.update.mockRejectedValueOnce(
      new Error("Identity bind interrupted"),
    );
    await expect(a.getActiveScratchpad()).rejects.toThrow(
      "Identity bind interrupted",
    );
    expect((await b.getActiveScratchpad()).id).toBe("authority-generated-id");
    expect(activeNotes(fixture)).toHaveLength(1);
    expect(
      fixture.create.mock.calls.filter(
        ([input]) => input.type === "tasknotes-scratch",
      ),
    ).toHaveLength(1);
  });

  it("repairs existing duplicates deterministically across clients", async () => {
    const initial = [note("b", "active"), note("a", "active"), note("old")];
    const { fixture, a, b } = await clients(initial);
    const [first, second] = await Promise.all([
      a.getActiveScratchpad(),
      b.getActiveScratchpad(),
    ]);
    expect(first.id).toBe("a");
    expect(second.id).toBe("a");
    expect(activeNotes(fixture)).toHaveLength(1);
    for (const record of initial) {
      expect(fixture.records.get(record.path)).toMatchObject({
        path: record.path,
        body: record.body,
        frontmatter: {
          id: record.frontmatter.id,
          title: record.frontmatter.title,
          dateCreated: record.frontmatter.dateCreated,
        },
      });
    }
    expect(fixture.remove).not.toHaveBeenCalled();
  });

  it("allows only one concurrent New note and leaves no abandoned candidate", async () => {
    const { fixture, a, b } = await clients([note("current", "active")]);
    const current = await a.getActiveScratchpad();
    const results = await Promise.allSettled([
      a.startNewScratchpad(newInput(current)),
      b.startNewScratchpad(newInput(current)),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(activeNotes(fixture)).toHaveLength(1);
    expect(
      [...fixture.records.values()].filter(
        (record) => record.frontmatter.type === "tasknotes-scratch",
      ),
    ).toHaveLength(2);
    expect((await a.getActiveScratchpad()).id).toBe(
      (await b.getActiveScratchpad()).id,
    );
    expect(fixture.records.get(current.path)?.body).toBe(current.body);
  });

  it("another client helps finish New note rather than creating its own during the gap", async () => {
    const { fixture, a, b } = await clients([note("current", "active")]);
    const current = await a.getActiveScratchpad();
    const entered = deferred<void>();
    const release = deferred<void>();
    const create = fixture.create.getMockImplementation()!;
    let paused = false;
    fixture.create.mockImplementation(async (...args) => {
      if (!paused && args[0].type === "tasknotes-scratch") {
        paused = true;
        entered.resolve();
        await release.promise;
      }
      return create(...args);
    });
    const starting = a.startNewScratchpad(newInput(current));
    await entered.promise;
    const assisted = await b.getActiveScratchpad();
    release.resolve();
    const result = await starting;
    expect(result.current.id).toBe(assisted.id);
    expect(activeNotes(fixture)).toHaveLength(1);
    expect((await a.listScratchFeed()).items).toHaveLength(1);
  });

  it("recovers New note after a restart when candidate creation failed", async () => {
    const { fixture, a } = await clients([note("current", "active")]);
    const current = await a.getActiveScratchpad();
    fixture.create.mockRejectedValueOnce(new Error("Connection interrupted"));
    await expect(
      a.startNewScratchpad({
        ...newInput(current),
        body: "Unsaved final text\n",
      }),
    ).rejects.toThrow("Connection interrupted");
    expect(
      fixture.records.get(SCRATCHPAD_CURRENT_PATH)?.frontmatter.pending,
    ).toBe(true);
    const reopened = new MdbaseTaskRepository({
      ...fixture.connect,
    } as typeof fixture.connect);
    await reopened.initialize();
    expect((await reopened.getActiveScratchpad()).id).not.toBe(current.id);
    expect(activeNotes(fixture)).toHaveLength(1);
    expect(fixture.records.get(current.path)).toMatchObject({
      body: "Unsaved final text\n",
      frontmatter: { state: "converted" },
    });
    expect(
      fixture.records.get(SCRATCHPAD_CURRENT_PATH)?.frontmatter.pending,
    ).toBeUndefined();
  });

  it("only accepts one of two competing Resume operations", async () => {
    const { fixture, a, b } = await clients([
      note("current", "active"),
      note("one"),
      note("two"),
    ]);
    const current = await a.getActiveScratchpad();
    const one = (await a.getScratchpad("one"))!;
    const two = (await b.getScratchpad("two"))!;
    const results = await Promise.allSettled([
      a.reactivateScratchpad({ current: ref(current), target: ref(one) }),
      b.reactivateScratchpad({ current: ref(current), target: ref(two) }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(activeNotes(fixture)).toHaveLength(1);
    expect((await a.getActiveScratchpad()).id).toBe(
      (await b.getActiveScratchpad()).id,
    );
    for (const record of [current, one, two])
      expect(fixture.records.get(record.path)?.body).toBe(record.body);
  });

  it("finishes a Resume interrupted between demotion and promotion", async () => {
    const { fixture, a, b } = await clients([
      note("current", "active"),
      note("old"),
    ]);
    const current = await a.getActiveScratchpad();
    const target = (await a.getScratchpad("old"))!;
    const update = fixture.update.getMockImplementation()!;
    let failed = false;
    fixture.update.mockImplementation(async (...args) => {
      if (
        !failed &&
        args[0].path === target.path &&
        args[0].patch?.state === "active"
      ) {
        failed = true;
        throw new Error("Promotion interrupted");
      }
      return update(...args);
    });
    await expect(
      a.reactivateScratchpad({ current: ref(current), target: ref(target) }),
    ).rejects.toThrow("Promotion interrupted");
    expect(activeNotes(fixture)).toHaveLength(0);
    expect((await b.getActiveScratchpad()).id).toBe(target.id);
    expect(activeNotes(fixture)).toHaveLength(1);
    expect(
      fixture.create.mock.calls.filter(
        ([input]) => input.type === "tasknotes-scratch",
      ),
    ).toHaveLength(0);
  });

  it("handles connected-computer path_conflict diagnostics during bootstrap", async () => {
    const { fixture, a, b } = await clients();
    const create = fixture.create.getMockImplementation()!;
    fixture.create.mockImplementation(async (...args) => {
      if (fixture.records.has(args[0].path!)) {
        throw connectError("operation_invalid", "File already exists", {
          details: {
            diagnostics: [{ code: "path_conflict", severity: "error" }],
          },
        });
      }
      return create(...args);
    });
    const [first, second] = await Promise.all([
      a.getActiveScratchpad(),
      b.getActiveScratchpad(),
    ]);
    expect(first.id).toBe(second.id);
    expect(activeNotes(fixture)).toHaveLength(1);
  });

  it("a delayed helper cannot demote a note resumed by a newer transition", async () => {
    const { fixture, a, b } = await clients([note("original", "active")]);
    const original = await a.getActiveScratchpad();
    const entered = deferred<void>();
    const release = deferred<void>();
    const update = fixture.update.getMockImplementation()!;
    let paused = false;
    fixture.update.mockImplementation(async (...args) => {
      if (
        !paused &&
        args[0].path === original.path &&
        args[0].patch?.state === "converted"
      ) {
        paused = true;
        entered.resolve();
        await release.promise;
      }
      return update(...args);
    });
    const starting = a.startNewScratchpad(newInput(original));
    await entered.promise;
    const next = await b.getActiveScratchpad();
    const historical = (await b.getScratchpad(original.id))!;
    await b.reactivateScratchpad({
      current: ref(next),
      target: ref(historical),
    });
    release.resolve();
    await starting;
    expect((await a.getActiveScratchpad()).id).toBe(original.id);
    expect(activeNotes(fixture).map((record) => record.frontmatter.id)).toEqual(
      [original.id],
    );
    expect(fixture.records.get(original.path)?.body).toBe(original.body);
  });

  it("does not overwrite a record occupying the coordination path", async () => {
    const occupied = { ...note("unrelated"), path: SCRATCHPAD_CURRENT_PATH };
    const { fixture, a } = await clients([occupied]);
    await expect(a.getActiveScratchpad()).rejects.toThrow(
      "current-note record is invalid",
    );
    expect(fixture.records.get(occupied.path)).toEqual(occupied);
    expect(fixture.update).not.toHaveBeenCalled();
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it("does not mistake an unavailable pointer read for a missing record", async () => {
    const { fixture, a } = await clients();
    fixture.read.mockRejectedValueOnce(
      connectError("access_denied", "Access denied"),
    );
    await expect(a.getActiveScratchpad()).rejects.toThrow("Access denied");
    expect(fixture.create).not.toHaveBeenCalled();
  });
});
