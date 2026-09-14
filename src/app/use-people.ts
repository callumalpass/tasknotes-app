import { useCallback, useEffect, useMemo, useState } from "react";
import type { PeopleDirectory } from "../domain/people";
import { useRepository } from "./repository-context";

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
  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("focus", retry);
    return () => window.removeEventListener("focus", retry);
  }, [enabled, retry]);
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
    supported: Boolean(repository.people),
  };
}
