export function isMissingFileError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "NotFoundError")
    return true;
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown };
  if (value.code === "OS-PLUG-FILE-0008") return true;
  return (
    typeof value.message === "string" &&
    /(?:does not exist|not found)/i.test(value.message)
  );
}
