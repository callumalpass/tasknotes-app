import { useLingui, Trans } from "@lingui/react/macro";
import { t as translate } from "@lingui/core/macro";
import { appLocale } from "../i18n/app";
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
  onChange,
}: {
  reminders: TaskReminder[];
  scheduled?: string;
  due?: string;
  deliveryMode?: "mdbase" | "local";
  onChange(reminders: TaskReminder[]): void;
}) {
  const { t } = useLingui();
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
            <strong>
              <Trans>Notifications are not available here</Trans>
            </strong>
            <p>
              <Trans>
                Reminder details stay in Markdown, but tasks stored on this
                device cannot deliver notifications.
              </Trans>
            </p>
          </div>
        </div>
      ) : null}
      <div className="reminder-editor-heading">
        <div>
          <span className="field-label">
            <Trans>Reminders</Trans>
          </span>
          <p>
            {deliveryMode === "mdbase"
              ? t({
                  message: "Notify at a fixed time or relative to this task.",
                })
              : t({
                  message: "Save a fixed or relative reminder in this task.",
                })}
          </p>
        </div>
        <button className="text-action" type="button" onClick={addDefault}>
          <Plus aria-hidden="true" size={16} />
          <Trans>Add reminder</Trans>
        </button>
      </div>

      {defaultAnchor ? (
        <div
          className="reminder-quick-actions"
          aria-label={t({ message: "Quick reminders" })}
        >
          {[
            ["5m", "-PT5M", "5 minutes before"],
            ["15m", "-PT15M", "15 minutes before"],
            ["1h", "-PT1H", "1 hour before"],
            ["1d", "-P1D", "1 day before"],
          ].map(([label, offset, description]) => (
            <button
              key={offset}
              type="button"
              aria-label={quickReminderLabel(offset, defaultAnchor)}
              onClick={() =>
                add(relativeReminder(defaultAnchor, offset, description))
              }
            >
              {quickReminderDuration(label)}
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
        <p className="reminder-empty">
          <Trans>No reminders set.</Trans>
        </p>
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
  const { t } = useLingui();
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
    <section className="reminder-row" aria-label={t`Reminder ${index + 1}`}>
      <div className="reminder-row-heading">
        <strong>
          <Trans>Reminder {index + 1}</Trans>
        </strong>
        <button
          className="text-action danger"
          type="button"
          aria-label={t`Remove reminder ${index + 1}`}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" size={16} />
          <Trans>Remove</Trans>
        </button>
      </div>
      <div className="field-grid metadata-fields reminder-fields">
        <TaskNotesSelectField
          label={t({ message: "Type" })}
          options={[
            ...(relativeAvailable
              ? [{ value: "relative", label: t({ message: "Relative" }) }]
              : []),
            { value: "absolute", label: t({ message: "Fixed date and time" }) },
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
        <span>
          <Trans>Description</Trans>
        </span>
        <input
          placeholder={t({ message: "Optional notification text" })}
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
  const { t } = useLingui();
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
    onChange(
      relativeReminder(
        reminder.relatedTo ?? (due ? "due" : "scheduled"),
        reminderOffset({
          amount: nextAmount,
          unit: nextUnit,
          direction: nextDirection,
        }),
        reminder.description,
        reminder.id,
      ),
    );
  }

  return (
    <>
      <TaskNotesSelectField
        label={t({ message: "Relative to" })}
        options={[
          ...(due ? [{ value: "due", label: t({ message: "Due" }) }] : []),
          ...(scheduled
            ? [{ value: "scheduled", label: t({ message: "Scheduled" }) }]
            : []),
          ...(!due && reminder.relatedTo === "due"
            ? [{ value: "due", label: t({ message: "Due (not set)" }) }]
            : []),
          ...(!scheduled && reminder.relatedTo === "scheduled"
            ? [
                {
                  value: "scheduled",
                  label: t({ message: "Scheduled (not set)" }),
                },
              ]
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
        <span>
          <Trans>Amount</Trans>
        </span>
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
        label={t({ message: "Unit" })}
        options={[
          { value: "minutes", label: t({ message: "Minutes" }) },
          { value: "hours", label: t({ message: "Hours" }) },
          { value: "days", label: t({ message: "Days" }) },
        ]}
        value={unit}
        onChange={(value) => {
          const next = value as ReminderOffsetUnit;
          setUnit(next);
          commit(amount, next, direction);
        }}
      />
      <TaskNotesSelectField
        label={t({ message: "Direction" })}
        options={[
          { value: "before", label: t({ message: "Before" }) },
          { value: "after", label: t({ message: "After" }) },
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
  const { t } = useLingui();
  const initial = localDateTimeParts(reminder.absoluteTime);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);

  function commit(nextDate: string, nextTime: string) {
    if (!nextDate || !nextTime) return;
    onChange({
      id: reminder.id,
      type: "absolute",
      absoluteTime: new Date(`${nextDate}T${nextTime}`).toISOString(),
      ...(reminder.description ? { description: reminder.description } : {}),
    });
  }

  return (
    <>
      <div className="form-field tasknotes-control-field">
        <span>
          <Trans>Date</Trans>
        </span>
        <TaskNotesDatePicker
          ariaLabel={t({ message: "Reminder date" })}
          value={date}
          onChange={(value) => {
            const next = value ?? date;
            setDate(next);
            commit(next, time);
          }}
        />
      </div>
      <div className="form-field tasknotes-control-field">
        <span>
          <Trans>Time</Trans>
        </span>
        <TaskNotesTimePicker
          ariaLabel={t({ message: "Reminder time" })}
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

function quickReminderLabel(
  offset: string,
  anchor: "due" | "scheduled",
): string {
  switch (offset) {
    case "-PT5M":
      return anchor === "due"
        ? translate`Add 5 minutes before due`
        : translate`Add 5 minutes before scheduled`;
    case "-PT15M":
      return anchor === "due"
        ? translate`Add 15 minutes before due`
        : translate`Add 15 minutes before scheduled`;
    case "-PT1H":
      return anchor === "due"
        ? translate`Add 1 hour before due`
        : translate`Add 1 hour before scheduled`;
    default:
      return anchor === "due"
        ? translate`Add 1 day before due`
        : translate`Add 1 day before scheduled`;
  }
}

function quickReminderDuration(label: string): string {
  const amount = Number.parseInt(label, 10);
  const unit = label.endsWith("m")
    ? "minute"
    : label.endsWith("h")
      ? "hour"
      : "day";
  return new Intl.NumberFormat(appLocale(), {
    style: "unit",
    unit,
    unitDisplay: "narrow",
  }).format(amount);
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
