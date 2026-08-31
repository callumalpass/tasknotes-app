import {
  SCRATCH_IMAGE_TYPE,
  type CreateScratchImageInput,
  type ScratchImage,
} from "../domain/scratch-image";
import type { ScratchpadRecordLike } from "./scratchpads";

export function scratchImageFromRecord(
  record: ScratchpadRecordLike,
): ScratchImage {
  const value = record.frontmatter;
  if (
    value.type !== SCRATCH_IMAGE_TYPE &&
    !record.types?.includes(SCRATCH_IMAGE_TYPE)
  )
    throw new Error(`${record.path} is not a TaskNotes scratch image.`);
  const digest = requiredString(value, "digest");
  if (!/^sha256:[0-9a-f]{64}$/i.test(digest))
    throw new Error(`${record.path} has an invalid image digest.`);
  const size = value.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0)
    throw new Error(`${record.path} has an invalid image size.`);
  return {
    kind: "image",
    id: requiredString(value, "id"),
    path: record.path,
    revision: record.revision,
    dateCreated: requiredString(value, "dateCreated"),
    dateModified: requiredString(value, "dateModified"),
    file: requiredString(value, "file"),
    digest: digest.toLowerCase() as `sha256:${string}`,
    size,
    mediaType: requiredString(value, "mediaType"),
    ...(dimension(value.width) ? { width: value.width as number } : {}),
    ...(dimension(value.height) ? { height: value.height as number } : {}),
    ...(typeof value.caption === "string" && value.caption.trim()
      ? { caption: value.caption.trim() }
      : {}),
  };
}

export function scratchImageFrontmatter(
  input: CreateScratchImageInput,
  now = input.dateCreated,
) {
  return {
    type: SCRATCH_IMAGE_TYPE,
    id: input.id,
    dateCreated: input.dateCreated,
    dateModified: now,
    file: input.file,
    digest: input.digest,
    size: input.size,
    mediaType: input.mediaType,
    ...(input.width ? { width: input.width } : {}),
    ...(input.height ? { height: input.height } : {}),
    ...(input.caption?.trim() ? { caption: input.caption.trim() } : {}),
  };
}

function requiredString(value: Record<string, unknown>, key: string) {
  const result = value[key];
  if (typeof result !== "string" || !result.trim())
    throw new Error(`Scratch image ${key} must be a non-empty string.`);
  return result;
}

function dimension(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
