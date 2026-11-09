import { t } from "@lingui/core/macro";
import { hasOpenOverlay } from "../components/overlays/overlay-stack";
import { todayString } from "../domain/task";
import { setTaskDate, shiftTaskDate } from "../domain/task-date-actions";
import {
  loadCalendarPreferences,
  startOfCalendarWeek,
} from "./calendar-preferences";

/** Actions a focused task row (or the command palette) can run on its task. */
export type TaskShortcutAction =
  | "open"
  | "toggle"
  | "dates"
  | "priority"
  | "status"
  | "project"
  | "today"
  | "tomorrow"
  | "next-week";

export const TASK_SHORTCUT_EVENT = "tasknotes:task-shortcut";
/** Asks a row's action menu to open on one panel. */
export const TASK_MENU_PANEL_EVENT = "tasknotes:task-menu-panel";

/** Single-letter keys for a focused task row. Enter also opens (native button). */
const rowKeys: Record<string, TaskShortcutAction> = {
  o: "open",
  x: "toggle",
  d: "dates",
  p: "priority",
  s: "status",
  t: "today",
  m: "tomorrow",
  w: "next-week",
};

export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches(
        "input, textarea, select, [role='textbox'], [contenteditable]:not([contenteditable='false'])",
      ))
  );
}

export function hasCommandModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey;
}

/**
 * Plain-key shortcuts yield to typing, IME composition, other handlers, and
 * any open menu, sheet, or dialog, which owns the keyboard while it is open.
 */
export function plainShortcutsSuspended(
  event: KeyboardEvent,
  allowAlt = false,
): boolean {
  return (
    event.defaultPrevented ||
    event.isComposing ||
    event.metaKey ||
    event.ctrlKey ||
    (event.altKey && !allowAlt) ||
    isEditableTarget(event.target) ||
    hasOpenOverlay() ||
    inNativeDialog(event.target)
  );
}

/** Shared mdbase dialogs (feedback) are native and outside the overlay stack. */
function inNativeDialog(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("dialog[open]") !== null;
}

export function taskRowShortcut(
  event: KeyboardEvent,
): TaskShortcutAction | null {
  // "+" needs Shift on many layouts, and matches the capture syntax.
  if (event.key === "+")
    return plainShortcutsSuspended(event) ? null : "project";
  if (event.shiftKey || plainShortcutsSuspended(event)) return null;
  return rowKeys[event.key.toLocaleLowerCase()] ?? null;
}

/** The first day of the next calendar week, honouring the calendar setting. */
export function nextWeekStart(
  today = todayString(),
  firstDay = safeFirstDay(),
): string {
  const [year, month, day] = today.split("-").map(Number);
  const start = startOfCalendarWeek(new Date(year, month - 1, day), firstDay);
  const offset = Math.round(
    (start.valueOf() - new Date(year, month - 1, day).valueOf()) / 86_400_000,
  );
  return shiftTaskDate(today, offset + 7);
}

/** Date shortcuts move the scheduled day and keep any existing time. */
export function shortcutSchedule(
  action: Extract<TaskShortcutAction, "today" | "tomorrow" | "next-week">,
  current: string | undefined,
  today = todayString(),
): string {
  const target =
    action === "today"
      ? today
      : action === "tomorrow"
        ? shiftTaskDate(today, 1)
        : nextWeekStart(today);
  return setTaskDate(current, target);
}

export function shortcutScheduleLabel(
  action: Extract<TaskShortcutAction, "today" | "tomorrow" | "next-week">,
): string {
  return action === "today"
    ? t({ message: "today" })
    : action === "tomorrow"
      ? t({ message: "tomorrow" })
      : t({ message: "next week" });
}

/** Ask a mounted task row to run an action, as if its key had been pressed. */
export function requestTaskShortcut(
  row: Element,
  action: TaskShortcutAction,
): void {
  row.dispatchEvent(
    new CustomEvent<TaskShortcutAction>(TASK_SHORTCUT_EVENT, {
      detail: action,
    }),
  );
}

const ROW_SELECTOR = ".task-row[data-task-id]";

function visible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    if (node.hidden || node.inert) return false;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

/** Task rows in reading order within the region that owns the current row. */
export function taskRowsIn(region: ParentNode): HTMLElement[] {
  return [...region.querySelectorAll<HTMLElement>(ROW_SELECTOR)].filter(
    (row) => row.querySelector(".task-row-title") && visible(row),
  );
}

