import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  editableReminderOffset,
  reminderOffset,
  type ReminderOffsetDirection,
  type ReminderOffsetUnit,
} from "../domain/reminder";
import {
  TaskNotesDatePicker,
  TaskNotesSelectField,
  TaskNotesTimePicker,
} from "./tasknotes-controls";

import type { TaskReminder } from "../domain/task";

export function ReminderEditor({
  reminders,
  scheduled,
  due,
  deliveryMode = "mdbase",
  onConnectMdbase,
  onChange,
}: {
  reminders: TaskReminder[];
  scheduled?: string;
  due?: string;
  deliveryMode?: "mdbase" | "local";
  onConnectMdbase?(): void;
  onChange(reminders: TaskReminder[]): void;
}) {
  const defaultAnchor = due ? "due" : scheduled ? "scheduled" : undefined;

  function add(reminder: TaskReminder) {
    onChange([...reminders, reminder]);
  }

  function addDefault() {
    add(
      defaultAnchor
        ? relativeReminder(defaultAnchor, "-PT15M", "15 minutes before")
        : absoluteReminder(),
    );
  }

  return (
    <div className="reminder-editor">
      {deliveryMode === "local" ? (
        <div className="reminder-delivery-note" role="note">
          <div>
            <strong>Notifications are not available here</strong>
            <p>
              Reminder details stay in Markdown, but tasks stored on this device
              cannot deliver notifications.
            </p>
          </div>
          {onConnectMdbase ? (
            <button
              className="text-action"
              type="button"
              onClick={onConnectMdbase}
            >
              Connect mdbase
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="reminder-editor-heading">
        <div>
          <span className="field-label">Reminders</span>
          <p>
            {deliveryMode === "mdbase"
              ? "Notify at a fixed time or relative to this task."
              : "Save a fixed or relative reminder in this task."}
          </p>
        </div>
        <button className="text-action" type="button" onClick={addDefault}>
          <Plus aria-hidden="true" size={16} />
          Add reminder
        </button>
      </div>

      {defaultAnchor ? (
        <div className="reminder-quick-actions" aria-label="Quick reminders">
          {[
            ["5m", "-PT5M", "5 minutes before"],
            ["15m", "-PT15M", "15 minutes before"],
            ["1h", "-PT1H", "1 hour before"],
            ["1d", "-P1D", "1 day before"],
          ].map(([label, offset, description]) => (
            <button
              key={offset}
              type="button"
              aria-label={`Add ${description} ${defaultAnchor}`}
              onClick={() =>
                add(relativeReminder(defaultAnchor, offset, description))
              }
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {reminders.length ? (
        <div className="reminder-list">
          {reminders.map((reminder, index) => (
            <ReminderRow
              due={due}
              index={index}
              key={reminder.id}
              reminder={reminder}
              scheduled={scheduled}
              onChange={(next) =>
                onChange(
                  reminders.map((entry) =>
                    entry.id === reminder.id ? next : entry,
                  ),
                )
              }
              onRemove={() =>
                onChange(reminders.filter((entry) => entry.id !== reminder.id))
              }
            />
          ))}
        </div>
      ) : (
        <p className="reminder-empty">No reminders set.</p>
      )}
    </div>
  );
}

function ReminderRow({
  reminder,
  index,
  scheduled,
  due,
  onChange,
  onRemove,
}: {
  reminder: TaskReminder;
  index: number;
  scheduled?: string;
  due?: string;
  onChange(reminder: TaskReminder): void;
  onRemove(): void;
}) {
  const relativeAvailable =
    Boolean(scheduled || due) || reminder.type === "relative";

  function changeType(type: string) {
    if (type === reminder.type) return;
    onChange(
      type === "relative"
        ? relativeReminder(
            due ? "due" : "scheduled",
            "-PT15M",
            reminder.description,
            reminder.id,
          )
        : absoluteReminder(reminder.id, reminder.description),
    );
  }

  return (
    <section className="reminder-row" aria-label={`Reminder ${index + 1}`}>
      <div className="reminder-row-heading">
        <strong>Reminder {index + 1}</strong>
        <button
          className="text-action danger"
          type="button"
          aria-label={`Remove reminder ${index + 1}`}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" size={16} />
          Remove
        </button>
      </div>
      <div className="field-grid metadata-fields reminder-fields">
        <TaskNotesSelectField
          label="Type"
          options={[
            ...(relativeAvailable
              ? [{ value: "relative", label: "Relative" }]
              : []),
            { value: "absolute", label: "Fixed date and time" },
          ]}
          value={reminder.type}
          onChange={changeType}
        />
        {reminder.type === "relative" ? (
          <RelativeReminderFields
            due={due}
            reminder={reminder}
            scheduled={scheduled}
            onChange={onChange}
          />
        ) : (
          <AbsoluteReminderFields reminder={reminder} onChange={onChange} />
        )}
      </div>
      <label className="form-field reminder-description">
        <span>Description</span>
        <input
          placeholder="Optional notification text"
          value={reminder.description ?? ""}
          onChange={(event) =>
            onChange({
              ...reminder,
              description: event.target.value || undefined,
            })
          }
        />
      </label>
    </section>
  );
}

function RelativeReminderFields({
  reminder,
  scheduled,
  due,
  onChange,
}: {
  reminder: TaskReminder;
  scheduled?: string;
  due?: string;
  onChange(reminder: TaskReminder): void;
}) {
  const initial = editableReminderOffset(reminder.offset);
  const [amount, setAmount] = useState(initial.amount);
  const [unit, setUnit] = useState<ReminderOffsetUnit>(initial.unit);
  const [direction, setDirection] = useState<ReminderOffsetDirection>(
    initial.direction,
  );

  function commit(
    nextAmount = amount,
    nextUnit = unit,
    nextDirection = direction,
  ) {
    onChange({
      ...reminder,
      type: "relative",
      relatedTo: reminder.relatedTo ?? (due ? "due" : "scheduled"),
      offset: reminderOffset({
        amount: nextAmount,
        unit: nextUnit,
        direction: nextDirection,
      }),
      absoluteTime: undefined,
    });
  }

  return (
    <>
      <TaskNotesSelectField
        label="Relative to"
        options={[
          ...(due ? [{ value: "due", label: "Due" }] : []),
          ...(scheduled ? [{ value: "scheduled", label: "Scheduled" }] : []),
          ...(!due && reminder.relatedTo === "due"
            ? [{ value: "due", label: "Due (not set)" }]
            : []),
          ...(!scheduled && reminder.relatedTo === "scheduled"
            ? [{ value: "scheduled", label: "Scheduled (not set)" }]
            : []),
        ]}
        value={reminder.relatedTo ?? (due ? "due" : "scheduled")}
        onChange={(relatedTo) =>
          onChange({
            ...reminder,
            relatedTo: relatedTo as "due" | "scheduled",
          })
        }
      />
      <label className="form-field">
        <span>Amount</span>
        <input
          inputMode="numeric"
          min="0"
          type="number"
          value={amount}
          onChange={(event) => {
            const next = Math.max(0, Number(event.target.value) || 0);
            setAmount(next);
            commit(next, unit, direction);
          }}
        />
      </label>
      <TaskNotesSelectField
        label="Unit"
        options={[
          { value: "minutes", label: "Minutes" },
          { value: "hours", label: "Hours" },
          { value: "days", label: "Days" },
        ]}
        value={unit}
        onChange={(value) => {
          const next = value as ReminderOffsetUnit;
          setUnit(next);
          commit(amount, next, direction);
        }}
      />
      <TaskNotesSelectField
        label="Direction"
        options={[
          { value: "before", label: "Before" },
          { value: "after", label: "After" },
        ]}
        value={direction}
        onChange={(value) => {
          const next = value as ReminderOffsetDirection;
          setDirection(next);
          commit(amount, unit, next);
        }}
      />
    </>
  );
}

function AbsoluteReminderFields({
  reminder,
  onChange,
}: {
  reminder: TaskReminder;
  onChange(reminder: TaskReminder): void;
}) {
  const initial = localDateTimeParts(reminder.absoluteTime);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);

  function commit(nextDate: string, nextTime: string) {
    if (!nextDate || !nextTime) return;
    onChange({
      ...reminder,
      type: "absolute",
      absoluteTime: new Date(`${nextDate}T${nextTime}`).toISOString(),
      relatedTo: undefined,
      offset: undefined,
    });
  }

  return (
    <>
      <div className="form-field tasknotes-control-field">
        <span>Date</span>
        <TaskNotesDatePicker
          ariaLabel="Reminder date"
          value={date}
          onChange={(value) => {
            const next = value ?? date;
            setDate(next);
            commit(next, time);
          }}
        />
      </div>
      <div className="form-field tasknotes-control-field">
        <span>Time</span>
        <TaskNotesTimePicker
          ariaLabel="Reminder time"
          value={time}
          onChange={(value) => {
            const next = value ?? time;
            setTime(next);
            commit(date, next);
          }}
        />
      </div>
    </>
  );
}

function relativeReminder(
  relatedTo: "due" | "scheduled",
  offset: string,
  description?: string,
  id: string = crypto.randomUUID(),
): TaskReminder {
  return {
    id,
    type: "relative",
    relatedTo,
    offset,
    ...(description ? { description } : {}),
  };
}

function absoluteReminder(
  id: string = crypto.randomUUID(),
  description?: string,
): TaskReminder {
  return {
    id,
    type: "absolute",
    absoluteTime: nextWholeHour().toISOString(),
    ...(description ? { description } : {}),
  };
}

function nextWholeHour(now = new Date()): Date {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

function localDateTimeParts(value?: string): { date: string; time: string } {
  const instant = value ? new Date(value) : nextWholeHour();
  const local = new Date(
    instant.valueOf() - instant.getTimezoneOffset() * 60_000,
  );
  const serialized = local.toISOString();
  return { date: serialized.slice(0, 10), time: serialized.slice(11, 16) };
}
