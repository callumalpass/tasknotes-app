import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clipboard,
  Copy,
  FileText,
  FolderTree,
  Link2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Square,
  Star,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useRepository } from "../app/repository-context";
import { recordCompletion } from "../domain/completion";
import { activeTimeEntry, todayString } from "../domain/task";
import { shiftTaskDate } from "../domain/task-date-actions";
import { actionFeedback } from "../native/feedback";

import type { Task } from "../domain/task";

interface MenuPosition {
  x: number;
  y: number;
}

type MenuPanel =
  | "actions"
  | "status"
  | "priority"
  | "dates"
  | "organize"
  | "subtask"
  | "copy"
  | "delete";

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
  const {
    configuration,
    repository,
    createTask,
    deleteTask,
    setTaskArchived,
    startTimeTracking,
    stopTimeTracking,
    updateTask,
  } = useRepository();
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [panel, setPanel] = useState<MenuPanel>("actions");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tracking = Boolean(activeTimeEntry(task.timeEntries));
  const status =
    configuration.statuses.find((option) => option.value === task.status)
      ?.label ?? task.status;
  const priority =
    configuration.priorities.find((option) => option.value === task.priority)
      ?.label ?? task.priority;

  useEffect(() => {
    if (!position) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (panel !== "actions") {
        event.preventDefault();
        setPanel("actions");
      } else {
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
  }, [panel, position]);

  useEffect(() => {
    if (!position || panel === "subtask") return;
    queueMicrotask(() =>
      menuRef.current
        ?.querySelector<HTMLButtonElement>("[role='menuitem']")
        ?.focus(),
    );
  }, [panel, position]);

  function openFromTrigger() {
    if (position) {
      closeMenu();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    const width = 272;
    openMenu(
      (rect?.right ?? innerWidth - 16) - width,
      (rect?.bottom ?? 64) + 4,
    );
  }

  function openFromPointer(x: number, y: number) {
    openMenu(x, y + 4);
  }

  function openMenu(x: number, y: number) {
    const width = 272;
    const estimatedHeight = 520;
    setError("");
    setPanel("actions");
    setSubtaskTitle("");
    // Relay query results do not carry a revision. Fetch it while the person is
    // choosing an action so revision-guarded writes do not add a later round trip.
    void repository.get(task.id).catch(() => undefined);
    setPosition({
      x: Math.max(8, Math.min(x, innerWidth - width - 8)),
      y: Math.max(
        8,
        Math.min(y, innerHeight - Math.min(estimatedHeight, innerHeight - 16)),
      ),
    });
  }

  function closeMenu() {
    setPosition(null);
    setPanel("actions");
    setSubtaskTitle("");
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

  function openEditor() {
    closeMenu();
    onOpen(task, occurrenceDate);
  }

  const today = todayString();
  const tomorrow = shiftTaskDate(today, 1);
  const projectLink = task.path
    ? recordCompletion(
        {
          path: task.path,
          label: task.title,
          frontmatter: task.frontmatter,
          types: ["task"],
        },
        configuration.linkWriteFormat,
      ).value
    : "";

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
        onContextMenu={(event) => {
          event.preventDefault();
          openFromPointer(event.clientX, event.clientY);
        }}
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
              onKeyDown={handleMenuKeys}
            >
              <div className="task-actions-heading">
                <strong>{task.title}</strong>
                <button type="button" onClick={closeMenu}>
                  Close
                </button>
              </div>
              {panel !== "actions" ? (
                <div className="task-actions-subheading">
                  <button
                    aria-label="Back to task actions"
                    type="button"
                    onClick={() => setPanel("actions")}
                  >
                    <ChevronLeft aria-hidden="true" size={18} />
                  </button>
                  <strong>{panelTitle(panel)}</strong>
                </div>
              ) : null}
              <div className="task-actions-items">
                {panel === "actions" ? (
                  <>
                    <MenuAction
                      icon={Pencil}
                      label="Edit"
                      onClick={openEditor}
                    />
                    <MenuAction
                      icon={task.completed ? Circle : Check}
                      label={task.completed ? "Mark open" : "Complete"}
                      onClick={() => {
                        closeMenu();
                        onToggle(task, occurrenceDate);
                      }}
                    />
                    <MenuAction
                      detail={status}
                      icon={Circle}
                      label="Status"
                      next
                      onClick={() => setPanel("status")}
                    />
                    <MenuAction
                      detail={priority}
                      icon={Star}
                      label="Priority"
                      next
                      onClick={() => setPanel("priority")}
                    />
                    <MenuAction
                      detail={dateSummary(task)}
                      icon={CalendarClock}
                      label="Dates"
                      next
                      onClick={() => setPanel("dates")}
                    />
                    <MenuAction
                      icon={FolderTree}
                      label="Organize"
                      next
                      onClick={() => setPanel("organize")}
                    />
                    <MenuSeparator />
                    <MenuAction
                      disabled={busy}
                      icon={tracking ? Square : Play}
                      label={tracking ? "Stop timer" : "Start timer"}
                      onClick={() =>
                        void run(() =>
                          tracking
                            ? stopTimeTracking(task.id)
                            : startTimeTracking(task.id),
                        )
                      }
                    />
                    <MenuAction
                      disabled={busy}
                      icon={task.archived ? ArchiveRestore : Archive}
                      label={task.archived ? "Restore" : "Archive"}
                      onClick={() =>
                        void run(() => setTaskArchived(task.id, !task.archived))
                      }
                    />
                    <MenuAction
                      icon={Copy}
                      label="Copy"
                      next
                      onClick={() => setPanel("copy")}
                    />
                    <MenuSeparator />
                    <MenuAction
                      danger
                      icon={Trash2}
                      label="Delete"
                      onClick={() => setPanel("delete")}
                    />
                  </>
                ) : null}
                {panel === "status"
                  ? configuration.statuses.map((option) => (
                      <MenuAction
                        current={option.value === task.status}
                        disabled={busy}
                        icon={option.value === task.status ? Check : Circle}
                        key={option.value}
                        label={option.label}
                        onClick={() =>
                          void run(() =>
                            updateTask(task.id, { status: option.value }),
                          )
                        }
                      />
                    ))
                  : null}
                {panel === "priority"
                  ? configuration.priorities.map((option) => (
                      <MenuAction
                        current={option.value === task.priority}
                        disabled={busy}
                        icon={option.value === task.priority ? Check : Star}
                        key={option.value}
                        label={option.label}
                        onClick={() =>
                          void run(() =>
                            updateTask(task.id, { priority: option.value }),
                          )
                        }
                      />
                    ))
                  : null}
                {panel === "dates" ? (
                  <>
                    <MenuAction
                      disabled={busy}
                      icon={CalendarClock}
                      label="Due today"
                      onClick={() =>
                        void run(() => updateTask(task.id, { due: today }))
                      }
                    />
                    <MenuAction
                      disabled={busy}
                      icon={CalendarClock}
                      label="Due tomorrow"
                      onClick={() =>
                        void run(() => updateTask(task.id, { due: tomorrow }))
                      }
                    />
                    <MenuAction
                      disabled={busy}
                      icon={CalendarClock}
                      label="Schedule today"
                      onClick={() =>
                        void run(() =>
                          updateTask(task.id, { scheduled: today }),
                        )
                      }
                    />
                    <MenuAction
                      disabled={busy}
                      icon={CalendarClock}
                      label="Schedule tomorrow"
                      onClick={() =>
                        void run(() =>
                          updateTask(task.id, { scheduled: tomorrow }),
                        )
                      }
                    />
                    <MenuAction
                      disabled={busy || (!task.due && !task.scheduled)}
                      icon={ChevronRight}
                      label="Postpone one day"
                      onClick={() =>
                        void run(() =>
                          updateTask(task.id, {
                            ...(task.due
                              ? { due: shiftTaskDate(task.due, 1) }
                              : {}),
                            ...(task.scheduled
                              ? {
                                  scheduled: shiftTaskDate(task.scheduled, 1),
                                }
                              : {}),
                          }),
                        )
                      }
                    />
                    <MenuSeparator />
                    {task.due ? (
                      <MenuAction
                        disabled={busy}
                        icon={Trash2}
                        label="Clear due date"
                        onClick={() =>
                          void run(() => updateTask(task.id, { due: null }))
                        }
                      />
                    ) : null}
                    {task.scheduled ? (
                      <MenuAction
                        disabled={busy}
                        icon={Trash2}
                        label="Clear scheduled date"
                        onClick={() =>
                          void run(() =>
                            updateTask(task.id, { scheduled: null }),
                          )
                        }
                      />
                    ) : null}
                    <MenuAction
                      icon={Pencil}
                      label="Edit all dates"
                      onClick={openEditor}
                    />
                  </>
                ) : null}
                {panel === "organize" ? (
                  <>
                    <MenuAction
                      detail={projectLink ? undefined : "Waiting for sync"}
                      disabled={!projectLink}
                      icon={Plus}
                      label="Create subtask"
                      onClick={() => setPanel("subtask")}
                    />
                    <MenuAction
                      detail="Projects and dependencies"
                      icon={Link2}
                      label="Edit relationships"
                      onClick={openEditor}
                    />
                    <MenuAction
                      detail={
                        task.reminders.length
                          ? `${task.reminders.length} set`
                          : "None set"
                      }
                      icon={CalendarClock}
                      label="Edit reminders"
                      onClick={openEditor}
                    />
                  </>
                ) : null}
                {panel === "subtask" ? (
                  <form
                    aria-label={`Create a subtask of ${task.title}`}
                    className="task-actions-subtask"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const title = subtaskTitle.trim();
                      if (!title) return;
                      void run(() =>
                        createTask({ title, projects: [projectLink] }),
                      );
                    }}
                  >
                    <label>
                      <span>Subtask title</span>
                      <input
                        autoFocus
                        disabled={busy}
                        value={subtaskTitle}
                        onChange={(event) =>
                          setSubtaskTitle(event.target.value)
                        }
                      />
                    </label>
                    <button
                      className="primary"
                      disabled={busy || !subtaskTitle.trim()}
                      type="submit"
                    >
                      <Plus aria-hidden="true" size={18} /> Add subtask
                    </button>
                  </form>
                ) : null}
                {panel === "copy" ? (
                  <>
                    <MenuAction
                      icon={FileText}
                      label="Copy title"
                      onClick={() => void run(() => writeClipboard(task.title))}
                    />
                    <MenuAction
                      detail={
                        configuration.linkWriteFormat === "markdown"
                          ? "Markdown link"
                          : "Wikilink"
                      }
                      disabled={!projectLink}
                      icon={Link2}
                      label="Copy task link"
                      onClick={() =>
                        void run(() => writeClipboard(projectLink))
                      }
                    />
                    <MenuAction
                      disabled={!task.path}
                      icon={Clipboard}
                      label="Copy path"
                      onClick={() => void run(() => writeClipboard(task.path))}
                    />
                  </>
                ) : null}
                {panel === "delete" ? (
                  <div className="task-actions-confirm">
                    <p>Delete this task permanently?</p>
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
                      onClick={() => setPanel("actions")}
                    >
                      Keep task
                    </button>
                  </div>
                ) : null}
              </div>
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

  function handleMenuKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    )
      return;
    if (event.key === "ArrowLeft" && panel !== "actions") {
      event.preventDefault();
      setPanel("actions");
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
        "[role='menuitem']:not(:disabled)",
      ) ?? []),
    ];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (current + 1 + items.length) % items.length
            : (current - 1 + items.length) % items.length;
    items[target]?.focus();
  }
}

