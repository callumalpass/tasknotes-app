import { afterEach, describe, expect, it, vi } from "vitest";
import { SCRATCHPAD_TYPE, type ScratchpadDocument } from "../domain/scratchpad";
import { nextTaskFixture } from "../test/next-task-fixture";
import { SCRATCH_IMAGE_TYPE } from "../domain/scratch-image";

const fixtures: Awaited<ReturnType<typeof nextTaskFixture>>[] = [];
async function fixture() {
  const f = await nextTaskFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  fixtures.splice(0).forEach((f) => f.close());
});
function saveInput(note: ScratchpadDocument, body = note.body) {
  return {
    id: note.id,
    path: note.path,
    revision: note.revision,
    baseBody: note.body,
    body,
  };
}
function seed(
  f: Awaited<ReturnType<typeof fixture>>,
  id: string,
  state = "active",
  dateModified = "2026-08-01T10:00:00Z",
  body = "- Original body",
) {
  return f.replica.seed({
    path: `TaskNotes/Scratchpad/${id}.md`,
    types: [SCRATCHPAD_TYPE],
    frontmatter: {
      type: SCRATCHPAD_TYPE,
      id,
      state,
      dateCreated: "2026-08-01T09:00:00Z",
      dateModified,
      title: "Kept title",
    },
    body,
  });
}

function imageInput(id: string, dateCreated = "2026-08-01T12:00:00Z") {
  return {
    id,
    path: `TaskNotes/Scratchpad/Image Metadata/${id}.md`,
    dateCreated,
    file: "TaskNotes/Scratchpad/Images/kept.png",
    digest: `sha256:${"a".repeat(64)}` as const,
    size: 4,
    mediaType: "image/png",
  };
}

