import type { RepositorySyncStatus } from "../application/ports/task-repository";

export function storageExplanation(mode: RepositorySyncStatus["mode"]): string {
  if (mode === "replicated")
    return "The shared mdbase collection is the source of truth. This device keeps an offline copy and syncs changes.";
  if (mode === "live")
    return "The connected mdbase collection is the source of truth. TaskNotes reads and writes it directly; changes require a connection.";
  return "Markdown files on this device are the source of truth. TaskNotes reads and writes them directly.";
}
