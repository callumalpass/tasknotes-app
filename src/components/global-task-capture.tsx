import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  captureSessionFor,
  type CaptureSession,
} from "../application/capture-session";
import { createPortal } from "react-dom";

import { useRepository } from "../app/repository-context";
import { TaskCapture } from "./task-capture";

import type { CreateTaskInput, Task } from "../domain/task";

export function GlobalTaskCapture({
  open,
  onClose,
  onOpenTask,
  defaults,
  onCreated,
  session: providedSession,
}: {
  open: boolean;
  onClose(): void;
  onOpenTask(task: Task): void;
  defaults?: Partial<CreateTaskInput>;
  session?: CaptureSession;
  onCreated?(
    task: Task,
  ): Promise<import("./task-capture").TaskCaptureFollowUp | void>;
}) {
  const [keepAdding, setKeepAdding] = useState(false);
  const { configuration, createTask, repository } = useRepository();
  const session = providedSession ?? captureSessionFor(repository);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const keepAddingRef = useRef(keepAdding);
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    const resize = () => {
      scrimRef.current?.style.setProperty(
        "--capture-viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      scrimRef.current?.style.setProperty(
        "--capture-viewport-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
    };
  }, [open]);
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
      ref={scrimRef}
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
          session={session}
          defaults={defaults}
          retainFocusAfterCreate={keepAdding}
          configuration={configuration}
          createTask={createTask}
          completeField={completeField}
          focusRequest={1}
          placeholder="What needs doing?"
          showGuide
          onCreated={onCreated}
          onAccepted={(_task, version) => {
            if (!keepAddingRef.current && session.canCloseAccepted(version))
              onClose();
          }}
          onOpenCreated={(task) => {
            onClose();
            onOpenTask(task);
          }}
        />
        {snapshot.text.trim() ? (
          <div className="capture-draft-actions">
            <small>Draft kept while this collection is open.</small>
            <button
              type="button"
              className="text-action"
              disabled={snapshot.status === "submitting"}
              onClick={() => session.discard()}
            >
              Discard draft
            </button>
          </div>
        ) : null}
        <label className="capture-keep-adding">
          <input
            type="checkbox"
            checked={keepAdding}
            onChange={(event) => {
              keepAddingRef.current = event.target.checked;
              setKeepAdding(event.target.checked);
            }}
          />
          Keep adding tasks
        </label>
      </section>
    </div>,
    document.body,
  );
}
