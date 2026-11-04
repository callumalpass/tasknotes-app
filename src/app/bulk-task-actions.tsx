import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Archive, Check, Trash2, X } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { TaskNotesSelect } from "../components/tasknotes-controls";
import { FeedbackNotice } from "../components/workspace-feedback";
import {
  applyBulkEdits,
  undoBulkEdits,
  type BulkEditFailure,
  type BulkEditReceipt,
  type BulkTaskChange,
  planTaskChange,
} from "../application/bulk-task-edit";
import { taskDatePart, todayString } from "../domain/task";
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
  const [projects, setProjects] = useState<FieldCompletion[]>([]);
  const [projectError, setProjectError] = useState("");
  const actionBar = useRef<HTMLElement>(null);
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
  const shownNotice = notice?.navigationKey === navigationKey ? notice : null;
  const currentNavigation = useRef(navigationKey);
  useEffect(() => {
    currentNavigation.current = navigationKey;
    setFailures([]);
    setPicking(false);
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
      (reason) => {
        if (active)
          setProjectError(
            reason instanceof Error ? reason.message : String(reason),
          );
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
  ]);
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
  const keyedChange = useEffectEvent((action: TaskShortcutAction) => {
    if (action === "open" || disabled) return false;
    keyed.current = true;
    const menus = actionBar.current?.querySelectorAll<HTMLElement>(
      ".tasknotes-select-trigger",
    );
    const menu =
      menus?.[["dates", "priority", "project"].indexOf(action)] ?? null;
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
    if (store.busy || !eligible.length) return;
    const focusedRow =
      document.activeElement?.closest<HTMLElement>(".task-row");
    const restoreFocus = focusedRow
      ? preserveRowFocus(focusedRow)
      : returnFocusToList;
    store.setBusy(true);
    setFailures([]);
    setNotice(null);
    setPicking(false);
    const origin = navigationKey;
    try {
      const result = await applyBulkEdits(
        eligible,
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
          : change.kind === "project"
            ? linkDisplayLabel(change.value)
            : "",
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
      store.remove(result.receipts.map((receipt) => receipt.before.id));
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
          if (!keyed.current) undoRef.current?.focus();
          else restoreFocus();
          keyed.current = false;
        });
      }
    } finally {
      store.setBusy(false);
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
                    setPicking(true);
                    return;
                  }
                  void run({ kind: "schedule", date: scheduleDate(value) });
                }}
              />
              <TaskNotesSelect
                ariaLabel={t`Priority for selected tasks`}
                disabled={disabled}
                options={configuration.priorities.map((priority) => ({
                  value: priority.value,
                  label: priority.label,
                }))}
                placeholder={t`Priority`}
                value=""
                onChange={(value) => void run({ kind: "priority", value })}
              />
              <TaskNotesSelect
                ariaLabel={t`Move selected tasks to project`}
                disabled={disabled}
                options={[
                  { value: "__none__", label: t`No project` },
                  ...projects.map((project) => ({
                    value: project.value,
                    label: project.label,
                  })),
                ]}
                placeholder={t`Move to project`}
                value=""
                onChange={(value) =>
                  void run({
                    kind: "project",
                    value: value === "__none__" ? "" : value,
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
          {picking ? (
            <TaskDatePopover
              draft={NO_DATES}
              planOnly
              target="scheduled"
              title={t`Schedule date`}
              trigger={actionBar}
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
                one="# repeating task excluded. Open it to choose an occurrence or the series."
                other="# repeating tasks excluded. Open each task to choose an occurrence or the series."
              />
            </p>
          ) : null}
          {projectError ? (
            <p className="bulk-selection-hint">
              {t`Could not load projects.`} {projectError}
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
