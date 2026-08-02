import { describe, expect, it } from "vitest";

import type {
  CollectionFile,
  CollectionFileAction,
  CollectionFileStore,
} from "../application/ports/collection-file-store";
import { LocalFirstMdbaseFileStore } from "./local-first-mdbase-files";

describe("LocalFirstMdbaseFileStore", () => {
  it("durably accepts bytes offline and resumes the same upload after restart", async () => {
    const remote = new MemoryRemote();
    remote.online = false;
    const collectionId = crypto.randomUUID();
    const first = new LocalFirstMdbaseFileStore(remote, collectionId);
    const bytes = Uint8Array.from([137, 80, 78, 71, 4, 2]);

    const pending = await first.upload("Attachments/offline.png", bytes, {
      mediaType: "image/png",
    });
    expect(pending).toMatchObject({
      pending: "upload",
      availability: "local",
    });
    expect(await first.list()).toHaveLength(1);
    expect(
      new Uint8Array(await (await first.download(pending)).arrayBuffer()),
    ).toEqual(bytes);

    remote.online = true;
    const restarted = new LocalFirstMdbaseFileStore(remote, collectionId);
    await restarted.sync();
    const [synced] = await restarted.list();
    expect(synced).toMatchObject({
      path: "Attachments/offline.png",
      availability: "local-and-remote",
    });
    expect(synced?.pending).toBeUndefined();
    expect(remote.uploadIds).toHaveLength(1);
    expect(
      new Uint8Array(await (await remote.download(synced!)).arrayBuffer()),
    ).toEqual(bytes);
  });

  it("hides an offline deletion immediately and finishes it on reconnect", async () => {
    const remote = new MemoryRemote();
    const store = new LocalFirstMdbaseFileStore(remote, crypto.randomUUID());
    const uploaded = await store.upload(
      "Attachments/remove.jpg",
      Uint8Array.of(1, 2, 3),
      { mediaType: "image/jpeg" },
    );
    remote.online = false;

    await store.delete(uploaded);
    expect(await store.list()).toEqual([]);
    expect(remote.files).toHaveLength(1);

    remote.online = true;
    await store.sync();
    expect(remote.files).toEqual([]);
    expect(await store.list()).toEqual([]);
  });

  it("reconciles files removed directly from the hosted authority", async () => {
    const remote = new MemoryRemote();
    const store = new LocalFirstMdbaseFileStore(remote, crypto.randomUUID());
    const uploaded = await store.upload(
      "Attachments/removed-elsewhere.jpg",
      Uint8Array.of(1),
      { mediaType: "image/jpeg" },
    );
    await store.download(uploaded);
    remote.files = [];
    remote.bytes.clear();

    expect(await store.list()).toEqual([]);
  });

  it("discards cached bytes when another client replaces the remote file", async () => {
    const remote = new MemoryRemote();
    const store = new LocalFirstMdbaseFileStore(remote, crypto.randomUUID());
    const original = await store.upload(
      "Attachments/replaced.png",
      Uint8Array.of(1, 2, 3),
      { mediaType: "image/png" },
    );
    await store.download(original);

    const replacement = await remote.upload(
      original.path,
      Uint8Array.of(9, 8, 7, 6),
      { mediaType: "image/png" },
    );
    const [listed] = await store.list();

    expect(listed?.contentDigest).toBe(replacement.contentDigest);
    expect(listed?.availability).toBe("remote");
    expect(
      new Uint8Array(await (await store.download(listed!)).arrayBuffer()),
    ).toEqual(Uint8Array.of(9, 8, 7, 6));
  });

  it("preserves operation order when an offline move is followed by delete", async () => {
    const remote = new MemoryRemote();
    const store = new LocalFirstMdbaseFileStore(remote, crypto.randomUUID());
    const uploaded = await store.upload(
      "Attachments/original.jpg",
      Uint8Array.of(1, 2),
      { mediaType: "image/jpeg" },
    );
    remote.online = false;

    const moved = await store.move(uploaded, "Attachments/moved.jpg");
    await store.delete(moved);
    expect(await store.list()).toEqual([]);

    remote.online = true;
    remote.failDelete = true;
    await expect(store.sync()).rejects.toThrow("Delete unavailable");
    expect(remote.files.map(({ path }) => path)).toEqual([
      "Attachments/moved.jpg",
    ]);
    expect(await store.list()).toEqual([]);

    remote.failDelete = false;
    await store.sync();
    expect(remote.files).toEqual([]);
    expect(await store.list()).toEqual([]);
  });
});

class MemoryRemote implements CollectionFileStore {
  online = true;
  failDelete = false;
  files: CollectionFile[] = [];
  readonly bytes = new Map<string, Blob>();
  readonly uploadIds: string[] = [];

  authorizedActions(): ReadonlySet<CollectionFileAction> {
    return new Set(["list", "read", "add", "replace", "move", "delete"]);
  }

  async list(): Promise<CollectionFile[]> {
    this.requireOnline();
    return structuredClone(this.files);
  }

  async upload(
    path: string,
    source: Blob | ArrayBuffer | ArrayBufferView,
    options: { mediaType?: string; transferId?: string } = {},
  ): Promise<CollectionFile> {
    this.requireOnline();
    const blob = source instanceof Blob ? source : new Blob([owned(source)]);
    const existing = this.files.find((candidate) => candidate.path === path);
    const file: CollectionFile = {
      fileId: existing?.fileId ?? crypto.randomUUID(),
      path,
      revision: crypto.randomUUID(),
      contentDigest: await digest(blob),
      size: blob.size,
      mediaType: options.mediaType,
      mediaClass: options.mediaType?.startsWith("image/") ? "image" : "other",
      modifiedAt: new Date().toISOString(),
    };
    this.files = [
      ...this.files.filter((candidate) => candidate.path !== path),
      file,
    ];
    this.bytes.set(file.fileId, blob);
    if (options.transferId) this.uploadIds.push(options.transferId);
    return file;
  }

  async download(file: CollectionFile): Promise<Blob> {
    this.requireOnline();
    return this.bytes.get(file.fileId)!;
  }

  async downloadStream(
    file: CollectionFile,
  ): Promise<ReadableStream<Uint8Array>> {
    return (await this.download(file)).stream();
  }

  async move(file: CollectionFile, path: string): Promise<CollectionFile> {
    this.requireOnline();
    const moved = { ...file, path, revision: crypto.randomUUID() };
    this.files = [
      ...this.files.filter(({ fileId }) => fileId !== file.fileId),
      moved,
    ];
    return moved;
  }

  async delete(file: CollectionFile): Promise<void> {
    this.requireOnline();
    if (this.failDelete) throw new Error("Delete unavailable");
    this.files = this.files.filter(({ fileId }) => fileId !== file.fileId);
    this.bytes.delete(file.fileId);
  }

  private requireOnline(): void {
    if (!this.online) throw new TypeError("Network unavailable");
  }
}

function owned(source: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  const bytes = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function digest(blob: Blob): Promise<`sha256:${string}`> {
  const value = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return `sha256:${[...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}
