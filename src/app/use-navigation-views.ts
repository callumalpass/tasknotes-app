import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  defaultNavigationViewKeys,
  taskNotesViewSourcePath,
} from "../domain/default-view-source";
import {
  logViewDiscovery,
  type ViewDiscoveryOutcome,
} from "./view-discovery-diagnostic";
import { flattenViewDocuments } from "../domain/view";
import { useRepository } from "./repository-context";
import {
  moveNavigationViewKey,
  navigationViewScope,
  legacyNavigationViewScope,
  readLegacyPrimaryViewKey,
  readPreviousNavigationViewKeys,
  readNavigationViewKeys,
  SCRATCHPAD_NAVIGATION_KEY,
  SEARCH_NAVIGATION_KEY,
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
  homeKey?: string;
  loading: boolean;
  discovery: "loading" | ViewDiscoveryOutcome;
  refreshing: boolean;
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
  const requestSequence = useRef({ value: 0 });
  const inFlight = useRef<{
    repository: TaskRepository;
    sequence: number;
    pending: Promise<void>;
  } | null>(null);
  const [discovery, setDiscovery] = useState<"loading" | ViewDiscoveryOutcome>(
    "loading",
  );
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => {
    if (status !== "ready") return Promise.resolve();
    const sequence = requestSequence.current;
    const active = inFlight.current;
    if (active?.repository === repository && active.sequence === sequence.value)
      return active.pending;
    const request = ++sequence.value;
    const pending = (async () => {
      const started = performance.now();
      let outcome: ViewDiscoveryOutcome = "error";
      let viewCount: number | null = null;
      let stage: "metadata" | "discovery" = "metadata";
      let discoveryMs: number | null = null;
      let failure: unknown;
      let published = false;
      let info:
        Awaited<ReturnType<TaskRepository["collectionInfo"]>> | undefined;
      let cachedDocuments: TaskViewDocument[];
      let cachedCatalog: ViewCatalog | null = null;
      try {
        // Start asynchronously when invoked by the mount effect. Superseded
        // owners cannot publish state or launch an extra discovery READ.
        await Promise.resolve();
        if (request !== sequence.value) return;
        setRefreshing(true);
        [info, cachedDocuments] = await Promise.all([
          repository.collectionInfo(),
          repository.cachedViews().catch(() => []),
        ]);
        if (request !== sequence.value) return;
        cachedCatalog = resolveNavigationViewCatalog(
          info,
          cachedDocuments,
          true,
        );
        const scope = navigationViewScope(info);
        setCatalog((current) => {
          if (current.scope === scope && current.documents !== null)
            return current;
          return (
            cachedCatalog ?? {
              documents: null,
              error: "",
              scope,
              navigationKeys: [],
            }
          );
        });
        stage = "discovery";
        const readStarted = performance.now();
        let providerDocuments: TaskViewDocument[];
        try {
          // Discovery is read-only. Setup and explicit Create view own writes;
          // missing/deleted defaults must never be silently recreated here.
          providerDocuments = await repository.listViews();
        } finally {
          discoveryMs = performance.now() - readStarted;
        }
        viewCount = flattenViewDocuments(providerDocuments).length;
        outcome = viewCount ? "ok" : "empty";
        if (request !== sequence.value) return;
        setCatalog(
          resolveNavigationViewCatalog(info, providerDocuments, false)!,
        );
        setDiscovery(outcome);
        published = true;
      } catch (reason) {
        failure = reason;
        outcome = "error";
        if (request !== sequence.value) return;
        // A failed READ is not an authoritative empty catalog. Preserve cached
        // views and preferences without pruning or writing navigation choices.
        setCatalog((current) => ({
          ...(info && current.scope === navigationViewScope(info)
            ? current
            : (cachedCatalog ?? {
                documents: null,
                scope: info ? navigationViewScope(info) : "",
                navigationKeys: [],
              })),
          error: "Couldn't load your views.",
        }));
        setDiscovery("error");
        published = true;
      } finally {
        if (request === sequence.value) setRefreshing(false);
        logViewDiscovery({
          outcome,
          viewCount,
          stage,
          error: failure,
          published,
          totalMs: performance.now() - started,
          discoveryMs,
        });
      }
    })();
    inFlight.current = { repository, sequence: request, pending };
    void pending
      .finally(() => {
        if (inFlight.current?.pending === pending) inFlight.current = null;
      })
      .catch(() => {});
    return pending;
  }, [repository, status]);

  useEffect(() => {
    const sequence = requestSequence.current;
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    const stop = repository.subscribe((change) => {
      if (active && (change?.kind === "data" || change?.kind === "lifecycle"))
        void refresh();
    });
    return () => {
      active = false;
      stop();
      sequence.value++;
    };
  }, [refresh, repository]);

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
        const next = keys.filter((candidate) => candidate !== key);
        return next.length ? next : keys;
      }),
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
    navigationKeys: catalog.navigationKeys,
    homeKey: catalog.navigationKeys[0],
    loading: catalog.documents === null && discovery !== "error",
    discovery,
    refreshing,
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
  available.add(SEARCH_NAVIGATION_KEY);
  const previousScope = legacyNavigationViewScope(info);
  let stored = readNavigationViewKeys(storage, scope);
  if (!stored && previousScope) {
    stored = readNavigationViewKeys(storage, previousScope);
    if (stored) writeNavigationViewKeys(storage, scope, stored);
  }
  if (!stored) {
    const previous =
      readPreviousNavigationViewKeys(storage, scope) ??
      (previousScope
        ? readPreviousNavigationViewKeys(storage, previousScope)
        : undefined);
    if (previous) {
      stored = withDefaultTools(previous);
      writeNavigationViewKeys(storage, scope, stored);
    }
  }
  if (!stored) {
    const legacy =
      readLegacyPrimaryViewKey(storage, scope) ??
      (previousScope
        ? readLegacyPrimaryViewKey(storage, previousScope)
        : undefined);
    if (legacy) {
      stored = withDefaultTools([legacy]);
      writeNavigationViewKeys(storage, scope, stored);
    }
  }
  if (stored) {
    const upgraded = stored.map((key) => upgradeDefaultViewKey(key, available));
    if (upgraded.some((key, index) => key !== stored![index])) {
      stored = upgraded;
      writeNavigationViewKeys(storage, scope, stored);
    }
  }
  if (
    requireStoredViews &&
    ((!stored && flattenViewDocuments(documents).length === 0) ||
      (stored?.[0] && !available.has(stored[0])))
  )
    return null;
  const requested =
    stored ?? dailyNavigationDefaults(defaultNavigationViewKeys(documents));
  const navigationKeys = requested.filter((key) => available.has(key));
  if (!navigationKeys.length) {
    const defaults = defaultNavigationViewKeys(documents);
    if (defaults.length)
      navigationKeys.push(...dailyNavigationDefaults(defaults));
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

function upgradeDefaultViewKey(
  key: string,
  available: ReadonlySet<string>,
): string {
  const match =
    /^(?:views\/tasknotes-app\.base|views\/tasknotes\/[a-z0-9-]+\.base)#([a-z0-9-]+)$/i.exec(
      key,
    );
  if (!match) return key;
  const id = match[1].toLowerCase();
  const upgraded = `${taskNotesViewSourcePath(id)}#${id}`;
  return available.has(upgraded) ? upgraded : key;
}

function dailyNavigationDefaults(keys: readonly string[]): string[] {
  return [
    ...keys.slice(0, 2),
    SCRATCHPAD_NAVIGATION_KEY,
    SEARCH_NAVIGATION_KEY,
    ...keys.slice(2),
  ];
}

function withDefaultTools(keys: readonly string[]): string[] {
  const next = [...keys];
  if (!next.includes(SCRATCHPAD_NAVIGATION_KEY))
    next.splice(Math.min(1, next.length), 0, SCRATCHPAD_NAVIGATION_KEY);
  if (!next.includes(SEARCH_NAVIGATION_KEY))
    next.splice(Math.min(2, next.length), 0, SEARCH_NAVIGATION_KEY);
  return next;
}
