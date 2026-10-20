import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import {
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
  schedule(scheduled: string): Promise<void>;
}

/**
 * Row keys (o, x, t, m, w) for a focused task row, plus the same actions
 * requested by the command palette through TASK_SHORTCUT_EVENT.
 */
export function useTaskShortcuts(
  rowRef: RefObject<HTMLElement | null>,
  handlers: TaskShortcutHandlers,
) {
  const latest = useRef(handlers);
  const restoreAfterRemoval = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const row = rowRef.current;
    return () => {
      // A refreshed view can remove the row after the action promise and its
      // first animation frame have settled. Capture focus before React detaches
      // the node, then restore against the committed list, not the old DOM.
      if (row?.contains(document.activeElement) && restoreAfterRemoval.current)
        window.requestAnimationFrame(restoreAfterRemoval.current);
    };
  }, [rowRef]);
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
      const restoreFocus = preserveRowFocus(row);
      restoreAfterRemoval.current = restoreFocus;
      try {
        if (action === "toggle") {
          await toggle();
          announceShortcut(
            `${completed ? "Reopened" : "Completed"} ${task.title}.`,
          );
        } else if (!reschedulable) {
          restoreAfterRemoval.current = null;
          announceShortcut(
            `${task.title} is one occurrence of a repeating task; open it to change its dates.`,
          );
          return;
        } else {
          await schedule(shortcutSchedule(action, task.scheduled));
          announceShortcut(
            `Scheduled ${task.title} for ${shortcutScheduleLabel(action)}.`,
          );
        }
      } catch {
        restoreAfterRemoval.current = null;
        // The row shows the mutation error and its retry action.
        return;
      }
      window.requestAnimationFrame(restoreFocus);
    };
    const keydown = (event: KeyboardEvent) => {
      const action = taskRowShortcut(event);
      if (!action) return;
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
