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
import { useOverlay } from "./overlays/use-overlay";

import type { CreateTaskInput, Task } from "../domain/task";

export function GlobalTaskCapture({
  open,
  onClose,
  onOpenTask,
  defaults,
  onCreated,
  onAdded,
  session: providedSession,
  createTask: suppliedCreateTask,
}: {
  open: boolean;
  onClose(): void;
  onOpenTask(task: Task): void;
  onAdded?(task: Task): void;
  defaults?: Partial<CreateTaskInput>;
  session?: CaptureSession;
  createTask?(input: CreateTaskInput): Promise<Task>;
  onCreated?(
    task: Task,
  ): Promise<import("./task-capture").TaskCaptureFollowUp | void>;
}) {
  const [keepAdding, setKeepAdding] = useState(false);
  const {
    configuration,
    createTask: repositoryCreateTask,
    repository,
  } = useRepository();
  const createTask = suppliedCreateTask ?? repositoryCreateTask;
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
  const completeField = useCallback(
    (request: import("../domain/completion").FieldCompletionRequest) =>
      repository.completeField(request),
    [repository],
  );

  useOverlay({ open, rootRef: dialogRef, modal: true, onDismiss: onClose });

  if (!open) return null;
  return createPortal(
    <div className="global-capture-scrim" ref={scrimRef}>
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
          onAccepted={(task, version) => {
            if (!keepAddingRef.current && session.canCloseAccepted(version)) {
              onAdded?.(task);
              onClose();
            }
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
