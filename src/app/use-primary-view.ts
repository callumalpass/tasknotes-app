import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TaskView } from "../domain/view";
import { useRepository } from "./repository-context";
import {
  primaryViewScope,
  readPrimaryViewKey,
  writePrimaryViewKey,
} from "./primary-view";

interface ViewCatalog {
  views: TaskView[] | null;
  error: string;
  scope: string;
  primaryKey?: string;
}

export function usePrimaryView(): {
  views: TaskView[] | null;
  error: string;
  primaryView?: TaskView;
  refresh(): Promise<void>;
  setPrimaryView(key?: string): void;
} {
  const { repository, status, version } = useRepository();
  const [catalog, setCatalog] = useState<ViewCatalog>({
    views: null,
    error: "",
    scope: "",
  });
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    if (status !== "ready") return;
    const request = ++requestSequence.current;
    try {
      const [info, views] = await Promise.all([
        repository.collectionInfo(),
        repository.listViews(),
      ]);
      if (request !== requestSequence.current) return;
      const scope = primaryViewScope(info);
      setCatalog({
        views,
        error: "",
        scope,
        primaryKey: readPrimaryViewKey(window.localStorage, scope),
      });
    } catch (reason) {
      if (request !== requestSequence.current) return;
      setCatalog((current) => ({
        ...current,
        views: current.views ?? [],
        error: reason instanceof Error ? reason.message : String(reason),
      }));
    }
  }, [repository, status]);

  useEffect(() => {
    void refresh();
  }, [refresh, version]);

  const setPrimaryView = useCallback(
    (key?: string) => {
      if (!catalog.scope) return;
      writePrimaryViewKey(window.localStorage, catalog.scope, key);
      setCatalog((current) => ({ ...current, primaryKey: key }));
    },
    [catalog.scope],
  );
  const primaryView = useMemo(
    () => catalog.views?.find((view) => view.key === catalog.primaryKey),
    [catalog.primaryKey, catalog.views],
  );
  return {
    views: catalog.views,
    error: catalog.error,
    primaryView,
    refresh,
    setPrimaryView,
  };
}
