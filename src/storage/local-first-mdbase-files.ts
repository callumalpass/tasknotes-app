import Dexie, { type EntityTable } from "dexie";

import type {
  CollectionFile,
  CollectionFileAction,
  CollectionFileProgress,
  CollectionFileStore,
} from "../application/ports/collection-file-store";

interface CachedFile {
  path: string;
  file: CollectionFile;
  bytes?: ArrayBuffer;
  tombstone: boolean;
}

type FileMutation =
  | {
      id: string;
      kind: "upload";
      path: string;
      file: CollectionFile;
      bytes: ArrayBuffer;
      mediaType?: string;
      ifRevision?: string;
      enqueuedAt: number;
    }
  | {
      id: string;
      kind: "move";
      after?: string;
      path: string;
      targetPath: string;
      file: CollectionFile;
      enqueuedAt: number;
    }
  | {
      id: string;
      kind: "delete";
      after?: string;
      path: string;
      file: CollectionFile;
      enqueuedAt: number;
    };

class FileReplica extends Dexie {
  files!: EntityTable<CachedFile, "path">;
  mutations!: EntityTable<FileMutation, "id">;

  constructor(collectionId: string) {
    super(`tasknotes-files-${collectionId}`);
    this.version(1).stores({
      files: "&path",
      mutations: "&id,enqueuedAt,path",
    });
  }
}

/**
 * Durable cache and mutation outbox for mdbase files. Binary bytes land here
 * before the network is attempted, making an accepted attachment recoverable
 * across offline restarts and ambiguous upload failures.
 */
export class LocalFirstMdbaseFileStore implements CollectionFileStore {
  private readonly replica: FileReplica;
  private syncInFlight: Promise<void> | null = null;

  constructor(
    private readonly remote: CollectionFileStore,
    collectionId: string,
  ) {
    this.replica = new FileReplica(collectionId);
  }

  authorizedActions(): ReadonlySet<CollectionFileAction> {
    return this.remote.authorizedActions();
  }

  async list(
    options: { folder?: string; signal?: AbortSignal } = {},
  ): Promise<CollectionFile[]> {
    throwIfAborted(options.signal);
    await this.trySync();
    try {
      const remoteFiles = await this.remote.list(options);
      const remotePaths = new Set(remoteFiles.map(({ path }) => path));
      const folderPrefix = options.folder
        ? `${options.folder.replace(/\/$/, "")}/`
        : "";
      await this.replica.transaction("rw", this.replica.files, async () => {
        const cachedFiles = await this.replica.files.toArray();
        for (const cached of cachedFiles) {
          if (
            !cached.tombstone &&
            !cached.file.pending &&
            (!folderPrefix || cached.path.startsWith(folderPrefix)) &&
            !remotePaths.has(cached.path)
          )
            await this.replica.files.delete(cached.path);
        }
        for (const file of remoteFiles) {
          const cached = await this.replica.files.get(file.path);
          if (cached?.tombstone || cached?.file.pending) continue;
          const bytes =
            cached?.file.contentDigest === file.contentDigest
              ? cached.bytes
              : undefined;
          await this.replica.files.put({
            path: file.path,
            file: {
              ...file,
              availability: bytes ? "local-and-remote" : "remote",
            },
            ...(bytes ? { bytes } : {}),
            tombstone: false,
          });
        }
      });
    } catch {
      // A complete cached listing remains useful when the authority is offline.
    }
    const folderPrefix = options.folder
      ? `${options.folder.replace(/\/$/, "")}/`
      : "";
    return (await this.replica.files.toArray())
      .filter(({ tombstone }) => !tombstone)
      .filter(({ path }) => !folderPrefix || path.startsWith(folderPrefix))
      .map(({ file, bytes }) => ({
        ...file,
        availability: (bytes
          ? file.pending
            ? "local"
            : "local-and-remote"
          : "remote") as CollectionFile["availability"],
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  async upload(
    path: string,
    source: Blob | ArrayBuffer | ArrayBufferView,
    options: {
      mediaType?: string;
      ifRevision?: string;
      transferId?: string;
      signal?: AbortSignal;
      onProgress?: (progress: CollectionFileProgress) => void;
    } = {},
  ): Promise<CollectionFile> {
    requireAction(this.remote, options.ifRevision ? "replace" : "add");
    throwIfAborted(options.signal);
    const blob = await toBlob(source, options.mediaType);
    const bytes = await blob.arrayBuffer();
    const transferId = options.transferId ?? crypto.randomUUID();
    const digest = await sha256(blob);
    const existing = await this.replica.files.get(path);
    if (
      options.ifRevision !== undefined &&
      existing?.file.revision !== options.ifRevision
    )
      throw new Error(`Attachment revision conflict at ${path}.`);
    const file: CollectionFile = {
      fileId: existing?.file.fileId ?? `pending:${transferId}`,
      path,
      revision: `pending:${transferId}`,
      contentDigest: digest,
      size: blob.size,
      ...(options.mediaType || blob.type
        ? { mediaType: options.mediaType || blob.type }
        : {}),
      mediaClass: (options.mediaType || blob.type).startsWith("image/")
        ? "image"
        : "other",
      modifiedAt: new Date().toISOString(),
      availability: "local",
      pending: "upload",
    };
    const mutation: FileMutation = {
      id: transferId,
      kind: "upload",
      path,
      file,
      bytes,
      ...(options.mediaType ? { mediaType: options.mediaType } : {}),
      ...(options.ifRevision ? { ifRevision: options.ifRevision } : {}),
      enqueuedAt: Date.now(),
    };
    await this.replica.transaction(
      "rw",
      this.replica.files,
      this.replica.mutations,
      async () => {
        await this.replica.files.put({ path, file, bytes, tombstone: false });
        await this.replica.mutations.put(mutation);
      },
    );
    options.onProgress?.({
      phase: "uploading",
      transferredBytes: blob.size,
      totalBytes: blob.size,
    });
    await this.trySync();
    return (await this.replica.files.get(path))?.file ?? file;
  }

  async download(
    file: CollectionFile,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: CollectionFileProgress) => void;
    } = {},
  ): Promise<Blob> {
    throwIfAborted(options.signal);
    const cached = await this.replica.files.get(file.path);
    if (
      cached?.bytes &&
      !cached.tombstone &&
      cached.file.contentDigest === file.contentDigest
    ) {
      options.onProgress?.({
        phase: "downloading",
        transferredBytes: cached.bytes.byteLength,
        totalBytes: cached.bytes.byteLength,
      });
      return new Blob([cached.bytes], {
        type: cached.file.mediaType ?? "application/octet-stream",
      });
    }
    const blob = await this.remote.download(file, options);
    if (blob.size !== file.size || (await sha256(blob)) !== file.contentDigest)
      throw new Error(
        `Downloaded attachment failed integrity checks at ${file.path}.`,
      );
    const bytes = await blob.arrayBuffer();
    await this.replica.files.put({
      path: file.path,
      file: { ...file, availability: "local-and-remote" },
      bytes,
      tombstone: false,
    });
    return blob;
  }

  async downloadStream(
    file: CollectionFile,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: CollectionFileProgress) => void;
    } = {},
  ): Promise<ReadableStream<Uint8Array>> {
    return (await this.download(file, options)).stream();
  }

