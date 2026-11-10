import { useLingui as useI18n } from "@lingui/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CommandPalette } from "../components/command-palette";
import { KeyboardShortcutsSheet } from "../components/keyboard-shortcuts-sheet";
import { hasOpenOverlay } from "../components/overlays/overlay-stack";
import type { PaletteCommand } from "./command-palette-model";
import {
  focusAdjacentTaskRow,
  plainShortcutsSuspended,
  rememberRowPlace,
  subscribeShortcutAnnouncements,
} from "./keyboard-shortcuts";
import {
  navigationCommands,
  paletteTaskTarget,
  taskCommands,
  timerCommands,
} from "./palette-commands";
import { useTaskSearch } from "./repository-context";
import type { Route } from "./use-workspace-navigation";
import type { TaskView } from "../domain/view";
import type { TimerControl } from "./use-timer-control";

/**
 * Shell-wide keyboard layer: j/k and arrow row navigation, ? for the
 * shortcut sheet, Cmd/Ctrl+K for the palette, and polite announcements for
 * row actions. Row keys themselves belong to each task row.
 */
export function KeyboardLayer({
  route,
  navigationKeys,
  views,
  homeKey,
  navigate,
  newTask,
  paletteRequest,
  toggleSidebar,
  timers,
}: {
  route: Route;
  navigationKeys: readonly string[];
  views: readonly TaskView[];
  homeKey?: string;
  navigate(route: Route): void;
  newTask(): void;
  toggleSidebar?(): void;
  /** Increments when the sidebar asks for the palette. */
  paletteRequest: number;
  /** Running timers and their actions; without it the palette offers none. */
  timers?: Pick<TimerControl, "timers" | "start" | "stop">;
}) {
  useI18n();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const routeRef = useRef(route);
  const paletteOpenRef = useRef(paletteOpen);
  useEffect(() => {
    routeRef.current = route;
    paletteOpenRef.current = paletteOpen;
  });

  const openPalette = useCallback(() => {
    setTarget(paletteTaskTarget(document.activeElement, routeRef.current));
    setQuery("");
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const [handledRequest, setHandledRequest] = useState(paletteRequest);
  if (handledRequest !== paletteRequest) {
    setHandledRequest(paletteRequest);
    if (paletteRequest > 0) {
      setTarget(paletteTaskTarget(null, route));
      setQuery("");
      setPaletteOpen(true);
    }
  }

  useEffect(
    () =>
      subscribeShortcutAnnouncements((message) =>
        // Alternate a trailing space so repeated messages are re-announced.
        setAnnouncement((previous) =>
          previous === message ? `${message}\u00a0` : message,
        ),
      ),
    [],
  );

  useEffect(() => {
    let prefixUntil = 0;
    const navigation = navigationCommands({
      navigationKeys,
      views,
      homeKey,
      navigate,
      newTask,
      showShortcuts: () => setSheetOpen(true),
      toggleSidebar,
    });
    const clearPrefix = () => {
      prefixUntil = 0;
    };
    // Capture the second key before a focused row can interpret t as Schedule today.
    const sequenceKeydown = (event: KeyboardEvent) => {
      if (!prefixUntil) return;
      const pending = Date.now() < prefixUntil;
      clearPrefix();
      if (!pending || event.shiftKey || plainShortcutsSuspended(event)) return;
      const command = navigation.find(
        (entry) => entry.shortcut === `g ${event.key.toLowerCase()}`,
      );
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      command.run();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const key = event.key.toLocaleLowerCase();
      if (
        key === "k" &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        if (paletteOpenRef.current) {
          event.preventDefault();
          setPaletteOpen(false);
          return;
        }
        if (hasOpenOverlay()) return;
        event.preventDefault();
        openPalette();
        return;
      }
      if (plainShortcutsSuspended(event)) {
        clearPrefix();
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setSheetOpen(true);
        return;
      }
      if (key === "m" && toggleSidebar && event.shiftKey) {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (event.shiftKey) return;
      if (key === "g") {
        event.preventDefault();
        prefixUntil = Date.now() + 1_000;
        return;
      }
      if (key === "q" || key === "n") {
        event.preventDefault();
        newTask();
        return;
      }
      if (key === "/") {
        event.preventDefault();
        const input = document.querySelector<HTMLInputElement>(
          "#main-content input[type='search']",
        );
        if (input && route.page !== "task") input.focus();
        else navigation.find((entry) => entry.id === "go:search")?.run();
        return;
      }
      const active = document.activeElement;
      const onRow = Boolean(active?.matches(".task-row-title"));
      const direction =
        key === "j" || (onRow && event.key === "ArrowDown")
          ? 1
          : key === "k" || (onRow && event.key === "ArrowUp")
            ? -1
            : 0;
      if (!direction) return;
      if (focusAdjacentTaskRow(direction) || onRow) event.preventDefault();
    };
    const trackRow = (event: FocusEvent) => rememberRowPlace(event.target);
    window.addEventListener("focusin", trackRow);
    window.addEventListener("keydown", sequenceKeydown, true);
    window.addEventListener("keydown", keydown);
    window.addEventListener("blur", clearPrefix);
    window.addEventListener("focusin", clearPrefix);
    return () => {
      window.removeEventListener("focusin", trackRow);
      window.removeEventListener("keydown", sequenceKeydown, true);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("blur", clearPrefix);
      window.removeEventListener("focusin", clearPrefix);
    };
  }, [
    openPalette,
    navigationKeys,
    views,
    homeKey,
    navigate,
    newTask,
    toggleSidebar,
    route,
  ]);

  const openTaskId = route.page === "task" ? route.id : undefined;
  const commands = [
    ...taskCommands(target, openTaskId),
    ...(timers ? timerCommands(target, timers) : []),
    ...navigationCommands({
      navigationKeys,
      views,
      homeKey,
      navigate,
      newTask,
      showShortcuts: () => setSheetOpen(true),
      toggleSidebar,
    }),
  ];

  return (
    <>
      {paletteOpen ? (
        <SearchingCommandPalette
          commands={commands}
          query={query}
          navigate={navigate}
          onClose={closePalette}
          onQueryChange={setQuery}
        />
      ) : null}
      <KeyboardShortcutsSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
      <p aria-live="polite" className="visually-hidden">
        {announcement}
      </p>
    </>
  );
}

/** Mounted only while open, so task search never runs in the background. */
function SearchingCommandPalette({
  commands,
  query,
  navigate,
  onClose,
  onQueryChange,
}: {
  commands: readonly PaletteCommand[];
  query: string;
  navigate(route: Route): void;
  onClose(): void;
  onQueryChange(query: string): void;
}) {
  const { t } = useLingui();
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 140);
    return () => window.clearTimeout(timeout);
  }, [query]);
  const searchText = debouncedQuery.trim();
  const { tasks: results, loading } = useTaskSearch({
    status: "all",
    search: searchText,
    limit: searchText ? 8 : 0,
  });
  const taskResults = useMemo<PaletteCommand[]>(
    () =>
      searchText
        ? results.map(({ task }) => ({
            id: `find:${task.id}`,
            label: task.title,
            section: "tasks" as const,
            detail: task.completed ? t({ message: "Completed" }) : undefined,
            run: () => navigate({ page: "task", id: task.id }),
          }))
        : [],
    [navigate, results, searchText, t],
  );
  return (
    <CommandPalette
      commands={commands}
      open
      query={query}
      searchingTasks={Boolean(
        query.trim() && (loading || query !== debouncedQuery),
      )}
      taskResults={taskResults}
      onClose={onClose}
      onQueryChange={onQueryChange}
    />
  );
}
