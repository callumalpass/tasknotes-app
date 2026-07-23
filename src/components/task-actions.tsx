import {
  Archive,
  ArchiveRestore,
  Check,
  Circle,
  MoreHorizontal,
  Pencil,
  Play,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useRepository } from "../app/repository-context";
import { activeTimeEntry } from "../domain/task";
import { actionFeedback } from "../native/feedback";

import type { Task } from "../domain/task";

interface MenuPosition {
  x: number;
  y: number;
}

export function TaskActions({
  task,
  occurrenceDate,
  onOpen,
  onToggle,
}: {
  task: Task;
  occurrenceDate?: string;
  onOpen(task: Task, occurrenceDate?: string): void;
  onToggle(task: Task, occurrenceDate?: string): void;
}) {
  const { deleteTask, setTaskArchived, startTimeTracking, stopTimeTracking } =
    useRepository();
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tracking = Boolean(activeTimeEntry(task.timeEntries));

  useEffect(() => {
    if (!position) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [position]);

  function openFromTrigger() {
    if (position) {
      closeMenu();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    openMenu(rect?.right ?? innerWidth - 16, rect?.bottom ?? 64);
  }

  function openMenu(x: number, y: number) {
    const width = 224;
    const height = 300;
    setError("");
    setConfirmDelete(false);
    setPosition({
      x: Math.max(8, Math.min(x - width, innerWidth - width - 8)),
      y: Math.max(8, Math.min(y + 4, innerHeight - height - 8)),
    });
    queueMicrotask(() =>
      menuRef.current
        ?.querySelector<HTMLButtonElement>("[role='menuitem']")
        ?.focus(),
    );
  }

  function closeMenu() {
    setPosition(null);
    setConfirmDelete(false);
    setError("");
  }

  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      actionFeedback();
      closeMenu();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        aria-controls={position ? menuId : undefined}
        aria-expanded={Boolean(position)}
        aria-haspopup="menu"
        aria-label={`Task actions for ${task.title}`}
        className="task-actions-trigger"
        ref={triggerRef}
        type="button"
        onClick={openFromTrigger}
      >
        <MoreHorizontal aria-hidden="true" size={20} strokeWidth={1.7} />
      </button>
      {position
        ? createPortal(
            <div
              aria-label={`Actions for ${task.title}`}
              className="task-actions-menu"
              id={menuId}
              ref={menuRef}
              role="menu"
              style={{ left: position.x, top: position.y }}
            >
              <div className="task-actions-heading">
                <strong>{task.title}</strong>
                <button type="button" onClick={closeMenu}>
                  Close
                </button>
              </div>
              {confirmDelete ? (
                <div className="task-actions-confirm">
                  <p>Delete this task?</p>
                  <button
                    className="danger"
                    disabled={busy}
                    role="menuitem"
                    type="button"
                    onClick={() => void run(() => deleteTask(task.id))}
                  >
                    <Trash2 aria-hidden="true" size={18} /> Delete permanently
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Keep task
                  </button>
                </div>
              ) : (
                <div className="task-actions-items">
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      closeMenu();
                      onOpen(task, occurrenceDate);
                    }}
                  >
                    <Pencil aria-hidden="true" size={18} /> Edit
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      closeMenu();
                      onToggle(task, occurrenceDate);
                    }}
                  >
                    {task.completed ? (
                      <Circle aria-hidden="true" size={18} />
                    ) : (
                      <Check aria-hidden="true" size={18} />
                    )}
                    {task.completed ? "Mark open" : "Complete"}
                  </button>
                  <button
                    disabled={busy}
                    role="menuitem"
                    type="button"
                    onClick={() =>
                      void run(() =>
                        tracking
                          ? stopTimeTracking(task.id)
                          : startTimeTracking(task.id),
                      )
                    }
                  >
                    {tracking ? (
                      <Square aria-hidden="true" size={17} />
                    ) : (
                      <Play aria-hidden="true" size={18} />
                    )}
                    {tracking ? "Stop timer" : "Start timer"}
                  </button>
                  <button
                    disabled={busy}
                    role="menuitem"
                    type="button"
                    onClick={() =>
                      void run(() => setTaskArchived(task.id, !task.archived))
                    }
                  >
                    {task.archived ? (
                      <ArchiveRestore aria-hidden="true" size={18} />
                    ) : (
                      <Archive aria-hidden="true" size={18} />
                    )}
                    {task.archived ? "Restore" : "Archive"}
                  </button>
                  <button
                    className="danger"
                    role="menuitem"
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 aria-hidden="true" size={18} /> Delete
                  </button>
                </div>
              )}
              {error ? (
                <p className="task-actions-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
