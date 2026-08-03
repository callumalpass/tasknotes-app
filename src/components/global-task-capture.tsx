import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import { useRepository } from "../app/repository-context";
import { TaskCapture } from "./task-capture";

import type { Task } from "../domain/task";

export function GlobalTaskCapture({
  open,
  onClose,
  onOpenTask,
}: {
  open: boolean;
  onClose(): void;
  onOpenTask(task: Task): void;
}) {
  const { configuration, createTask, repository } = useRepository();
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const completeField = useCallback(
    (request: import("../domain/completion").FieldCompletionRequest) =>
      repository.completeField(request),
    [repository],
  );

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const app = document.getElementById("root");
    const previousOverflow = document.body.style.overflow;
    if (app) app.inert = true;
    document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      if (app) app.inert = false;
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", keydown);
      queueMicrotask(() => returnFocusRef.current?.focus());
    };
  }, [onClose, open]);

  if (!open) return null;
  return createPortal(
    <div
      className="global-capture-scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="global-capture-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <div>
            <p className="eyebrow">This collection</p>
            <h2 id={titleId}>New task</h2>
          </div>
          <button
            aria-label="Close new task"
            className="icon-action"
            type="button"
            onClick={onClose}
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        <TaskCapture
          configuration={configuration}
          createTask={createTask}
          completeField={completeField}
          focusRequest={1}
          placeholder="What needs doing?"
          showGuide
          onCreated={async () => onClose()}
          onOpenCreated={(task) => {
            onClose();
            onOpenTask(task);
          }}
        />
      </section>
    </div>,
    document.body,
  );
}
