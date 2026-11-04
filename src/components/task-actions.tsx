import { countLabel } from "../i18n/default-labels";
import { t } from "@lingui/core/macro";
import { useLingui, Trans } from "@lingui/react/macro";
import {
  Archive,
  ArchiveRestore,
  AtSign,
  CalendarClock,
  Check,
  ChevronLeft,
  CalendarDays,
  CalendarOff,
  ChevronRight,
  Circle,
  Clipboard,
  Copy,
  FileText,
  Flag,
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
  Sun,
  Sunrise,
  Tags,
  Trash2,
  type LucideProps,
} from "lucide-react";
import { rememberUndo } from "../app/undo-history";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { completionKey } from "../application/task-mutations";
import { useMutationState } from "./use-mutation-state";
import { useOverlay } from "./overlays/use-overlay";
import { useExitingValue, usePresence } from "./overlays/use-presence";
import { useRepository } from "../app/repository-context";
import { linkLabel, linkTarget } from "../domain/completion";
import { activeTimeEntry, taskDatePart } from "../domain/task";
import { rescheduleInput, shiftTaskDate } from "../domain/task-date-actions";
import { actionFeedback } from "../native/feedback";
import { writeClipboard } from "../native/clipboard";
import { taskRecordLink } from "../domain/task-links";
import {
  TASK_MENU_PANEL_EVENT,
  returnFocusToList,
  shortcutSchedule,
} from "../app/keyboard-shortcuts";
import { OperationErrorNotice } from "./operation-error-notice";
import { MultiValueField } from "./multi-value-field";

