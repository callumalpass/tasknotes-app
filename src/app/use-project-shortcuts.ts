import { useSyncExternalStore } from "react";
import type { ProjectShortcut } from "../domain/project-shortcuts";
import { useRepository } from "./repository-context";

const NONE: ProjectShortcut[] = [];

/** Observe already-loaded metadata; the sidebar must never start collection reads. */
export function useProjectShortcuts(): ProjectShortcut[] {
  const { repository, status } = useRepository();
  const serialized = useSyncExternalStore(
    (listener) => repository.subscribe(listener),
    () =>
      JSON.stringify(
        status === "ready" ? (repository.projectShortcuts?.() ?? NONE) : NONE,
      ),
    () => "[]",
  );
  return JSON.parse(serialized) as ProjectShortcut[];
}
