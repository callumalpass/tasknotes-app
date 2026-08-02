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

/** Application-facing adapter over beta.23's resumable, integrity-checked file client. */
export class MdbaseCollectionFileStore implements CollectionFileStore {
  constructor(private readonly connection: MdbaseConnection) {}

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
    for await (const file of this.connection.files.list(options))
      files.push(fromMdbaseFile(file));
    return files;
  }

  async upload(
    path: string,
    source: Blob | ArrayBuffer | ArrayBufferView,
    options: {
      mediaType?: string;
      ifRevision?: string;
      signal?: AbortSignal;
      onProgress?: (progress: CollectionFileProgress) => void;
    } = {},
  ): Promise<CollectionFile> {
    return fromMdbaseFile(
      await this.connection.files.upload(path, source, options),
    );
  }

  download(
    file: CollectionFile,
    options: Parameters<MdbaseConnection["files"]["download"]>[1] = {},
  ): Promise<Blob> {
    return this.connection.files.download(toMdbaseFile(file), options);
  }

  downloadStream(
    file: CollectionFile,
    options: Parameters<MdbaseConnection["files"]["downloadStream"]>[1] = {},
  ): Promise<ReadableStream<Uint8Array>> {
    return this.connection.files.downloadStream(toMdbaseFile(file), options);
  }

  async move(file: CollectionFile, path: string): Promise<CollectionFile> {
    return fromMdbaseFile(
      await this.connection.files.move(toMdbaseFile(file), path),
    );
  }

  async delete(file: CollectionFile): Promise<void> {
    await this.connection.files.delete(toMdbaseFile(file));
  }
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
