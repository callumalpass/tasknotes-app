import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownCollection } from "../../storage/collection";
import { TaskIndex } from "../../storage/index";
import { IndexedMarkdownRepository } from "../../storage/repository";
import { MemoryVault } from "../../test/memory-vault";
import { AttachmentService } from "./attachment-service";

import type { TaskRepository } from "../ports/task-repository";

const indexes: TaskIndex[] = [];

afterEach(async () => {
  await Promise.all(indexes.splice(0).map((index) => index.delete()));
});

describe("AttachmentService", () => {
  it("makes frontmatter membership authoritative and keeps detach non-destructive", async () => {
    const { repository, vault } = await fixture();
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
    expect(await vault.readBinary(attached.file.path)).toEqual(
      Uint8Array.of(1, 2, 3),
    );

    const detached = await service.detach(task.id, attached.reference);
    expect(detached.attachments).toEqual([]);
    expect(
      await repository.files!.list({ folder: "Attachments" }),
    ).toHaveLength(1);
  });

  it("treats inline insertion as explicit presentation in addition to membership", async () => {
    const { repository } = await fixture();
    const task = await repository.create({
      title: "Visual task",
      body: "Context",
    });
    const result = await new AttachmentService(repository).insertImageInline(
      task.id,
      new File([Uint8Array.of(9)], "diagram.webp", { type: "image/webp" }),
    );

    expect(result.task.attachments).toEqual([result.reference]);
    expect(result.task.body).toBe(`Context\n\n!${result.reference}\n`);
  });

  it("inserts an existing image idempotently and rejects missing membership or bytes", async () => {
    const { repository } = await fixture();
    const task = await repository.create({ title: "Existing image" });
    const service = new AttachmentService(repository);
    const attached = await service.attachImage(
      task.id,
      new File([Uint8Array.of(4)], "existing.gif", { type: "image/gif" }),
    );

    const inserted = await service.insertExistingInline(
      task.id,
      attached.reference,
    );
    const repeated = await service.insertExistingInline(
      task.id,
      attached.reference,
    );
    expect(repeated.body).toBe(inserted.body);
    expect(repeated.body.match(/!\[\[/g)).toHaveLength(1);

    await service.detach(task.id, attached.reference);
    await expect(
      service.insertExistingInline(task.id, attached.reference),
    ).rejects.toThrow("Attach this image");
    await repository.update(task.id, { attachments: [attached.reference] });
    await repository.files!.delete(attached.file);
    await expect(
      service.insertExistingInline(task.id, attached.reference),
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

  it("rejects unavailable storage, missing tasks, invalid links, and missing files", async () => {
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
    const task = await repository.create({ title: "Missing file" });
    await expect(
      service.deletePhysical(task.id, "https://example.com/image.png"),
    ).rejects.toThrow("safe file path");
    const reference = "[[Attachments/missing.png]]";
    await repository.update(task.id, { attachments: [reference] });
    await expect(service.deletePhysical(task.id, reference)).rejects.toThrow(
      "already missing",
    );
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

  it("reference-checks physical deletion across frontmatter and task bodies", async () => {
    const { repository } = await fixture();
    const first = await repository.create({ title: "First" });
    const second = await repository.create({ title: "Second" });
    const service = new AttachmentService(repository);
    const list = vi.spyOn(repository, "list");
    const attached = await service.attachImage(
      first.id,
      new File([Uint8Array.of(4)], "shared.jpg", { type: "image/jpeg" }),
    );
    await repository.update(second.id, { attachments: [attached.reference] });

    await expect(
      service.deletePhysical(first.id, attached.reference),
    ).rejects.toThrow("other tasks");
    expect(list).toHaveBeenCalledWith({
      status: "all",
      archived: "include",
      limit: Number.MAX_SAFE_INTEGER,
    });
    await service.detach(second.id, attached.reference);
    await repository.update(first.id, { body: `!${attached.reference}` });
    await expect(
      service.deletePhysical(first.id, attached.reference),
    ).rejects.toThrow("inline embed");
    await repository.update(first.id, { body: "" });

    const updated = await service.deletePhysical(first.id, attached.reference);
    expect(updated.attachments).toEqual([]);
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

  it("keeps membership until an interrupted physical deletion can resume", async () => {
    const { repository } = await fixture();
    const task = await repository.create({ title: "Delete safely" });
    const service = new AttachmentService(repository);
    const attached = await service.attachImage(
      task.id,
      new File([Uint8Array.of(7)], "delete.png", { type: "image/png" }),
    );
    vi.spyOn(repository.files!, "delete").mockRejectedValueOnce(
      new Error("device storage busy"),
    );

    await expect(
      service.deletePhysical(task.id, attached.reference),
    ).rejects.toThrow("device storage busy");
    expect((await repository.get(task.id))?.attachments).toEqual([
      attached.reference,
    ]);

    await service.recover();
    expect((await repository.get(task.id))?.attachments).toEqual([]);
    expect(await repository.files!.list({ folder: "Attachments" })).toEqual([]);
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
  repository: IndexedMarkdownRepository;
  vault: MemoryVault;
}> {
  const vault = new MemoryVault();
  const index = new TaskIndex(`attachments-${crypto.randomUUID()}`);
  indexes.push(index);
  const repository = new IndexedMarkdownRepository({
    collection: new MarkdownCollection(vault),
    index,
  });
  await repository.initialize();
  return { repository, vault };
}