  async move(
    file: CollectionFile,
    path: string,
    options: { mutationId?: string; signal?: AbortSignal } = {},
  ): Promise<CollectionFile> {
    requireAction(this.remote, "move");
    throwIfAborted(options.signal);
    const id = options.mutationId ?? crypto.randomUUID();
    if (file.pending === "delete")
      throw new Error("An attachment pending deletion cannot be moved.");
    const cached = await this.replica.files.get(file.path);
    if (file.pending === "upload") {
      const transferId = file.revision.replace(/^pending:/, "");
      const upload = await this.replica.mutations.get(transferId);
      if (upload?.kind === "upload") {
        const moved: CollectionFile = { ...file, path };
        await this.replica.transaction(
          "rw",
          this.replica.files,
          this.replica.mutations,
          async () => {
            await this.replica.files.delete(file.path);
            await this.replica.files.put({
              path,
              file: moved,
              bytes: upload.bytes,
              tombstone: false,
            });
            await this.replica.mutations.put({
              ...upload,
              path,
              file: moved,
            });
          },
        );
        await this.trySync();
        return (await this.replica.files.get(path))?.file ?? moved;
      }
    }
    const moved: CollectionFile = {
      ...file,
      path,
      revision: `pending:${id}`,
      availability: cached?.bytes ? "local" : file.availability,
      pending: "move",
    };
    await this.replica.transaction(
      "rw",
      this.replica.files,
      this.replica.mutations,
      async () => {
        await this.replica.files.delete(file.path);
        await this.replica.files.put({
          path,
          file: moved,
          ...(cached?.bytes ? { bytes: cached.bytes } : {}),
          tombstone: false,
        });
        const mutation: FileMutation = {
          id,
          kind: "move",
          ...(file.pending === "move"
            ? { after: file.revision.replace(/^pending:/, "") }
            : {}),
          path: file.path,
          targetPath: path,
          file,
          enqueuedAt: Date.now(),
        };
        await this.replica.mutations.put(mutation);
      },
    );
    await this.trySync();
    return (await this.replica.files.get(path))?.file ?? moved;
  }

