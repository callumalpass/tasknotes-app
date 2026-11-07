import { describe, expect, it, vi } from "vitest";

import { nextTaskFixture } from "../../test/next-task-fixture";
import { AttachmentService } from "./attachment-service";

import type { TaskRepository } from "../ports/task-repository";

describe("AttachmentService", () => {
  it.each([
    ["notes.txt", "text/plain", "Text notes"],
    ["page.html", "text/html", "<script>alert('untrusted')</script>"],
    ["drawing.svg", "image/svg+xml", "<svg onload='alert(1)'/>"],
    ["document.pdf", "application/pdf", "%PDF"],
    ["archive.custom-extension", "application/octet-stream", "binary"],
    ["empty.txt", "text/plain", ""],
  ])(
    "attaches %s byte-for-byte with canonical membership",
    async (name, type, content) => {
      const { repository, files } = await fixture();
      const task = await repository.create({
        title: "Any file",
        body: "Keep notes",
      });
      const service = new AttachmentService(repository);
      const result = await service.attachFile(
        task.id,
        new File([content], name, { type }),
      );

      expect(result.task.attachments).toEqual([result.reference]);
      expect(result.task.frontmatter.attachments).toEqual([result.reference]);
      expect(result.reference).toBe(`[[${result.file.path}]]`);
      expect(result.task.body).toBe("Keep notes");
      expect(await (await files.download(result.file)).text()).toBe(content);
      expect(result.file.size).toBe(new Blob([content]).size);
      await expect(
        service.assertInlineInsertable(task.id, result.reference),
      ).rejects.toThrow("Only supported images");
      await service.detach(task.id, result.reference);
      expect(await files.list({ folder: "Attachments" })).toHaveLength(1);
    },
  );

  it("reports the model's extensionless-link restriction before uploading any bytes", async () => {
    const { repository } = await fixture();
    const task = await repository.create({ title: "Extensionless file" });
    const upload = vi.spyOn(repository.files!, "upload");
    await expect(
      new AttachmentService(repository).attachFile(
        task.id,
        new File(["text"], "README"),
      ),
    ).rejects.toThrow("Invalid attachment path");
    expect(upload).not.toHaveBeenCalled();
    expect((await repository.get(task.id))?.attachments).toEqual([]);
  });

  it("keeps arbitrary filename syntax within one portable attachment path", async () => {
    const { repository } = await fixture();
    const task = await repository.create({ title: "Names" });
    const service = new AttachmentService(repository);
    const result = await service.attachFile(
      task.id,
      new File(["safe"], "../folder/report.[[bad]].html"),
    );
    expect(result.file.path).toMatch(
      /^Attachments\/[0-9a-f-]+-report-bad\.html$/,
    );
  });

  it("recovers a non-image membership after a held record write fails", async () => {
    const { repository } = await fixture();
    const task = await repository.create({ title: "Held file" });
    const update = repository.update.bind(repository);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    repository.update = vi
      .fn()
      .mockImplementationOnce(async () => {
        markEntered();
        await held;
        throw new Error("record write interrupted");
      })
      .mockImplementation(update);
    const service = new AttachmentService(repository);
    const pending = service.attachFile(
      task.id,
      new File(["receipt"], "receipt.txt"),
    );
    const rejection = expect(pending).rejects.toThrow(
      "record write interrupted",
    );
    await entered;
    expect((await repository.get(task.id))?.attachments).toEqual([]);
    release();
    await rejection;
    await service.recover();
    expect((await repository.get(task.id))?.attachments).toHaveLength(1);
    expect(
      await repository.files!.list({ folder: "Attachments" }),
    ).toHaveLength(1);
  });

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

async function fixture() {
  const { repository } = await nextTaskFixture();
  await repository.initialize();
  return { repository, files: repository.files };
}