export function rowTitle(row: Element): HTMLButtonElement | null {
  return row.querySelector<HTMLButtonElement>(".task-row-title");
}

function focusRow(row: HTMLElement) {
  const title = rowTitle(row);
  if (!title) return;
  title.focus({ preventScroll: true });
  row.scrollIntoView?.({ block: "nearest" });
}

export function focusRestoredTaskRow(taskId: string) {
  const main = document.getElementById("main-content");
  if (!main) return;
  const href = location.href;
  const restore = () => {
    const row = main.querySelector<HTMLElement>(
      `.task-row[data-task-id="${CSS.escape(taskId)}"]`,
    );
    if (!row || location.href !== href) return false;
    focusRow(row);
    return true;
  };
  if (restore()) return;
  const observer = new MutationObserver(() => {
    if (location.href !== href || restore()) {
      observer.disconnect();
      window.clearTimeout(timeout);
    }
  });
  const timeout = window.setTimeout(() => observer.disconnect(), 5_000);
  observer.observe(main, { childList: true, subtree: true });
}

let rowPlace: { id: string; index: number; href: string } | undefined;

/** Keeps the keyboard's place in a list after focus leaves it. */
export function rememberRowPlace(target: EventTarget | null) {
  if (!(target instanceof Element)) return;
  const row = target.closest<HTMLElement>(ROW_SELECTOR);
  const region = row?.closest("#main-content");
  if (!row || !region) return;
  rowPlace = {
    id: row.dataset.taskId!,
    index: taskRowsIn(region).indexOf(row),
    href: location.href,
  };
}

function placedRow(rows: HTMLElement[]): {
  row: HTMLElement;
  stillThere: boolean;
} | null {
  if (!rowPlace || rowPlace.href !== location.href) return null;
  const { id, index } = rowPlace;
  const same = rows.find((row) => row.dataset.taskId === id);
  const row = same ?? rows[Math.min(index, rows.length - 1)];
  return row ? { row, stillThere: Boolean(same) } : null;
}

/** Returns focus to the list after a menu or edit has taken it away. */
export function returnFocusToList(
  main: ParentNode | null = document.getElementById("main-content"),
) {
  const active = document.activeElement;
  if (active && active !== document.body && active !== main) return;
  const place = main && placedRow(taskRowsIn(main));
  if (place) focusRow(place.row);
}

/**
 * Move focus to the next or previous task row. With no row focused, start
 * from the first row in view (or the last, moving up) of the main content.
 */
export function focusAdjacentTaskRow(
  direction: 1 | -1,
  active: Element | null = document.activeElement,
  main: ParentNode | null = document.getElementById("main-content"),
): boolean {
  const current = active?.closest<HTMLElement>(ROW_SELECTOR) ?? null;
  const region =
    current?.closest("#main-content, .detail-inspector") ?? main ?? document;
  const rows = taskRowsIn(region);
  if (!rows.length) return false;
  if (!current || !rows.includes(current)) {
    const place = placedRow(rows);
    if (place) {
      const next = place.stillThere
        ? (rows[rows.indexOf(place.row) + direction] ?? place.row)
        : place.row;
      focusRow(next);
      return true;
    }
    const inView = rows.filter((row) => {
      const bounds = row.getBoundingClientRect();
      return bounds.bottom > 0 && bounds.top < window.innerHeight;
    });
    const candidates = inView.length ? inView : rows;
    focusRow(direction > 0 ? candidates[0] : candidates.at(-1)!);
    return true;
  }
  const next = rows[rows.indexOf(current) + direction];
  if (!next) return false;
  focusRow(next);
  return true;
}

/**
 * Remember a row's neighbours before an action that may remove it from the
 * list, and keep keyboard focus in the list if it does.
 */