import type { TaskSummary, UpdateTaskInput } from "../domain/task";
import { TaskDatePanel } from "./task-date-panel";
import type { TaskCreateIntent } from "../application/ports/task-repository";

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
  task: TaskSummary;
  occurrenceDate?: string;
  context?: "row" | "detail";
  beforeAction?(): Promise<void>;
  onOpen?(task: TaskSummary, occurrenceDate?: string): void;
  onToggle(task: TaskSummary, occurrenceDate?: string): void | Promise<unknown>;
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
  const { t } = useLingui();
  const {
    configuration,
    mutations,
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
  // One subtask creation keeps its intent across retries, so a retry after a
  // lost reply cannot create the subtask twice.
  const subtaskIntent = useRef<TaskCreateIntent | null>(null);
  const [organizeDraft, setOrganizeDraft] = useState({
    projects: task.projects,
    contexts: task.contexts,
    tags: task.tags,
  });
  const command = useMutationState(
    mutations,
    completionKey(task.id, occurrenceDate),
  );
  const [actionBusy, setBusy] = useState(false);
  const busy = actionBusy || command.pending;
  const [localError, setError] = useState("");
  const error = localError || command.error?.message || "";
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
    subtaskIntent.current = null;
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
    if (!position || panel === "subtask") return;
    queueMicrotask(() => {
      const finePointer = !window.matchMedia?.("(pointer: coarse)").matches;
      const selector =
        panel === "delete"
          ? "[data-safe-action]"
          : isOrganizeEditor(panel)
            ? finePointer
              ? ".multi-value-control input"
              : "[data-panel-back]"
            : panel === "dates" && finePointer
              ? ".task-date-input"
              : "[role='menuitem']:not(:disabled):not(.task-actions-quick *), [role='menuitemradio']:not(:disabled):not(.task-actions-quick *)";
      menuRef.current?.querySelector<HTMLButtonElement>(selector)?.focus();
    });
  }, [panel, position]);

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

  function openDates() {
    openFromTrigger();
    setPanels(["actions", "dates"]);
  }

  const openPanel = useEffectEvent((event: Event) => {
    const panel = (event as CustomEvent<string>).detail;
    openFromTrigger();
    setPanels(
      panel === "project"
        ? ["actions", "organize", "projects"]
        : ["actions", "priority"],
    );
  });
  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const listener = (event: Event) => openPanel(event);
    trigger.addEventListener(TASK_MENU_PANEL_EVENT, listener);
    return () => trigger.removeEventListener(TASK_MENU_PANEL_EVENT, listener);
  }, []);

  function openMenu(x: number, y: number) {
    const width = 304;
    const estimatedHeight = 640;
    setError("");
    setPanels(["actions"]);
    setSubtaskTitle("");
    subtaskIntent.current = null;
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

  // Opening resets the panel, so a closing menu keeps its content while it exits.
  function closeMenu(restoreFocus = false) {
    setPosition(null);
    subtaskIntent.current = null;
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

  /** Saves an edit and keeps the fields it replaced for the Undo shortcut. */
  async function change(input: UpdateTaskInput) {
    const earlier = Object.fromEntries(
      Object.keys(input).map((field) => [
        field,
        (task as unknown as Record<string, unknown>)[field] ?? null,
      ]),
    ) as UpdateTaskInput;
    await updateTask(task.id, input);
    const title = task.title;
    rememberUndo({
      label: title,
      notice: t`Updated “${title}”`,
      run: () => updateTask(task.id, earlier),
    });
  }

  async function run(action: () => Promise<unknown>, after?: () => void) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await beforeAction?.();
      await action();
      actionFeedback();
      closeMenu(true);
      after?.();
      // The edit can move this row out of the list along with its menu.
      window.setTimeout(() => returnFocusToList(), 200);
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

  const projectLink = taskRecordLink(task, configuration.linkWriteFormat);
  const rootRole =
    panel === "delete"
      ? "alertdialog"
      : mobile ||
          panel === "subtask" ||
          panel === "dates" ||
          isOrganizeEditor(panel)
        ? "dialog"
        : "menu";
  const actionMenuRole =
    mobile &&
    panel !== "subtask" &&
    panel !== "delete" &&
    panel !== "dates" &&
    !isOrganizeEditor(panel);
  useOverlay({
    open: Boolean(position),
    rootRef: menuRef,
    modal: rootRole !== "menu",
    returnFocusRef: triggerRef,
    onDismiss: (reason) => {
      if (reason === "escape" && panels.length > 1) goBack();
      else closeMenu();
    },
  });

  const layerRef = useRef<HTMLDivElement>(null);
  const exiting = useExitingValue(position);
  const shownPosition = exiting.value;
  const present = usePresence(Boolean(position), layerRef, exiting.clear);

  return (
    <>
      {!contextMenuRequest && context === "row" && !virtualOccurrence ? (
        <button
          aria-label={t`Change dates for ${task.title}`}
          className="task-row-quick-date"
          tabIndex={-1}
          title={t({ message: "Dates" })}
          type="button"
          onClick={openDates}
        >
          <CalendarDays aria-hidden="true" size={16} strokeWidth={1.7} />
        </button>
      ) : null}
      {!contextMenuRequest ? (
        <button
          aria-controls={position ? menuId : undefined}
          aria-expanded={Boolean(position)}
          aria-haspopup={mobile ? "dialog" : "menu"}
          aria-label={
            context === "detail"
              ? t({ message: "More task actions" })
              : t`Task actions for ${task.title}`
          }
          className={
            context === "detail" ? "icon-action" : "task-actions-trigger"
          }
          ref={triggerRef}
          title={t`Actions for ${task.title}`}
          type="button"
          onClick={openFromTrigger}
          onContextMenu={(event) => {
            event.preventDefault();
            openFromPointer(event.clientX, event.clientY);
          }}
        >
          <MoreHorizontal
            aria-hidden="true"
            size={context === "detail" ? 20 : 18}
            strokeWidth={context === "detail" ? 1.7 : 1.5}
          />
        </button>
      ) : null}
      {present && shownPosition
        ? createPortal(
            <div
              aria-hidden={position ? undefined : true}
              aria-label={
                rootRole === "menu" ? t`Actions for ${task.title}` : undefined
              }
              className="task-actions-layer"
              data-state={position ? "open" : "closed"}
              inert={!position}
              ref={layerRef}
              role={rootRole === "menu" ? "region" : undefined}
            >
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
                  rootRole === "menu" ? t`Actions for ${task.title}` : undefined
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
                    ? Math.max(8, Math.min(shownPosition.x, innerWidth - 428))
                    : shownPosition.x,
                  top: shownPosition.y,
                }}
                onKeyDown={handleMenuKeys}
              >
                <div className="task-actions-heading">
                  <strong id={headingId}>{task.title}</strong>
                  <button type="button" onClick={() => closeMenu(true)}>
                    <Trans>Close</Trans>
                  </button>
                </div>
                {panel !== "actions" ? (
                  <div className="task-actions-subheading">
                    <button
                      aria-label={t({ message: "Back to previous actions" })}
                      data-panel-back
                      role={rootRole === "menu" ? "menuitem" : undefined}
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
                              ? t({ message: "Mark occurrence open" })
                              : t({ message: "Complete occurrence" })
                          }
                          onClick={() => void run(toggle)}
                        />
                        <MenuAction
                          disabled={busy || !occurrence}
                          icon={SkipForward}
                          label={
                            occurrenceSkipped
                              ? t({ message: "Unskip occurrence" })
                              : t({ message: "Skip occurrence" })
                          }
                          onClick={() =>
                            void run(() => skipTask(task.id, occurrence!))
                          }
                        />
                        {/* A skipped date needs a skipped status for its note. */}
                        {occurrenceSkipped &&
                        !configuration.statuses.some(
                          (status) => status.isSkipped,
                        ) ? null : (
                          <MenuAction
                            disabled={busy || !occurrenceDate}
                            icon={NotebookPen}
                            label={t({ message: "Make occurrence note" })}
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
                        )}
                        <MenuSeparator />
                        <MenuAction
                          detail={t({ message: "Changes every occurrence" })}
                          icon={Repeat2}
                          label={t({ message: "Repeating task actions" })}
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
                            void run(() => change({ status: option.value }))
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
                            void run(() => change({ priority: option.value }))
                          }
                        />
                      ))
                    : null}
                  {panel === "dates" ? (
                    <>
                      <TaskDatePanel
                        busy={busy}
                        task={task}
                        onApply={(input) => void run(() => change(input))}
                      />
                      <MenuSeparator />
                      <MenuAction
                        disabled={busy || (!task.due && !task.scheduled)}
                        icon={ChevronRight}
                        label={t({ message: "Move dates one day later" })}
                        plain
                        onClick={() =>
                          void run(() =>
                            change({
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
                      {onOpen ? (
                        <MenuAction
                          icon={Pencil}
                          label={t({ message: "Edit dates and reminders" })}
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
                        label={t({ message: "Projects" })}
                        next
                        onClick={() => navigate("projects")}
                      />
                      <MenuAction
                        detail={valueSummary(task.contexts)}
                        icon={AtSign}
                        label={t({ message: "Contexts" })}
                        next
                        onClick={() => navigate("contexts")}
                      />
                      <MenuAction
                        detail={valueSummary(task.tags)}
                        icon={Tags}
                        label={t({ message: "Tags" })}
                        next
                        onClick={() => navigate("tags")}
                      />
                      <MenuSeparator />
                      <MenuAction
                        disabled={!projectLink}
                        icon={Plus}
                        label={t({ message: "Create subtask" })}
                        onClick={() => navigate("subtask")}
                      />
                      {onOpen ? (
                        <MenuAction
                          detail={
                            task.blockedBy.length
                              ? countLabel(task.blockedBy.length, "dependency")
                              : t({ message: "Dependencies" })
                          }
                          icon={Link2}
                          label={t({ message: "Relationships" })}
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
                      aria-label={t`Create a subtask of ${task.title}`}
                      className="task-actions-subtask"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const title = subtaskTitle.trim();
                        if (!title) return;
                        subtaskIntent.current ??= { id: crypto.randomUUID() };
                        const intent = subtaskIntent.current;
                        void run(() =>
                          createTask(
                            { title, projects: [projectLink] },
                            intent,
                          ),
                        );
                      }}
                    >
                      <label>
                        <span>
                          <Trans>Subtask title</Trans>
                        </span>
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
                        <Plus aria-hidden="true" size={18} />{" "}
                        <Trans>Add subtask</Trans>
                      </button>
                    </form>
                  ) : null}
                  {panel === "copy" ? (
                    <>
                      <MenuAction
                        icon={FileText}
                        label={t({ message: "Copy title" })}
                        onClick={() =>
                          void run(() => writeClipboard(task.title))
                        }
                      />
                      <MenuAction
                        detail={
                          configuration.linkWriteFormat === "markdown"
                            ? t({ message: "Markdown link" })
                            : t({ message: "Wikilink" })
                        }
                        disabled={!projectLink}
                        icon={Link2}
                        label={t({ message: "Copy task link" })}
                        onClick={() =>
                          void run(() => writeClipboard(projectLink))
                        }
                      />
                      <MenuAction
                        disabled={!task.path}
                        icon={Clipboard}
                        label={t({ message: "Copy path" })}
                        onClick={() =>
                          void run(() => writeClipboard(task.path))
                        }
                      />
                    </>
                  ) : null}
                  {panel === "delete" ? (
                    <div className="task-actions-confirm">
                      <p>
                        <Trans>
                          {virtualOccurrence
                            ? t({
                                message:
                                  "Delete this repeating task and all of its occurrences?",
                              })
                            : t({ message: "Delete this task?" })}{" "}
                          You’ll have 30 seconds to undo.
                        </Trans>
                      </p>
                      <button data-safe-action type="button" onClick={goBack}>
                        <Trans>Keep task</Trans>
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
                          ? t({ message: "Delete repeating task" })
                          : t({ message: "Delete task" })}
                      </button>
                    </div>
                  ) : null}
                </div>
                {error ? (
                  <OperationErrorNotice
                    action={t({ message: "The task action" })}
                    className="task-actions-error"
                    message={error}
                    recovery={t({
                      message: "The menu is still open so you can retry.",
                    })}
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
    const { t } = useLingui();
    const scheduleTo = (action: "today" | "tomorrow" | "next-week"): void => {
      void run(() =>
        change(
          rescheduleInput(
            task,
            taskDatePart(shortcutSchedule(action, task.scheduled)),
          ),
        ),
      );
    };
    return (
      <>
        {!series && !task.completed ? (
          <div className="task-actions-quick">
            <div className="task-actions-quick-row">
              <QuickAction
                disabled={busy}
                icon={Sun}
                label={t({ message: "Schedule today" })}
                onClick={() => scheduleTo("today")}
              />
              <QuickAction
                disabled={busy}
                icon={Sunrise}
                label={t({ message: "Schedule tomorrow" })}
                onClick={() => scheduleTo("tomorrow")}
              />
              <QuickAction
                disabled={busy}
                icon={CalendarDays}
                label={t({ message: "Schedule next week" })}
                onClick={() => scheduleTo("next-week")}
              />
              <QuickAction
                disabled={busy || !task.scheduled}
                icon={CalendarOff}
                label={t({ message: "Clear scheduled date" })}
                onClick={() => void run(() => change({ scheduled: null }))}
              />
            </div>
            <div className="task-actions-quick-row">
              {configuration.priorities.slice(0, 5).map((option) => (
                <QuickAction
                  checked={option.value === task.priority}
                  color={option.color}
                  disabled={busy}
                  icon={Flag}
                  key={option.value}
                  label={t`Priority: ${option.label}`}
                  onClick={() =>
                    void run(() => change({ priority: option.value }))
                  }
                />
              ))}
            </div>
          </div>
        ) : null}
        <MenuAction
          disabled={busy}
          icon={task.completed ? Circle : Check}
          label={
            task.completed
              ? t({ message: "Mark open" })
              : t({ message: "Complete" })
          }
          onClick={() => void run(toggle)}
        />
        <MenuAction
          detail={dateSummary(task)}
          icon={CalendarClock}
          label={t({ message: "Dates" })}
          next
          onClick={() => navigate("dates")}
        />
        <MenuAction
          detail={task.priority === "none" ? undefined : priority}
          icon={Star}
          label={t({ message: "Priority" })}
          next
          onClick={() => navigate("priority")}
        />
        <MenuAction
          detail={task.status === "none" ? undefined : status}
          icon={Circle}
          label={t({ message: "Status" })}
          next
          onClick={() => navigate("status")}
        />
        <MenuSeparator />
        <MenuAction
          icon={FolderTree}
          label={t({ message: "Organize" })}
          next
          onClick={() => navigate("organize")}
        />
        <MenuAction
          disabled={busy}
          icon={tracking ? Square : Play}
          label={
            tracking
              ? t({ message: "Stop timer" })
              : t({ message: "Start timer" })
          }
          onClick={() =>
            void run(() =>
              tracking ? stopTimeTracking(task.id) : startTimeTracking(task.id),
            )
          }
        />
        {context === "row" && onOpen ? (
          <MenuAction
            icon={Pencil}
            label={
              series
                ? t({ message: "Edit repeating task" })
                : t({ message: "Edit details" })
            }
            onClick={openEditor}
          />
        ) : null}
        <MenuAction
          icon={Copy}
          label={t({ message: "Copy" })}
          next
          onClick={() => navigate("copy")}
        />
        <MenuSeparator />
        <MenuAction
          disabled={busy}
          icon={task.archived ? ArchiveRestore : Archive}
          label={
            task.archived
              ? t({ message: "Restore" })
              : t({ message: "Archive" })
          }
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
          label={
            series
              ? t({ message: "Delete repeating task" })
              : t({ message: "Delete" })
          }
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
    const { t } = useLingui();
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
          void run(() => change({ [field]: organizeDraft[field] }));
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
          placeholder={t`Add ${label.toLocaleLowerCase()}`}
          values={organizeDraft[field]}
          onChange={(values) =>
            setOrganizeDraft((current) => ({ ...current, [field]: values }))
          }
        />
        <button className="primary" disabled={busy} type="submit">
          {busy
            ? t({ message: "Saving…" })
            : t`Save ${label.toLocaleLowerCase()}`}
        </button>
      </form>
    );
  }

  function handleMenuKeys(event: React.KeyboardEvent<HTMLDivElement>) {
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
    const quickRow =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.closest(".task-actions-quick-row")
        : null;
    if (quickRow && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      const cells = [
        ...quickRow.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ),
      ];
      const current = cells.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const step = event.key === "ArrowRight" ? 1 : -1;
      event.preventDefault();
      cells[(current + step + cells.length) % cells.length]?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
        panel === "subtask" || panel === "delete"
          ? "button:not(:disabled)"
          : "[role='menuitem']:not(:disabled):not(.task-actions-quick *), [role='menuitemradio']:not(:disabled):not(.task-actions-quick *), .task-actions-quick-row > button:not(:disabled):first-child",
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

function QuickAction({
  checked,
  color,
  disabled = false,
  icon: Icon,
  label,
  onClick,
}: {
  checked?: boolean;
  color?: string;
  disabled?: boolean;
  icon: React.ComponentType<LucideProps>;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      title={label}
      type="button"
      onClick={onClick}
    >
      <Icon
        aria-hidden="true"
        fill={checked ? "currentColor" : "none"}
        size={18}
        strokeWidth={1.7}
        style={color ? { color } : undefined}
      />
    </button>
  );
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
  plain = false,
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
  /** Inside a dialog panel, where a menu role has no menu around it. */
  plain?: boolean;
  radio?: boolean;
  onClick(): void;
}) {
  return (
    <button
      aria-label={label}
      aria-checked={radio ? checked : undefined}
      className={danger ? "danger" : undefined}
      disabled={disabled}
      role={plain ? undefined : radio ? "menuitemradio" : "menuitem"}
      type="button"
      onClick={onClick}
    >
      <Icon
        aria-hidden="true"
        size={18}
        style={iconColor ? { color: iconColor } : undefined}
      />
      {labelColor ? (
        <span
          aria-hidden="true"
          className="value-color"
          style={{ backgroundColor: labelColor }}
        />
      ) : null}
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

function panelTitle(panel: Exclude<MenuPanel, "actions">): string {
  if (panel === "series") return t({ message: "Repeating task" });
  if (panel === "status") return t({ message: "Status" });
  if (panel === "priority") return t({ message: "Priority" });
  if (panel === "dates") return t({ message: "Dates" });
  if (panel === "organize") return t({ message: "Organize" });
  if (panel === "projects") return t({ message: "Projects" });
  if (panel === "contexts") return t({ message: "Contexts" });
  if (panel === "tags") return t({ message: "Tags" });
  if (panel === "subtask") return t({ message: "New subtask" });
  if (panel === "copy") return t({ message: "Copy" });
  return t({ message: "Delete task" });
}

function isOrganizeEditor(
  panel: MenuPanel,
): panel is "projects" | "contexts" | "tags" {
  return panel === "projects" || panel === "contexts" || panel === "tags";
}

function valueSummary(values: readonly string[]): string {
  if (!values.length) return t({ message: "None" });
  if (values.length === 1) return values[0]!;
  return `${values[0]} +${values.length - 1}`;
}

function organizeValueLabel(value: string): string {
  const label = linkLabel(value);
  if (label) return label;
  const target = linkTarget(value);
  return target.split("/").at(-1) || value;
}

function dateSummary(task: TaskSummary): string {
  if (task.due && task.scheduled) return t({ message: "Due and scheduled" });
  if (task.due) return t({ message: "Due set" });
  if (task.scheduled) return t({ message: "Scheduled" });
  return "";
}
