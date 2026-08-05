import type { MdbaseConnection } from "@mdbase-dev/connect";
import type { CollectionFileDescriptor } from "@mdbase-dev/connect-protocol";

import type {
  CollectionFile,
  CollectionFileAction,
  CollectionFileProgress,
  CollectionFileStore,
} from "../application/ports/collection-file-store";

export const TASKNOTES_FILE_ACTIONS = [
  "list",
  "read",
  "add",
  "replace",
  "move",
  "delete",
] as const satisfies readonly CollectionFileAction[];

/** Application-facing adapter over the mdbase file capability. */
export class MdbaseCollectionFileStore implements CollectionFileStore {
  constructor(
    private readonly connection: MdbaseConnection,
    private readonly operationSignal: () => AbortSignal | undefined = () =>
      undefined,
  ) {}

  authorizedActions(): ReadonlySet<CollectionFileAction> {
    return new Set(
      this.connection.fileCapability?.actions.filter(
        (action): action is CollectionFileAction =>
          TASKNOTES_FILE_ACTIONS.includes(action as CollectionFileAction),
      ) ?? [],
    );
  }

  async list(options: { folder?: string; signal?: AbortSignal } = {}) {
    const files: CollectionFile[] = [];
    for await (const file of this.connection.files.list(
      withOperationSignal(options, this.operationSignal()),
    ))
      files.push(fromMdbaseFile(file));
    return files;
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
    return fromMdbaseFile(
      await this.connection.files.upload(
        path,
        source,
        withOperationSignal(options, this.operationSignal()),
      ),
    );
  }

  download(
    file: CollectionFile,
    options: Parameters<MdbaseConnection["files"]["download"]>[1] = {},
  ): Promise<Blob> {
    return this.connection.files.download(
      toMdbaseFile(file),
      withOperationSignal(options, this.operationSignal()),
    );
  }

  downloadStream(
    file: CollectionFile,
    options: Parameters<MdbaseConnection["files"]["downloadStream"]>[1] = {},
  ): Promise<ReadableStream<Uint8Array>> {
    return this.connection.files.downloadStream(
      toMdbaseFile(file),
      withOperationSignal(options, this.operationSignal()),
    );
  }

  async move(
    file: CollectionFile,
    path: string,
    options: { mutationId?: string; signal?: AbortSignal } = {},
  ): Promise<CollectionFile> {
    return fromMdbaseFile(
      await this.connection.files.move(toMdbaseFile(file), path, {
        ifRevision: file.revision,
        ...withOperationSignal(options, this.operationSignal()),
      }),
    );
  }

  async delete(
    file: CollectionFile,
    options: { mutationId?: string; signal?: AbortSignal } = {},
  ): Promise<void> {
    await this.connection.files.delete(toMdbaseFile(file), {
      ifRevision: file.revision,
      ...withOperationSignal(options, this.operationSignal()),
    });
  }
}

function withOperationSignal<Options extends { signal?: AbortSignal }>(
  options: Options,
  operationSignal: AbortSignal | undefined,
): Options {
  const signals = [options.signal, operationSignal].filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  return {
    ...options,
    ...(signals.length
      ? { signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) }
      : {}),
  };
}

function fromMdbaseFile(file: CollectionFileDescriptor): CollectionFile {
  return {
    fileId: file.file_id,
    path: file.path,
    revision: file.revision,
    contentDigest: file.content_digest,
    size: file.size,
    ...(file.media_type ? { mediaType: file.media_type } : {}),
    mediaClass: file.media_class,
    modifiedAt: file.modified_at,
  };
}

function toMdbaseFile(file: CollectionFile): CollectionFileDescriptor {
  return {
    file_id: file.fileId,
    path: file.path,
    revision: file.revision,
    content_digest: file.contentDigest,
    size: file.size,
    ...(file.mediaType ? { media_type: file.mediaType } : {}),
    media_class: file.mediaClass,
    modified_at: file.modifiedAt,
  };
}