function MenuAction({
  current = false,
  danger = false,
  detail,
  disabled = false,
  icon: Icon,
  label,
  next = false,
  onClick,
}: {
  current?: boolean;
  danger?: boolean;
  detail?: string;
  disabled?: boolean;
  icon: typeof Circle;
  label: string;
  next?: boolean;
  onClick(): void;
}) {
  return (
    <button
      aria-current={current ? "true" : undefined}
      className={danger ? "danger" : undefined}
      disabled={disabled}
      role="menuitem"
      type="button"
      onClick={onClick}
    >
      <Icon aria-hidden="true" size={18} />
      <span>{label}</span>
      {detail ? <small>{detail}</small> : null}
      {next ? (
        <ChevronRight
          aria-hidden="true"
          className="task-actions-next"
          size={17}
        />
      ) : null}
    </button>
  );
}

function MenuSeparator() {
  return <hr aria-hidden="true" />;
}

function panelTitle(panel: MenuPanel): string {
  if (panel === "status") return "Status";
  if (panel === "priority") return "Priority";
  if (panel === "dates") return "Dates";
  if (panel === "organize") return "Organize";
  if (panel === "subtask") return "New subtask";
  if (panel === "copy") return "Copy";
  if (panel === "delete") return "Delete task";
  return "Task actions";
}

function dateSummary(task: Task): string {
  if (task.due && task.scheduled) return "Due and scheduled";
  if (task.due) return "Due set";
  if (task.scheduled) return "Scheduled";
  return "Not set";
}

async function writeClipboard(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText)
    throw new Error("Clipboard access is not available.");
  await navigator.clipboard.writeText(value);
}
