import { useCallback, useEffect, useMemo, useState } from "react";

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
  setPrimaryView(key?: string): void;
} {
  const { repository, status, version } = useRepository();
  const [catalog, setCatalog] = useState<ViewCatalog>({
    views: null,
    error: "",
    scope: "",
  });

  useEffect(() => {
    if (status !== "ready") return;
    let active = true;
    Promise.all([repository.collectionInfo(), repository.listViews()]).then(
      ([info, views]) => {
        if (!active) return;
        const scope = primaryViewScope(info);
        setCatalog({
          views,
          error: "",
          scope,
          primaryKey: readPrimaryViewKey(window.localStorage, scope),
        });
      },
      (reason: unknown) => {
        if (!active) return;
        setCatalog((current) => ({
          ...current,
          views: current.views ?? [],
          error: reason instanceof Error ? reason.message : String(reason),
        }));
      },
    );
    return () => {
      active = false;
    };
  }, [repository, status, version]);

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
    setPrimaryView,
  };
}
