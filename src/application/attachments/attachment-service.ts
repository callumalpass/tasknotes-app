import Dexie, { type EntityTable } from "dexie";
import {
  attachmentPathFromReference,
  canonicalAttachmentReference,
} from "@tasknotes/model/attachments";

import type {
  CollectionFile,
  CollectionFileStore,
} from "../ports/collection-file-store";
import type { TaskRepository } from "../ports/task-repository";
import type { Task } from "../../domain/task";

interface AttachmentJournalEntry {
  id: string;
  collectionId: string;
  taskId: string;
  reference: string;
  expectedDigest?: `sha256:${string}`;
  expectedSize?: number;
  fileSaved?: boolean;
  enqueuedAt: number;
}

class AttachmentJournal extends Dexie {
  entries!: EntityTable<AttachmentJournalEntry, "id">;

  constructor() {
    super("tasknotes-attachment-journal-v1");
    this.version(1).stores({
      entries: "&id,collectionId,enqueuedAt,taskId",
    });
  }
}

export interface ResolvedTaskAttachment {
  reference: string;
  path?: string;
  file?: CollectionFile;
}

export interface AttachImageResult {
  task: Task;
  file: CollectionFile;
  reference: string;
}

const journal = new AttachmentJournal();

/** Coordinates binary persistence with authoritative frontmatter membership. */
export class AttachmentService {
  constructor(private readonly repository: TaskRepository) {}

  available(): boolean {
    return Boolean(this.repository.files);
  }

  currentTask(taskId: string): Promise<Task | null> {
    return this.repository.get(taskId);
  }

  async recover(): Promise<void> {
    const collectionId = await this.collectionId();
    const entries = await journal.entries
      .where("collectionId")
      .equals(collectionId)
      .sortBy("enqueuedAt");
    for (const entry of entries) {
      const task = await this.repository.get(entry.taskId);
      if (!task) {
        await journal.entries.delete(entry.id);
        continue;
      }
      if (!entry.fileSaved) {
        const file = await this.findFile(task, entry.reference);
        if (!file || !matchesExpectedFile(file, entry)) {
          if (file)
            await this.requireStore()
              .delete(file)
              .catch(() => undefined);
          await journal.entries.delete(entry.id);
          continue;
        }
        entry.fileSaved = true;
        await journal.entries.put(entry);
      }
      await this.applyMembership(
        (await this.repository.get(entry.taskId)) ?? task,
        entry,
      );
      await journal.entries.delete(entry.id);
    }
  }

  async attachImage(
    taskId: string,
    source: File | Blob,
  ): Promise<AttachImageResult> {
    return this.attach(taskId, source);
  }

  /** Verifies an existing membership can safely be presented in Notes. */
  async assertInlineInsertable(
    taskId: string,
    reference: string,
  ): Promise<void> {
    const task = await this.requireTask(taskId);
    if (!hasReference(task, reference))
      throw new Error(
        "Attach this image to the task before inserting it in Notes.",
      );
    if (!(await this.findFile(task, reference)))
      throw new Error("The attachment file is missing and cannot be inserted.");
  }

  async resolve(task: Task): Promise<ResolvedTaskAttachment[]> {
    const files = this.requireStore();
    const listed = await files.list({ folder: "Attachments" });
    const byPath = new Map(listed.map((file) => [file.path, file]));
    return task.attachments.map((reference) => {
      const path = attachmentPathFromReference(reference, task.path);
      return {
        reference,
        ...(path ? { path } : {}),
        ...(path && byPath.has(path) ? { file: byPath.get(path) } : {}),
      };
    });
  }

  async detach(taskId: string, reference: string): Promise<Task> {
    const task = await this.requireTask(taskId);
    return this.repository.update(task.id, {
      attachments: withoutReference(task, reference),
    });
  }

