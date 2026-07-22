import { ArrowLeft, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { LoadingRows } from "../components/loading";
import {
  combineTaskDateTime,
  recurrencePreset,
  recurrenceRule,
  taskDatePart,
  taskTimePart,
} from "../domain/task";
import { useRepository, useTask } from "./repository-context";

import type { Task, UpdateTaskInput } from "../domain/task";

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

export function TaskScreen({ id, onBack }: { id: string; onBack(): void }) {
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
  return <TaskEditor key={task.id} task={task} onBack={onBack} />;
}

function TaskEditor({ task, onBack }: { task: Task; onBack(): void }) {
  const { updateTask, deleteTask, configuration } = useRepository();
  const [draft, setDraft] = useState<Draft>(() => toDraft(task));
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
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

        <div className="repeat-fields">
          <label className="form-field">
            <span>Repeat</span>
            <select
              value={recurrencePreset(draft.recurrence)}
              onChange={(event) => {
                const preset = event.target.value;
                change({
                  recurrence:
                    preset === "never"
                      ? undefined
                      : (recurrenceRule(preset) ?? draft.recurrence ?? ""),
                });
              }}
            >
              <option value="never">Never</option>
              <option value="daily">Daily</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              {recurrencePreset(draft.recurrence) === "custom" ? (
                <option value="custom">Custom rule</option>
              ) : null}
            </select>
          </label>
          {recurrencePreset(draft.recurrence) === "custom" ? (
            <label className="form-field custom-rule-field">
              <span>Recurrence rule</span>
              <input
                value={draft.recurrence ?? ""}
                onChange={(event) => change({ recurrence: event.target.value })}
              />
            </label>
          ) : null}
          {draft.recurrence ? (
            <Fieldset legend="Repeat from">
              <Choice
                selected={
                  (draft.recurrenceAnchor ?? "scheduled") === "scheduled"
                }
                onClick={() => change({ recurrenceAnchor: "scheduled" })}
              >
                Schedule
              </Choice>
              <Choice
                selected={draft.recurrenceAnchor === "completion"}
                onClick={() => change({ recurrenceAnchor: "completion" })}
              >
                Completion
              </Choice>
            </Fieldset>
          ) : null}
        </div>

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
