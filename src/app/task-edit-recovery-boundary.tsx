import { ArrowLeft } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { LoadingRows } from "../components/loading";
import { OperationErrorNotice } from "../components/operation-error-notice";
import { useRepository } from "./repository-context";
import { taskEditScope } from "./task-edit-recovery";

/** No editable field may precede the identity used to keep its draft.
 * The child must read its existing backup synchronously on mount, before
 * effects can clear it or input can change it. */
export function TaskEditRecoveryBoundary({
  children,
  onBack,
}: {
  children(scope: string): ReactNode;
  onBack(): void;
}) {
  const { repository } = useRepository();
  const [scope, setScope] = useState<{
    repository: typeof repository;
    value: string | null;
    error: Error | null;
  } | null>(null);
  useEffect(() => {
    let live = true;
    void repository
      .collectionInfo()
      .then((info) => {
        if (live)
          setScope({ repository, value: taskEditScope(info), error: null });
      })
      .catch((reason: unknown) => {
        if (live)
          setScope({
            repository,
            value: null,
            error: reason instanceof Error ? reason : new Error(String(reason)),
          });
      });
    return () => {
      live = false;
    };
  }, [repository]);
  if (scope?.repository !== repository)
    return (
      <section className="screen task-screen">
        <LoadingRows count={5} />
      </section>
    );
  if (scope.error || scope.value === null)
    return (
      <section className="screen task-screen">
        <button className="back-action" type="button" onClick={onBack}>
          <ArrowLeft size={20} /> Back
        </button>
        <OperationErrorNotice
          action="Unsaved edit recovery"
          message={
            scope.error?.message ?? "The collection identity is unavailable."
          }
          recovery="Go back and refresh the collection before editing."
        />
      </section>
    );
  return children(scope.value);
}
