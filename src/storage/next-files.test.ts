import { describe, expect, it, vi } from "vitest";
import { Write, type MdbaseClient, type wire } from "@mdbase-dev/sdk";
import { NextCollectionFileStore } from "./next-files";
import { nextTaskFixture } from "../test/next-task-fixture";

type Files = Pick<
  MdbaseClient["files"],
  "grant" | "list" | "get" | "upload" | "downloadStream" | "move" | "delete"
>;
const id = "11111111-1111-4111-8111-111111111111";
const digest: `sha256:${string}` = `sha256:${"a".repeat(64)}`;
function view(): wire.FileView {
  return {
    id,
    path: "Attachments/test.png",
    size: 3,
    digest,
    media: "image",
    mediaType: "image/png",
    state: "materialized",
    confirmedSeq: 1,
    mtime: 0,
  };
}
function write(state: "pending" | "confirmed" = "confirmed") {
  return Object.assign(new Write({ mutation: id, state }), { fileId: id });
}
function fixture() {
  const owner = new AbortController();
  const api = {
    grant: {
      actions: ["list", "read", "add", "replace", "move", "delete"],
      scope: { kind: "collection" },
    } as Files["grant"],
    list: vi.fn<Files["list"]>().mockImplementation(async function* () {
      yield view();
    }),
    get: vi.fn<Files["get"]>().mockImplementation(async () => view()),
    upload: vi.fn<Files["upload"]>().mockImplementation(async () => write()),
    downloadStream: vi.fn<Files["downloadStream"]>(),
    move: vi.fn<Files["move"]>().mockImplementation(async () => write()),
    delete: vi.fn<Files["delete"]>().mockImplementation(async () => write()),
  } satisfies Files;
  return {
    api,
    owner,
    store: new NextCollectionFileStore(api, () => owner.signal),
  };
}
function stream(
  bytes = new Uint8Array([1, 2, 3]),
  file: Promise<wire.FileView> = Promise.resolve(view()),
) {
  return Object.assign(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    { file },
  );
}

