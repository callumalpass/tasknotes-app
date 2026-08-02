import type {
  CollectionFile,
  CollectionFileAction,
  CollectionFileProgress,
  CollectionFileStore,
} from "../application/ports/collection-file-store";
import { safePath, type BinaryVault, type VaultEntry } from "./vault-contract";

export const TASKNOTES_IMAGE_EXTENSIONS = [
  ".avif",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
] as const;

const ALL_ACTIONS = new Set<CollectionFileAction>([
  "list",
  "read",
  "add",
  "replace",
  "move",
  "delete",
]);

/** Binary file storage for a native Markdown collection. */
export class VaultCollectionFileStore implements CollectionFileStore {
  private readonly digestCache = new Map<
    string,
    { revision: string; digest: `sha256:${string}` }
  >();

  constructor(private readonly vault: BinaryVault) {}

  authorizedActions(): ReadonlySet<CollectionFileAction> {
    return ALL_ACTIONS;
  }

  async list(
    options: { folder?: string; signal?: AbortSignal } = {},
  ): Promise<CollectionFile[]> {
    throwIfAborted(options.signal);
    const folder = options.folder?.replace(/\/$/, "");
    const entries = folder
      ? await this.vault.listFiles(safePath(folder), [
          ...TASKNOTES_IMAGE_EXTENSIONS,
        ])
      : await this.vault.listCollectionFiles([...TASKNOTES_IMAGE_EXTENSIONS]);
    const present = new Set(entries.map(({ path }) => path));
    for (const path of this.digestCache.keys())
      if (!present.has(path)) this.digestCache.delete(path);
    return Promise.all(
      entries.map(async (entry) => {
        throwIfAborted(options.signal);
        const cached = this.digestCache.get(entry.path);
        if (cached?.revision === revision(entry))
          return descriptorFrom(entry, cached.digest);
        const digest = await sha256(await this.vault.readBinary(entry.path));
        this.remember(entry, digest);
        return descriptorFrom(entry, digest);
      }),
    );
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
    const target = imagePath(path);
    const resolvedMediaType = validatedMediaType(target, options.mediaType);
    throwIfAborted(options.signal);
    const existing = await this.entry(target);
    if (options.ifRevision !== undefined) {
      if (!existing || revision(existing) !== options.ifRevision)
        throw new Error(`Attachment revision conflict at ${target}.`);
    }
    const bytes = await bytesFrom(source);
    options.onProgress?.({
      phase: "hashing",
      transferredBytes: 0,
      totalBytes: bytes.byteLength,
    });
    throwIfAborted(options.signal);
    const digest = await sha256(bytes);
    options.onProgress?.({
      phase: "hashing",
      transferredBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
    });
    throwIfAborted(options.signal);
    const written = await this.vault.writeBinary(target, bytes);
    this.remember(written, digest);
    options.onProgress?.({
      phase: "uploading",
      transferredBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
    });
    return descriptorFrom(written, digest, resolvedMediaType);
  }

  async download(
    file: CollectionFile,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: CollectionFileProgress) => void;
    } = {},
  ): Promise<Blob> {
    throwIfAborted(options.signal);
    const bytes = await this.vault.readBinary(imagePath(file.path));
    throwIfAborted(options.signal);
    options.onProgress?.({
      phase: "downloading",
      transferredBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
    });
    return new Blob([ownedBuffer(bytes)], {
      type: file.mediaType ?? mediaType(file.path),
    });
  }

  async downloadStream(
    file: CollectionFile,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: CollectionFileProgress) => void;
    } = {},
  ): Promise<ReadableStream<Uint8Array>> {
    const blob = await this.download(file, options);
    return blob.stream();
  }

  async move(file: CollectionFile, path: string): Promise<CollectionFile> {
    const target = imagePath(path);
    const entry = await this.vault.rename(imagePath(file.path), target);
    this.digestCache.delete(file.path);
    this.remember(entry, file.contentDigest);
    return {
      ...file,
      fileId: fileId(target),
      path: target,
      revision: revision(entry),
      modifiedAt: modifiedAt(entry),
      mediaType: mediaType(target),
    };
  }

  async delete(file: CollectionFile): Promise<void> {
    await this.vault.delete(imagePath(file.path));
    this.digestCache.delete(file.path);
  }

  private async entry(path: string): Promise<VaultEntry | undefined> {
    if (!(await this.vault.exists(path))) return undefined;
    return (
      await this.vault.listCollectionFiles([...TASKNOTES_IMAGE_EXTENSIONS])
    ).find((entry) => entry.path === path);
  }

  private remember(entry: VaultEntry, digest: `sha256:${string}`): void {
    this.digestCache.set(entry.path, { revision: revision(entry), digest });
  }
}

function descriptorFrom(
  entry: VaultEntry,
  digest: `sha256:${string}`,
  explicitMediaType?: string,
): CollectionFile {
  return {
    fileId: fileId(entry.path),
    path: entry.path,
    revision: revision(entry),
    contentDigest: digest,
    size: entry.size,
    mediaType: explicitMediaType || mediaType(entry.path),
    mediaClass: "image",
    modifiedAt: modifiedAt(entry),
  };
}

function imagePath(path: string): string {
  const target = safePath(path);
  if (
    !TASKNOTES_IMAGE_EXTENSIONS.some((extension) =>
      target.toLowerCase().endsWith(extension),
    )
  )
    throw new Error("TaskNotes attachments must use a supported image format.");
  return target;
}

function fileId(path: string): string {
  return `vault:${path}`;
}

function revision(entry: VaultEntry): string {
  return `${entry.lastModified}:${entry.size}`;
}

function modifiedAt(entry: VaultEntry): string {
  return new Date(entry.lastModified).toISOString();
}

function mediaType(path: string): string {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".heic" || extension === ".heif") return "image/heic";
  return `image/${extension.slice(1)}`;
}

function validatedMediaType(path: string, declared?: string): string {
  const inferred = mediaType(path);
  if (!declared) return inferred;
  const normalized = declared.toLowerCase().split(";", 1)[0].trim();
  const accepted =
    inferred === "image/heic"
      ? new Set(["image/heic", "image/heif"])
      : new Set([inferred]);
  if (!accepted.has(normalized))
    throw new Error(
      "Attachment media type does not match its image extension.",
    );
  return normalized;
}

async function bytesFrom(
  source: Blob | ArrayBuffer | ArrayBufferView,
): Promise<Uint8Array> {
  if (source instanceof Blob) return new Uint8Array(await source.arrayBuffer());
  if (ArrayBuffer.isView(source))
    return new Uint8Array(
      source.buffer.slice(
        source.byteOffset,
        source.byteOffset + source.byteLength,
      ),
    );
  return new Uint8Array(source.slice(0));
}

async function sha256(bytes: Uint8Array): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", ownedBuffer(bytes));
  return `sha256:${[...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
}