  private async attach(
    taskId: string,
    source: File | Blob,
  ): Promise<AttachImageResult> {
    const store = this.requireStore();
    const task = await this.requireTask(taskId);
    const name =
      source instanceof File ? source.name : `image-${Date.now()}.png`;
    const path = attachmentPath(name);
    assertImage(source.type, path);
    const reference = canonicalAttachmentReference(path);
    const expectedSize = source.size;
    const expectedDigest = await sha256(source);
    const entry: AttachmentJournalEntry = {
      id: crypto.randomUUID(),
      collectionId: await this.collectionId(),
      taskId,
      reference,
      expectedDigest,
      expectedSize,
      fileSaved: false,
      enqueuedAt: Date.now(),
    };
    await journal.entries.put(entry);
    let file: CollectionFile;
    try {
      file = await store.upload(path, source, {
        ...(source.type ? { mediaType: source.type } : {}),
      });
    } catch (reason) {
      let listingSucceeded = false;
      const recovered = await this.findFile(task, reference).then(
        (candidate) => {
          listingSucceeded = true;
          return candidate;
        },
        () => undefined,
      );
      if (!recovered || !matchesExpectedFile(recovered, entry)) {
        if (recovered) await store.delete(recovered).catch(() => undefined);
        if (listingSucceeded) await journal.entries.delete(entry.id);
        throw reason;
      }
      file = recovered;
    }
    if (!matchesExpectedFile(file, entry)) {
      await store.delete(file).catch(() => undefined);
      await journal.entries.delete(entry.id);
      throw new Error(
        "The attachment write did not preserve every byte. The partial file was not attached.",
      );
    }
    entry.fileSaved = true;
    await journal.entries.put(entry);
    const updated = await this.applyMembership(
      (await this.repository.get(taskId)) ?? task,
      entry,
    );
    await journal.entries.delete(entry.id);
    return { task: updated, file, reference };
  }

  private async applyMembership(
    task: Task,
    entry: AttachmentJournalEntry,
  ): Promise<Task> {
    const attachments = hasReference(task, entry.reference)
      ? task.attachments
      : [...task.attachments, entry.reference];
    if (sameList(task.attachments, attachments)) return task;
    return this.repository.update(task.id, { attachments });
  }

  private async findFile(
    task: Task,
    reference: string,
  ): Promise<CollectionFile | undefined> {
    const path = attachmentPathFromReference(reference, task.path);
    if (!path) return undefined;
    return (
      await this.requireStore().list({ folder: parentFolder(path) })
    ).find((candidate) => candidate.path === path);
  }

  private requireStore(): CollectionFileStore {
    if (!this.repository.files)
      throw new Error("This collection does not provide attachment storage.");
    return this.repository.files;
  }

  private async requireTask(taskId: string): Promise<Task> {
    const task = await this.repository.get(taskId);
    if (!task) throw new Error("Task not found.");
    return task;
  }

  private async collectionId(): Promise<string> {
    const info = await this.repository.collectionInfo();
    return info.id ?? `${info.kind}:${info.location}`;
  }
}

function attachmentPath(name: string): string {
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : "";
  const stem =
    (dot > 0 ? name.slice(0, dot) : name)
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "image";
  return `Attachments/${crypto.randomUUID()}-${stem}${extension}`;
}

function assertImage(mediaType: string, path: string): void {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  const supportedMediaTypes: Record<string, readonly string[]> = {
    ".avif": ["image/avif"],
    ".gif": ["image/gif"],
    ".heic": ["image/heic", "image/heif"],
    ".heif": ["image/heic", "image/heif"],
    ".jpeg": ["image/jpeg"],
    ".jpg": ["image/jpeg"],
    ".png": ["image/png"],
    ".webp": ["image/webp"],
  };
  const normalizedMediaType = mediaType.toLowerCase().split(";", 1)[0].trim();
  if (
    !supportedMediaTypes[extension] ||
    (normalizedMediaType &&
      !supportedMediaTypes[extension].includes(normalizedMediaType))
  )
    throw new Error("Choose an AVIF, GIF, HEIC, JPEG, PNG, or WebP image.");
}

function withoutReference(task: Task, reference: string): string[] {
  const path = attachmentPathFromReference(reference, task.path);
  return task.attachments.filter(
    (candidate) => attachmentPathFromReference(candidate, task.path) !== path,
  );
}

function hasReference(task: Task, reference: string): boolean {
  return withoutReference(task, reference).length !== task.attachments.length;
}

async function sha256(blob: Blob): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return `sha256:${[...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function matchesExpectedFile(
  file: CollectionFile,
  entry: AttachmentJournalEntry,
): boolean {
  return (
    entry.expectedSize !== undefined &&
    entry.expectedDigest !== undefined &&
    file.size === entry.expectedSize &&
    file.contentDigest === entry.expectedDigest
  );
}

function parentFolder(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
