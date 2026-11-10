import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Archive, Check, Trash2, X } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { TaskNotesSelect } from "../components/tasknotes-controls";
import { FeedbackNotice } from "../components/workspace-feedback";
import { OverdueDeadlineChoice } from "../components/overdue-schedule-actions";
import {
  applyBulkEdits,
  undoBulkEdits,
  type BulkEditFailure,
  type BulkEditReceipt,
  type BulkTaskChange,
  planTaskChange,
  taskNeedsChange,
} from "../application/bulk-task-edit";
import { taskDatePart, todayString } from "../domain/task";
import { statusChoices } from "../domain/task-configuration";
import { shiftTaskDate } from "../domain/task-date-actions";
import {
  nextWeekStart,
  preserveRowFocus,
  returnFocusToList,
  taskRowShortcut,
} from "./keyboard-shortcuts";
import { useRepository } from "./repository-context";
import { TaskDatePopover } from "../components/task-detail-dates";
import { forgetUndo, rememberUndo, type UndoEntry } from "./undo-history";
import { bulkTaskFeedback } from "./bulk-task-feedback";
import type { TaskShortcutAction } from "./keyboard-shortcuts";
import type { TaskSelectionStore } from "./task-selection-store";
import { linkDisplayLabel } from "../domain/completion";
import type { FieldCompletion } from "../domain/completion";

const NO_DATES = { scheduled: undefined, due: undefined };

