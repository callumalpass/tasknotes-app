import { describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../test/memory-vault";
import { VaultCollectionFileStore } from "./vault-files";

describe("VaultCollectionFileStore", () => {
  it("round-trips an image without changing its bytes", async () => {
    const vault = new MemoryVault();
    const store = new VaultCollectionFileStore(vault);
    const bytes = Uint8Array.from([0, 255, 12, 99, 1]);
    const progress = vi.fn();

    const uploaded = await store.upload("Attachments/photo.jpg", bytes, {
      mediaType: "image/jpeg",
      onProgress: progress,
    });

    expect(uploaded).toMatchObject({
      path: "Attachments/photo.jpg",
      size: 5,
      mediaType: "image/jpeg",
      mediaClass: "image",
    });
    expect(uploaded.contentDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(
      new Uint8Array(await (await store.download(uploaded)).arrayBuffer()),
    ).toEqual(bytes);
    expect(await store.list({ folder: "Attachments" })).toEqual([uploaded]);
    expect(progress).toHaveBeenLastCalledWith({
      phase: "uploading",
      transferredBytes: 5,
      totalBytes: 5,
    });
  });

  it("honors revision guards and safe image paths", async () => {
    const store = new VaultCollectionFileStore(new MemoryVault());
    const uploaded = await store.upload(
      "Attachments/photo.png",
      Uint8Array.of(1),
    );

    await expect(
      store.upload("Attachments/photo.png", Uint8Array.of(2), {
        ifRevision: "stale",
      }),
    ).rejects.toThrow("revision conflict");
    await expect(
      store.upload("../photo.png", Uint8Array.of(1)),
    ).rejects.toThrow("Unsafe collection path");
    await expect(
      store.upload("Attachments/file.txt", Uint8Array.of(1)),
    ).rejects.toThrow("supported image format");
    await expect(
      store.upload("Attachments/disguised.png", Uint8Array.of(1), {
        mediaType: "image/svg+xml",
      }),
    ).rejects.toThrow("does not match");
    expect(await store.download(uploaded)).toBeInstanceOf(Blob);
  });

  it("moves and deletes files", async () => {
    const store = new VaultCollectionFileStore(new MemoryVault());
    const uploaded = await store.upload(
      "Attachments/one.webp",
      Uint8Array.of(1, 2),
    );
    const moved = await store.move(uploaded, "Attachments/two.webp");

    expect(moved.path).toBe("Attachments/two.webp");
    expect((await store.list()).map(({ path }) => path)).toEqual([
      "Attachments/two.webp",
    ]);
    await store.delete(moved);
    expect(await store.list()).toEqual([]);
  });

  it("does not reread unchanged image bytes when listing descriptors", async () => {
    const vault = new MemoryVault();
    await vault.writeBinary("Attachments/photo.png", Uint8Array.of(1, 2, 3));
    const readBinary = vi.spyOn(vault, "readBinary");
    const store = new VaultCollectionFileStore(vault);

    const first = await store.list();
    const second = await store.list();

    expect(second).toEqual(first);
    expect(readBinary).toHaveBeenCalledTimes(1);
  });
});
