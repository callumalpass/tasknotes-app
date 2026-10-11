import type { PaletteCommand } from "./command-palette-model";
import {
  requestTaskShortcut,
  type TaskShortcutAction,
} from "./keyboard-shortcuts";
import {
  SCRATCHPAD_NAVIGATION_KEY,
  SEARCH_NAVIGATION_KEY,
} from "./navigation-views";
import type { Route } from "./use-workspace-navigation";
import type { TaskView } from "../domain/view";

/** Find the task row the palette should act on: focused, else the open task. */
export function paletteTaskTarget(
  active: Element | null,
  route: Route,
): HTMLElement | null {
  const focused = active?.closest<HTMLElement>(".task-row[data-task-id]");
  if (focused) return focused;
  if (route.page !== "task") return null;
  const rows = document.querySelectorAll<HTMLElement>(
    "#main-content .task-row[data-task-id]",
  );
  return (
    [...rows].find(
      (row) =>
        row.dataset.taskId === route.id &&
        (row.dataset.occurrence ?? undefined) === route.occurrence,
    ) ??
    [...rows].find((row) => row.dataset.taskId === route.id) ??
    null
  );
}

export function navigationCommands({
  navigationKeys,
  views,
  homeKey,
  navigate,
  newTask,
  showShortcuts,
}: {
  navigationKeys: readonly string[];
  views: readonly TaskView[];
  homeKey?: string;
  navigate(route: Route): void;
  newTask(): void;
  showShortcuts(): void;
}): PaletteCommand[] {
  const commands: PaletteCommand[] = [];
  const routeFor = (key: string, route: Route): Route =>
    key === homeKey ? { page: "home" } : route;
  const seen = new Set<string>();
  const add = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    if (key === SCRATCHPAD_NAVIGATION_KEY) {
      commands.push({
        id: "go:scratchpad",
        label: "Scratchpad",
        section: "navigate",
        keywords: ["notes", "outline"],
        run: () => navigate(routeFor(key, { page: "scratchpad" })),
      });
      return;
    }
    if (key === SEARCH_NAVIGATION_KEY) {
      commands.push({
        id: "go:search",
        label: "Search",
        section: "navigate",
        keywords: ["find"],
        run: () => navigate(routeFor(key, { page: "search" })),
      });
      return;
    }
    const view = views.find((candidate) => candidate.key === key);
    if (!view) return;
    commands.push({
      id: `go:view:${view.key}`,
      label: view.name,
      section: "navigate",
      keywords: ["view"],
      run: () => navigate(routeFor(key, { page: "views", key: view.key })),
    });
  };
  for (const key of navigationKeys) add(key);
  add(SEARCH_NAVIGATION_KEY);
  add(SCRATCHPAD_NAVIGATION_KEY);
  for (const view of views) add(view.key);
  commands.push(
    {
      id: "go:views",
      label: "Manage views",
      section: "navigate",
      keywords: ["views", "saved"],
      run: () => navigate({ page: "views" }),
    },
    {
      id: "go:settings",
      label: "Settings",
      section: "navigate",
      keywords: ["preferences", "collection", "theme"],
      run: () => navigate({ page: "more" }),
    },
    {
      id: "action:new-task",
      label: "New task",
      section: "actions",
      keywords: ["add", "create", "capture"],
      run: newTask,
    },
    {
      id: "action:shortcuts",
      label: "Keyboard shortcuts",
      section: "actions",
      keywords: ["help", "keys"],
      shortcut: "?",
      run: showShortcuts,
    },
  );
  return commands;
}

export function taskCommands(
  row: HTMLElement | null,
  openTaskId?: string,
): PaletteCommand[] {
  if (!row?.dataset.taskId) return [];
  const title = row.dataset.taskTitle ?? "this task";
  const completed = row.dataset.taskCompleted === "true";
  const request = (action: TaskShortcutAction) => () => {
    if (row.isConnected) requestTaskShortcut(row, action);
  };
  const commands: PaletteCommand[] = [];
  if (row.dataset.taskId !== openTaskId)
    commands.push({
      id: "task:open",
      label: `Open “${title}”`,
      section: "task",
      keywords: ["details", "edit"],
      shortcut: "o",
      run: request("open"),
    });
  commands.push(
    {
      id: "task:toggle",
      label: `${completed ? "Reopen" : "Complete"} “${title}”`,
      section: "task",
      keywords: ["done", "finish", "check"],
      shortcut: "x",
      run: request("toggle"),
    },
    {
      id: "task:today",
      label: "Schedule today",
      section: "task",
      keywords: ["date", "move"],
      shortcut: "t",
      detail: title,
      run: request("today"),
    },
    {
      id: "task:tomorrow",
      label: "Schedule tomorrow",
      section: "task",
      keywords: ["date", "move", "postpone"],
      shortcut: "m",
      detail: title,
      run: request("tomorrow"),
    },
    {
      id: "task:next-week",
      label: "Schedule next week",
      section: "task",
      keywords: ["date", "move", "postpone", "defer"],
      shortcut: "w",
      detail: title,
      run: request("next-week"),
    },
  );
  return commands;
}