export function BulkTaskActions({
  store,
  navigationKey,
}: {
  store: TaskSelectionStore;
  navigationKey: string;
}) {
  const { t } = useLingui();
  const selectionVersion = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
  );
  const {
    repository,
    configuration,
    updateTask,
    setTaskArchived,
    deleteTask,
    pendingDeletion,
    deletionError,
  } = useRepository();
  const port = {
    getSummary: (id: string) => repository.getSummary(id),
    updateTask,
    setTaskArchived,
  };
  const [announcement, setAnnouncement] = useState("");
  const [notice, setNotice] = useState<{
    count: number;
    receipts: BulkEditReceipt[];
    navigationKey: string;
    message: string;
    entry: UndoEntry;
  } | null>(null);
  const [failures, setFailures] = useState<BulkEditFailure[]>([]);
  const [undoing, setUndoing] = useState(false);
  const [held, setHeld] = useState(false);
  const [picking, setPicking] = useState(false);
  const [scheduleChoice, setScheduleChoice] = useState<Extract<
    BulkTaskChange,
    { kind: "schedule" }
  > | null>(null);
  const [projects, setProjects] = useState<FieldCompletion[]>([]);
  const [projectError, setProjectError] = useState("");
  const [projectAttempt, setProjectAttempt] = useState(0);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState<string | null>(null);
  const newTagId = useId();
  const actionBar = useRef<HTMLElement>(null);
  const pickAnchor = useRef<HTMLElement>(null);
  const deleting = useRef<{ navigationKey: string; ids: string[] } | null>(
    null,
  );
  const deletionFailureHandled = useRef<unknown>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const selected = store.selectedTasks;
  const eligible = selected.filter(
    (task) => !task.recurrence && !task.recurrenceParent,
  );
  const excluded = selected.length - eligible.length;
  const hasSelection = selected.length > 0;
  const sharedPriority = eligible.every(
    (task) => task.priority === eligible[0]?.priority,
  )
    ? (eligible[0]?.priority ?? "")
    : "";
  const sharedStatus = eligible.every(
    (task) => task.status === eligible[0]?.status,
  )
    ? (eligible[0]?.status ?? "")
    : "";
  // The tags that mark a record as a task or as archived are not labels.
  const reservedTags = [
    configuration.defaults.taskTag,
    configuration.fieldMapping.archiveTag,
  ];
  // A tag every selected task carries is offered for removal; any other is added.
  const sharedTags = (eligible[0]?.tags ?? []).filter(
    (tag) =>
      !reservedTags.includes(tag) &&
      eligible.every((task) => task.tags.includes(tag)),
  );
  const otherTags = [
    ...new Set([...eligible.flatMap((task) => task.tags), ...knownTags]),
  ].filter((tag) => !sharedTags.includes(tag) && !reservedTags.includes(tag));
  const namedTag = newTag?.trim().replace(/^#+/, "") ?? "";
  const canAddNamedTag = Boolean(namedTag) && !reservedTags.includes(namedTag);
  const shownNotice = notice?.navigationKey === navigationKey ? notice : null;
  const currentNavigation = useRef(navigationKey);
  useEffect(() => {
    setScheduleChoice(null);
  }, [selectionVersion]);
  useEffect(() => {
    currentNavigation.current = navigationKey;
    setFailures([]);
    setPicking(false);
    setScheduleChoice(null);
    setNewTag(null);
    setNotice(null);
  }, [navigationKey]);
  useEffect(() => {
    if (!hasSelection) return;
    let active = true;
    setProjectError("");
    const field = configuration.fieldMapping.projects;
    const completion = configuration.fieldCompletions[field];
    void Promise.all([
      repository.completeField({ field, kind: "values", limit: 200 }),
      repository.completeField({
        field,
        kind: "records",
        targetTypes: completion?.targetTypes,
        limit: 200,
      }),
    ]).then(
      ([values, records]) => {
        if (active)
          setProjects([
            ...new Map(
              [
                ...values.map((value) => ({
                  ...value,
                  label: linkDisplayLabel(value.value),
                })),
                ...records.filter((record) => !record.taskId),
              ].map((value) => [value.value, value]),
            ).values(),
          ]);
      },
      () => {
        if (active) setProjectError("unavailable");
      },
    );
    return () => {
      active = false;
    };
  }, [
    hasSelection,
    repository,
    configuration.fieldMapping.projects,
    configuration.fieldCompletions,
    projectAttempt,
  ]);
  useEffect(() => {
    if (!hasSelection) return;
    let active = true;
    // Tags already on the selection are listed even when this cannot load.
    void repository
      .completeField({ field: "tags", kind: "values", limit: 200 })
      .then(
        (values) => {
          if (active) setKnownTags(values.map(({ value }) => value));
        },
        () => undefined,
      );
    return () => {
      active = false;
    };
  }, [hasSelection, repository]);
  useEffect(() => {
    if (!shownNotice || held || undoing || failures.length) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [shownNotice, held, undoing, failures.length]);

  useLayoutEffect(() => {
    const bar = actionBar.current;
    if (!bar) return;
    const measure = () =>
      document.documentElement.style.setProperty(
        "--task-selection-height",
        `${bar.getBoundingClientRect().height}px`,
      );
    measure();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(bar);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.documentElement.style.removeProperty("--task-selection-height");
    };
  }, [store.mode, hasSelection]);

  useEffect(() => {
    if (store.mode || store.count) setAnnouncement(t`${store.count} selected`);
    else setAnnouncement((previous) => (previous ? t`Selection cleared` : ""));
  }, [store, selectionVersion, t]);

  // Row keys act on the whole selection while one is held.
  const keyed = useRef(false);
  const keyedFocus = useRef<(() => void) | null>(null);
  const keyedChange = useEffectEvent((action: TaskShortcutAction) => {
    if (action === "open" || disabled) return false;
    keyed.current = true;
    const focusedRow =
      document.activeElement?.closest<HTMLElement>(".task-row");
    keyedFocus.current = focusedRow
      ? preserveRowFocus(focusedRow)
      : returnFocusToList;
    const menuClass = {
      dates: "bulk-schedule",
      status: "bulk-status",
      priority: "bulk-priority",
      project: "bulk-project",
    }[action as string];
    const menu = menuClass
      ? (actionBar.current?.querySelector<HTMLElement>(
          `.${menuClass} .tasknotes-select-trigger`,
        ) ?? null)
      : null;
    if (menu) {
      menu.focus();
      menu.click();
    } else if (action === "toggle") void run({ kind: "complete" });
    else
      void run({
        kind: "schedule",
        date: scheduleDate(action === "next-week" ? "week" : action),
      });
    return true;
  });
  useEffect(() => {
    if (!store.count) return;
    const keydown = (event: KeyboardEvent) => {
      if (actionBar.current?.querySelector("[aria-expanded='true']")) return;
      const action = taskRowShortcut(event);
      if (action && keyedChange(action)) event.preventDefault();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [store, store.count]);

  const changedMessage = t`This task changed. Open it to review before trying again.`;
  async function run(change: BulkTaskChange) {
    const targets = eligible.filter((task) => taskNeedsChange(task, change));
    if (store.busy || !targets.length) return;
    if (
      change.kind === "schedule" &&
      change.date &&
      change.date >= todayString() &&
      change.moveDeadlines === undefined &&
      eligible.some(
        (task) => task.due && taskDatePart(task.due) < todayString(),
      )
    ) {
      setPicking(false);
      setScheduleChoice(change);
      return;
    }
    setScheduleChoice(null);
    const focusedRow =
      document.activeElement?.closest<HTMLElement>(".task-row");
    const restoreFocus =
      keyedFocus.current ??
      (focusedRow ? preserveRowFocus(focusedRow) : returnFocusToList);
    store.setBusy(true);
    setFailures([]);
    setNotice(null);
    setPicking(false);
    const origin = navigationKey;
    try {
      const result = await applyBulkEdits(
        targets,
        (task) => planTaskChange(task, change),
        port,
        changedMessage,
        change.kind === "archive",
      );
      const feedback = bulkTaskFeedback(
        change,
        result.receipts.length,
        change.kind === "priority"
          ? (configuration.priorities.find(
              (priority) => priority.value === change.value,
            )?.label ?? change.value)
          : change.kind === "status"
            ? (configuration.statuses.find(
                (status) => status.value === change.value,
              )?.label ?? change.value)
            : change.kind === "project"
              ? linkDisplayLabel(change.value)
              : change.kind === "tag"
                ? change.value
                : "",
        result.receipts.filter(({ undo }) => "due" in undo).length,
      );
      let undoReceipts = result.receipts;
      const entry: UndoEntry = {
        label: feedback.message,
        undoNotice: feedback.undoNotice,
        run: async () => {
          const undone = await undoBulkEdits(
            undoReceipts,
            port,
            changedMessage,
          );
          undoReceipts = undone.remaining;
          setFailures(undone.failures);
          setNotice((current) =>
            current?.entry === entry
              ? undone.remaining.length
                ? { ...current, receipts: undone.remaining }
                : null
              : current,
          );
          if (undone.remaining.length) throw new Error(changedMessage);
        },
      };
      if (result.receipts.length) rememberUndo(entry);
      if (currentNavigation.current !== origin) return;
      // Rows that already matched are done too; only refused rows stay selected.
      const refused = new Set(result.failures.map(({ task }) => task.id));
      store.remove(
        eligible.filter((task) => !refused.has(task.id)).map(({ id }) => id),
      );
      setFailures(result.failures);
      if (result.receipts.length) {
        setNotice({
          count: result.receipts.length,
          receipts: result.receipts,
          navigationKey: origin,
          message: feedback.message,
          entry,
        });
        window.requestAnimationFrame(() => {
          if (!keyed.current) undoRef.current?.focus({ preventScroll: true });
        });
      }
    } finally {
      store.setBusy(false);
      if (keyed.current) {
        requestAnimationFrame(() => {
          if (currentNavigation.current === origin) restoreFocus();
          keyed.current = false;
          keyedFocus.current = null;
        });
      }
    }
  }
  async function remove() {
    if (store.busy || !eligible.length) return;
    store.setBusy(true);
    setFailures([]);
    setNotice(null);
    const origin = navigationKey;
    deleting.current = {
      navigationKey: origin,
      ids: eligible.map((task) => task.id),
    };
    deletionFailureHandled.current = null;
    try {
      // One request in the existing durable delayed-deletion/Undo service.
      await deleteTask(eligible.map((task) => task.id));
      if (currentNavigation.current !== origin) return;
      store.remove(eligible.map((task) => task.id));
    } catch (reason) {
      deleting.current = null;
      if (currentNavigation.current === origin)
        setFailures(eligible.map((task) => ({ task, reason })));
    } finally {
      store.setBusy(false);
    }
  }
  async function undo() {
    if (!shownNotice || undoing) return;
    setUndoing(true);
    store.setBusy(true);
    try {
      await shownNotice.entry.run();
      forgetUndo(shownNotice.entry);
    } catch {
      return;
    } finally {
      setUndoing(false);
      store.setBusy(false);
    }
  }
  const deletionNeedsReview = Boolean(
    pendingDeletion?.bulk &&
    deletionError &&
    selected.some((task) => pendingDeletion.ids?.includes(task.id)),
  );
  useEffect(() => {
    if (
      !deletionError ||
      !pendingDeletion?.bulk ||
      !deleting.current ||
      deleting.current.navigationKey !== navigationKey ||
      deletionFailureHandled.current === deletionError
    )
      return;
    const remaining = (pendingDeletion.ids ?? [pendingDeletion.id]).filter(
      (id) => deleting.current!.ids.includes(id),
    );
    const tasks = store.tasks.filter((task) => remaining.includes(task.id));
    if (tasks.length !== remaining.length) return;
    deletionFailureHandled.current = deletionError;
    for (const task of tasks)
      if (!store.isSelected(task.id)) store.toggle(task.id);
    setFailures(
      tasks.map((task) => ({
        task,
        reason:
          task.id === pendingDeletion.id
            ? deletionError
            : t`Deletion stopped before this task was changed.`,
      })),
    );
  }, [
    deletionError,
    pendingDeletion,
    navigationKey,
    store,
    selectionVersion,
    t,
  ]);
  const disabled = store.busy || !eligible.length || deletionNeedsReview;
  function closeNewTag() {
    setNewTag(null);
    requestAnimationFrame(() =>
      actionBar.current
        ?.querySelector<HTMLElement>(".bulk-tags .tasknotes-select-trigger")
        ?.focus(),
    );
  }
  return (
    <>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {store.mode || hasSelection ? (
        <section
          ref={actionBar}
          className="bulk-actions"
          aria-label={t`Selected tasks`}
          aria-busy={store.busy}
        >
          <div className="bulk-selection-count">
            <strong>{t`${selected.length} selected`}</strong>
            <button type="button" onClick={store.clear} disabled={store.busy}>
              <X size={16} aria-hidden="true" />
              <Trans>Clear</Trans>
            </button>
          </div>
          {scheduleChoice ? (
            <OverdueDeadlineChoice
              deadlines={
                eligible.filter(
                  (task) => task.due && taskDatePart(task.due) < todayString(),
                ).length
              }
              pending={store.busy}
              onCancel={() => {
                setScheduleChoice(null);
                requestAnimationFrame(() => {
                  if (keyed.current) keyedFocus.current?.();
                  else
                    actionBar.current
                      ?.querySelector<HTMLButtonElement>(
                        ".tasknotes-select-trigger",
                      )
                      ?.focus();
                  keyed.current = false;
                  keyedFocus.current = null;
                });
              }}
              onAnswer={(keepDeadlines) =>
                void run({ ...scheduleChoice, moveDeadlines: !keepDeadlines })
              }
            />
          ) : null}
          {!hasSelection ? (
            <p className="bulk-selection-hint">
              <span className="bulk-coarse-hint">
                <Trans>Tap tasks to select them.</Trans>
              </span>
              <span className="bulk-fine-hint">
                <Trans>Click tasks to select them.</Trans>
              </span>
            </p>
          ) : (
            <div className="bulk-action-controls">
              <button
                type="button"
                disabled={disabled}
                onClick={() => void run({ kind: "complete" })}
              >
                <Check size={17} aria-hidden="true" />
                <Trans>Complete</Trans>
              </button>
              <TaskNotesSelect
                ariaLabel={t`Schedule selected tasks`}
                className="bulk-schedule"
                disabled={disabled}
                options={[
                  { value: "today", label: t`Today` },
                  { value: "tomorrow", label: t`Tomorrow` },
                  { value: "week", label: t`Next week` },
                  { value: "pick", label: t`Pick date` },
                  { value: "none", label: t`No date` },
                ]}
                placeholder={t`Schedule`}
                value=""
                onChange={(value) => {
                  if (value === "pick") {
                    // The closing list returns focus to its button first.
                    pickAnchor.current =
                      actionBar.current?.querySelector<HTMLElement>(
                        ".tasknotes-select-trigger",
                      ) ?? null;
                    window.requestAnimationFrame(() => setPicking(true));
                    return;
                  }
                  void run({ kind: "schedule", date: scheduleDate(value) });
                }}
              />
              <TaskNotesSelect
                ariaLabel={t`Status for selected tasks`}
                className="bulk-status"
                triggerLabel={t`Status`}
                disabled={disabled}
                options={statusChoices(configuration.statuses, sharedStatus)}
                placeholder={t`Status`}
                value={sharedStatus}
                onChange={(value) => void run({ kind: "status", value })}
              />
              <TaskNotesSelect
                ariaLabel={t`Priority for selected tasks`}
                className="bulk-priority"
                triggerLabel={t`Priority`}
                disabled={disabled}
                options={configuration.priorities.map((priority) => ({
                  value: priority.value,
                  label: priority.label,
                  color: priority.color,
                }))}
                placeholder={t`Priority`}
                value={sharedPriority}
                onChange={(value) => void run({ kind: "priority", value })}
              />
              <TaskNotesSelect
                ariaLabel={t`Move selected tasks to project`}
                className="bulk-project"
                disabled={disabled}
                options={[
                  { value: "__none__", label: t`No project` },
                  ...projects.map((project) => ({
                    value: project.value,
                    label: project.label,
                  })),
                ]}
                placeholder={t`Project`}
                value=""
                onChange={(value) =>
                  void run({
                    kind: "project",
                    value: value === "__none__" ? "" : value,
                  })
                }
              />
              <TaskNotesSelect
                ariaLabel={t`Add or remove a tag on selected tasks`}
                className="bulk-tags"
                disabled={disabled}
                options={[
                  ...sharedTags.map((tag) => ({
                    value: tag,
                    label: tag,
                    description: t`Remove from selected tasks`,
                  })),
                  ...otherTags.map((tag) => ({ value: tag, label: tag })),
                ]}
                actions={[
                  { label: t`New tag…`, onChoose: () => setNewTag("") },
                ]}
                actionsLabel={t`Tag actions`}
                placeholder={t`Tags`}
                value=""
                onChange={(value) =>
                  void run({
                    kind: "tag",
                    value,
                    remove: sharedTags.includes(value),
                  })
                }
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => void run({ kind: "archive" })}
              >
                <Archive size={17} aria-hidden="true" />
                <Trans>Archive</Trans>
              </button>
              <button
                type="button"
                disabled={disabled}
                className="bulk-delete"
                onClick={() => void remove()}
              >
                <Trash2 size={17} aria-hidden="true" />
                <Trans>Delete</Trans>
              </button>
            </div>
          )}
          {newTag !== null && hasSelection ? (
            <form
              className="bulk-new-tag"
              onSubmit={(event) => {
                event.preventDefault();
                if (!canAddNamedTag) return;
                setNewTag(null);
                void run({ kind: "tag", value: namedTag, remove: false });
              }}
            >
              <label htmlFor={newTagId}>
                <Trans>New tag</Trans>
              </label>
              <input
                id={newTagId}
                autoFocus
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                value={newTag}
                onChange={(event) => setNewTag(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.stopPropagation();
                  closeNewTag();
                }}
              />
              <button type="submit" disabled={store.busy || !canAddNamedTag}>
                <Trans>Add tag</Trans>
              </button>
              <button type="button" onClick={closeNewTag}>
                <Trans>Cancel</Trans>
              </button>
            </form>
          ) : null}
          {picking ? (
            <TaskDatePopover
              draft={NO_DATES}
              planOnly
              target="scheduled"
              title={t`Schedule date`}
              trigger={pickAnchor}
              onClose={() => setPicking(false)}
              onApply={({ scheduled }) => {
                setPicking(false);
                if (scheduled)
                  void run({
                    kind: "schedule",
                    date: taskDatePart(scheduled),
                  });
              }}
            />
          ) : null}
          {deletionNeedsReview ? (
            <p className="bulk-selection-hint">
              <Trans>
                Deletion needs review. Use the recovery notice before editing
                these tasks.
              </Trans>
            </p>
          ) : null}
          {excluded ? (
            <p className="bulk-selection-hint">
              <Plural
                value={excluded}
                one="# repeating task won’t change. Open it to choose an occurrence or the series."
                other="# repeating tasks won’t change. Open each one to choose an occurrence or the series."
              />
            </p>
          ) : null}
          {projectError ? (
            <p className="bulk-selection-hint">
              {t`Could not load projects.`}{" "}
              <button
                type="button"
                onClick={() => setProjectAttempt((attempt) => attempt + 1)}
              >
                {t`Retry`}
              </button>
            </p>
          ) : null}
        </section>
      ) : null}
      <FeedbackNotice>
        {failures.length ? (
          <div className="bulk-failures" role="alert">
            <p>
              <Plural
                value={failures.length}
                one="# task could not be updated. Open it to review before trying again."
                other="# tasks could not be updated. Open them to review before trying again."
              />
            </p>
            <ul>
              {failures.map(({ task, reason }) => (
                <li key={task.id}>
                  <strong>{task.title}</strong>:{" "}
                  {reason instanceof Error ? reason.message : String(reason)}
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setFailures([])}>
              <Trans>Dismiss</Trans>
            </button>
          </div>
        ) : null}
        {shownNotice ? (
          <div
            className="undo-toast bulk-update-notice"
            onPointerEnter={() => setHeld(true)}
            onPointerLeave={() => setHeld(false)}
            onFocus={() => setHeld(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                setHeld(false);
            }}
          >
            <span role="status">{shownNotice.message}</span>
            <button
              type="button"
              ref={undoRef}
              disabled={undoing}
              onClick={() => void undo()}
            >
              <Trans>Undo</Trans>
            </button>
            <button
              type="button"
              aria-label={t`Dismiss bulk update notice`}
              onClick={() => setNotice(null)}
            >
              <X aria-hidden="true" size={17} />
            </button>
          </div>
        ) : null}
      </FeedbackNotice>
    </>
  );
}

function scheduleDate(value: string): string | null {
  const today = todayString();
  if (value === "none") return null;
  if (value === "today") return today;
  return value === "tomorrow" ? shiftTaskDate(today, 1) : nextWeekStart(today);
}
