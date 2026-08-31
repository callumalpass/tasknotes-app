export const SCRATCH_IMAGE_TYPE = "tasknotes-scratch-image";
export const SCRATCH_IMAGE_METADATA_FOLDER =
  "TaskNotes/Scratchpad/Image Metadata";
export const SCRATCH_IMAGE_FILE_FOLDER = "TaskNotes/Scratchpad/Images";

export interface ScratchImage {
  kind: "image";
  id: string;
  path: string;
  revision: string;
  dateCreated: string;
  dateModified: string;
  file: string;
  digest: `sha256:${string}`;
  size: number;
  mediaType: string;
  width?: number;
  height?: number;
  caption?: string;
}

export interface CreateScratchImageInput {
  id: string;
  path: string;
  dateCreated: string;
  file: string;
  digest: `sha256:${string}`;
  size: number;
  mediaType: string;
  width?: number;
  height?: number;
  caption?: string;
}

export function scratchImageIdentity(now: Date, id: string, extension: string) {
  const timestamp = now.toISOString().replaceAll(":", "-");
  const suffix = id.slice(0, 8);
  const safeExtension = /^\.[a-z0-9]+$/i.test(extension)
    ? extension.toLowerCase()
    : ".img";
  return {
    metadataPath: `${SCRATCH_IMAGE_METADATA_FOLDER}/${timestamp} – ${suffix}.md`,
    filePath: `${SCRATCH_IMAGE_FILE_FOLDER}/${timestamp} – ${suffix}${safeExtension}`,
  };
}
