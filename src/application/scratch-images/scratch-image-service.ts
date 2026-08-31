import type { TaskRepository } from "../ports/task-repository";
import type { CollectionFile } from "../ports/collection-file-store";
import {
  scratchImageIdentity,
  type ScratchImage,
} from "../../domain/scratch-image";

const EXTENSIONS: Record<string, string> = {
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/** Bounded, session-only upload coordinator. It does not claim crash recovery. */
export class ScratchImageService {
  private readonly inFlight = new Map<string, Promise<ScratchImage>>();

  constructor(private readonly repository: TaskRepository) {}

  async add(source: Blob): Promise<ScratchImage> {
    if (!this.repository.files || !this.repository.createScratchImage)
      throw new Error("Image storage is not available for this collection.");
    const mediaType = source.type.toLowerCase().split(";", 1)[0]!.trim();
    const extension = EXTENSIONS[mediaType];
    if (!extension)
      throw new Error("Add an AVIF, GIF, HEIC, JPEG, PNG, or WebP image.");
    if (!source.size) throw new Error("The image is empty.");
    await assertRasterSignature(source, mediaType);
    const digest = await sha256(source);
    const existing = this.inFlight.get(digest);
    if (existing) return existing;
    const operation = this.upload(source, mediaType, extension, digest).finally(
      () => {
        if (this.inFlight.get(digest) === operation)
          this.inFlight.delete(digest);
      },
    );
    this.inFlight.set(digest, operation);
    return operation;
  }

  private async upload(
    source: Blob,
    mediaType: string,
    extension: string,
    digest: `sha256:${string}`,
  ) {
    const id = crypto.randomUUID();
    const now = new Date();
    const paths = scratchImageIdentity(now, id, extension);
    const file = await this.repository.files!.upload(paths.filePath, source, {
      mediaType,
      transferId: id,
    });
    assertVerified(file, source, digest, mediaType);
    const dimensions = await imageDimensions(source);
    // Metadata is intentionally created only after a verified authority upload.
    // A metadata failure may leave an unreferenced binary; it is never deleted here.
    return this.repository.createScratchImage!({
      id,
      path: paths.metadataPath,
      dateCreated: now.toISOString(),
      file: file.path,
      digest,
      size: source.size,
      mediaType,
      ...dimensions,
    });
  }
}

function assertVerified(
  file: CollectionFile,
  source: Blob,
  digest: string,
  mediaType: string,
) {
  if (
    file.size !== source.size ||
    file.contentDigest !== digest ||
    file.mediaClass !== "image" ||
    (file.mediaType && file.mediaType.toLowerCase() !== mediaType)
  )
    throw new Error(
      "The image upload could not be verified. No feed record was created.",
    );
}

async function sha256(blob: Blob): Promise<`sha256:${string}`> {
  const bytes = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return `sha256:${[...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

async function assertRasterSignature(blob: Blob, mediaType: string) {
  const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const ascii = new TextDecoder("ascii").decode(bytes);
  const matches =
    mediaType === "image/png"
      ? startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      : mediaType === "image/jpeg"
        ? startsWith(bytes, [0xff, 0xd8, 0xff])
        : mediaType === "image/gif"
          ? ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")
          : mediaType === "image/webp"
            ? ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP"
            : mediaType === "image/avif"
              ? ascii.slice(4, 8) === "ftyp" && /avif|avis/.test(ascii.slice(8))
              : ascii.slice(4, 8) === "ftyp" &&
                /heic|heix|hevc|hevx|mif1|msf1/.test(ascii.slice(8));
  if (!matches)
    throw new Error("The pasted file is not a valid supported raster image.");
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

async function imageDimensions(
  blob: Blob,
): Promise<{ width?: number; height?: number }> {
  if (typeof createImageBitmap !== "function") return {};
  try {
    const bitmap = await createImageBitmap(blob);
    const result = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return result;
  } catch {
    throw new Error("The pasted image could not be decoded.");
  }
}
