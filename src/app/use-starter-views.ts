import { useCallback, useRef, useState } from "react";

import { addTaskNotesStarterViews } from "../application/ensure-default-view-source";
import { cleanOperationError } from "./operation-error";
import { useRepository } from "./repository-context";

/** Explicit Add starter views action. Creates only the missing TaskNotes
 * starters; existing view sources are never replaced. */
export function useAddStarterViews(onAdded: () => Promise<void>): {
  add(): Promise<void>;
  adding: boolean;
  error: string;
} {
  const { repository, configuration } = useRepository();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  const add = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setAdding(true);
    setError("");
    try {
      await addTaskNotesStarterViews(repository, configuration);
      await onAdded();
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message
          ? `Couldn't add starter views. ${cleanOperationError(reason.message)}`
          : "Couldn't add starter views.",
      );
    } finally {
      running.current = false;
      setAdding(false);
    }
  }, [configuration, onAdded, repository]);
  return { add, adding, error };
}
