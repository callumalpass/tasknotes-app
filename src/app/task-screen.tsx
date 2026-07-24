import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Clock3,
  Play,
  Square,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LoadingRows } from "../components/loading";
import { MultiValueField } from "../components/multi-value-field";
import {
  TaskNotesDateField,
  TaskNotesDatePicker,
  TaskNotesDateTimeField,
  TaskNotesSelect,
  TaskNotesSelectField,
  TaskNotesTimePicker,
} from "../components/tasknotes-controls";
import {
  buildRecurrenceRule,
  parseRecurrenceRule,
  type RecurrenceRuleDraft,
} from "../domain/recurrence-rule";
import {
  activeTimeEntry,
  combineTaskDateTime,
  recurrencePreset,
  recurrenceRule,
  taskDatePart,
  taskTimeTotals,
  taskTimePart,
} from "../domain/task";
import { useRepository, useTask } from "./repository-context";

import type { Task, TaskTimeEntry, UpdateTaskInput } from "../domain/task";
import type {
  FieldCompletionRequest,
  FieldCompletion,
} from "../domain/completion";
import type { TaskFieldCompletionConfiguration } from "../domain/task-configuration";

type SaveState = "saved" | "saving" | "error";
type Draft = Pick<
  Task,
  | "title"
  | "status"
  | "priority"
  | "due"
  | "scheduled"
  | "body"
  | "tags"
  | "contexts"
  | "projects"
  | "recurrence"
  | "recurrenceAnchor"
  | "occurrenceMaterialization"
  | "occurrenceNextTrigger"
  | "occurrenceTemplate"
  | "occurrencePastHorizon"
  | "occurrenceFutureHorizon"
  | "reminders"
  | "timeEstimate"
  | "customProperties"
>;

export function TaskScreen({
  id,
  occurrenceDate,
  onBack,
  onMaterialized,
}: {
  id: string;
  occurrenceDate?: string;
  onBack(): void;
  onMaterialized(task: Task): void;
}) {
  const { task, loading, error } = useTask(id);
  if (loading)
    return (
      <section className="screen task-screen">
        <LoadingRows count={5} />
      </section>
    );
  if (error || !task)
    return (
      <section className="screen task-screen">
        <button className="back-action" type="button" onClick={onBack}>
          <ArrowLeft size={20} /> Back
        </button>
        <p className="inline-error" role="alert">
          {error?.message ?? "Task not found."}
        </p>
      </section>
    );
  return (
    <TaskEditor
      key={`${task.id}:${occurrenceDate ?? "record"}`}
      task={task}
      occurrenceDate={occurrenceDate}
      onBack={onBack}
      onMaterialized={onMaterialized}
    />
  );
}

