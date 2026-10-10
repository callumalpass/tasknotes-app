import { useState } from "react";
import type {
  RecordWriteTarget,
  TaskRepository,
} from "../application/ports/task-repository";

import { useRecordWriteState } from "./use-record-write-state";

/** Provider-neutral local capture versus authority outcome. Checking never writes. */
export function RecordWriteNotice({
  repository,
  target,
}: {
  repository: TaskRepository;
  target: RecordWriteTarget;
}) {
  const state = useRecordWriteState(repository, target);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(false);
  if (!state) return null;
  return (
    <span className="save-state" role="status">
      {state === "pending"
        ? "Saved locally · Waiting to sync"
        : state === "failed"
          ? "Change rejected · Review this record"
          : state === "conflicted"
            ? "Conflicting changes · Review this record"
            : "Save outcome unknown"}
      {state === "unknown" && repository.reconcileWrites ? (
        <button
          type="button"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            setError(false);
            void repository.reconcileWrites!()
              .catch(() => setError(true))
              .finally(() => setChecking(false));
          }}
        >
          {checking ? "Checking" : "Check save"}
        </button>
      ) : null}
      {error ? " · Could not check; the original change is retained" : null}
    </span>
  );
}
