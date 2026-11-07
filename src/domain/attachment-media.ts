const inlineImageTypes: Record<string, readonly string[]> = {
  avif: ["image/avif"],
  gif: ["image/gif"],
  heic: ["image/heic", "image/heif"],
  heif: ["image/heic", "image/heif"],
  jpeg: ["image/jpeg"],
  jpg: ["image/jpeg"],
  png: ["image/png"],
  webp: ["image/webp"],
};

export function inlineImageMediaType(
  path: string,
  mediaType?: string,
): string | null {
  const extension = /\.([^./\\]+)$/.exec(path)?.[1].toLowerCase();
  const supported =
    extension && Object.hasOwn(inlineImageTypes, extension)
      ? inlineImageTypes[extension]
      : undefined;
  const normalized = mediaType?.toLowerCase().split(";", 1)[0].trim();
  if (!supported || (normalized && !supported.includes(normalized)))
    return null;
  return normalized || supported[0];
}
