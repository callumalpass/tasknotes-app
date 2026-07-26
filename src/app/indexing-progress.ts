import type { RepositoryIndexingProgress } from "../storage/repository";

export function localIndexingLabel(
  progress: RepositoryIndexingProgress,
): string {
  if (progress.phase === "indexing" && progress.total)
    return `Indexing ${progress.completed.toLocaleString()} of ${progress.total.toLocaleString()} tasks…`;
  return "Checking local tasks…";
}
