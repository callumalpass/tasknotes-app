import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { defaultNavigationViewKeys } from "../domain/default-view-source";
import { ensureTaskNotesDefaultViewSource } from "../application/ensure-default-view-source";
import { flattenViewDocuments } from "../domain/view";
import { useRepository } from "./repository-context";
import {
  moveNavigationViewKey,
  navigationViewScope,
  readLegacyPrimaryViewKey,
  readPreviousNavigationViewKeys,
  readNavigationViewKeys,
  SCRATCHPAD_NAVIGATION_KEY,
  writeNavigationViewKeys,
} from "./navigation-views";

import type { TaskView, TaskViewDocument } from "../domain/view";
import type { TaskRepository } from "../application/ports/task-repository";

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
  navigationKeys: string[];
  homeView?: TaskView;
  loading: boolean;
  refresh(): Promise<void>;
  toggleNavigationView(key: string): void;
  moveNavigationView(key: string, direction: -1 | 1): void;
} {
  const { repository, status } = useRepository();
  const [catalog, setCatalog] = useState<ViewCatalog>({
    documents: null,
    error: "",
    scope: "",
    navigationKeys: [],
  });
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    if (status !== "ready") return;
    const request = ++requestSequence.current;
    let info: Awaited<ReturnType<TaskRepository["collectionInfo"]>> | undefined;
    let cachedDocuments: TaskViewDocument[] = [];
    try {
      [info, cachedDocuments] = await Promise.all([
        repository.collectionInfo(),
        repository.cachedViews().catch(() => []),
      ]);
      if (request !== requestSequence.current) return;
      const cached = resolveNavigationViewCatalog(info, cachedDocuments, true);
      if (cached)
        setCatalog((current) =>
          current.documents === null || current.scope !== cached.scope
            ? cached
            : current,
        );

      const providerDocuments = await ensureTaskNotesDefaultViewSource(
        repository,
        await repository.listViews(),
        await repository.taskConfiguration(),
      );
      if (request !== requestSequence.current) return;
      setCatalog(resolveNavigationViewCatalog(info, providerDocuments, false)!);
    } catch (reason) {
      if (request !== requestSequence.current) return;
      const fallback = info
        ? resolveNavigationViewCatalog(info, cachedDocuments, false)
        : null;
      setCatalog((current) => {
        const resolved =
          current.documents !== null ? current : (fallback ?? current);
        return {
          ...resolved,
          error: reason instanceof Error ? reason.message : String(reason),
        };
      });
    }
  }, [repository, status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      setNavigationKeys((keys) => {
        if (!keys.includes(key)) return [...keys, key];
        const taskViewCount = keys.filter(
          (candidate) => candidate !== SCRATCHPAD_NAVIGATION_KEY,
        ).length;
        if (key !== SCRATCHPAD_NAVIGATION_KEY && taskViewCount === 1)
          return keys;
        return keys.filter((candidate) => candidate !== key);
      }),
    [setNavigationKeys],
  );
  const moveNavigationView = useCallback(
    (key: string, direction: -1 | 1) =>
      setNavigationKeys((keys) => {
        const next = moveNavigationViewKey(keys, key, direction);
        return next[0] === SCRATCHPAD_NAVIGATION_KEY ? keys : next;
      }),
    [setNavigationKeys],
  );
  return {
    documents: catalog.documents,
    views,
    error: catalog.error,
    navigationViews,
    navigationKeys: catalog.navigationKeys,
    homeView: navigationViews[0],
    loading: catalog.documents === null,
    refresh,
    toggleNavigationView,
    moveNavigationView,
  };
}

export function resolveNavigationViewCatalog(
  info: Awaited<ReturnType<TaskRepository["collectionInfo"]>>,
  providerDocuments: TaskViewDocument[],
  requireStoredViews: boolean,
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
): ViewCatalog | null {
  const scope = navigationViewScope(info);
  const documents = providerDocuments;
  const available = new Set(
    flattenViewDocuments(documents).map((view) => view.key),
  );
  available.add(SCRATCHPAD_NAVIGATION_KEY);
  let stored = readNavigationViewKeys(storage, scope);
  if (!stored && info.id) {
    stored = readNavigationViewKeys(storage, `${info.kind}:${info.location}`);
    if (stored) writeNavigationViewKeys(storage, scope, stored);
  }
  if (!stored) {
    const previous =
      readPreviousNavigationViewKeys(storage, scope) ??
      (info.id
        ? readPreviousNavigationViewKeys(
            storage,
            `${info.kind}:${info.location}`,
          )
        : undefined);
    if (previous) {
      stored = withDefaultScratchpad(previous);
      writeNavigationViewKeys(storage, scope, stored);
    }
  }
  if (!stored) {
    const legacy =
      readLegacyPrimaryViewKey(storage, scope) ??
      (info.id
        ? readLegacyPrimaryViewKey(storage, `${info.kind}:${info.location}`)
        : undefined);
    if (legacy) {
      stored = withDefaultScratchpad([legacy]);
      writeNavigationViewKeys(storage, scope, stored);
    }
  }
  if (requireStoredViews && stored?.[0] && !available.has(stored[0]))
    return null;
  const requested =
    stored ?? withDefaultScratchpad(defaultNavigationViewKeys(documents));
  const navigationKeys = requested.filter((key) => available.has(key));
  if (!navigationKeys.length) {
    const defaults = defaultNavigationViewKeys(documents);
    if (defaults.length) navigationKeys.push(...defaults);
    else {
      const first = flattenViewDocuments(documents)[0];
      if (first) navigationKeys.push(first.key);
    }
  }
  if (
    !requireStoredViews &&
    stored &&
    (stored.length !== navigationKeys.length ||
      stored.some((key, index) => key !== navigationKeys[index]))
  )
    writeNavigationViewKeys(storage, scope, navigationKeys);
  return {
    documents,
    error: "",
    scope,
    navigationKeys,
  };
}

function withDefaultScratchpad(keys: readonly string[]): string[] {
  if (keys.includes(SCRATCHPAD_NAVIGATION_KEY)) return [...keys];
  return [...keys.slice(0, 1), SCRATCHPAD_NAVIGATION_KEY, ...keys.slice(1)];
}
