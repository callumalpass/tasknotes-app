import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_NAVIGATION_VIEW_KEYS,
  taskNotesDefaultViewDocument,
} from "../domain/default-views";
import { flattenViewDocuments } from "../domain/view";
import { useRepository } from "./repository-context";
import {
  moveNavigationViewKey,
  navigationViewScope,
  readNavigationViewKeys,
  writeNavigationViewKeys,
} from "./navigation-views";

import type { TaskView, TaskViewDocument } from "../domain/view";

interface ViewCatalog {
  documents: TaskViewDocument[] | null;
  error: string;
  scope: string;
  navigationKeys: string[];
}

export function useNavigationViews(): {
  documents: TaskViewDocument[] | null;
  views: TaskView[] | null;
  error: string;
  navigationViews: TaskView[];
  homeView?: TaskView;
  refresh(): Promise<void>;
  toggleNavigationView(key: string): void;
  moveNavigationView(key: string, direction: -1 | 1): void;
} {
  const { repository, status, version } = useRepository();
  const [catalog, setCatalog] = useState<ViewCatalog>({
    documents: [taskNotesDefaultViewDocument()],
    error: "",
    scope: "",
    navigationKeys: [...DEFAULT_NAVIGATION_VIEW_KEYS],
  });
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    if (status !== "ready") return;
    const request = ++requestSequence.current;
    try {
      const [info, providerDocuments] = await Promise.all([
        repository.collectionInfo(),
        repository.listViews(),
      ]);
      if (request !== requestSequence.current) return;
      const scope = navigationViewScope(info);
      const documents = [
        taskNotesDefaultViewDocument(),
        ...providerDocuments.filter(
          (document) => document.id !== "tasknotes.default-views",
        ),
      ];
      const available = new Set(
        flattenViewDocuments(documents).map((view) => view.key),
      );
      const stored = readNavigationViewKeys(window.localStorage, scope);
      const requested = stored ?? [...DEFAULT_NAVIGATION_VIEW_KEYS];
      const navigationKeys = requested.filter((key) => available.has(key));
      if (!navigationKeys.length) {
        const first = flattenViewDocuments(documents)[0];
        if (first) navigationKeys.push(first.key);
      }
      if (
        stored &&
        (stored.length !== navigationKeys.length ||
          stored.some((key, index) => key !== navigationKeys[index]))
      )
        writeNavigationViewKeys(window.localStorage, scope, navigationKeys);
      setCatalog({
        documents,
        error: "",
        scope,
        navigationKeys,
      });
    } catch (reason) {
      if (request !== requestSequence.current) return;
      setCatalog((current) => ({
        ...current,
        documents: current.documents ?? [taskNotesDefaultViewDocument()],
        navigationKeys: current.navigationKeys.length
          ? current.navigationKeys
          : [...DEFAULT_NAVIGATION_VIEW_KEYS],
        error: reason instanceof Error ? reason.message : String(reason),
      }));
    }
  }, [repository, status]);

  useEffect(() => {
    void refresh();
  }, [refresh, version]);

  const setNavigationKeys = useCallback(
    (update: (keys: string[]) => string[]) => {
      if (!catalog.scope) return;
      setCatalog((current) => {
        const navigationKeys = update(current.navigationKeys);
        if (!navigationKeys.length) return current;
        writeNavigationViewKeys(
          window.localStorage,
          current.scope,
          navigationKeys,
        );
        return { ...current, navigationKeys };
      });
    },
    [catalog.scope],
  );
  const views = useMemo(
    () => (catalog.documents ? flattenViewDocuments(catalog.documents) : null),
    [catalog.documents],
  );
  const navigationViews = useMemo(
    () =>
      catalog.navigationKeys.flatMap((key) => {
        const view = views?.find((candidate) => candidate.key === key);
        return view ? [view] : [];
      }),
    [catalog.navigationKeys, views],
  );
  const toggleNavigationView = useCallback(
    (key: string) =>
      setNavigationKeys((keys) =>
        keys.includes(key)
          ? keys.length === 1
            ? keys
            : keys.filter((candidate) => candidate !== key)
          : [...keys, key],
      ),
    [setNavigationKeys],
  );
  const moveNavigationView = useCallback(
    (key: string, direction: -1 | 1) =>
      setNavigationKeys((keys) => moveNavigationViewKey(keys, key, direction)),
    [setNavigationKeys],
  );
  return {
    documents: catalog.documents,
    views,
    error: catalog.error,
    navigationViews,
    homeView: navigationViews[0],
    refresh,
    toggleNavigationView,
    moveNavigationView,
  };
}
