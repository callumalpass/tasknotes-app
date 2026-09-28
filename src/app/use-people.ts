import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PeopleDirectory } from "../domain/people";
import { useRepository, useRepositoryRevision } from "./repository-context";

export function usePeople(enabled = true) {
  const { repository, invalidation } = useRepository();
  const [revision, setRevision] = useState(0);
  const request = useMemo(
    () => ({ repository, enabled, revision }),
    [repository, enabled, revision],
  );
  const [state, setState] = useState<{
    request: typeof request;
    directory?: PeopleDirectory;
    error?: Error;
  }>();
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(
    () => invalidation.subscribe("people", retry),
    [invalidation, retry],
  );
  // Reload once when the user comes back from Connect's person settings,
  // rather than rereading every person record on each window focus.
  const awaitingSettingsReturn = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const returned = () => {
      if (!awaitingSettingsReturn.current) return;
      awaitingSettingsReturn.current = false;
      retry();
    };
    window.addEventListener("focus", returned);
    return () => window.removeEventListener("focus", returned);
  }, [enabled, retry]);
  const openedSettings = useCallback(() => {
    awaitingSettingsReturn.current = true;
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (request.enabled && request.repository.people) {
      void request.repository
        .people(controller.signal)
        .then((directory) => {
          if (!controller.signal.aborted) setState({ request, directory });
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setState({
              request,
              error:
                reason instanceof Error
                  ? reason
                  : new Error("People could not be loaded."),
            });
        });
    }
    return () => controller.abort();
  }, [request]);
  const current = state?.request === request ? state : undefined;
  return {
    directory: current?.directory,
    error: current?.error,
    retry,
    openedSettings,
    supported: Boolean(repository.people),
  };
}

/**
 * Where each saved assignee link of a task resolves, refreshed when the task
 * changes. Undefined while loading, unsupported, or unavailable.
 */
export function useAssigneeTargets(taskId: string, enabled: boolean) {
  const { repository } = useRepository();
  const revision = useRepositoryRevision(`task:${taskId}`);
  const [state, setState] = useState<{
    key: string;
    targets: Map<string, string | null>;
  }>();
  const key = `${taskId}\u0000${revision}`;
  useEffect(() => {
    if (!enabled || !repository.resolveAssignees) return;
    const controller = new AbortController();
    repository
      .resolveAssignees(taskId, controller.signal)
      .then((targets) => {
        if (!controller.signal.aborted) setState({ key, targets });
      })
      // Labels fall back to link text; resolution never blocks editing.
      .catch(() => undefined);
    return () => controller.abort();
  }, [enabled, key, repository, taskId]);
  return state?.key === key ? state.targets : undefined;
}
