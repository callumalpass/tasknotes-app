import { describe, expect, it, vi } from "vitest";

import { mdbaseFixture, type TestRecord } from "../test/mdbase-fixture";
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
      dateModified: "2030-01-01T00:00:00.000Z",
    },
    body: `- [ ] ${id}\n`,
  };
}

describe("mdbase scratchpad stream", () => {
  it("loads only the explicitly active note on the current-note fast path", async () => {
    const fixture = mdbaseFixture([
      scratchpad("old", "2026-07-01T00:00:00.000Z"),
      scratchpad("current", "2026-07-03T00:00:00.000Z", "active"),
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();
    fixture.query.mockClear();
    fixture.read.mockClear();

    const current = await repository.getActiveScratchpad();

    expect(current.id).toBe("current");
    expect(fixture.query).toHaveBeenCalledWith(
      expect.objectContaining({
        types: ["tasknotes-scratch"],
        where: 'note.state == "active"',
        includeBody: false,
        frontmatterMode: "persisted",
        limit: 2,
      }),
      expect.anything(),
    );
    expect(fixture.read).toHaveBeenCalledOnce();
    expect(fixture.read).toHaveBeenCalledWith(
      { path: "scratchpads/Scratchpad.md" },
      expect.anything(),
    );
  });

  it("rejects multiple active notes on the current-note fast path", async () => {
    const fixture = mdbaseFixture([
      scratchpad("current-a", "2026-07-02T00:00:00.000Z", "active"),
      {
        ...scratchpad("current-b", "2026-07-03T00:00:00.000Z", "active"),
        path: "scratchpads/Current B.md",
      },
    ]);
    const repository = new MdbaseTaskRepository(fixture.connect);
    await repository.initialize();

    await expect(repository.getActiveScratchpad()).rejects.toThrow(
      "More than one active scratchpad was found",
    );
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
    expect(fixture.query).not.toHaveBeenCalled();
    expect(fixture.read).toHaveBeenCalledTimes(1);
    expect(fixture.rename).not.toHaveBeenCalled();
    expect(
      (await repository.listScratchpads({ limit: 20 })).documents.filter(
        ({ state }) => state === "active",
      ),
    ).toHaveLength(1);
  });
});
