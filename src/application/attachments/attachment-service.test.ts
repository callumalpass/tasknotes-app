import { describe, expect, it, vi } from "vitest";

import { MdbaseTaskRepository } from "../../storage/mdbase-repository";
import { createTestMdbaseRepository } from "../../test/mdbase-fixture";
import { MemoryCollectionFileStore } from "../../test/memory-collection-files";
import { AttachmentService } from "./attachment-service";

import type { TaskRepository } from "../ports/task-repository";

describe("AttachmentService", () => {
  it("makes frontmatter membership authoritative and keeps detach non-destructive", async () => {
    const { repository, files } = await fixture();
    const task = await repository.create({
      title: "Expense report",
      body: "Notes",
    });
    const service = new AttachmentService(repository);

    const attached = await service.attachImage(
      task.id,
      new File([Uint8Array.of(1, 2, 3)], "Receipt Photo.PNG", {
        type: "image/png",
      }),
    );

    expect(attached.reference).toMatch(
      /^\[\[Attachments\/[0-9a-f-]+-Receipt-Photo\.png\]\]$/,
    );
    expect(attached.task.attachments).toEqual([attached.reference]);
    expect(attached.task.frontmatter.attachments).toEqual([attached.reference]);
    expect(attached.task.body).toBe("Notes");
    expect(
      new Uint8Array(await (await files.download(attached.file)).arrayBuffer()),
    ).toEqual(Uint8Array.of(1, 2, 3));

    const detached = await service.detach(task.id, attached.reference);
    expect(detached.attachments).toEqual([]);
    expect(
      await repository.files!.list({ folder: "Attachments" }),
    ).toHaveLength(1);
  });

  it("keeps Notes presentation outside binary and membership persistence", async () => {
    const { repository } = await fixture();
    const task = await repository.create({
      title: "Visual task",
      body: "Context",
    });
    const result = await new AttachmentService(repository).attachImage(
      task.id,
      new File([Uint8Array.of(9)], "diagram.webp", { type: "image/webp" }),
    );

    expect(result.task.attachments).toEqual([result.reference]);
    expect(result.task.body).toBe("Context");
  });

  it("names unnamed blobs and resolves missing or invalid memberships honestly", async () => {
    const { repository } = await fixture();
    const task = await repository.create({ title: "Pasted image" });
    const service = new AttachmentService(repository);
    const result = await service.attachImage(
      task.id,
      new Blob([Uint8Array.of(6)]),
    );

    expect(result.file.path).toMatch(
      /^Attachments\/[0-9a-f-]+-image-[0-9]+\.png$/,
    );
    await expect(service.currentTask(task.id)).resolves.toMatchObject({
      id: task.id,
    });
    await expect(
      service.resolve({
        ...result.task,
        attachments: [result.reference, "https://example.com/remote.png"],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        reference: result.reference,
        path: result.file.path,
        file: result.file,
      }),
      { reference: "https://example.com/remote.png" },
    ]);
  });

  it("validates existing inline insertion without mutating Notes", async () => {
    const { repository } = await fixture();
    const task = await repository.create({ title: "Existing image" });
    const service = new AttachmentService(repository);
    const attached = await service.attachImage(
      task.id,
      new File([Uint8Array.of(4)], "existing.gif", { type: "image/gif" }),
    );

    await expect(
      service.assertInlineInsertable(task.id, attached.reference),
    ).resolves.toBeUndefined();
    expect((await repository.get(task.id))?.body).toBe("");

    await service.detach(task.id, attached.reference);
    await expect(
      service.assertInlineInsertable(task.id, attached.reference),
    ).rejects.toThrow("Attach this image");
    await repository.update(task.id, { attachments: [attached.reference] });
    await repository.files!.delete(attached.file);
    await expect(
      service.assertInlineInsertable(task.id, attached.reference),
    ).rejects.toThrow("file is missing");
  });

  it("rejects disguised or mismatched image media types", async () => {
    const { repository } = await fixture();
    const task = await repository.create({ title: "Unsafe image" });
    const service = new AttachmentService(repository);

    await expect(
      service.attachImage(
        task.id,
        new File(["<svg/>"], "disguised.png", { type: "image/svg+xml" }),
      ),
    ).rejects.toThrow("Choose an AVIF");
    expect(await repository.files!.list({ folder: "Attachments" })).toEqual([]);
  });

  it("rejects unavailable storage and missing tasks", async () => {
    const unavailable = new AttachmentService({
      files: undefined,
    } as TaskRepository);
    expect(unavailable.available()).toBe(false);
    await expect(
      unavailable.attachImage("missing", new Blob([Uint8Array.of(1)])),
    ).rejects.toThrow("does not provide attachment storage");

    const { repository } = await fixture();
    const service = new AttachmentService(repository);
    await expect(
      service.attachImage(
        "missing",
        new File([Uint8Array.of(1)], "missing.png", { type: "image/png" }),
      ),
    ).rejects.toThrow("Task not found");
  });

  it("cleans a journaled link when storage rejects before writing bytes", async () => {
    const { repository } = await fixture();
    const task = await repository.create({ title: "Storage full" });
    const service = new AttachmentService(repository);
    vi.spyOn(repository.files!, "upload").mockRejectedValueOnce(
      new Error("Storage full"),
    );

    await expect(
      service.attachImage(
        task.id,
        new File([Uint8Array.of(1)], "full.png", { type: "image/png" }),
      ),
    ).rejects.toThrow("Storage full");
    await service.recover();
    expect((await repository.get(task.id))?.attachments).toEqual([]);
    expect(await repository.files!.list({ folder: "Attachments" })).toEqual([]);
  });

  it("recovers frontmatter linking after bytes were saved but the record write failed", async () => {
    const { repository } = await fixture();
    const task = await repository.create({ title: "Recover me" });
    const update = repository.update.bind(repository);
    repository.update = vi
      .fn()
      .mockRejectedValueOnce(new Error("record write interrupted"))
      .mockImplementation(update);
    const service = new AttachmentService(repository);

    await expect(
      service.attachImage(
        task.id,
        new File([Uint8Array.of(8)], "recover.png", { type: "image/png" }),
      ),
    ).rejects.toThrow("record write interrupted");
    expect((await repository.get(task.id))?.attachments).toEqual([]);

    await new AttachmentService(repository).recover();
    expect((await repository.get(task.id))?.attachments).toHaveLength(1);
    expect(
      await repository.files!.list({ folder: "Attachments" }),
    ).toHaveLength(1);
  });

  it("recovers an ambiguous upload that wrote bytes before reporting failure", async () => {
    const { repository } = await fixture();
    const task = await repository.create({ title: "Interrupted upload" });
    const service = new AttachmentService(repository);
    const upload = repository.files!.upload.bind(repository.files);
    vi.spyOn(repository.files!, "upload").mockImplementationOnce(
      async (...arguments_) => {
        await upload(...arguments_);
        throw new Error("Bridge response was lost");
      },
    );

    const result = await service.attachImage(
      task.id,
      new File([Uint8Array.of(1, 2, 3)], "ambiguous.png", {
        type: "image/png",
      }),
    );

    expect((await repository.get(task.id))?.attachments).toEqual([
      result.reference,
    ]);
    expect(
      await repository.files!.list({ folder: "Attachments" }),
    ).toHaveLength(1);
  });

  it("rejects and cleans a truncated ambiguous native write", async () => {
    const { repository } = await fixture();
    const task = await repository.create({
      title: "Interrupted partial upload",
    });
    const service = new AttachmentService(repository);
    const upload = repository.files!.upload.bind(repository.files);
    vi.spyOn(repository.files!, "upload").mockImplementationOnce(
      async (path, _source, options) => {
        await upload(
          path,
          new Blob([Uint8Array.of(1)], { type: "image/png" }),
          options,
        );
        throw new Error("Bridge response was lost after a partial write");
      },
    );

    await expect(
      service.attachImage(
        task.id,
        new File([Uint8Array.of(1, 2, 3)], "partial.png", {
          type: "image/png",
        }),
      ),
    ).rejects.toThrow("partial write");
    expect((await repository.get(task.id))?.attachments).toEqual([]);
    expect(await repository.files!.list({ folder: "Attachments" })).toEqual([]);
    await expect(service.recover()).resolves.toBeUndefined();
  });

  it("rejects a successful write whose returned descriptor fails integrity", async () => {
    const { repository } = await fixture();
    const task = await repository.create({ title: "Dishonest provider" });
    const service = new AttachmentService(repository);
    const upload = repository.files!.upload.bind(repository.files);
    const deleteFile = vi
      .spyOn(repository.files!, "delete")
      .mockRejectedValueOnce(new Error("cleanup deferred"));
    vi.spyOn(repository.files!, "upload").mockImplementationOnce(
      async (...arguments_) => ({
        ...(await upload(...arguments_)),
        size: 0,
      }),
    );

    await expect(
      service.attachImage(
        task.id,
        new File([Uint8Array.of(1, 2)], "integrity.png", {
          type: "image/png",
        }),
      ),
    ).rejects.toThrow("did not preserve every byte");
    expect(deleteFile).toHaveBeenCalledOnce();
    expect((await repository.get(task.id))?.attachments).toEqual([]);
  });

  it("drops recovery intent safely when its task was deleted", async () => {
    const { repository } = await fixture();
    const task = await repository.create({ title: "Deleted during linking" });
    const update = repository.update.bind(repository);
    repository.update = vi
      .fn()
      .mockRejectedValueOnce(new Error("record write interrupted"))
      .mockImplementation(update);
    const service = new AttachmentService(repository);

    await expect(
      service.attachImage(
        task.id,
        new File([Uint8Array.of(2)], "orphan.png", { type: "image/png" }),
      ),
    ).rejects.toThrow("record write interrupted");
    await repository.delete(task.id);
    await service.recover();
    await expect(service.recover()).resolves.toBeUndefined();
    expect(
      await repository.files!.list({ folder: "Attachments" }),
    ).toHaveLength(1);
  });
});

async function fixture(): Promise<{
  repository: MdbaseTaskRepository;
  files: MemoryCollectionFileStore;
}> {
  const repository = createTestMdbaseRepository();
  const files = new MemoryCollectionFileStore();
  Object.defineProperty(repository, "files", { value: files });
  await repository.initialize();
  return { repository, files };
}
