import type {
  CollectionFile,
  CollectionFileStore,
} from "../application/ports/collection-file-store";

export async function downloadAttachment(
  store: CollectionFileStore,
  file: CollectionFile,
  name: string,
): Promise<void> {
  const bytes = await store.download(file);
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/octet-stream" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
