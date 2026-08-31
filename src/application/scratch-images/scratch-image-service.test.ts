import { describe, expect, it, vi } from "vitest";
import { ScratchImageService } from "./scratch-image-service";
import type { TaskRepository } from "../ports/task-repository";

function setup(overrides: { wrongDigest?: boolean } = {}) {
  const createScratchImage = vi.fn(async (input) => ({
    kind: "image",
    ...input,
    revision: "r1",
    dateModified: input.dateCreated,
  }));
  const upload = vi.fn(async (path: string, source: Blob) => {
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      await source.arrayBuffer(),
    );
    const digest =
      `sha256:${[...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("")}` as const;
    return {
      fileId: "f1",
      path,
      revision: "r1",
      contentDigest: overrides.wrongDigest
        ? (`sha256:${"0".repeat(64)}` as const)
        : digest,
      size: source.size,
      mediaType: source.type,
      mediaClass: "image" as const,
      modifiedAt: "2026-01-01T00:00:00.000Z",
    };
  });
  const repository = {
    files: { upload },
    createScratchImage,
  } as unknown as TaskRepository;
  return {
    service: new ScratchImageService(repository),
    upload,
    createScratchImage,
  };
}

function png(marker = 0) {
  return new Blob(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker])],
    { type: "image/png" },
  );
}

describe("ScratchImageService", () => {
  it("uploads and verifies bytes before creating metadata", async () => {
    const { service, createScratchImage } = setup();
    const image = await service.add(png());
    expect(image.file).toMatch(/^TaskNotes\/Scratchpad\/Images\//);
    expect(image.path).toMatch(/^TaskNotes\/Scratchpad\/Image Metadata\//);
    expect(createScratchImage).toHaveBeenCalledWith(
      expect.objectContaining({
        size: 9,
        mediaType: "image/png",
        digest: expect.stringMatching(/^sha256:/),
      }),
    );
  });

  it("does not create metadata for an unverified upload", async () => {
    const { service, createScratchImage } = setup({ wrongDigest: true });
    await expect(service.add(png())).rejects.toThrow(/verified/);
    expect(createScratchImage).not.toHaveBeenCalled();
  });

  it("rejects SVG and coalesces an identical rapid paste", async () => {
    const { service, upload } = setup();
    await expect(
      service.add(new Blob(["svg"], { type: "image/svg+xml" })),
    ).rejects.toThrow(/Add an/);
    const blob = png(1);
    const [left, right] = await Promise.all([
      service.add(blob),
      service.add(blob),
    ]);
    expect(left.id).toBe(right.id);
    expect(upload).toHaveBeenCalledOnce();
  });

  it("rejects bytes that merely claim an image media type", async () => {
    const { service, upload } = setup();
    await expect(
      service.add(new Blob(["not an image"], { type: "image/png" })),
    ).rejects.toThrow(/valid supported raster/);
    expect(upload).not.toHaveBeenCalled();
  });
});
