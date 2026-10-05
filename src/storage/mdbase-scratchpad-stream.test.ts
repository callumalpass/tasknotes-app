import { describe, expect, it, vi } from "vitest";
import { connectError } from "@mdbase-dev/connect-testing";

import {
  deferred,
  mdbaseFixture,
  type TestRecord,
} from "../test/mdbase-fixture";
import { MdbaseTaskRepository } from "./mdbase-repository";

function scratchpad(
  id: string,
  dateCreated: string,
  state: "active" | "converted" = "converted",
): TestRecord {
  return {
    path:
      state === "active" ? "scratchpads/Scratchpad.md" : `scratchpads/${id}.md`,
    revision: `r-${id}`,
    types: ["tasknotes-scratch"],
    frontmatter: {
      type: "tasknotes-scratch",
      id,
      state,
      dateCreated,
      dateModified: "2020-01-01T00:00:00.000Z",
    },
    body: `- [ ] ${id}\n`,
  };
}

// Mirror the selected connection coordinator's admission limits: four active
// foreground reads plus 32 queued. Microtask completion keeps the regression
// deterministic without network timing, sleeps or widened test timeouts.
function limitFixtureReads(fixture: ReturnType<typeof mdbaseFixture>) {
  const read = fixture.read.getMockImplementation()!;
  const waiting: Array<() => void> = [];
  let active = 0;
  let peakAdmitted = 0;
  let rejected = 0;
  fixture.read.mockImplementation(async (input) => {
    if (active === 4) {
      if (waiting.length === 32) {
        rejected++;
        throw connectError(
          "connector_busy",
          "The selected connection request queue is full.",
          { operationOutcome: "not_sent", status: 503 },
        );
      }
      const admitted = new Promise<void>((resolve) => waiting.push(resolve));
      peakAdmitted = Math.max(peakAdmitted, active + waiting.length);
      await admitted;
    } else {
      active++;
      peakAdmitted = Math.max(peakAdmitted, active + waiting.length);
    }
    try {
      await Promise.resolve();
      return await read(input);
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  });
  return { peak: () => peakAdmitted, rejected: () => rejected };
}

function imageRecord(index: number): TestRecord {
  return {
    path: `scratch-images/image-${index}.md`,
    revision: `image-r${index}`,
    types: ["tasknotes-scratch-image"],
    frontmatter: {
      type: "tasknotes-scratch-image",
      id: `image-${index}`,
      dateCreated: "2026-07-02T00:00:00.000Z",
      dateModified: "2026-07-02T00:00:00.000Z",
      file: `Scratchpad Images/image-${index}.png`,
      digest: `sha256:${"a".repeat(64)}`,
      size: 12,
      mediaType: "image/png",
    },
    body: "",
  };
}

describe("mdbase scratchpad stream", () => {
  it.each([
    { notes: 50, images: 20 },
    { notes: 2, images: 50 },
  ])(
    "loads $notes previous notes and $images images within the connection read slots",
    async ({ notes, images }) => {
      const initial = [
        scratchpad("current", "2026-07-03T00:00:00.000Z", "active"),
        ...Array.from({ length: notes }, (_, index) =>
          scratchpad(`history-${index}`, "2026-07-01T00:00:00.000Z"),
        ),
        ...Array.from({ length: images }, (_, index) => imageRecord(index)),
      ];
      const fixture = mdbaseFixture(initial);
      const admission = limitFixtureReads(fixture);
      const repository = new MdbaseTaskRepository(fixture.connect);
      await repository.initialize();
      const page = await repository.listScratchFeed({ limit: 100 });
      expect(page.current.id).toBe("current");
      expect(page.items).toHaveLength(notes + images);
      for (const record of initial.filter(
        (record) => record.frontmatter.state !== "active",
      )) {
        const item = page.items.find(
          (item) => item.id === record.frontmatter.id,
        );
        expect(item).toMatchObject({
          path: record.path,
          revision: record.revision,
        });
        if (item?.kind === "scratchpad") expect(item.body).toBe(record.body);
      }
      expect(admission.rejected()).toBe(0);
      expect(admission.peak()).toBeLessThanOrEqual(4);
      expect(fixture.create).not.toHaveBeenCalled();
      // History query bodies are unnecessary while beta.123 still needs point
      // reads for revision tokens. Do not download every note body twice.
      expect(fixture.query).not.toHaveBeenCalledWith(
        expect.objectContaining({
          types: ["tasknotes-scratch"],
          includeBody: true,
        }),
      );
      repository.dispose();
    },
  );
  it("propagates failed reads without creating a replacement active note", async () => {
    const fixture = mdbaseFixture([
      scratchpad("current", "2026-07-03T00:00:00.000Z", "active"),
      scratchpad("history", "2026-07-01T00:00:00.000Z"),
    ]);
    const read = fixture.read.getMockImplementation()!;
    const failure = connectError(
      "connector_busy",
      "The selected connection request queue is full.",
    );
    fixture.read.mockRejectedValueOnce(failure);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    await expect(repository.getActiveScratchpad()).rejects.toBe(failure);
    expect(fixture.create).not.toHaveBeenCalled();
    fixture.read.mockImplementation(async (input) => {
      if (input.path === "scratchpads/history.md") throw failure;
      return read(input);
    });
    await expect(repository.listScratchFeed()).rejects.toBe(failure);
    expect(fixture.create).not.toHaveBeenCalled();
    fixture.read.mockImplementation(read);
    expect((await repository.listScratchFeed()).items).toHaveLength(1);
    repository.dispose();
  });

  it("stops scheduling further record batches when the foreground scope is cancelled", async () => {
    const fixture = mdbaseFixture([
      scratchpad("current", "2026-07-03T00:00:00.000Z", "active"),
      ...Array.from({ length: 12 }, (_, index) =>
        scratchpad(`history-${index}`, "2026-07-01T00:00:00.000Z"),
      ),
    ]);
    const started = deferred<void>();
    const release = deferred<void>();
    const read = fixture.read.getMockImplementation()!;
    let historyReads = 0;
    fixture.read.mockImplementation(async (input) => {
      if (input.path !== "scratchpads/Scratchpad.md") {
        if (++historyReads === 3) started.resolve();
        await release.promise;
      }
      return read(input);
    });
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const loading = repository.listScratchFeed();
    const rejected = expect(loading).rejects.toMatchObject({
      name: "AbortError",
    });
    await started.promise;
    repository.suspend();
    release.resolve();
    await rejected;
    expect(historyReads).toBe(3); // The first four-slot batch also includes current.
    expect(fixture.create).not.toHaveBeenCalled();
    repository.dispose();
  });

  it("loads only the explicitly active note on the current-note fast path", async () => {
    const fixture = mdbaseFixture([
      scratchpad("old", "2026-07-01T00:00:00.000Z"),
      scratchpad("current", "2026-07-03T00:00:00.000Z", "active"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    await repository.getActiveScratchpad();
    fixture.query.mockClear();
    fixture.read.mockClear();

    const current = await repository.getActiveScratchpad();

    expect(current.id).toBe("current");
    expect(fixture.query).toHaveBeenCalledWith(
      expect.objectContaining({
        types: ["tasknotes-scratch"],
        where: 'record.state == "active"',
        includeBody: false,
      }),
    );
    expect(fixture.read).toHaveBeenCalledOnce();
    expect(fixture.read).toHaveBeenCalledWith(
      { path: "scratchpads/Scratchpad.md" },
      expect.anything(),
    );
  });

  it("selects from every note when the authority cannot evaluate the active filter", async () => {
    const fixture = mdbaseFixture([
      scratchpad("old", "2026-07-01T00:00:00.000Z"),
      scratchpad("current", "2026-07-03T00:00:00.000Z", "active"),
    ]);
    const query = fixture.query.getMockImplementation()!;
    // Observed from an authority without the expression's namespace: every
    // record is reported as a warning and the valid result is empty.
    fixture.query.mockImplementation(async (input) => {
      if (
        Array.isArray(input?.types) &&
        input.types.includes("tasknotes-scratch") &&
        typeof input.where === "string"
      )
        return {
          valid: true,
          result: { results: [] },
          diagnostics: [...fixture.records.values()].map((record) => ({
            severity: "warning" as const,
            code: "expression_evaluation_error",
            field: "where",
            message: "No such overload",
            path: record.path,
          })),
        } as unknown as Awaited<ReturnType<typeof query>>;
      return query(input);
    });
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();

    expect((await repository.getActiveScratchpad()).id).toBe("current");
    expect((await repository.listScratchFeed()).current.id).toBe("current");
    expect(
      fixture.create.mock.calls.filter(
        ([input]) => input.type === "tasknotes-scratch",
      ),
    ).toHaveLength(0);
  });

  it("deletes a previous note only at the revision the caller holds", async () => {
    const fixture = mdbaseFixture([
      scratchpad("old", "2026-07-01T00:00:00.000Z"),
      scratchpad("current", "2026-07-03T00:00:00.000Z", "active"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const current = await repository.getActiveScratchpad();
    const old = (await repository.listScratchFeed()).items.find(
      (item) => item.id === "old",
    )!;

    await expect(
      repository.deleteScratchpad({
        id: current.id,
        path: current.path,
        revision: current.revision,
      }),
    ).rejects.toThrow("Only a previous note can be deleted.");
    await expect(
      repository.deleteScratchpad({
        id: old.id,
        path: old.path,
        revision: "stale",
      }),
    ).rejects.toThrow("Reload it before deleting.");
    expect(fixture.remove).not.toHaveBeenCalled();

    await repository.deleteScratchpad({
      id: old.id,
      path: old.path,
      revision: old.revision,
    });

    expect(fixture.remove).toHaveBeenCalledWith(
      { path: old.path, ifRevision: old.revision },
      expect.anything(),
    );
    expect(fixture.records.has(old.path)).toBe(false);
    const page = await repository.listScratchFeed();
    expect(page.current.id).toBe("current");
    expect(page.items.map(({ id }) => id)).not.toContain("old");
  });

  it("repairs multiple active notes without changing contents or deleting files", async () => {
    const fixture = mdbaseFixture([
      scratchpad("current-a", "2026-07-02T00:00:00.000Z", "active"),
      {
        ...scratchpad("current-b", "2026-07-03T00:00:00.000Z", "active"),
        path: "scratchpads/Current B.md",
      },
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();

    const before = [...fixture.records.values()].map((record) =>
      structuredClone(record),
    );
    expect((await repository.getActiveScratchpad()).id).toBe("current-b");
    const page = await repository.listScratchpads();
    expect(
      page.documents.filter((note) => note.state === "active"),
    ).toHaveLength(1);
    expect(page.documents.find((note) => note.id === "current-a")?.state).toBe(
      "converted",
    );
    for (const note of before) {
      expect(fixture.records.get(note.path)).toMatchObject({
        path: note.path,
        body: note.body,
        frontmatter: {
          id: note.frontmatter.id,
          dateCreated: note.frontmatter.dateCreated,
        },
      });
    }
    expect(fixture.remove).not.toHaveBeenCalled();
  });

  it("pages typed documents in stable creation order and saves history", async () => {
    const fixture = mdbaseFixture([
      scratchpad("old", "2026-07-01T00:00:00.000Z"),
      scratchpad("same-a", "2026-07-02T00:00:00.000Z"),
      scratchpad("same-b", "2026-07-02T00:00:00.000Z"),
      scratchpad("current", "2026-07-03T00:00:00.000Z", "active"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();

    const first = await repository.listScratchpads({ limit: 2 });
    expect(first.documents.map(({ id }) => id)).toEqual(["current", "same-b"]);
    const second = await repository.listScratchpads({
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.documents.map(({ id }) => id)).toEqual(["same-a", "old"]);

    const historical = (await repository.getScratchpad("old"))!;
    await fixture.connect.update({
      path: historical.path,
      ifRevision: historical.revision,
      patch: { dateModified: "2031-01-01T00:00:00.000Z" },
      body: historical.body,
    });
    const saved = await repository.saveScratchpad({
      id: historical.id,
      path: historical.path,
      revision: historical.revision,
      baseBody: historical.body,
      body: "- [ ] edited history\n",
    });
    expect(saved.state).toBe("converted");
    expect(saved.body).toContain("edited history");
  });

  it("saves malformed Markdown, unrelated edits, and a later repair", async () => {
    const fixture = mdbaseFixture([
      scratchpad("current", "2026-07-03T00:00:00.000Z", "active"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const current = await repository.getActiveScratchpad();
    fixture.update.mockClear();

    const malformed = await repository.saveScratchpad({
      id: current.id,
      path: current.path,
      revision: current.revision,
      baseBody: current.body,
      body: "- [ ] Draft [[Plan\n- [ ] [[]]\n",
    });
    expect(fixture.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: malformed.body }),
      expect.anything(),
    );

    const titled = await repository.saveScratchpad({
      id: malformed.id,
      path: malformed.path,
      revision: malformed.revision,
      baseBody: malformed.body,
      body: malformed.body,
      title: "Ideas",
    });
    expect(titled).toMatchObject({ title: "Ideas", body: malformed.body });

    await expect(
      repository.saveScratchpad({
        id: titled.id,
        path: titled.path,
        revision: titled.revision,
        baseBody: titled.body,
        body: "- [ ] Draft [[Plan]]\n- [ ] [[Plan]]\n",
      }),
    ).resolves.toMatchObject({
      title: "Ideas",
      body: "- [ ] Draft [[Plan]]\n- [ ] [[Plan]]\n",
    });
    expect(fixture.update).toHaveBeenCalledTimes(3);
  });

  it("saves, preserves, and clears an explicit title independently of the body", async () => {
    const fixture = mdbaseFixture([
      scratchpad("current", "2026-07-03T00:00:00.000Z", "active"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const current = await repository.getActiveScratchpad();
    const titled = await repository.saveScratchpad({
      id: current.id,
      path: current.path,
      revision: current.revision,
      baseBody: current.body,
      body: current.body,
      title: "Research ideas",
    });
    const bodySaved = await repository.saveScratchpad({
      id: titled.id,
      path: titled.path,
      revision: titled.revision,
      baseBody: titled.body,
      body: "- [ ] A different first point\n",
    });
    expect(bodySaved.title).toBe("Research ideas");
    const cleared = await repository.saveScratchpad({
      id: bodySaved.id,
      path: bodySaved.path,
      revision: bodySaved.revision,
      baseBody: bodySaved.body,
      body: bodySaved.body,
      title: "",
    });
    expect(cleared.title).toBe("");
    expect(fixture.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ title: "" }),
      }),
      expect.anything(),
    );
  });

  it("stores and mixes independent image metadata, and removal never deletes bytes", async () => {
    const fixture = mdbaseFixture([
      scratchpad("old", "2026-07-01T00:00:00.000Z"),
      scratchpad("current", "2026-07-03T00:00:00.000Z", "active"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const deleteBinary = vi.spyOn(repository.files, "delete");
    const image = await repository.createScratchImage({
      id: "image-1",
      path: "scratch-images/image-1.md",
      dateCreated: "2026-07-02T00:00:00.000Z",
      file: "Scratchpad Images/image-1.png",
      digest: `sha256:${"a".repeat(64)}`,
      size: 12,
      mediaType: "image/png",
      width: 4,
      height: 3,
    });

    expect(
      (await repository.listScratchFeed()).items.map((item) => [
        item.kind,
        item.id,
      ]),
    ).toEqual([
      ["image", "image-1"],
      ["scratchpad", "old"],
    ]);
    expect((await repository.getScratchImage(image.id, image.path))?.file).toBe(
      image.file,
    );
    await repository.removeScratchImage(image);
    expect(await repository.getScratchImage(image.id, image.path)).toBeNull();
    expect(deleteBinary).not.toHaveBeenCalled();
  });

  it("creates a timestamped current document beside converted legacy data", async () => {
    const fixture = mdbaseFixture([
      scratchpad("stranded", "2026-07-03T00:00:00.000Z", "active"),
    ]);
    const stranded = fixture.records.get("scratchpads/Scratchpad.md")!;
    await fixture.connect.update({
      path: stranded.path,
      ifRevision: stranded.revision,
      patch: {
        state: "converted",
        title: "Interrupted archive",
        dateConverted: "2026-07-04T00:00:00.000Z",
      },
      body: stranded.body,
    });
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();

    const page = await repository.listScratchpads();

    expect(
      page.documents.filter(({ state }) => state === "active"),
    ).toHaveLength(1);
    expect(page.documents.find(({ id }) => id === "stranded")).toMatchObject({
      state: "converted",
      title: "Interrupted archive",
    });
    expect(fixture.records.get("scratchpads/Scratchpad.md")).toMatchObject({
      frontmatter: { state: "converted" },
    });
    expect(
      page.documents.find(({ state }) => state === "active")?.path,
    ).toMatch(
      /^TaskNotes\/Scratchpad\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z – .+\.md$/,
    );
  });

  it("reactivates history without changing note identity or content", async () => {
    const fixture = mdbaseFixture([
      {
        ...scratchpad("old", "2026-07-01T00:00:00.000Z"),
        frontmatter: {
          ...scratchpad("old", "2026-07-01T00:00:00.000Z").frontmatter,
          title: "Earlier plan",
          dateConverted: "2026-07-02T00:00:00.000Z",
        },
      },
      scratchpad("current", "2026-07-03T00:00:00.000Z", "active"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const current = await repository.getActiveScratchpad();
    const target = (await repository.getScratchpad("old"))!;
    fixture.update.mockClear();

    const result = await repository.reactivateScratchpad({
      current: {
        id: current.id,
        path: current.path,
        revision: current.revision,
      },
      target: {
        id: target.id,
        path: target.path,
        revision: target.revision,
      },
    });

    expect(result.current).toMatchObject({
      id: target.id,
      path: target.path,
      state: "active",
      title: "Earlier plan",
      body: target.body,
      dateCreated: target.dateCreated,
    });
    expect(result.current.dateConverted).toBe("2026-07-02T00:00:00.000Z");
    expect(result.previous).toMatchObject({
      id: current.id,
      path: current.path,
      state: "converted",
      body: current.body,
      dateConverted: expect.any(String),
    });
    const noteUpdates = fixture.update.mock.calls;
    expect(noteUpdates).toHaveLength(2);
    expect(
      noteUpdates.find(([input]) => input.path === target.path)?.[0].patch,
    ).not.toHaveProperty("dateConverted");
    expect(
      fixture.create.mock.calls.filter(
        ([input]) => input.type === "tasknotes-scratch",
      ),
    ).toHaveLength(0);
    expect(fixture.rename).not.toHaveBeenCalled();
    expect((await repository.getActiveScratchpad()).id).toBe(target.id);
    expect((await repository.listScratchFeed()).items[0]).toMatchObject({
      kind: "scratchpad",
      id: current.id,
    });
  });

  it("rejects stale reactivation before changing either note", async () => {
    const fixture = mdbaseFixture([
      scratchpad("old", "2026-07-01T00:00:00.000Z"),
      scratchpad("current", "2026-07-03T00:00:00.000Z", "active"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const current = await repository.getActiveScratchpad();
    const target = (await repository.getScratchpad("old"))!;
    fixture.update.mockClear();

    await expect(
      repository.reactivateScratchpad({
        current: {
          id: current.id,
          path: current.path,
          revision: "stale",
        },
        target: {
          id: target.id,
          path: target.path,
          revision: target.revision,
        },
      }),
    ).rejects.toThrow("changed after it was opened");
    expect(fixture.update).not.toHaveBeenCalled();
  });

  it("recovers an accepted reactivation when a note-state write fails", async () => {
    const fixture = mdbaseFixture([
      scratchpad("old", "2026-07-01T00:00:00.000Z"),
      scratchpad("current", "2026-07-03T00:00:00.000Z", "active"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const current = await repository.getActiveScratchpad();
    const target = (await repository.getScratchpad("old"))!;
    const update = fixture.update.getMockImplementation()!;
    let demotionFailed = false;
    fixture.update.mockImplementation(async (...args) => {
      const [input] = args;
      if (
        !demotionFailed &&
        input.path === current.path &&
        input.patch?.state === "converted"
      ) {
        demotionFailed = true;
        throw new Error("Second write failed");
      }
      return update(...args);
    });

    await expect(
      repository.reactivateScratchpad({
        current: {
          id: current.id,
          path: current.path,
          revision: current.revision,
        },
        target: {
          id: target.id,
          path: target.path,
          revision: target.revision,
        },
      }),
    ).rejects.toThrow("Second write failed");

    const reopened = new MdbaseTaskRepository({
      ...fixture.connect,
    } as typeof fixture.connect);
    await reopened.initialize();
    expect(await reopened.getActiveScratchpad()).toMatchObject({
      id: target.id,
      state: "active",
      body: target.body,
    });
    expect(await reopened.getScratchpad(current.id)).toMatchObject({
      id: current.id,
      state: "converted",
      body: current.body,
    });
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it("preserves the current document and creates exactly one replacement", async () => {
    const fixture = mdbaseFixture([
      scratchpad("current", "2026-07-03T00:00:00.000Z", "active"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    const current = await repository.getActiveScratchpad();
    fixture.query.mockClear();
    fixture.read.mockClear();
    fixture.rename.mockClear();

    const result = await repository.startNewScratchpad({
      id: current.id,
      path: current.path,
      revision: current.revision,
      baseBody: current.body,
      body: current.body,
      title: "Current notes",
    });

    expect(result.previous).toMatchObject({
      id: "current",
      path: current.path,
      state: "converted",
      title: "Current notes",
    });
    expect(result.current).toMatchObject({ state: "active", body: "" });
    expect(result.current.path).not.toBe(current.path);
    expect(fixture.query).toHaveBeenCalled();
    expect(
      fixture.create.mock.calls.filter(
        ([input]) => input.type === "tasknotes-scratch",
      ),
    ).toHaveLength(1);
    expect(fixture.rename).not.toHaveBeenCalled();
    expect(
      (await repository.listScratchpads({ limit: 20 })).documents.filter(
        ({ state }) => state === "active",
      ),
    ).toHaveLength(1);
  });
});
