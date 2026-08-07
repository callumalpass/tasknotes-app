import type {
  CollectionFile,
  CollectionFileStore,
} from "../application/ports/collection-file-store";

/** Session-only collection files for exercising attachment flows in the demo. */
export class DemoFileStore implements CollectionFileStore {
  private readonly entries = new Map<
    string,
    { file: CollectionFile; bytes: Blob }
  >();

  authorizedActions() {
    return new Set([
      "list",
      "read",
      "add",
      "replace",
      "move",
      "delete",
    ] as const);
  }

  async list(options: { folder?: string } = {}) {
    const folder = options.folder?.replace(/\/$/u, "");
    return [...this.entries.values()]
      .map(({ file }) => structuredClone(file))
      .filter((file) => !folder || file.path.startsWith(`${folder}/`));
  }

  async upload(
    path: string,
    source: Blob | ArrayBuffer | ArrayBufferView,
    options: { mediaType?: string } = {},
  ) {
    const bytes = toBlob(source, options.mediaType);
    const file: CollectionFile = {
      fileId: crypto.randomUUID(),
      path,
      revision: crypto.randomUUID(),
      contentDigest: await sha256(bytes),
      size: bytes.size,
      ...(options.mediaType ? { mediaType: options.mediaType } : {}),
      mediaClass: mediaClass(options.mediaType),
      modifiedAt: new Date().toISOString(),
    };
    this.entries.set(path, { file, bytes });
    return structuredClone(file);
  }

  async download(file: CollectionFile) {
    const entry = this.entries.get(file.path);
    if (!entry) throw new Error("File not found.");
    return entry.bytes;
  }

  async downloadStream(file: CollectionFile) {
    return (await this.download(file)).stream();
  }

  async move(file: CollectionFile, path: string) {
    const entry = this.entries.get(file.path);
    if (!entry) throw new Error("File not found.");
    this.entries.delete(file.path);
    const moved = { ...entry.file, path, revision: crypto.randomUUID() };
    this.entries.set(path, { file: moved, bytes: entry.bytes });
    return structuredClone(moved);
  }

  async delete(file: CollectionFile) {
    this.entries.delete(file.path);
  }
}

function toBlob(
  source: Blob | ArrayBuffer | ArrayBufferView,
  mediaType?: string,
): Blob {
  if (source instanceof Blob) return source;
  if (source instanceof ArrayBuffer)
    return new Blob([source], { type: mediaType });
  return new Blob(
    [
      source.buffer.slice(
        source.byteOffset,
        source.byteOffset + source.byteLength,
      ) as ArrayBuffer,
    ],
    { type: mediaType },
  );
}

function mediaClass(mediaType?: string): CollectionFile["mediaClass"] {
  if (mediaType?.startsWith("image/")) return "image";
  if (mediaType?.startsWith("audio/")) return "audio";
  if (mediaType?.startsWith("video/")) return "video";
  if (mediaType === "application/pdf") return "pdf";
  return "other";
}

async function sha256(source: Blob): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await source.arrayBuffer(),
  );
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}
