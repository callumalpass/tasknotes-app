import { useLingui, Trans } from "@lingui/react/macro";
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
import { usePresence } from "./overlays/use-presence";

import type { CreateTaskInput, Task, TaskSummary } from "../domain/task";
import type { TaskCreateIntent } from "../application/ports/task-repository";

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
  onOpenTask(task: TaskSummary): void;
  onAdded?(task: TaskSummary): void;
  defaults?: Partial<CreateTaskInput>;
  session?: CaptureSession;
  createTask?(input: CreateTaskInput, intent?: TaskCreateIntent): Promise<Task>;
  onCreated?(
    task: TaskSummary,
  ): Promise<import("./task-capture").TaskCaptureFollowUp | void>;
}) {
  const { t } = useLingui();
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
  const present = usePresence(open, scrimRef);

  if (!present) return null;
  return createPortal(
    <div
      aria-hidden={open ? undefined : true}
      className="global-capture-scrim"
      data-state={open ? "open" : "closed"}
      inert={!open}
      ref={scrimRef}
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
            <h2 id={titleId}>
              <Trans>New task</Trans>
            </h2>
          </div>
          <button
            aria-label={t({ message: "Close new task" })}
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
          placeholder={t({ message: "What needs doing?" })}
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
            <button
              type="button"
              className="text-action"
              disabled={snapshot.status === "submitting"}
              onClick={() => session.discard()}
            >
              <Trans>Discard draft</Trans>
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
          <Trans>Keep adding tasks</Trans>
        </label>
      </section>
    </div>,
    document.body,
  );
}
