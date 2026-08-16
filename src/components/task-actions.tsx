import {
  Archive,
  ArchiveRestore,
  AtSign,
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
  NotebookPen,
  Pencil,
  Play,
  Plus,
  Repeat2,
  SkipForward,
  Square,
  Star,
  Tags,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useRepository } from "../app/repository-context";
import { linkLabel, linkTarget, recordCompletion } from "../domain/completion";
import { activeTimeEntry, todayString } from "../domain/task";
import { shiftTaskDate } from "../domain/task-date-actions";
import { actionFeedback } from "../native/feedback";
import { OperationErrorNotice } from "./operation-error-notice";
import { MultiValueField } from "./multi-value-field";

import type { Task } from "../domain/task";

interface MenuPosition {
  x: number;
  y: number;
}

type MenuPanel =
  | "actions"
  | "series"
  | "status"
  | "priority"
  | "dates"
  | "organize"
  | "projects"
  | "contexts"
  | "tags"
  | "subtask"
  | "copy"
  | "delete";

interface TaskActionsProps {
  task: Task;
  occurrenceDate?: string;
  context?: "row" | "detail";
  beforeAction?(): Promise<void>;
  onOpen?(task: Task, occurrenceDate?: string): void;
  onToggle(task: Task, occurrenceDate?: string): void | Promise<void>;
  onArchived?(): void;
  onDeleted?(): void;
  contextMenuRequest?: { id: number; x: number; y: number };
}

