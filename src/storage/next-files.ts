import {
  MAX_CONVENIENCE_BYTES,
  type MdbaseClient,
  type wire,
} from "@mdbase-dev/sdk";
import type {
  CollectionFile,
  CollectionFileAction,
  CollectionFileProgress,
  CollectionFileStore,
} from "../application/ports/collection-file-store";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";

type Files = Pick<
  MdbaseClient["files"],
  "grant" | "list" | "get" | "upload" | "downloadStream" | "move" | "delete"
>;
type ReadOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: CollectionFileProgress) => void;
};

/** Borrows the original SDK files port. No client, transfer retry or native owner. */
export class NextCollectionFileStore implements CollectionFileStore {
  constructor(
    private readonly files: Files,
    private readonly ownerSignal: () => AbortSignal,
  ) {}

  authorizedActions(): ReadonlySet<CollectionFileAction> {
    return new Set(
      this.ownerSignal().aborted ? [] : (this.files.grant?.actions ?? []),
    );
  }

  async list(
    options: { folder?: string; signal?: AbortSignal } = {},
  ): Promise<CollectionFile[]> {
    const signal = this.signal(options.signal);
    const result: CollectionFile[] = [];
    for await (const file of this.files.list({
      folder: options.folder,
      signal,
    })) {
      signal.throwIfAborted();
      result.push(collectionFile(file));
    }
    signal.throwIfAborted();
    return result;
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
    const signal = this.signal(
      options.signal,
      TASKNOTES_REQUEST_BUDGETS.uploadMs,
    );
    // Replacement must retain the actual original file ID, not become an add.
    const original =
      options.ifRevision === undefined
        ? undefined
        : await this.files.get({ path }, signal);
    signal.throwIfAborted();
    if (original && original.digest !== options.ifRevision) throw changedFile();
    const input = ArrayBuffer.isView(source)
      ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
      : source;
    // Media type is Core-derived from the path; never overwrite it with a hint.
    const write = await this.files.upload(path, input, {
      signal,
      transferId: options.transferId,
      ifRevision: options.ifRevision,
      ...(original ? { fileId: original.id } : {}),
      onProgress: progress(options.onProgress, "uploading"),
    });
    await settled(write.confirmed, signal);
    const actual = await this.files.get(write.fileId, signal);
    signal.throwIfAborted();
    if (
      actual.id !== write.fileId ||
      actual.path !== path ||
      (original && actual.id !== original.id)
    )
      throw changedFile();
    return collectionFile(actual);
  }

  async downloadStream(
    file: CollectionFile,
    options: ReadOptions = {},
  ): Promise<ReadableStream<Uint8Array>> {
    const signal = this.signal(
      options.signal,
      TASKNOTES_REQUEST_BUDGETS.uploadMs,
    );
    // Revision is a CURRENT digest expectation, never a historical reopen API.
    const stream = this.files.downloadStream(file.fileId, {
      revision: file.revision,
      signal,
      onProgress: progress(options.onProgress, "downloading"),
    });
    const reader = stream.getReader();
    try {
      const actual = await settled(stream.file, signal);
      assertOriginal(actual, file);
      signal.throwIfAborted();
    } catch (reason) {
      await reader.cancel(reason).catch(() => undefined);
      throw reason;
    }
    let bytes = 0;
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          signal.throwIfAborted();
          const chunk = await reader.read();
          signal.throwIfAborted();
          if (chunk.done) {
            if (bytes !== file.size) throw changedFile();
            controller.close();
          } else {
            bytes += chunk.value.byteLength;
            if (bytes > file.size) throw changedFile();
            controller.enqueue(chunk.value);
          }
        } catch (reason) {
          controller.error(reason);
          await reader.cancel(reason).catch(() => undefined);
        }
      },
      cancel: (reason) => reader.cancel(reason),
    });
  }

  async download(
    file: CollectionFile,
    options: ReadOptions = {},
  ): Promise<Blob> {
    if (file.size > MAX_CONVENIENCE_BYTES)
      throw new Error(
        "This file is too large to open here. Use streaming download.",
      );
    const reader = (await this.downloadStream(file, options)).getReader();
    const chunks: ArrayBuffer[] = [];
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        chunks.push(new Uint8Array(chunk.value).buffer);
      }
      return new Blob(chunks, {
        type: file.mediaType ?? "application/octet-stream",
      });
    } finally {
      reader.releaseLock();
    }
  }

  async move(
    file: CollectionFile,
    path: string,
    options: { mutationId?: string; signal?: AbortSignal } = {},
  ): Promise<CollectionFile> {
    const signal = this.signal(options.signal);
    const original = await this.files.get(file.fileId, signal);
    assertOriginal(original, file);
    signal.throwIfAborted();
    const write = await this.files.move(original, path, {
      mutationId: options.mutationId,
      ifRevision: file.revision,
      signal,
    });
    await settled(write.confirmed, signal);
    const actual = await this.files.get(original.id, signal);
    assertOriginal(actual, { ...file, path });
    signal.throwIfAborted();
    return collectionFile(actual);
  }

  async delete(
    file: CollectionFile,
    options: { mutationId?: string; signal?: AbortSignal } = {},
  ): Promise<void> {
    const signal = this.signal(options.signal);
    const original = await this.files.get(file.fileId, signal);
    assertOriginal(original, file);
    signal.throwIfAborted();
    const write = await this.files.delete(original, {
      mutationId: options.mutationId,
      ifRevision: file.revision,
      signal,
    });
    await settled(write.confirmed, signal);
  }

  private signal(
    caller?: AbortSignal,
    budget: number = TASKNOTES_REQUEST_BUDGETS.foregroundMs,
  ): AbortSignal {
    const signal = AbortSignal.any([
      this.ownerSignal(),
      ...(caller ? [caller] : []),
      AbortSignal.timeout(budget),
    ]);
    signal.throwIfAborted();
    return signal;
  }
}

function changedFile(): Error {
  return new Error(
    "The file changed. Refresh the collection before trying again.",
  );
}

function collectionFile(file: wire.FileView): CollectionFile {
  if (
    !/^sha256:[0-9a-f]{64}$/.test(file.digest) ||
    !Number.isSafeInteger(file.size) ||
    file.size < 0
  )
    throw changedFile();
  return {
    fileId: file.id,
    path: file.path,
    revision: file.digest,
    contentDigest: file.digest as CollectionFile["contentDigest"],
    size: file.size,
    mediaClass: file.media,
    ...(file.mediaType ? { mediaType: file.mediaType } : {}),
    ...(file.mtime === undefined
      ? {}
      : { modifiedAt: new Date(file.mtime).toISOString() }),
  };
}

function assertOriginal(actual: wire.FileView, expected: CollectionFile): void {
  if (
    actual.id !== expected.fileId ||
    actual.digest !== expected.revision ||
    actual.digest !== expected.contentDigest ||
    actual.size !== expected.size ||
    actual.path !== expected.path
  )
    throw changedFile();
}

function progress(
  callback: ReadOptions["onProgress"],
  phase: CollectionFileProgress["phase"],
): ((value: wire.TransferProgress) => void) | undefined {
  return callback
    ? (value) =>
        callback({
          phase,
          transferredBytes: value.done,
          totalBytes: value.total,
        })
    : undefined;
}

/** Stop awaiting on retirement; the SDK retains the original write and outcome. */
function settled<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    pending
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
