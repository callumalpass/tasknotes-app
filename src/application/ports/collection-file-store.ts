export type CollectionFileMediaClass =
  "image" | "audio" | "video" | "pdf" | "other";

export type CollectionFileAction =
  "list" | "read" | "add" | "replace" | "move" | "delete";

export interface CollectionFile {
  fileId: string;
  path: string;
  revision: string;
  contentDigest: `sha256:${string}`;
  size: number;
  mediaType?: string;
  mediaClass: CollectionFileMediaClass;
  modifiedAt: string;
}

export interface CollectionFileProgress {
  phase: "hashing" | "uploading" | "downloading";
  transferredBytes: number;
  totalBytes: number;
}

export interface CollectionFileStore {
  /** The actions present on the current grant. An empty set needs reauthorization. */
  authorizedActions(): ReadonlySet<CollectionFileAction>;
  list(options?: {
    folder?: string;
    signal?: AbortSignal;
  }): Promise<CollectionFile[]>;
  upload(
    path: string,
    source: Blob | ArrayBuffer | ArrayBufferView,
    options?: {
      mediaType?: string;
      ifRevision?: string;
      signal?: AbortSignal;
      onProgress?: (progress: CollectionFileProgress) => void;
    },
  ): Promise<CollectionFile>;
  download(
    file: CollectionFile,
    options?: {
      signal?: AbortSignal;
      onProgress?: (progress: CollectionFileProgress) => void;
    },
  ): Promise<Blob>;
  downloadStream(
    file: CollectionFile,
    options?: {
      signal?: AbortSignal;
      onProgress?: (progress: CollectionFileProgress) => void;
    },
  ): Promise<ReadableStream<Uint8Array>>;
  move(file: CollectionFile, path: string): Promise<CollectionFile>;
  delete(file: CollectionFile): Promise<void>;
}
