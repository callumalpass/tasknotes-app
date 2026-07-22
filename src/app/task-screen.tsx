import { ArrowLeft, Clock3, Play, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LoadingRows } from "../components/loading";
import {
  buildRecurrenceRule,
  parseRecurrenceRule,
  type RecurrenceRuleDraft,
} from "../domain/recurrence-rule";
import {
  combineTaskDateTime,
  activeTimeEntry,
  recurrencePreset,
  recurrenceRule,
  taskTimeTotals,
  taskDatePart,
  taskTimePart,
} from "../domain/task";
import { useRepository, useTask } from "./repository-context";

import type { Task, TaskTimeEntry, UpdateTaskInput } from "../domain/task";

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
  | "reminders"
  | "timeEstimate"
  | "customProperties"
>;

export function TaskScreen({
  id,
  occurrenceDate,
  onBack,
}: {
  id: string;
  occurrenceDate?: string;
  onBack(): void;
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
    />
  );
}

function TaskEditor({
  task,
  occurrenceDate,
  onBack,
}: {
  task: Task;
  occurrenceDate?: string;
  onBack(): void;
}) {
  const {
    updateTask,
    deleteTask,
    toggleTask,
    skipTask,
    startTimeTracking,
    stopTimeTracking,
    replaceTimeEntries,
    removeTimeEntry,
    configuration,
  } = useRepository();
  const [draft, setDraft] = useState<Draft>(() => toDraft(task));
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [occurrenceAction, setOccurrenceAction] = useState(false);
  const [timeAction, setTimeAction] = useState(false);
  const [timeError, setTimeError] = useState<string | null>(null);
  const mounted = useRef(true);
  const editVersion = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const persist = useCallback(
    async (value: Draft, version: number) => {
      if (!value.title.trim()) {
        if (mounted.current) setSaveState("error");
        return;
      }
      setSaveState("saving");
      setSaveError(null);
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
          reminders: value.reminders,
          timeEstimate: value.timeEstimate ?? null,
          customProperties: value.customProperties,
        };
        await updateTask(task.id, input);
        if (mounted.current && editVersion.current === version) {
          setDirty(false);
          setSaveState("saved");
        }
      } catch (reason) {
        if (mounted.current && editVersion.current === version) {
          setSaveError(
            reason instanceof Error ? reason.message : String(reason),
          );
          setSaveState("error");
        }
      }
    },
    [task.id, updateTask],
  );

  useEffect(() => {
    if (!dirty) return;
    const version = editVersion.current;
    const timeout = window.setTimeout(() => void persist(draft, version), 520);
    return () => window.clearTimeout(timeout);
  }, [dirty, draft, persist]);

  function change(patch: Partial<Draft>) {
    editVersion.current += 1;
    setDraft((value) => ({ ...value, ...patch }));
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
    if (dirty) void persist(draft, editVersion.current);
    onBack();
  }

  async function remove() {
    await deleteTask(task.id);
    onBack();
  }

  async function toggleOccurrence() {
    if (!occurrenceDate || occurrenceAction) return;
    setOccurrenceAction(true);
    try {
      await toggleTask(task.id, occurrenceDate);
    } finally {
      if (mounted.current) setOccurrenceAction(false);
    }
  }

  async function toggleSkippedOccurrence() {
    if (!occurrenceDate || occurrenceAction) return;
    setOccurrenceAction(true);
    try {
      await skipTask(task.id, occurrenceDate);
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
          aria-label="Delete task"
          className="icon-action"
          type="button"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 aria-hidden="true" size={19} strokeWidth={1.6} />
        </button>
      </header>

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

      {occurrenceDate && task.recurrence ? (
        <div className="occurrence-banner">
          <div>
            <span>Occurrence</span>
            <strong>{formatOccurrenceDate(occurrenceDate)}</strong>
          </div>
          <div>
            <button
              className="text-action"
              disabled={occurrenceAction}
              type="button"
              onClick={() => void toggleOccurrence()}
            >
              {task.completeInstances.includes(occurrenceDate)
                ? "Mark open"
                : "Complete"}
            </button>
            <button
              className="text-action"
              disabled={occurrenceAction}
              type="button"
              onClick={() => void toggleSkippedOccurrence()}
            >
              {task.skippedInstances.includes(occurrenceDate)
                ? "Unskip"
                : "Skip"}
            </button>
          </div>
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

        <Fieldset legend="Status">
          {[...configuration.statuses]
            .sort((left, right) => left.order - right.order)
            .map((status) => (
              <Choice
                key={status.value}
                selected={draft.status === status.value}
                onClick={() => change({ status: status.value })}
              >
                {status.label}
              </Choice>
            ))}
        </Fieldset>

        <div className="field-grid timing-fields">
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
          <label className="form-field">
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
        </div>

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
            label="Projects"
            placeholder="Website, Home"
            values={draft.projects}
            onChange={(projects) => change({ projects })}
          />
          <ListField
            label="Contexts"
            placeholder="Computer, Errands"
            values={draft.contexts}
            onChange={(contexts) => change({ contexts })}
          />
          <ListField
            label="Tags"
            placeholder="work, important"
            values={draft.tags.filter((tag) => tag !== "task")}
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
                  field={field}
                  key={field.key}
                  value={draft.customProperties[field.key]}
                  onChange={(value) => changeCustomProperty(field.key, value)}
                />
              ))}
            </div>
          </section>
        ) : null}

        <RecurrenceField
          anchor={draft.recurrenceAnchor}
          value={draft.recurrence}
          onAnchorChange={(recurrenceAnchor) => change({ recurrenceAnchor })}
          onChange={(recurrence) => change({ recurrence })}
        />

        <ReminderField
          reminders={draft.reminders}
          onChange={(reminders) => change({ reminders })}
        />

        <label className="notes-field">
          <span>Notes</span>
          <textarea
            placeholder="Add a note"
            rows={8}
            value={draft.body}
            onChange={(event) => change({ body: event.target.value })}
          />
        </label>

        <div className="record-path">
          <span>Markdown record</span>
          <code>{task.path}</code>
        </div>
      </div>
    </section>
  );
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
        <input
          aria-label="Session start"
          type="datetime-local"
          value={start}
          onChange={(event) => setStart(event.target.value)}
        />
        <input
          aria-label="Session end"
          type="datetime-local"
          value={end}
          onChange={(event) => setEnd(event.target.value)}
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
  children,
  onClick,
}: {
  selected: boolean;
  children: React.ReactNode;
  onClick(): void;
}) {
  return (
    <button
      aria-pressed={selected}
      className={selected ? "is-selected" : undefined}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ListField({
  label,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange(values: string[]): void;
}) {
  return (
    <label className="form-field list-field">
      <span>{label}</span>
      <input
        type="text"
        placeholder={placeholder}
        value={values.join(", ")}
        onChange={(event) => onChange(parseList(event.target.value))}
      />
    </label>
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
        <label className="form-field">
          <span>Repeat</span>
          <select
            value={preset}
            onChange={(event) => {
              const next = event.target.value;
              onChange(
                next === "never" ? undefined : (recurrenceRule(next) ?? value),
              );
            }}
          >
            <option value="never">Never</option>
            <option value="daily">Daily</option>
            <option value="weekdays">Weekdays</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
            {preset === "custom" ? (
              <option value="custom">Custom</option>
            ) : null}
          </select>
        </label>
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
              <select
                aria-label="Repeat frequency"
                value={rule.frequency}
                onChange={(event) =>
                  update({
                    frequency: event.target
                      .value as RecurrenceRuleDraft["frequency"],
                  })
                }
              >
                <option value="DAILY">days</option>
                <option value="WEEKLY">weeks</option>
                <option value="MONTHLY">months</option>
                <option value="YEARLY">years</option>
              </select>
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
              <label className="form-field">
                <span>Ends</span>
                <select
                  value={rule.end}
                  onChange={(event) =>
                    update({
                      end: event.target.value as RecurrenceRuleDraft["end"],
                      until:
                        rule.until ?? new Date().toISOString().slice(0, 10),
                      count: rule.count ?? 10,
                    })
                  }
                >
                  <option value="never">Never</option>
                  <option value="until">On date</option>
                  <option value="count">After occurrences</option>
                </select>
              </label>
              {rule.end === "until" ? (
                <label className="form-field">
                  <span>Last date</span>
                  <input
                    type="date"
                    value={rule.until ?? ""}
                    onChange={(event) => update({ until: event.target.value })}
                  />
                </label>
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
  return (
    <label className="form-field reminder-field">
      <span>Reminder</span>
      <div>
        <input
          aria-label="Reminder date and time"
          type="datetime-local"
          value={toLocalDateTime(absolute?.absoluteTime)}
          onChange={(event) => {
            const next = event.target.value;
            onChange(
              next
                ? [
                    ...reminders.filter((reminder) => reminder !== absolute),
                    {
                      id: absolute?.id ?? crypto.randomUUID(),
                      type: "absolute",
                      absoluteTime: new Date(next).toISOString(),
                    },
                  ]
                : reminders.filter((reminder) => reminder !== absolute),
            );
          }}
        />
        {absolute ? (
          <button
            className="text-action danger"
            type="button"
            onClick={() =>
              onChange(reminders.filter((reminder) => reminder !== absolute))
            }
          >
            Remove
          </button>
        ) : null}
      </div>
    </label>
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
  const date = taskDatePart(value);
  const time = taskTimePart(value);
  return (
    <label className="form-field date-time-field">
      <span>{label}</span>
      <div>
        <input
          aria-label={`${label} date`}
          type="date"
          value={date}
          onChange={(event) =>
            onChange(combineTaskDateTime(event.target.value, time))
          }
        />
        <input
          aria-label={`${label} time`}
          disabled={!date}
          type="time"
          value={time}
          onChange={(event) =>
            onChange(combineTaskDateTime(date, event.target.value))
          }
        />
      </div>
    </label>
  );
}

function CustomField({
  field,
  value,
  onChange,
}: {
  field: import("@tasknotes/model/types").UserMappedField;
  value: unknown;
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
        label={field.displayName}
        placeholder="Comma-separated values"
        values={Array.isArray(value) ? value.map(String) : []}
        onChange={onChange}
      />
    );
  }
  return (
    <label className="form-field">
      <span>{field.displayName}</span>
      <input
        inputMode={field.type === "number" ? "decimal" : undefined}
        type={
          field.type === "date"
            ? "date"
            : field.type === "number"
              ? "number"
              : "text"
        }
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

function parseList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
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