  async delete(
    file: CollectionFile,
    options: { mutationId?: string; signal?: AbortSignal } = {},
  ): Promise<void> {
    requireAction(this.remote, "delete");
    throwIfAborted(options.signal);
    if (file.pending === "delete") return;
    if (file.pending === "upload") {
      const transferId = file.revision.replace(/^pending:/, "");
      await this.replica.transaction(
        "rw",
        this.replica.files,
        this.replica.mutations,
        async () => {
          await this.replica.files.delete(file.path);
          await this.replica.mutations.delete(transferId);
        },
      );
      return;
    }
    const id = options.mutationId ?? crypto.randomUUID();
    const cached = await this.replica.files.get(file.path);
    await this.replica.transaction(
      "rw",
      this.replica.files,
      this.replica.mutations,
      async () => {
        await this.replica.files.put({
          path: file.path,
          file: { ...file, pending: "delete" },
          ...(cached?.bytes ? { bytes: cached.bytes } : {}),
          tombstone: true,
        });
        await this.replica.mutations.put({
          id,
          kind: "delete",
          ...(file.pending === "move"
            ? { after: file.revision.replace(/^pending:/, "") }
            : {}),
          path: file.path,
          file,
          enqueuedAt: Date.now(),
        });
      },
    );
    await this.trySync();
  }

  sync(): Promise<void> {
    if (this.syncInFlight) return this.syncInFlight;
    this.syncInFlight = this.flush().finally(() => {
      this.syncInFlight = null;
    });
    return this.syncInFlight;
  }

  private async trySync(): Promise<void> {
    await this.sync().catch(() => undefined);
  }

  private async flush(): Promise<void> {
    while (true) {
      const queued = await this.replica.mutations
        .orderBy("enqueuedAt")
        .toArray();
      if (!queued.length) return;
      const queuedIds = new Set(queued.map(({ id }) => id));
      const mutation = queued.find(
        (candidate) =>
          candidate.kind === "upload" ||
          !candidate.after ||
          !queuedIds.has(candidate.after),
      );
      if (!mutation)
        throw new Error("Attachment mutation journal contains a cycle.");
      if (mutation.kind === "upload") {
        const uploaded = await this.remote.upload(
          mutation.path,
          mutation.bytes,
          {
            mediaType: mutation.mediaType,
            transferId: mutation.id,
            ...(mutation.ifRevision ? { ifRevision: mutation.ifRevision } : {}),
          },
        );
        await this.replica.transaction(
          "rw",
          this.replica.files,
          this.replica.mutations,
          async () => {
            await this.replica.files.put({
              path: mutation.path,
              file: { ...uploaded, availability: "local-and-remote" },
              bytes: mutation.bytes,
              tombstone: false,
            });
            await this.replica.mutations.delete(mutation.id);
          },
        );
        continue;
      }
      if (mutation.kind === "move") {
        const moved = await this.remote.move(
          mutation.file,
          mutation.targetPath,
          {
            mutationId: mutation.id,
          },
        );
        await this.replica.transaction(
          "rw",
          this.replica.files,
          this.replica.mutations,
          async () => {
            const dependents = (await this.replica.mutations.toArray()).filter(
              (candidate) =>
                candidate.id !== mutation.id &&
                candidate.kind !== "upload" &&
                candidate.after === mutation.id,
            );
            for (const dependent of dependents)
              await this.replica.mutations.put({
                ...dependent,
                file: moved,
              });
            const pendingDelete = dependents.find(
              (candidate) => candidate.kind === "delete",
            );
            if (pendingDelete) {
              const cached = await this.replica.files.get(pendingDelete.path);
              await this.replica.files.put({
                path: pendingDelete.path,
                file: { ...moved, pending: "delete" },
                ...(cached?.bytes ? { bytes: cached.bytes } : {}),
                tombstone: true,
              });
            } else if (!dependents.length) {
              const cached = await this.replica.files.get(mutation.targetPath);
              await this.replica.files.put({
                path: mutation.targetPath,
                file: {
                  ...moved,
                  availability: cached?.bytes ? "local-and-remote" : "remote",
                },
                ...(cached?.bytes ? { bytes: cached.bytes } : {}),
                tombstone: false,
              });
            }
            await this.replica.mutations.delete(mutation.id);
          },
        );
        continue;
      }
      await this.remote.delete(mutation.file, { mutationId: mutation.id });
      await this.replica.transaction(
        "rw",
        this.replica.files,
        this.replica.mutations,
        async () => {
          await this.replica.files.delete(mutation.path);
          await this.replica.mutations.delete(mutation.id);
        },
      );
    }
  }
}

function requireAction(
  store: CollectionFileStore,
  action: CollectionFileAction,
): void {
  if (!store.authorizedActions().has(action))
    throw new Error(`This collection has not authorized attachment ${action}.`);
}

async function toBlob(
  source: Blob | ArrayBuffer | ArrayBufferView,
  mediaType?: string,
): Promise<Blob> {
  if (source instanceof Blob)
    return source.type || !mediaType
      ? source
      : new Blob([await source.arrayBuffer()], { type: mediaType });
  const bytes = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], mediaType ? { type: mediaType } : {});
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
}