function TaskEditor({
  task,
  occurrenceDate,
  onBack,
  onMaterialized,
}: {
  task: Task;
  occurrenceDate?: string;
  onBack(): void;
  onMaterialized(task: Task): void;
}) {
  const {
    updateTask,
    deleteTask,
    toggleTask,
    skipTask,
    materializeOccurrence,
    startTimeTracking,
    stopTimeTracking,
    replaceTimeEntries,
    removeTimeEntry,
    setTaskArchived,
    configuration,
    repository,
  } = useRepository();
  const completeField = useCallback(
    (request: FieldCompletionRequest) => repository.completeField(request),
    [repository],
  );
  const [draft, setDraft] = useState<Draft>(() => toDraft(task));
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [occurrenceAction, setOccurrenceAction] = useState(false);
  const [occurrenceError, setOccurrenceError] = useState<string | null>(null);
  const [timeAction, setTimeAction] = useState(false);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [archiveAction, setArchiveAction] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const mounted = useRef(true);
  const editVersion = useRef(0);
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);
  const savesInFlight = useRef(new Map<number, Promise<void>>());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const persist = useCallback(
    (value: Draft, version: number): Promise<void> => {
      const existing = savesInFlight.current.get(version);
      if (existing) return existing;
      if (!value.title.trim()) {
        if (mounted.current) {
          setSaveError("Add a title before leaving this task.");
          setSaveState("error");
        }
        return Promise.resolve();
      }
      if (mounted.current) {
        setSaveState("saving");
        setSaveError(null);
      }
      const run = (async () => {
        try {
          const input: UpdateTaskInput = {
            title: value.title,
            status: value.status,
            priority: value.priority,
            due: value.due ?? null,
            scheduled: value.scheduled ?? null,
            body: value.body,
            tags: value.tags,
            contexts: value.contexts,
            projects: value.projects,
            recurrence: value.recurrence ?? null,
            recurrenceAnchor: value.recurrenceAnchor,
            occurrenceMaterialization: value.occurrenceMaterialization,
            occurrenceNextTrigger: value.occurrenceNextTrigger,
            occurrenceTemplate: value.occurrenceTemplate ?? null,
            occurrencePastHorizon: value.occurrencePastHorizon ?? null,
            occurrenceFutureHorizon: value.occurrenceFutureHorizon ?? null,
            reminders: value.reminders,
            timeEstimate: value.timeEstimate ?? null,
            customProperties: value.customProperties,
          };
          await updateTask(task.id, input);
          if (editVersion.current === version) {
            dirtyRef.current = false;
            if (mounted.current) {
              setDirty(false);
              setSaveState("saved");
            }
          }
        } catch (reason) {
          if (mounted.current && editVersion.current === version) {
            setSaveError(
              reason instanceof Error ? reason.message : String(reason),
            );
            setSaveState("error");
          }
        } finally {
          savesInFlight.current.delete(version);
        }
      })();
      savesInFlight.current.set(version, run);
      return run;
    },
    [task.id, updateTask],
  );

  useEffect(() => {
    if (!dirty) return;
    const version = editVersion.current;
    const timeout = window.setTimeout(() => void persist(draft, version), 520);
    return () => window.clearTimeout(timeout);
  }, [dirty, draft, persist]);

  useEffect(() => {
    const flush = () => {
      if (!dirtyRef.current || !draftRef.current.title.trim()) return;
      void persist(draftRef.current, editVersion.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [persist]);

  function change(patch: Partial<Draft>) {
    editVersion.current += 1;
    setDraft((value) => {
      const next = { ...value, ...patch };
      draftRef.current = next;
      return next;
    });
    dirtyRef.current = true;
    setDirty(true);
  }

  function changeCustomProperty(key: string, value: unknown) {
    const customProperties = { ...draft.customProperties };
    if (isEmptyFieldValue(value)) delete customProperties[key];
    else customProperties[key] = value;
    change({ customProperties });
  }

  function leave() {
    if (!draft.title.trim()) {
      setSaveState("error");
      return;
    }
    if (dirtyRef.current) void persist(draftRef.current, editVersion.current);
    onBack();
  }

  async function remove() {
    await deleteTask(task.id);
    onBack();
  }

  async function toggleOccurrence() {
    const date = occurrenceDate ?? task.occurrenceDate;
    if (!date || occurrenceAction) return;
    setOccurrenceAction(true);
    setOccurrenceError(null);
    try {
      await toggleTask(task.id, task.occurrenceDate ? undefined : date);
    } catch (reason) {
      if (mounted.current)
        setOccurrenceError(
          reason instanceof Error ? reason.message : String(reason),
        );
    } finally {
      if (mounted.current) setOccurrenceAction(false);
    }
  }

  async function toggleSkippedOccurrence() {
    const date = occurrenceDate ?? task.occurrenceDate;
    if (!date || occurrenceAction) return;
    setOccurrenceAction(true);
    setOccurrenceError(null);
    try {
      await skipTask(task.id, date);
    } catch (reason) {
      if (mounted.current)
        setOccurrenceError(
          reason instanceof Error ? reason.message : String(reason),
        );
    } finally {
      if (mounted.current) setOccurrenceAction(false);
    }
  }

  async function materialize() {
    if (!occurrenceDate || occurrenceAction) return;
    setOccurrenceAction(true);
    setOccurrenceError(null);
    try {
      const result = await materializeOccurrence(task.id, occurrenceDate);
      onMaterialized(result.task);
    } catch (reason) {
      if (mounted.current)
        setOccurrenceError(
          reason instanceof Error ? reason.message : String(reason),
        );
    } finally {
      if (mounted.current) setOccurrenceAction(false);
    }
  }

  async function runTimeAction(action: () => Promise<unknown>) {
    if (timeAction) return;
    setTimeAction(true);
    setTimeError(null);
    try {
      if (dirty) await persist(draft, editVersion.current);
      await action();
    } catch (reason) {
      if (mounted.current)
        setTimeError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mounted.current) setTimeAction(false);
    }
  }

  async function changeArchiveState() {
    if (archiveAction) return;
    setArchiveAction(true);
    setArchiveError(null);
    try {
      if (dirty) await persist(draft, editVersion.current);
      const updated = await setTaskArchived(task.id, !task.archived);
      if (updated.operationWarnings?.length) {
        if (mounted.current) {
          setArchiveError(updated.operationWarnings.join(" "));
          setArchiveAction(false);
        }
        return;
      }
      onBack();
    } catch (reason) {
      if (mounted.current) {
        setArchiveError(
          reason instanceof Error ? reason.message : String(reason),
        );
        setArchiveAction(false);
      }
    }
  }

  return (
    <section className="screen task-screen" aria-label="Task details">
      <header className="task-toolbar">
        <button
          aria-label="Back"
          className="icon-action"
          type="button"
          onClick={leave}
        >
          <ArrowLeft aria-hidden="true" size={21} strokeWidth={1.7} />
        </button>
        <button
          className={`save-state is-${saveState}`}
          disabled={saveState !== "error" || !draft.title.trim()}
          type="button"
          onClick={() => void persist(draft, editVersion.current)}
          aria-label={
            saveState === "error"
              ? `Save failed. ${saveError ?? "Tap to retry."}`
              : undefined
          }
        >
          {!draft.title.trim()
            ? "Title required"
            : saveState === "saving"
              ? "Saving"
              : saveState === "error"
                ? "Save failed · Retry"
                : "Saved"}
        </button>
        <button
          aria-label={task.archived ? "Restore task" : "Archive task"}
          className="icon-action"
          disabled={archiveAction}
          type="button"
          onClick={() => void changeArchiveState()}
        >
          {task.archived ? (
            <ArchiveRestore aria-hidden="true" size={19} strokeWidth={1.6} />
          ) : (
            <Archive aria-hidden="true" size={19} strokeWidth={1.6} />
          )}
        </button>
        <button
          aria-label="Delete task"
          className="icon-action"
          type="button"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 aria-hidden="true" size={19} strokeWidth={1.6} />
        </button>
      </header>

      {archiveError ? (
        <p className="inline-error" role="alert">
          {cleanOperationError(archiveError)}
        </p>
      ) : null}

      {confirmDelete ? (
        <div className="delete-confirmation" role="alert">
          <p>Delete this task?</p>
          <div>
            <button
              className="text-action danger"
              type="button"
              onClick={() => void remove()}
            >
              Delete
            </button>
            <button
              className="text-action"
              type="button"
              onClick={() => setConfirmDelete(false)}
            >
              Keep task
            </button>
          </div>
        </div>
      ) : null}

      {(occurrenceDate && task.recurrence) || task.occurrenceDate ? (
        <div className="occurrence-banner">
          <div>
            <span>
              {task.occurrenceDate ? "Occurrence note" : "Occurrence"}
            </span>
            <strong>
              {formatOccurrenceDate(task.occurrenceDate ?? occurrenceDate!)}
            </strong>
          </div>
          <div className="occurrence-actions">
            <button
              className="text-action"
              disabled={occurrenceAction}
              type="button"
              onClick={() => void toggleOccurrence()}
            >
              {task.occurrenceDate
                ? task.completed
                  ? "Mark open"
                  : "Complete"
                : task.completeInstances.includes(occurrenceDate!)
                  ? "Mark open"
                  : "Complete"}
            </button>
            <button
              className="text-action"
              disabled={occurrenceAction}
              type="button"
              onClick={() => void toggleSkippedOccurrence()}
            >
              {task.occurrenceDate
                ? task.skipped
                  ? "Unskip"
                  : "Skip"
                : task.skippedInstances.includes(occurrenceDate!)
                  ? "Unskip"
                  : "Skip"}
            </button>
            {occurrenceDate && task.recurrence ? (
              <button
                className="text-action"
                disabled={occurrenceAction}
                type="button"
                onClick={() => void materialize()}
              >
                Make occurrence note
              </button>
            ) : null}
          </div>
          {occurrenceError ? (
            <p className="inline-error" role="alert">
              {occurrenceError}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="task-form">
        <label
          className="visually-hidden"
          id="task-title-label"
          htmlFor="task-title"
        >
          Task title
        </label>
        <textarea
          autoFocus
          className="title-field"
          id="task-title"
          rows={2}
          value={draft.title}
          onChange={(event) => change({ title: event.target.value })}
        />

        <div className="field-grid timing-fields task-core-fields">
          <div className="tasknotes-status-field">
            <TaskNotesSelectField
              ariaDescribedBy={
                task.occurrenceDate ? "occurrence-status-help" : undefined
              }
              disabled={Boolean(task.occurrenceDate)}
              label="Status"
              options={[...configuration.statuses].sort(
                (left, right) => left.order - right.order,
              )}
              value={draft.status}
              onChange={(status) => change({ status })}
            />
            {task.occurrenceDate ? (
              <small id="occurrence-status-help">
                Use the occurrence actions above to change this state.
              </small>
            ) : null}
          </div>
          <DateTimeField
            label="Scheduled"
            value={draft.scheduled}
            onChange={(scheduled) => change({ scheduled })}
          />
          <DateTimeField
            label="Due"
            value={draft.due}
            onChange={(due) => change({ due })}
          />
        </div>

        <label className="notes-field">
          <span>Notes</span>
          <textarea
            placeholder="Add a note"
            rows={8}
            value={draft.body}
            onChange={(event) => change({ body: event.target.value })}
          />
        </label>

        <TaskFormSection summary={organizeSummary(draft)} title="Organize">
          <Fieldset legend="Priority">
            {configuration.priorities.map((priority) => (
              <Choice
                key={priority.value}
                selected={draft.priority === priority.value}
                onClick={() => change({ priority: priority.value })}
              >
                {priority.label}
              </Choice>
            ))}
          </Fieldset>
          <div className="field-grid metadata-fields">
            <ListField
              field={configuration.fieldMapping.projects}
              label="Projects"
              placeholder="Website, Home"
              values={draft.projects}
              completion={
                configuration.fieldCompletions[
                  configuration.fieldMapping.projects
                ] ?? { kind: "records" }
              }
              completeField={completeField}
              onChange={(projects) => change({ projects })}
            />
            <ListField
              field={configuration.fieldMapping.contexts}
              label="Contexts"
              placeholder="Computer, Errands"
              values={draft.contexts}
              completion={
                configuration.fieldCompletions[
                  configuration.fieldMapping.contexts
                ] ?? { kind: "values" }
              }
              completeField={completeField}
              onChange={(contexts) => change({ contexts })}
            />
            <ListField
              field="tags"
              label="Tags"
              placeholder="work, important"
              values={draft.tags.filter((tag) => tag !== "task")}
              completion={
                configuration.fieldCompletions.tags ?? { kind: "values" }
              }
              completeField={completeField}
              onChange={(tags) => change({ tags: ["task", ...tags] })}
            />
          </div>
          {configuration.userFields.length ? (
            <section
              className="custom-fields"
              aria-labelledby="custom-fields-title"
            >
              <h2 id="custom-fields-title">Properties</h2>
              <div className="field-grid metadata-fields">
                {configuration.userFields.map((field) => (
                  <CustomField
                    completion={configuration.fieldCompletions[field.key]}
                    completeField={completeField}
                    field={field}
                    key={field.key}
                    value={draft.customProperties[field.key]}
                    onChange={(value) => changeCustomProperty(field.key, value)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </TaskFormSection>

        <TaskFormSection
          defaultOpen={Boolean(activeTimeEntry(task.timeEntries))}
          summary={timeSummary(task, draft.timeEstimate)}
          title="Time"
        >
          <label className="form-field time-estimate-field">
            <span>Estimate (minutes)</span>
            <input
              inputMode="numeric"
              min="0"
              type="number"
              value={draft.timeEstimate ?? ""}
              onChange={(event) =>
                change({
                  timeEstimate: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
            />
          </label>
          <TimeTrackingField
            busy={timeAction}
            entries={task.timeEntries}
            error={timeError}
            onRemove={(index) =>
              runTimeAction(() => removeTimeEntry(task.id, index))
            }
            onReplace={(entries) =>
              runTimeAction(() => replaceTimeEntries(task.id, entries))
            }
            onStart={(description) =>
              runTimeAction(() => startTimeTracking(task.id, description))
            }
            onStop={() => runTimeAction(() => stopTimeTracking(task.id))}
          />
        </TaskFormSection>

        <TaskFormSection
          summary={repeatSummary(draft)}
          title="Repeat and reminders"
        >
          <RecurrenceField
            anchor={draft.recurrenceAnchor}
            value={draft.recurrence}
            onAnchorChange={(recurrenceAnchor) => change({ recurrenceAnchor })}
            onChange={(recurrence) => change({ recurrence })}
          />
          {draft.recurrence && !task.occurrenceDate ? (
            <OccurrencePolicyField
              futureHorizon={draft.occurrenceFutureHorizon}
              materialization={draft.occurrenceMaterialization ?? "manual"}
              nextTrigger={draft.occurrenceNextTrigger ?? "completion"}
              pastHorizon={draft.occurrencePastHorizon}
              template={draft.occurrenceTemplate}
              onChange={(patch) => change(patch)}
            />
          ) : null}
          <ReminderField
            reminders={draft.reminders}
            onChange={(reminders) => change({ reminders })}
          />
        </TaskFormSection>

        <details className="record-path">
          <summary>Markdown record</summary>
          <code>{task.path}</code>
        </details>
      </div>
    </section>
  );
}

function TaskFormSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="task-form-section"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>
          <strong>{title}</strong>
          <small>{summary}</small>
        </span>
      </summary>
      <div className="task-form-section-content">{children}</div>
    </details>
  );
}

function organizeSummary(draft: Draft): string {
  const values: string[] = [];
  if (draft.priority !== "normal" && draft.priority !== "none")
    values.push(`${humanizeValue(draft.priority)} priority`);
  if (draft.projects.length)
    values.push(listSummary(draft.projects, "project"));
  if (draft.contexts.length)
    values.push(listSummary(draft.contexts, "context"));
  const tags = draft.tags.filter((tag) => tag !== "task");
  if (tags.length)
    values.push(`${tags.length} ${tags.length === 1 ? "tag" : "tags"}`);
  const customCount = Object.values(draft.customProperties).filter(
    (value) => !isEmptyFieldValue(value),
  ).length;
  if (customCount)
    values.push(
      `${customCount} ${customCount === 1 ? "property" : "properties"}`,
    );
  return values.join(" · ") || "Priority, projects, contexts and tags";
}

function timeSummary(task: Task, estimate?: number): string {
  const active = activeTimeEntry(task.timeEntries);
  const values: string[] = [];
  if (active) values.push("Timer running");
  else if (task.timeEntries.length)
    values.push(
      `${task.timeEntries.length} ${task.timeEntries.length === 1 ? "session" : "sessions"}`,
    );
  if (estimate) values.push(`${estimate}m estimate`);
  return values.join(" · ") || "Estimate and work sessions";
}

function repeatSummary(draft: Draft): string {
  const values: string[] = [];
  if (draft.recurrence) {
    const preset = recurrencePreset(draft.recurrence);
    values.push(preset === "custom" ? "Custom repeat" : humanizeValue(preset));
  }
  if (draft.reminders.length)
    values.push(
      `${draft.reminders.length} ${draft.reminders.length === 1 ? "reminder" : "reminders"}`,
    );
  return values.join(" · ") || "No repeat or reminder";
}

function listSummary(values: string[], singular: string): string {
  return values.length === 1 ? values[0] : `${values.length} ${singular}s`;
}

function humanizeValue(value: string): string {
  const normalized = value.replaceAll("_", " ").replaceAll("-", " ");
  return normalized
    ? `${normalized[0].toUpperCase()}${normalized.slice(1)}`
    : value;
}

function TimeTrackingField({
  entries,
  busy,
  error,
  onStart,
  onStop,
  onReplace,
  onRemove,
}: {
  entries: TaskTimeEntry[];
  busy: boolean;
  error: string | null;
  onStart(description?: string): void;
  onStop(): void;
  onReplace(entries: TaskTimeEntry[]): void;
  onRemove(index: number): void;
}) {
  const active = activeTimeEntry(entries);
  const now = useTimerNow(Boolean(active));
  const totals = taskTimeTotals(entries, now);
  const [expanded, setExpanded] = useState(false);
  const [description, setDescription] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const visibleEntries = entries.slice(-50).reverse();

  return (
    <section className="time-tracking" aria-labelledby="time-tracking-title">
      <div className="time-tracking-heading">
        <div>
          <h2 id="time-tracking-title">
            <Clock3 aria-hidden="true" size={16} strokeWidth={1.7} /> Time
          </h2>
          <p>
            {active
              ? `${formatMinutes(totals.liveMinutes)} tracked`
              : formatMinutes(totals.closedMinutes)}
          </p>
        </div>
        {active ? (
          <button
            className="timer-action is-running"
            disabled={busy}
            type="button"
            onClick={onStop}
          >
            <Square aria-hidden="true" size={14} fill="currentColor" /> Stop
          </button>
        ) : (
          <button
            className="timer-action"
            disabled={busy}
            type="button"
            onClick={() => {
              onStart(description.trim() || undefined);
              setDescription("");
            }}
          >
            <Play aria-hidden="true" size={15} fill="currentColor" /> Start
          </button>
        )}
      </div>

      {!active ? (
        <input
          aria-label="Timer description"
          className="timer-description"
          placeholder="What are you working on?"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      ) : (
        <p className="active-session" aria-live="polite">
          {active.description || "Work session"} · {formatSession(active, now)}
        </p>
      )}

      {error ? (
        <p className="inline-error" role="alert">
          {cleanOperationError(error)}
        </p>
      ) : null}

      {entries.length ? (
        <button
          aria-expanded={expanded}
          className="text-action time-history-toggle"
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? "Hide sessions"
            : `${entries.length} session${entries.length === 1 ? "" : "s"}`}
        </button>
      ) : null}

      {expanded ? (
        <div className="time-entry-list">
          {entries.length > visibleEntries.length ? (
            <p className="time-entry-limit">
              Showing the latest {visibleEntries.length} of {entries.length}
              sessions.
            </p>
          ) : null}
          {visibleEntries.map((entry, reversedIndex) => {
            const index = entries.length - reversedIndex - 1;
            return editing === index ? (
              <TimeEntryEditor
                entry={entry}
                key={`${entry.startTime}:${index}`}
                onCancel={() => setEditing(null)}
                onSave={(next) => {
                  const replacement = entries.map((value, entryIndex) =>
                    entryIndex === index ? next : value,
                  );
                  onReplace(replacement);
                  setEditing(null);
                }}
              />
            ) : (
              <div
                className="time-entry-row"
                key={`${entry.startTime}:${index}`}
              >
                <button type="button" onClick={() => setEditing(index)}>
                  <strong>{entry.description || "Work session"}</strong>
                  <span>{formatSessionRange(entry, now)}</span>
                </button>
                <button
                  aria-label={`Remove ${entry.description || "session"}`}
                  className="icon-action"
                  disabled={busy}
                  type="button"
                  onClick={() => onRemove(index)}
                >
                  <Trash2 aria-hidden="true" size={15} strokeWidth={1.6} />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function TimeEntryEditor({
  entry,
  onSave,
  onCancel,
}: {
  entry: TaskTimeEntry;
  onSave(entry: TaskTimeEntry): void;
  onCancel(): void;
}) {
  const [start, setStart] = useState(toLocalDateTime(entry.startTime));
  const [end, setEnd] = useState(toLocalDateTime(entry.endTime));
  const [description, setDescription] = useState(entry.description ?? "");
  const valid = Boolean(start && (!end || new Date(end) >= new Date(start)));
  return (
    <div className="time-entry-editor">
      <input
        aria-label="Session description"
        placeholder="Session description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <div>
        <TaskNotesDateTimeField
          label="Session start"
          value={start}
          onChange={(value) => setStart(value ?? "")}
        />
        <TaskNotesDateTimeField
          label="Session end"
          value={end}
          onChange={(value) => setEnd(value ?? "")}
        />
      </div>
      <div className="time-entry-editor-actions">
        <button className="text-action" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="text-action"
          disabled={!valid}
          type="button"
          onClick={() =>
            onSave({
              startTime: new Date(start).toISOString(),
              ...(end ? { endTime: new Date(end).toISOString() } : {}),
              ...(description.trim()
                ? { description: description.trim() }
                : {}),
            })
          }
        >
          Save session
        </button>
      </div>
    </div>
  );
}

function useTimerNow(running: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, [running]);
  return now;
}

function formatMinutes(value: number): string {
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatSession(entry: TaskTimeEntry, now: Date): string {
  return formatMinutes(taskTimeTotals([entry], now).liveMinutes);
}

function formatSessionRange(entry: TaskTimeEntry, now: Date): string {
  const start = new Date(entry.startTime);
  const end = entry.endTime ? new Date(entry.endTime) : now;
  const day = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(start);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${time.format(start)}–${time.format(end)} · ${formatSession(entry, now)}`;
}

function cleanOperationError(value: string): string {
  return value.replace(/^[a-z_]+:\s*/i, "");
}

function Fieldset({
  legend,
  children,
}: {
  legend: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="choice-field">
      <legend>{legend}</legend>
      <div>{children}</div>
    </fieldset>
  );
}

function Choice({
  selected,
  disabled = false,
  children,
  onClick,
}: {
  selected: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick(): void;
}) {
  return (
    <button
      aria-pressed={selected}
      className={selected ? "is-selected" : undefined}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ListField({
  field,
  label,
  placeholder,
  values,
  completion,
  completeField,
  onChange,
}: {
  field: string;
  label: string;
  placeholder: string;
  values: string[];
  completion: TaskFieldCompletionConfiguration;
  completeField(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
  onChange(values: string[]): void;
}) {
  return (
    <MultiValueField
      completion={completion}
      completeField={completeField}
      field={field}
      label={label}
      placeholder={placeholder}
      values={values}
      onChange={onChange}
    />
  );
}

function RecurrenceField({
  value,
  anchor,
  onChange,
  onAnchorChange,
}: {
  value?: string;
  anchor?: "scheduled" | "completion";
  onChange(value?: string): void;
  onAnchorChange(value: "scheduled" | "completion"): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rule = useMemo(() => parseRecurrenceRule(value), [value]);
  const update = (patch: Partial<RecurrenceRuleDraft>) =>
    onChange(buildRecurrenceRule({ ...rule, ...patch }));
  const preset = recurrencePreset(value);
  return (
    <div className="repeat-fields">
      <div className="repeat-heading">
        <TaskNotesSelectField
          label="Repeat"
          options={[
            { value: "never", label: "Never" },
            { value: "daily", label: "Daily" },
            { value: "weekdays", label: "Weekdays" },
            { value: "weekly", label: "Weekly" },
            { value: "monthly", label: "Monthly" },
            { value: "yearly", label: "Yearly" },
            ...(preset === "custom"
              ? [{ value: "custom", label: "Custom" }]
              : []),
          ]}
          value={preset}
          onChange={(next) =>
            onChange(
              next === "never" ? undefined : (recurrenceRule(next) ?? value),
            )
          }
        />
        {value ? (
          <button
            className="text-action"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Done" : "Customize"}
          </button>
        ) : null}
      </div>

      {expanded && value ? (
        rule.unsupported.length ? (
          <div className="custom-rule-warning">
            <p>
              This rule uses {rule.unsupported.join(", ")}. Edit the RRULE
              directly to preserve it.
            </p>
            <label className="form-field custom-rule-field">
              <span>Recurrence rule</span>
              <input
                value={value}
                onChange={(event) => onChange(event.target.value)}
              />
            </label>
          </div>
        ) : (
          <div className="recurrence-builder">
            <div className="recurrence-interval">
              <span>Every</span>
              <input
                aria-label="Repeat interval"
                inputMode="numeric"
                min="1"
                type="number"
                value={rule.interval}
                onChange={(event) =>
                  update({ interval: Number(event.target.value) || 1 })
                }
              />
              <TaskNotesSelect
                ariaLabel="Repeat frequency"
                options={[
                  { value: "DAILY", label: "days" },
                  { value: "WEEKLY", label: "weeks" },
                  { value: "MONTHLY", label: "months" },
                  { value: "YEARLY", label: "years" },
                ]}
                value={rule.frequency}
                onChange={(frequency) =>
                  update({
                    frequency: frequency as RecurrenceRuleDraft["frequency"],
                  })
                }
              />
            </div>

            {rule.frequency === "WEEKLY" ? (
              <fieldset className="recurrence-weekdays">
                <legend>On</legend>
                {[
                  ["MO", "M"],
                  ["TU", "T"],
                  ["WE", "W"],
                  ["TH", "T"],
                  ["FR", "F"],
                  ["SA", "S"],
                  ["SU", "S"],
                ].map(([day, label]) => (
                  <button
                    aria-label={weekdayName(day)}
                    aria-pressed={rule.weekdays.includes(day)}
                    className={
                      rule.weekdays.includes(day) ? "is-selected" : undefined
                    }
                    key={day}
                    type="button"
                    onClick={() =>
                      update({
                        weekdays: rule.weekdays.includes(day)
                          ? rule.weekdays.filter((entry) => entry !== day)
                          : [...rule.weekdays, day],
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </fieldset>
            ) : null}

            <div className="recurrence-end">
              <TaskNotesSelectField
                label="Ends"
                options={[
                  { value: "never", label: "Never" },
                  { value: "until", label: "On date" },
                  { value: "count", label: "After occurrences" },
                ]}
                value={rule.end}
                onChange={(end) =>
                  update({
                    end: end as RecurrenceRuleDraft["end"],
                    until: rule.until ?? new Date().toISOString().slice(0, 10),
                    count: rule.count ?? 10,
                  })
                }
              />
              {rule.end === "until" ? (
                <TaskNotesDateField
                  label="Last date"
                  value={rule.until}
                  onChange={(until) => update({ until })}
                />
              ) : rule.end === "count" ? (
                <label className="form-field">
                  <span>Occurrences</span>
                  <input
                    inputMode="numeric"
                    min="1"
                    type="number"
                    value={rule.count ?? 10}
                    onChange={(event) =>
                      update({ count: Number(event.target.value) || 1 })
                    }
                  />
                </label>
              ) : null}
            </div>
          </div>
        )
      ) : null}

      {value ? (
        <Fieldset legend="Repeat from">
          <Choice
            selected={(anchor ?? "scheduled") === "scheduled"}
            onClick={() => onAnchorChange("scheduled")}
          >
            Schedule
          </Choice>
          <Choice
            selected={anchor === "completion"}
            onClick={() => onAnchorChange("completion")}
          >
            Completion
          </Choice>
        </Fieldset>
      ) : null}
    </div>
  );
}

function OccurrencePolicyField({
  materialization,
  nextTrigger,
  template,
  pastHorizon,
  futureHorizon,
  onChange,
}: {
  materialization: "manual" | "on_completion" | "rolling";
  nextTrigger: "completion" | "completion_or_skip";
  template?: string;
  pastHorizon?: string;
  futureHorizon?: string;
  onChange(value: Partial<Draft>): void;
}) {
  return (
    <section className="repeat-fields occurrence-policy">
      <div className="repeat-heading">
        <div>
          <span className="field-label">Occurrence notes</span>
          <p>Keep individual Markdown notes for recurring dates.</p>
        </div>
        <TaskNotesSelect
          ariaLabel="Occurrence note policy"
          options={[
            { value: "manual", label: "When I choose" },
            {
              value: "on_completion",
              label: "Create the next after completion",
            },
            { value: "rolling", label: "Keep a rolling window" },
          ]}
          value={materialization}
          onChange={(value) =>
            onChange({
              occurrenceMaterialization:
                value as Task["occurrenceMaterialization"],
            })
          }
        />
      </div>
      {materialization === "on_completion" ? (
        <TaskNotesSelectField
          label="Advance after"
          options={[
            { value: "completion", label: "Completion" },
            {
              value: "completion_or_skip",
              label: "Completion or skip",
            },
          ]}
          value={nextTrigger}
          onChange={(value) =>
            onChange({
              occurrenceNextTrigger: value as Task["occurrenceNextTrigger"],
            })
          }
        />
      ) : null}
      {materialization === "rolling" ? (
        <div className="field-grid metadata-fields">
          <label className="form-field">
            <span>Past horizon</span>
            <input
              placeholder="P0D"
              value={pastHorizon ?? ""}
              onChange={(event) =>
                onChange({ occurrencePastHorizon: event.target.value })
              }
            />
          </label>
          <label className="form-field">
            <span>Future horizon</span>
            <input
              placeholder="P14D"
              value={futureHorizon ?? ""}
              onChange={(event) =>
                onChange({ occurrenceFutureHorizon: event.target.value })
              }
            />
          </label>
        </div>
      ) : null}
      <label className="form-field">
        <span>Occurrence template</span>
        <input
          placeholder="Templates/Occurrence.md"
          value={template ?? ""}
          onChange={(event) =>
            onChange({ occurrenceTemplate: event.target.value })
          }
        />
      </label>
    </section>
  );
}

function weekdayName(value: string): string {
  return (
    {
      MO: "Monday",
      TU: "Tuesday",
      WE: "Wednesday",
      TH: "Thursday",
      FR: "Friday",
      SA: "Saturday",
      SU: "Sunday",
    }[value] ?? value
  );
}

function formatOccurrenceDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function ReminderField({
  reminders,
  onChange,
}: {
  reminders: Task["reminders"];
  onChange(reminders: Task["reminders"]): void;
}) {
  const absolute = reminders.find(
    (reminder) => reminder.type === "absolute" && reminder.absoluteTime,
  );
  const initial = toLocalDateTime(absolute?.absoluteTime);
  const [date, setDate] = useState(initial.slice(0, 10));
  const [time, setTime] = useState(initial.slice(11, 16));

  function commit(nextDate: string, nextTime: string) {
    onChange([
      ...reminders.filter((reminder) => reminder !== absolute),
      {
        id: absolute?.id ?? crypto.randomUUID(),
        type: "absolute",
        absoluteTime: new Date(`${nextDate}T${nextTime}`).toISOString(),
      },
    ]);
  }

  function remove() {
    onChange(reminders.filter((reminder) => reminder !== absolute));
  }

  return (
    <div className="reminder-field">
      <div className="form-field date-time-field tasknotes-control-field">
        <span>Reminder</span>
        <div>
          <TaskNotesDatePicker
            ariaLabel="Reminder date"
            value={date || undefined}
            onChange={(next) => {
              const nextDate = next ?? "";
              setDate(nextDate);
              if (nextDate && time) commit(nextDate, time);
              else if (!nextDate && absolute) remove();
            }}
          />
          <TaskNotesTimePicker
            ariaLabel="Reminder time"
            disabled={!date}
            value={time || undefined}
            onChange={(next) => {
              const nextTime = next ?? "";
              setTime(nextTime);
              if (date && nextTime) commit(date, nextTime);
              else if (!nextTime && absolute) remove();
            }}
          />
        </div>
      </div>
      {absolute ? (
        <button
          className="text-action danger"
          type="button"
          onClick={() => {
            setDate("");
            setTime("");
            remove();
          }}
        >
          Remove
        </button>
      ) : null}
    </div>
  );
}

function toDraft(task: Task): Draft {
  return {
    title: task.title,
    status: task.status,
    priority: task.priority,
    due: task.due,
    scheduled: task.scheduled,
    body: task.body,
    tags: task.tags,
    contexts: task.contexts,
    projects: task.projects,
    recurrence: task.recurrence,
    recurrenceAnchor: task.recurrenceAnchor,
    occurrenceMaterialization: task.occurrenceMaterialization,
    occurrenceNextTrigger: task.occurrenceNextTrigger,
    occurrenceTemplate: task.occurrenceTemplate,
    occurrencePastHorizon: task.occurrencePastHorizon,
    occurrenceFutureHorizon: task.occurrenceFutureHorizon,
    reminders: task.reminders,
    timeEstimate: task.timeEstimate,
    customProperties: { ...task.customProperties },
  };
}

function DateTimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange(value?: string): void;
}) {
  return (
    <TaskNotesDateTimeField
      combineValue={combineTaskDateTime}
      label={label}
      splitValue={(current) => ({
        date: taskDatePart(current) || undefined,
        time: taskTimePart(current) || undefined,
      })}
      value={value}
      onChange={onChange}
    />
  );
}

function CustomField({
  field,
  value,
  completion,
  completeField,
  onChange,
}: {
  field: import("@tasknotes/model/types").UserMappedField;
  value: unknown;
  completion?: TaskFieldCompletionConfiguration;
  completeField(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
  onChange(value: unknown): void;
}) {
  if (field.type === "boolean") {
    return (
      <label className="form-field boolean-field">
        <span>{field.displayName}</span>
        <input
          checked={value === true}
          type="checkbox"
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    );
  }
  if (field.type === "list") {
    return (
      <ListField
        field={field.key}
        label={field.displayName}
        placeholder="Comma-separated values"
        values={Array.isArray(value) ? value.map(String) : []}
        completion={completion ?? { kind: "values" }}
        completeField={completeField}
        onChange={onChange}
      />
    );
  }
  if (field.type === "date") {
    return (
      <TaskNotesDateField
        label={field.displayName}
        value={typeof value === "string" ? value : undefined}
        onChange={onChange}
      />
    );
  }
  return (
    <label className="form-field">
      <span>{field.displayName}</span>
      <input
        inputMode={field.type === "number" ? "decimal" : undefined}
        type={field.type === "number" ? "number" : "text"}
        value={
          typeof value === "string" || typeof value === "number" ? value : ""
        }
        onChange={(event) =>
          onChange(
            field.type === "number" && event.target.value
              ? Number(event.target.value)
              : event.target.value,
          )
        }
      />
    </label>
  );
}

function isEmptyFieldValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function toLocalDateTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