export function TaskActions({
  task,
  occurrenceDate,
  context = "row",
  beforeAction,
  onOpen,
  onToggle,
  onArchived,
  onDeleted,
  contextMenuRequest,
}: TaskActionsProps) {
  const {
    configuration,
    repository,
    createTask,
    deleteTask,
    materializeOccurrence,
    setTaskArchived,
    skipTask,
    startTimeTracking,
    stopTimeTracking,
    updateTask,
  } = useRepository();
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [panels, setPanels] = useState<MenuPanel[]>(["actions"]);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [organizeDraft, setOrganizeDraft] = useState({
    projects: task.projects,
    contexts: task.contexts,
    tags: task.tags,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mobile, setMobile] = useState(false);
  const menuId = useId();
  const headingId = `${menuId}-heading`;
  const panelHeadingId = `${menuId}-panel-heading`;
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panel = panels.at(-1) ?? "actions";
  const tracking = Boolean(activeTimeEntry(task.timeEntries));
  const virtualOccurrence = Boolean(
    occurrenceDate && task.recurrence && !task.occurrenceDate,
  );
  const occurrence = task.occurrenceDate ?? occurrenceDate;
  const occurrenceComplete = task.occurrenceDate
    ? task.completed
    : Boolean(
        occurrenceDate && task.completeInstances.includes(occurrenceDate),
      );
  const occurrenceSkipped = task.occurrenceDate
    ? task.skipped
    : Boolean(occurrenceDate && task.skippedInstances.includes(occurrenceDate));
  const status =
    configuration.statuses.find((option) => option.value === task.status)
      ?.label ?? task.status;
  const priority =
    configuration.priorities.find((option) => option.value === task.priority)
      ?.label ?? task.priority;

  useEffect(() => {
    if (!contextMenuRequest) return;
    const width = 304;
    const estimatedHeight = 640;
    setError("");
    setPanels(["actions"]);
    setSubtaskTitle("");
    setOrganizeDraft({
      projects: task.projects,
      contexts: task.contexts,
      tags: task.tags,
    });
    void repository.get(task.id).catch(() => undefined);
    setPosition({
      x: Math.max(8, Math.min(contextMenuRequest.x, innerWidth - width - 8)),
      y: Math.max(
        8,
        Math.min(
          contextMenuRequest.y + 4,
          innerHeight - Math.min(estimatedHeight, innerHeight - 16),
        ),
      ),
    });
  }, [contextMenuRequest, repository, task]);

  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 839px)");
    if (!query) return;
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!position) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        menuRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      )
        return;
      closeMenu();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (panels.length > 1) goBack();
      else closeMenu(true);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [panels, position]);

  useEffect(() => {
    if (!position || panel === "subtask") return;
    queueMicrotask(() => {
      const selector =
        panel === "delete"
          ? "[data-safe-action]"
          : isOrganizeEditor(panel)
            ? "[data-panel-back]"
            : "[role='menuitem']:not(:disabled), [role='menuitemradio']:not(:disabled)";
      menuRef.current?.querySelector<HTMLButtonElement>(selector)?.focus();
    });
  }, [panel, position]);

  useEffect(() => {
    if (!position || !mobile) return;
    const app = document.getElementById("root");
    const previousOverflow = document.body.style.overflow;
    if (app) app.inert = true;
    document.body.style.overflow = "hidden";
    return () => {
      if (app) app.inert = false;
      document.body.style.overflow = previousOverflow;
    };
  }, [mobile, position]);

  function openFromTrigger() {
    if (position) {
      closeMenu(true);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    const width = 304;
    openMenu(
      (rect?.right ?? innerWidth - 16) - width,
      (rect?.bottom ?? 64) + 4,
    );
  }

  function openFromPointer(x: number, y: number) {
    openMenu(x, y + 4);
  }

  function openMenu(x: number, y: number) {
    const width = 304;
    const estimatedHeight = 640;
    setError("");
    setPanels(["actions"]);
    setSubtaskTitle("");
    setOrganizeDraft({
      projects: task.projects,
      contexts: task.contexts,
      tags: task.tags,
    });
    // Relay query results do not carry a revision. Warm it while the person is
    // choosing so guarded writes do not add a later network round trip.
    void repository.get(task.id).catch(() => undefined);
    setPosition({
      x: Math.max(8, Math.min(x, innerWidth - width - 8)),
      y: Math.max(
        8,
        Math.min(y, innerHeight - Math.min(estimatedHeight, innerHeight - 16)),
      ),
    });
  }

  function closeMenu(restoreFocus = false) {
    setPosition(null);
    setPanels(["actions"]);
    setSubtaskTitle("");
    setError("");
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
  }

  function navigate(next: MenuPanel) {
    setPanels((current) => [...current, next]);
  }

  function goBack() {
    setPanels((current) =>
      current.length > 1 ? current.slice(0, -1) : current,
    );
  }

  async function run(action: () => Promise<unknown>, after?: () => void) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await beforeAction?.();
      await action();
      actionFeedback();
      closeMenu();
      after?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  function openEditor() {
    closeMenu();
    onOpen?.(task, occurrenceDate);
  }

  async function toggle() {
    await onToggle(task, occurrenceDate);
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
  const rootRole =
    panel === "delete"
      ? "alertdialog"
      : mobile || panel === "subtask" || isOrganizeEditor(panel)
        ? "dialog"
        : "menu";
  const actionMenuRole =
    mobile &&
    panel !== "subtask" &&
    panel !== "delete" &&
    !isOrganizeEditor(panel);

  return (
    <>
      {!contextMenuRequest ? (
        <button
          aria-controls={position ? menuId : undefined}
          aria-expanded={Boolean(position)}
          aria-haspopup={mobile ? "dialog" : "menu"}
          aria-label={
            context === "detail"
              ? "More task actions"
              : `Task actions for ${task.title}`
          }
          className={
            context === "detail" ? "icon-action" : "task-actions-trigger"
          }
          ref={triggerRef}
          title={`Actions for ${task.title}`}
          type="button"
          onClick={openFromTrigger}
          onContextMenu={(event) => {
            event.preventDefault();
            openFromPointer(event.clientX, event.clientY);
          }}
        >
          <MoreHorizontal aria-hidden="true" size={20} strokeWidth={1.7} />
        </button>
      ) : null}
      {position
        ? createPortal(
            <div className="task-actions-layer">
              {mobile ? (
                <button
                  aria-hidden="true"
                  className="task-actions-scrim"
                  tabIndex={-1}
                  type="button"
                  onClick={() => closeMenu(true)}
                />
              ) : null}
              <div
                aria-label={
                  rootRole === "menu" ? `Actions for ${task.title}` : undefined
                }
                aria-labelledby={
                  rootRole !== "menu"
                    ? isOrganizeEditor(panel)
                      ? panelHeadingId
                      : headingId
                    : undefined
                }
                aria-modal={rootRole !== "menu" ? true : undefined}
                className={`task-actions-menu${
                  isOrganizeEditor(panel) ? " is-organize-editor" : ""
                }`}
                id={menuId}
                ref={menuRef}
                role={rootRole}
                style={{
                  left: isOrganizeEditor(panel)
                    ? Math.max(8, Math.min(position.x, innerWidth - 428))
                    : position.x,
                  top: position.y,
                }}
                onKeyDown={handleMenuKeys}
              >
                <div className="task-actions-heading">
                  <strong id={headingId}>{task.title}</strong>
                  <button type="button" onClick={() => closeMenu(true)}>
                    Close
                  </button>
                </div>
                {panel !== "actions" ? (
                  <div className="task-actions-subheading">
                    <button
                      aria-label="Back to previous actions"
                      data-panel-back
                      type="button"
                      onClick={goBack}
                    >
                      <ChevronLeft aria-hidden="true" size={18} />
                    </button>
                    <strong id={panelHeadingId}>{panelTitle(panel)}</strong>
                  </div>
                ) : null}
                <div
                  className={`task-actions-items is-${panel}`}
                  role={actionMenuRole ? "menu" : undefined}
                >
                  {panel === "actions" ? (
                    virtualOccurrence ? (
                      <>
                        <MenuAction
                          disabled={busy}
                          icon={occurrenceComplete ? Circle : Check}
                          label={
                            occurrenceComplete
                              ? "Mark occurrence open"
                              : "Complete occurrence"
                          }
                          onClick={() => void run(toggle)}
                        />
                        <MenuAction
                          disabled={busy || !occurrence}
                          icon={SkipForward}
                          label={
                            occurrenceSkipped
                              ? "Unskip occurrence"
                              : "Skip occurrence"
                          }
                          onClick={() =>
                            void run(() => skipTask(task.id, occurrence!))
                          }
                        />
                        <MenuAction
                          disabled={busy || !occurrenceDate}
                          icon={NotebookPen}
                          label="Make occurrence note"
                          onClick={() =>
                            void run(async () => {
                              const result = await materializeOccurrence(
                                task.id,
                                occurrenceDate!,
                              );
                              onOpen?.(result.task);
                            })
                          }
                        />
                        <MenuSeparator />
                        <MenuAction
                          detail="Changes every occurrence"
                          icon={Repeat2}
                          label="Repeating task actions"
                          next
                          onClick={() => navigate("series")}
                        />
                      </>
                    ) : (
                      <TaskActionList />
                    )
                  ) : null}
                  {panel === "series" ? <TaskActionList series /> : null}
                  {panel === "status"
                    ? configuration.statuses.map((option) => (
                        <MenuAction
                          checked={option.value === task.status}
                          disabled={busy}
                          icon={option.value === task.status ? Check : Circle}
                          key={option.value}
                          label={option.label}
                          iconColor={option.color}
                          radio
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
                          checked={option.value === task.priority}
                          disabled={busy}
                          icon={option.value === task.priority ? Check : Star}
                          key={option.value}
                          label={option.label}
                          labelColor={option.color}
                          radio
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
                        label="Move dates one day later"
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
                      {onOpen ? (
                        <MenuAction
                          icon={Pencil}
                          label="Edit dates and reminders"
                          onClick={openEditor}
                        />
                      ) : null}
                    </>
                  ) : null}
                  {panel === "organize" ? (
                    <>
                      <MenuAction
                        detail={valueSummary(
                          task.projects.map(organizeValueLabel),
                        )}
                        icon={FolderTree}
                        label="Projects"
                        next
                        onClick={() => navigate("projects")}
                      />
                      <MenuAction
                        detail={valueSummary(task.contexts)}
                        icon={AtSign}
                        label="Contexts"
                        next
                        onClick={() => navigate("contexts")}
                      />
                      <MenuAction
                        detail={valueSummary(task.tags)}
                        icon={Tags}
                        label="Tags"
                        next
                        onClick={() => navigate("tags")}
                      />
                      <MenuSeparator />
                      <MenuAction
                        disabled={!projectLink}
                        icon={Plus}
                        label="Create subtask"
                        onClick={() => navigate("subtask")}
                      />
                      {onOpen ? (
                        <MenuAction
                          detail={
                            task.blockedBy.length
                              ? `${task.blockedBy.length} ${task.blockedBy.length === 1 ? "dependency" : "dependencies"}`
                              : "Dependencies"
                          }
                          icon={Link2}
                          label="Relationships"
                          onClick={openEditor}
                        />
                      ) : null}
                    </>
                  ) : null}
                  {isOrganizeEditor(panel) ? (
                    <OrganizeFieldEditor field={panel} />
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
                        onClick={() =>
                          void run(() => writeClipboard(task.title))
                        }
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
                        onClick={() =>
                          void run(() => writeClipboard(task.path))
                        }
                      />
                    </>
                  ) : null}
                  {panel === "delete" ? (
                    <div className="task-actions-confirm">
                      <p>
                        {virtualOccurrence
                          ? "Delete this repeating task and all of its occurrences?"
                          : "Delete this task?"}{" "}
                        You’ll have 30 seconds to undo.
                      </p>
                      <button data-safe-action type="button" onClick={goBack}>
                        Keep task
                      </button>
                      <button
                        className="danger"
                        disabled={busy}
                        type="button"
                        onClick={() =>
                          void run(() => deleteTask(task.id), onDeleted)
                        }
                      >
                        <Trash2 aria-hidden="true" size={18} />
                        {virtualOccurrence
                          ? "Delete repeating task"
                          : "Delete task"}
                      </button>
                    </div>
                  ) : null}
                </div>
                {error ? (
                  <OperationErrorNotice
                    action="The task action"
                    className="task-actions-error"
                    message={error}
                    recovery="The menu is still open so you can retry."
                  />
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );

  function TaskActionList({ series = false }: { series?: boolean }) {
    return (
      <>
        <MenuAction
          disabled={busy}
          icon={task.completed ? Circle : Check}
          label={task.completed ? "Mark open" : "Complete"}
          onClick={() => void run(toggle)}
        />
        <MenuAction
          detail={dateSummary(task)}
          icon={CalendarClock}
          label="Dates"
          next
          onClick={() => navigate("dates")}
        />
        <MenuAction
          detail={task.priority === "none" ? undefined : priority}
          icon={Star}
          label="Priority"
          next
          onClick={() => navigate("priority")}
        />
        <MenuAction
          detail={task.status === "none" ? undefined : status}
          icon={Circle}
          label="Status"
          next
          onClick={() => navigate("status")}
        />
        <MenuSeparator />
        <MenuAction
          icon={FolderTree}
          label="Organize"
          next
          onClick={() => navigate("organize")}
        />
        <MenuAction
          disabled={busy}
          icon={tracking ? Square : Play}
          label={tracking ? "Stop timer" : "Start timer"}
          onClick={() =>
            void run(() =>
              tracking ? stopTimeTracking(task.id) : startTimeTracking(task.id),
            )
          }
        />
        {context === "row" && onOpen ? (
          <MenuAction
            icon={Pencil}
            label={series ? "Edit repeating task" : "Edit details"}
            onClick={openEditor}
          />
        ) : null}
        <MenuAction
          icon={Copy}
          label="Copy"
          next
          onClick={() => navigate("copy")}
        />
        <MenuSeparator />
        <MenuAction
          disabled={busy}
          icon={task.archived ? ArchiveRestore : Archive}
          label={task.archived ? "Restore" : "Archive"}
          onClick={() =>
            void run(async () => {
              const updated = await setTaskArchived(task.id, !task.archived);
              if (updated.operationWarnings?.length)
                throw new Error(updated.operationWarnings.join(" "));
            }, onArchived)
          }
        />
        <MenuAction
          danger
          icon={Trash2}
          label={series ? "Delete repeating task" : "Delete"}
          onClick={() => navigate("delete")}
        />
      </>
    );
  }

  function OrganizeFieldEditor({
    field,
  }: {
    field: "projects" | "contexts" | "tags";
  }) {
    const label = panelTitle(field);
    const completionField =
      field === "projects"
        ? configuration.fieldMapping.projects
        : field === "contexts"
          ? configuration.fieldMapping.contexts
          : "tags";
    return (
      <form
        className="task-actions-organize-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() =>
            updateTask(task.id, { [field]: organizeDraft[field] }),
          );
        }}
      >
        <MultiValueField
          completion={
            configuration.fieldCompletions[completionField] ?? {
              kind: field === "projects" ? "records" : "values",
            }
          }
          completeField={(request) => repository.completeField(request)}
          field={completionField}
          label={label}
          placeholder={`Add ${label.toLocaleLowerCase()}`}
          values={organizeDraft[field]}
          onChange={(values) =>
            setOrganizeDraft((current) => ({ ...current, [field]: values }))
          }
        />
        <button className="primary" disabled={busy} type="submit">
          {busy ? "Saving…" : `Save ${label.toLocaleLowerCase()}`}
        </button>
      </form>
    );
  }

  function handleMenuKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    if (
      event.key === "Tab" &&
      (mobile || panel === "subtask" || panel === "delete")
    ) {
      const controls = [
        ...(menuRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled)",
        ) ?? []),
      ];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
      return;
    }
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    )
      return;
    if (event.key === "ArrowLeft" && panels.length > 1) {
      event.preventDefault();
      goBack();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
        panel === "subtask" || panel === "delete"
          ? "button:not(:disabled)"
          : "[role='menuitem']:not(:disabled), [role='menuitemradio']:not(:disabled)",
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
  checked = false,
  danger = false,
  detail,
  disabled = false,
  icon: Icon,
  label,
  next = false,
  iconColor,
  labelColor,
  radio = false,
  onClick,
}: {
  checked?: boolean;
  danger?: boolean;
  detail?: string;
  disabled?: boolean;
  icon: typeof Circle;
  label: string;
  next?: boolean;
  iconColor?: string;
  labelColor?: string;
  radio?: boolean;
  onClick(): void;
}) {
  return (
    <button
      aria-label={label}
      aria-checked={radio ? checked : undefined}
      className={danger ? "danger" : undefined}
      disabled={disabled}
      role={radio ? "menuitemradio" : "menuitem"}
      type="button"
      onClick={onClick}
    >
      <Icon
        aria-hidden="true"
        size={18}
        style={iconColor ? { color: iconColor } : undefined}
      />
      <span style={labelColor ? { color: labelColor } : undefined}>
        {label}
      </span>
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

function panelTitle(panel: Exclude<MenuPanel, "actions">): string {
  if (panel === "series") return "Repeating task";
  if (panel === "status") return "Status";
  if (panel === "priority") return "Priority";
  if (panel === "dates") return "Dates";
  if (panel === "organize") return "Organize";
  if (panel === "projects") return "Projects";
  if (panel === "contexts") return "Contexts";
  if (panel === "tags") return "Tags";
  if (panel === "subtask") return "New subtask";
  if (panel === "copy") return "Copy";
  return "Delete task";
}

function isOrganizeEditor(
  panel: MenuPanel,
): panel is "projects" | "contexts" | "tags" {
  return panel === "projects" || panel === "contexts" || panel === "tags";
}

function valueSummary(values: readonly string[]): string {
  if (!values.length) return "None";
  if (values.length === 1) return values[0]!;
  return `${values[0]} +${values.length - 1}`;
}

function organizeValueLabel(value: string): string {
  const label = linkLabel(value);
  if (label) return label;
  const target = linkTarget(value);
  return target.split("/").at(-1) || value;
}

function dateSummary(task: Task): string {
  if (task.due && task.scheduled) return "Due and scheduled";
  if (task.due) return "Due set";
  if (task.scheduled) return "Scheduled";
  return "";
}

async function writeClipboard(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText)
    throw new Error("Clipboard access is not available.");
  await navigator.clipboard.writeText(value);
}