export function preserveRowFocus(row: HTMLElement): () => void {
  const region = row.closest("#main-content, .detail-inspector") ?? document;
  const rows = taskRowsIn(region);
  const index = rows.indexOf(row);
  const neighbours = [rows[index + 1], rows[index - 1]].filter(Boolean);
  const focusFallback = () => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const fallback =
      neighbours.find(
        (candidate) => candidate.isConnected && visible(candidate),
      ) ??
      taskRowsIn(region)[Math.max(0, index)] ??
      taskRowsIn(region).at(-1);
    if (fallback) focusRow(fallback);
  };
  return () => {
    if (!row.isConnected) {
      focusFallback();
      return;
    }
    if (row.contains(document.activeElement)) {
      // The list may not have re-rendered yet: an async refresh can remove
      // the row after this restore runs, which would drop focus to <body>.
      // Watch briefly and recover only if that removal loses the focus.
      const observer = new MutationObserver(() => {
        if (row.isConnected) return;
        observer.disconnect();
        window.clearTimeout(timeout);
        focusFallback();
      });
      const timeout = window.setTimeout(() => observer.disconnect(), 1_000);
      observer.observe(region, { childList: true, subtree: true });
      return;
    }
    focusFallback();
  };
}

export function isApplePlatform(): boolean {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ?? navigator.platform;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere. */
export function shortcutLabel(key: string): string {
  return isApplePlatform() ? `⌘${key}` : `Ctrl ${key}`;
}

export function keyboardShortcutGroups(): {
  title: string;
  shortcuts: { keys: string[]; description: string }[];
}[] {
  return [
    {
      title: t({ message: "Anywhere" }),
      shortcuts: [
        {
          keys: [shortcutLabel("K")],
          description: t({ message: "Command palette" }),
        },
        {
          keys: ["q", "n", shortcutLabel("N")],
          description: t({ message: "New task" }),
        },
        {
          keys: [shortcutLabel("Z")],
          description: t({ message: "Undo last action" }),
        },
        { keys: ["?"], description: t({ message: "Keyboard shortcuts" }) },
      ],
    },
    {
      title: t({ message: "Navigation" }),
      shortcuts: [
        { keys: ["/"], description: t({ message: "Search" }) },
        { keys: ["g → t"], description: t({ message: "Today" }) },
        { keys: ["g → u"], description: t({ message: "Upcoming" }) },
        { keys: ["g → i"], description: t({ message: "Inbox" }) },
        { keys: ["g → s"], description: t({ message: "Scratchpad" }) },
        { keys: ["g → c"], description: t({ message: "Calendar" }) },
        { keys: ["g → p"], description: t({ message: "Projects" }) },
        { keys: ["Shift M"], description: t({ message: "Toggle sidebar" }) },
      ],
    },
    {
      title: t({ message: "Task details" }),
      shortcuts: [
        { keys: ["j", "Alt+↓"], description: t({ message: "Next task" }) },
        { keys: ["k", "Alt+↑"], description: t({ message: "Previous task" }) },
        { keys: ["Esc"], description: t({ message: "Back to the list" }) },
      ],
    },
    {
      title: t({ message: "Task lists" }),
      shortcuts: [
        { keys: ["j", "↓"], description: t({ message: "Next task" }) },
        { keys: ["k", "↑"], description: t({ message: "Previous task" }) },
        { keys: ["o", "Enter"], description: t({ message: "Open task" }) },
        { keys: ["x"], description: t({ message: "Complete or reopen" }) },
        { keys: ["v"], description: t({ message: "Select focused task" }) },
        {
          keys: ["Shift+j", "Shift+k"],
          description: t({ message: "Extend task selection" }),
        },
        {
          keys: [shortcutLabel("A")],
          description: t({ message: "Select all visible tasks" }),
        },
        { keys: ["Esc"], description: t({ message: "Clear task selection" }) },
        { keys: ["d"], description: t({ message: "Change dates" }) },
        { keys: ["p"], description: t({ message: "Set priority" }) },
        { keys: ["s"], description: t({ message: "Set status" }) },
        { keys: ["+"], description: t({ message: "Move to project" }) },
        { keys: ["t"], description: t({ message: "Schedule today" }) },
        { keys: ["m"], description: t({ message: "Schedule tomorrow" }) },
        { keys: ["w"], description: t({ message: "Schedule next week" }) },
      ],
    },
  ];
}

type Listener = (message: string) => void;
const listeners = new Set<Listener>();

/** Polite announcements for keyboard actions, rendered once by the shell. */
export function announceShortcut(message: string): void {
  for (const listener of listeners) listener(message);
}

export function subscribeShortcutAnnouncements(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function safeFirstDay(): number {
  try {
    return loadCalendarPreferences().firstDay;
  } catch {
    return 1;
  }
}
