import { useEffect, useRef, type RefObject } from "react";
import {
  TASK_MENU_PANEL_EVENT,
  TASK_SHORTCUT_EVENT,
  announceShortcut,
  preserveRowFocus,
  shortcutSchedule,
  shortcutScheduleLabel,
  taskRowShortcut,
  type TaskShortcutAction,
} from "../app/keyboard-shortcuts";

import type { TaskSummary } from "../domain/task";

export interface TaskShortcutHandlers {
  task: TaskSummary;
  completed: boolean;
  /** Virtual occurrences of a series keep the series dates. */
  reschedulable: boolean;
  open(): void;
  toggle(): Promise<void>;
  schedule(scheduled: string, when: string): Promise<void>;
  /** A held selection takes the keys, so they act on every selected task. */
  yieldToSelection(): boolean;
}

/**
 * Row keys (o, x, d, p, +, t, m, w) for a focused task row, plus the same actions
 * requested by the command palette through TASK_SHORTCUT_EVENT.
 */
export function useTaskShortcuts(
  rowRef: RefObject<HTMLElement | null>,
  handlers: TaskShortcutHandlers,
) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const run = async (action: TaskShortcutAction) => {
      const { task, completed, reschedulable, open, toggle, schedule } =
        latest.current;
      if (action === "open") {
        open();
        return;
      }
      if (action === "dates") {
        row.querySelector<HTMLButtonElement>(".task-row-quick-date")?.click();
        return;
      }
      if (
        action === "priority" ||
        action === "status" ||
        action === "project"
      ) {
        row
          .querySelector(".task-actions-trigger")
          ?.dispatchEvent(
            new CustomEvent(TASK_MENU_PANEL_EVENT, { detail: action }),
          );
        return;
      }
      const restoreFocus = preserveRowFocus(row);
      try {
        if (action === "toggle") {
          await toggle();
          announceShortcut(
            `${completed ? "Reopened" : "Completed"} ${task.title}.`,
          );
        } else if (!reschedulable) {
          announceShortcut(
            `${task.title} is one occurrence of a repeating task; open it to change its dates.`,
          );
          return;
        } else {
          const when = shortcutScheduleLabel(action);
          await schedule(shortcutSchedule(action, task.scheduled), when);
          announceShortcut(`Scheduled ${task.title} for ${when}.`);
        }
      } catch {
        // The row shows the mutation error and its retry action.
        return;
      }
      window.requestAnimationFrame(restoreFocus);
    };
    const keydown = (event: KeyboardEvent) => {
      const action = taskRowShortcut(event);
      if (!action) return;
      if (action !== "open" && latest.current.yieldToSelection()) return;
      event.preventDefault();
      void run(action);
    };
    const requested = (event: Event) =>
      void run((event as CustomEvent<TaskShortcutAction>).detail);
    row.addEventListener("keydown", keydown);
    row.addEventListener(TASK_SHORTCUT_EVENT, requested);
    return () => {
      row.removeEventListener("keydown", keydown);
      row.removeEventListener(TASK_SHORTCUT_EVENT, requested);
    };
  }, [rowRef]);
}