describe("native Scratchpad (SDK stand-in, not Core/Noise/LAB)", () => {
  it("orders and pages mixed metadata history independently of binary delivery", async () => {
    const f = await fixture();
    seed(f, "history", "converted");
    seed(f, "current");
    await f.repository.createScratchImage(
      imageInput("first", "2026-08-01T13:00:00Z"),
    );
    await f.repository.createScratchImage(
      imageInput("second", "2026-08-01T12:00:00Z"),
    );
    const pages = vi.spyOn(f.client, "pages");
    const first = await f.repository.listScratchFeed({ limit: 1 });
    expect(first.current.id).toBe("current");
    expect(first.items.map((item) => item.id)).toEqual(["first"]);
    expect(first.nextCursor).toBeTruthy();
    pages.mockClear();
    const second = await f.repository.listScratchFeed({
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.items.map((item) => item.id)).toEqual(["second"]);
    expect(pages).not.toHaveBeenCalled();
    const third = await f.repository.listScratchFeed({
      limit: 1,
      cursor: second.nextCursor,
    });
    expect(third.items.map((item) => item.id)).toEqual(["history"]);
    expect(third.nextCursor).toBeUndefined();
  });

  it("cannot reinstall a feed continuation invalidated by a write during loading", async () => {
    const f = await fixture();
    seed(f, "current");
    await f.repository.createScratchImage(
      imageInput("first", "2026-08-01T13:00:00Z"),
    );
    await f.repository.createScratchImage(
      imageInput("second", "2026-08-01T12:00:00Z"),
    );
    const pages = f.client.pages.bind(f.client);
    let raced = false;
    const spy = vi.spyOn(f.client, "pages").mockImplementation(async function* (
      ...args
    ) {
      for await (const page of pages(...args)) {
        if (!raced && args[0]?.types?.includes(SCRATCH_IMAGE_TYPE)) {
          raced = true;
          await f.repository.createScratchImage(
            imageInput("concurrent", "2026-08-01T14:00:00Z"),
          );
        }
        yield page;
      }
    });
    const first = await f.repository.listScratchFeed({ limit: 1 });
    expect(raced).toBe(true);
    expect(first.nextCursor).toBeTruthy();
    spy.mockClear();
    await f.repository.listScratchFeed({ limit: 1, cursor: first.nextCursor });
    expect(spy).toHaveBeenCalled();
  });

  it("does not return a cached continuation from a suspended scope", async () => {
    const f = await fixture();
    seed(f, "current");
    await f.repository.createScratchImage(imageInput("first"));
    await f.repository.createScratchImage(imageInput("second"));
    const page = await f.repository.listScratchFeed({ limit: 1 });
    expect(page.nextCursor).toBeTruthy();
    f.repository.suspend();
    await expect(
      f.repository.listScratchFeed({ cursor: page.nextCursor }),
    ).rejects.toThrow();
    f.repository.resume();
    const pages = vi.spyOn(f.client, "pages");
    await f.repository.listScratchFeed();
    expect(pages).toHaveBeenCalled();
  });

  it("removes image metadata only and refuses stale revisions", async () => {
    const f = await fixture();
    const image = await f.repository.createScratchImage(imageInput("image"));
    const deleteBinary = vi.spyOn(f.client.files, "delete");
    expect(await f.repository.getScratchImage(image.id, image.path)).toEqual(
      image,
    );
    expect(await f.repository.getScratchImage(image.id, "wrong.md")).toBeNull();
    await expect(
      f.repository.removeScratchImage({ ...image, revision: "stale" }),
    ).rejects.toThrow("changed after it was opened");
    await f.repository.removeScratchImage(image);
    expect(await f.repository.getScratchImage(image.id)).toBeNull();
    expect(deleteBinary).not.toHaveBeenCalled();
  });

  it("lost image-create ACK recovery reads the original native record without recreating", async () => {
    const f = await fixture();
    const input = imageInput("recover");
    const submit = f.client.submit.bind(f.client);
    const spy = vi
      .spyOn(f.client, "submit")
      .mockImplementationOnce(async (...args) => {
        await submit(...args);
        throw new Error("Lost image ACK");
      });
    await expect(f.repository.createScratchImage(input)).rejects.toMatchObject({
      problem: { code: "operation_outcome_unknown" },
    });
    expect((await f.repository.createScratchImage(input)).id).toBe(input.id);
    expect(spy).toHaveBeenCalledOnce();
    await expect(f.repository.createScratchImage(input)).rejects.toThrow(
      "already exists",
    );
  });

  it("refuses invalid image input before submission and invalidates feed snapshots after accepted changes", async () => {
    const f = await fixture();
    const submit = vi.spyOn(f.client, "submit");
    await expect(
      f.repository.createScratchImage({ ...imageInput("bad"), size: -1 }),
    ).rejects.toThrow("invalid image size");
    expect(submit).not.toHaveBeenCalled();
    await f.repository.listScratchFeed();
    await f.repository.createScratchImage(imageInput("new"));
    expect(
      (await f.repository.listScratchFeed()).items.map((item) => item.id),
    ).toContain("new");
  });

  it("lifecycle cancellation cannot turn an unanswered stream into note creation", async () => {
    const f = await fixture();
    const pages = f.client.pages.bind(f.client);
    vi.spyOn(f.client, "pages").mockImplementation(async function* (...args) {
      for await (const page of pages(...args)) {
        f.repository.suspend();
        yield page;
      }
    });
    const submit = vi.spyOn(f.client, "submit");
    await expect(f.repository.getActiveScratchpad()).rejects.toThrow();
    expect(submit).not.toHaveBeenCalled();
  });
  it("creates only after a complete empty query, then reuses the current note", async () => {
    const f = await fixture();
    const submit = vi.spyOn(f.client, "submit");
    const current = await f.repository.getActiveScratchpad();
    expect(current).toMatchObject({ state: "active", body: "" });
    expect((await f.repository.getActiveScratchpad()).id).toBe(current.id);
    expect(submit).toHaveBeenCalledOnce();
    expect(await f.repository.getScratchpad(current.id)).toEqual(current);
  });

  it("saves portable identities to the original native record and rebases only identical bodies", async () => {
    const f = await fixture();
    const native = seed(f, "portable-note");
    const current = await f.repository.getActiveScratchpad();
    expect(current.id).toBe("portable-note");
    expect(native.id).not.toBe(current.id);
    const saved = await f.repository.saveScratchpad({
      ...saveInput(current, "- New body"),
      title: "Edited",
    });
    expect(saved).toMatchObject({
      id: current.id,
      title: "Edited",
      body: "- New body",
    });
    const raw = await f.client.get(native.id, { body: true });
    expect(raw.body).toBe(saved.body);
    await expect(
      f.repository.saveScratchpad(saveInput(current, "- Stale edit")),
    ).rejects.toThrow("changed after it was opened");
    const rebased = await f.repository.saveScratchpad({
      ...saveInput(saved, "- Rebased"),
      revision: current.revision,
    });
    expect(rebased.body).toBe("- Rebased");
  });

  it("archives the edited current note and creates its replacement in one CAS batch", async () => {
    const f = await fixture();
    const current = await f.repository.getActiveScratchpad();
    const submit = vi.spyOn(f.client, "submit");
    const result = await f.repository.startNewScratchpad({
      ...saveInput(current, "- Final body"),
      title: "History title",
    });
    expect(result.previous).toMatchObject({
      id: current.id,
      state: "converted",
      body: "- Final body",
      title: "History title",
    });
    expect(result.current).toMatchObject({ state: "active", body: "" });
    expect(result.current.id).not.toBe(current.id);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]![0].map((op) => op.kind)).toEqual([
      "update",
      "create",
    ]);
    expect(await f.repository.getActiveScratchpad()).toEqual(result.current);
  });

  it("reactivates history atomically without changing identities, paths, bodies, titles or creation dates", async () => {
    const f = await fixture();
    const first = await f.repository.getActiveScratchpad();
    const transition = await f.repository.startNewScratchpad({
      ...saveInput(first, "- Kept"),
      title: "Kept",
    });
    const submit = vi.spyOn(f.client, "submit");
    const result = await f.repository.reactivateScratchpad({
      current: transition.current,
      target: transition.previous,
    });
    expect(result.current).toMatchObject({
      id: transition.previous.id,
      path: transition.previous.path,
      body: "- Kept",
      title: "Kept",
      dateCreated: first.dateCreated,
      state: "active",
    });
    expect(result.previous).toMatchObject({
      id: transition.current.id,
      path: transition.current.path,
      body: transition.current.body,
      dateCreated: transition.current.dateCreated,
      state: "converted",
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]![0].map((op) => op.kind)).toEqual([
      "update",
      "update",
    ]);
  });

  it("repairs duplicate active notes with CAS, preserving note content and selecting the shared-policy winner", async () => {
    const f = await fixture();
    const older = seed(f, "older");
    const newer = seed(
      f,
      "newer",
      "active",
      "2026-08-01T11:00:00Z",
      "- Winner",
    );
    const before = await f.client.get(older.id, { body: true });
    const submit = vi.spyOn(f.client, "submit");
    expect((await f.repository.getActiveScratchpad()).id).toBe("newer");
    const previous = await f.repository.getScratchpad("older");
    expect(previous).toMatchObject({
      state: "converted",
      body: before.body,
      title: "Kept title",
      dateCreated: "2026-08-01T09:00:00Z",
      dateModified: "2026-08-01T10:00:00Z",
    });
    const ops = submit.mock.calls[0]![0];
    expect(ops).toHaveLength(2);
    expect(ops.every((op) => op.kind === "update" && op.ifRevision)).toBe(true);
    expect(ops.map((op) => ("id" in op ? op.id : ""))).toEqual([
      newer.id,
      older.id,
    ]);
    expect(
      (await f.repository.listScratchpads()).documents.filter(
        (note) => note.state === "active",
      ),
    ).toHaveLength(1);
  });

  it("never deletes the current note or a stale historical revision", async () => {
    const f = await fixture();
    const current = await f.repository.getActiveScratchpad();
    await expect(f.repository.deleteScratchpad(current)).rejects.toThrow(
      "Only a previous note",
    );
    const result = await f.repository.startNewScratchpad(saveInput(current));
    await expect(f.repository.deleteScratchpad(current)).rejects.toThrow(
      "changed after it was opened",
    );
    await f.repository.deleteScratchpad(result.previous);
    expect(await f.repository.getScratchpad(current.id)).toBeNull();
    expect((await f.repository.getActiveScratchpad()).id).toBe(
      result.current.id,
    );
  });

  it("lost atomic-transition ACK recovery never submits a second replacement note", async () => {
    const f = await fixture();
    const current = await f.repository.getActiveScratchpad();
    const input = saveInput(current, "- Final");
    const submit = f.client.submit.bind(f.client);
    const spy = vi
      .spyOn(f.client, "submit")
      .mockImplementationOnce(async (...args) => {
        await submit(...args);
        throw new Error("Lost ACK");
      });
    await expect(f.repository.startNewScratchpad(input)).rejects.toMatchObject({
      problem: { code: "operation_outcome_unknown" },
    });
    const result = await f.repository.startNewScratchpad(input);
    expect(result.previous.body).toBe("- Final");
    expect(spy).toHaveBeenCalledOnce();
    expect((await f.repository.listScratchpads()).documents).toHaveLength(2);
  });

  it("uncertain save recovery cannot read a replacement native record with the same portable identity", async () => {
    const f = await fixture();
    const original = seed(f, "portable-note");
    const current = await f.repository.getActiveScratchpad();
    const input = saveInput(current, "- Accepted original");
    const submit = f.client.submit.bind(f.client);
    const spy = vi
      .spyOn(f.client, "submit")
      .mockImplementationOnce(async (...args) => {
        await submit(...args);
        throw new Error("Lost save ACK");
      });
    await expect(f.repository.saveScratchpad(input)).rejects.toMatchObject({
      problem: { code: "operation_outcome_unknown" },
    });
    await (
      await f.client.delete(original.id)
    ).confirmed;
    seed(f, "portable-note", "active", "2026-08-01T12:00:00Z", "- Replacement");
    spy.mockClear();
    await expect(f.repository.saveScratchpad(input)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(spy).not.toHaveBeenCalled();
    expect((await f.repository.getScratchpad(current.id))!.body).toBe(
      "- Replacement",
    );
  });

  it("rejected atomic transitions leave both notes unchanged", async () => {
    const f = await fixture();
    const current = await f.repository.getActiveScratchpad();
    f.replica.setOnline(false);
    const transition = f.repository.startNewScratchpad(
      saveInput(current, "- Unaccepted"),
    );
    await vi.waitFor(async () =>
      expect((await f.client.pendingWrites()).length).toBe(1),
    );
    const pending = (await f.client.pendingWrites())[0]!;
    f.replica.reject(pending.receipt.mutation, {
      code: "conflict",
      recovery: "refresh",
      message: "Changed at head",
    });
    await expect(transition).rejects.toMatchObject({ code: "conflict" });
    expect(await f.repository.getScratchpad(current.id)).toEqual(current);
    expect((await f.repository.listScratchpads()).documents).toHaveLength(1);
  });

  it("rejects ambiguous portable note identities before any mutation", async () => {
    const f = await fixture();
    seed(f, "duplicate");
    f.replica.seed({
      path: "TaskNotes/Scratchpad/other.md",
      types: [SCRATCHPAD_TYPE],
      frontmatter: {
        type: SCRATCHPAD_TYPE,
        id: "duplicate",
        state: "active",
        dateCreated: "2026-08-01T09:00:00Z",
        dateModified: "2026-08-01T10:00:00Z",
      },
      body: "- Different",
    });
    const submit = vi.spyOn(f.client, "submit");
    await expect(f.repository.getActiveScratchpad()).rejects.toThrow(
      "same portable Scratchpad identity",
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it("an incomplete authoritative query cannot create a current note", async () => {
    const f = await fixture();
    vi.spyOn(f.client, "pages").mockImplementation(async function* () {
      yield { records: [], complete: false, asOf: 0 };
    });
    const submit = vi.spyOn(f.client, "submit");
    await expect(f.repository.getActiveScratchpad()).rejects.toThrow(
      "complete scratchpad stream",
    );
    expect(submit).not.toHaveBeenCalled();
  });
});