// Files-port stand-ins exercise adapter translation only, not native/LAB custody.
describe("original SDK collection files adapter", () => {
  it("maps actual metadata and current grants without inventing timestamps or media types", async () => {
    const { api, store, owner } = fixture();
    const [file] = await store.list({ folder: "Attachments" });
    expect(file).toMatchObject({
      fileId: id,
      revision: digest,
      contentDigest: digest,
      modifiedAt: "1970-01-01T00:00:00.000Z",
      mediaType: "image/png",
    });
    expect(api.list).toHaveBeenCalledWith({
      folder: "Attachments",
      signal: expect.any(AbortSignal),
    });
    api.list.mockImplementation(async function* () {
      yield { ...view(), mtime: undefined, mediaType: undefined };
    });
    expect((await store.list())[0]).not.toHaveProperty("modifiedAt");
    expect((await store.list())[0]).not.toHaveProperty("mediaType");
    api.grant = {
      actions: ["read"],
      scope: { kind: "selected_folders", folders: ["Attachments"] },
    };
    expect([...store.authorizedActions()]).toEqual(["read"]);
    api.grant = null;
    expect(store.authorizedActions().size).toBe(0);
    owner.abort();
    expect(store.authorizedActions().size).toBe(0);
  });

  it("waits for the original upload confirmation and reads its actual native ID", async () => {
    const { api, store } = fixture();
    const original = write("pending");
    api.upload.mockResolvedValue(original);
    const finished = vi.fn();
    const result = store
      .upload(view().path, new Uint8Array([1, 2, 3]), {
        transferId: id,
        mediaType: "wrong/type",
      })
      .then((file) => {
        finished();
        return file;
      });
    await vi.waitFor(() => expect(api.upload).toHaveBeenCalledOnce());
    expect(finished).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
    original.update({ mutation: id, state: "confirmed" });
    expect(await result).toMatchObject({ fileId: id, mediaType: "image/png" });
    expect(api.get).toHaveBeenCalledWith(id, expect.any(AbortSignal));
    expect(api.upload.mock.calls[0][2]).toMatchObject({ transferId: id });
    expect(api.upload.mock.calls[0][2]).not.toHaveProperty("mediaType");
    expect(api.upload).toHaveBeenCalledOnce();
  });

  it("retains replacement identity/CAS and rejects stale replacement before submission", async () => {
    const { api, store } = fixture();
    const source = new Uint8Array([0, 1, 2, 3, 0]).subarray(1, 4);
    await store.upload(view().path, source, {
      ifRevision: digest,
      transferId: id,
    });
    expect(api.upload.mock.calls[0][1]).toEqual(new Uint8Array([1, 2, 3]));
    expect(api.upload.mock.calls[0][2]).toMatchObject({
      fileId: id,
      ifRevision: digest,
      transferId: id,
    });
    api.get.mockResolvedValue({
      ...view(),
      digest: `sha256:${"b".repeat(64)}`,
    });
    await expect(
      store.upload(view().path, source, { ifRevision: digest }),
    ).rejects.toThrow("file changed");
    expect(api.upload).toHaveBeenCalledOnce();
  });

  it("pins current digest, validates the stream header and buffers only the exact stream", async () => {
    const { api, store } = fixture();
    const [file] = await store.list();
    api.downloadStream.mockImplementation(() => stream());
    const blob = await store.download(file);
    expect(blob.size).toBe(3);
    expect(blob.type).toBe("image/png");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(api.downloadStream).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        revision: digest,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each(["id", "digest", "size"] as const)(
    "refuses a changed stream %s before exposing bytes",
    async (field) => {
      const { api, store } = fixture();
      const [file] = await store.list();
      const actual = {
        ...view(),
        [field]:
          field === "size"
            ? 4
            : field === "digest"
              ? `sha256:${"b".repeat(64)}`
              : "22222222-2222-4222-8222-222222222222",
      };
      const cancel = vi.fn();
      api.downloadStream.mockImplementation(() =>
        Object.assign(new ReadableStream<Uint8Array>({ cancel }), {
          file: Promise.resolve(actual),
        }),
      );
      await expect(store.downloadStream(file)).rejects.toThrow("file changed");
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it.each([2, 4])(
    "rejects short/long stream EOF or byte count (%i bytes)",
    async (size) => {
      const { api, store } = fixture();
      const [file] = await store.list();
      api.downloadStream.mockImplementation(() => stream(new Uint8Array(size)));
      await expect(store.download(file)).rejects.toThrow("file changed");
    },
  );

  it("keeps buffered download capped without limiting streaming", async () => {
    const { api, store } = fixture();
    const [file] = await store.list();
    await expect(
      store.download({ ...file, size: 64 * 1024 * 1024 + 1 }),
    ).rejects.toThrow("too large");
    expect(api.downloadStream).not.toHaveBeenCalled();
  });

  it("fences move/delete by original identity and revision and forwards mutation IDs", async () => {
    const { api, store } = fixture();
    const [file] = await store.list();
    api.get
      .mockResolvedValueOnce(view())
      .mockResolvedValueOnce({ ...view(), path: "Attachments/moved.png" });
    expect(
      await store.move(file, "Attachments/moved.png", { mutationId: id }),
    ).toMatchObject({ fileId: id, path: "Attachments/moved.png" });
    expect(api.move).toHaveBeenCalledWith(
      view(),
      "Attachments/moved.png",
      expect.objectContaining({ ifRevision: digest, mutationId: id }),
    );
    await store.delete(file, { mutationId: id });
    expect(api.delete).toHaveBeenCalledWith(
      view(),
      expect.objectContaining({ ifRevision: digest, mutationId: id }),
    );
    api.get.mockResolvedValue({
      ...view(),
      digest: `sha256:${"b".repeat(64)}`,
    });
    await expect(store.delete(file)).rejects.toThrow("file changed");
    expect(api.delete).toHaveBeenCalledOnce();
  });

  it("preserves caller/owner aborts and genuine errors without replaying uploads", async () => {
    const { api, store, owner } = fixture();
    const error = new Error("genuine refusal");
    api.upload.mockRejectedValue(error);
    await expect(store.upload(view().path, new Uint8Array(3))).rejects.toBe(
      error,
    );
    expect(api.upload).toHaveBeenCalledOnce();
    const caller = new AbortController();
    caller.abort(error);
    await expect(store.list({ signal: caller.signal })).rejects.toBe(error);
    expect(api.list).not.toHaveBeenCalled();
    owner.abort(error);
    await expect(
      store.delete({
        fileId: id,
        path: view().path,
        size: 3,
        revision: digest,
        contentDigest: digest,
        mediaClass: "image",
      }),
    ).rejects.toBe(error);
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("retiring a pending upload stops waiting without replacing its original receipt", async () => {
    const { api, store, owner } = fixture();
    const original = write("pending");
    api.upload.mockResolvedValue(original);
    const result = store.upload(view().path, new Uint8Array(3));
    await vi.waitFor(() => expect(api.upload).toHaveBeenCalledOnce());
    const reason = new Error("original scope retired");
    owner.abort(reason);
    await expect(result).rejects.toBe(reason);
    // The receipt can still settle in its SDK owner; no second submission/read.
    original.update({ mutation: id, state: "confirmed" });
    await original.confirmed;
    expect(api.upload).toHaveBeenCalledOnce();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("round-trips upload/read/delete through the actual SDK files API", async () => {
    const fixture = await nextTaskFixture();
    try {
      const file = await fixture.repository.files.upload(
        "Attachments/sdk.png",
        new Uint8Array([1, 2, 3]),
      );
      expect(file.fileId).toMatch(/^[0-9a-f-]{36}$/);
      expect(file.contentDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      const downloaded = await fixture.repository.files.download(file);
      expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(
        new Uint8Array([1, 2, 3]),
      );
      await fixture.repository.files.delete(file);
      expect(await fixture.repository.files.list()).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  it("is exposed by the real next repository and retires with its original adapter", async () => {
    const fixture = await nextTaskFixture();
    expect(fixture.repository.files).toBeInstanceOf(NextCollectionFileStore);
    fixture.repository.dispose();
    await expect(fixture.repository.files.list()).rejects.toThrow();
    fixture.close();
  });
});
