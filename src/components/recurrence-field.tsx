import { generateRecurringInstances } from "@tasknotes/model/recurrence";
import { useMemo, useState } from "react";

import {
  TaskNotesDateField,
  TaskNotesDateTimeField,
  TaskNotesSelect,
  TaskNotesSelectField,
} from "./tasknotes-controls";
import {
  buildRecurrenceRule,
  monthName,
  parseRecurrenceRule,
  recurrenceDtstartValue,
  recurrencePreset,
  recurrenceRuleForPreset,
  recurrenceRuleSummary,
  recurrenceStartStorageValue,
  weekdayName,
  type RecurrenceFrequency,
  type RecurrencePattern,
  type RecurrenceRuleDraft,
  type RecurrenceWeekday,
} from "../domain/recurrence-rule";

const WEEKDAYS: Array<{
  value: RecurrenceWeekday;
  short: string;
}> = [
  { value: "MO", short: "M" },
  { value: "TU", short: "T" },
  { value: "WE", short: "W" },
  { value: "TH", short: "T" },
  { value: "FR", short: "F" },
  { value: "SA", short: "S" },
  { value: "SU", short: "S" },
];

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  label: monthName(index + 1),
}));

const MONTH_DAYS = [
  ...Array.from({ length: 31 }, (_, index) => ({
    value: String(index + 1),
    label: ordinal(index + 1),
  })),
  { value: "-1", label: "Last day" },
];

const POSITIONS = [
  { value: "1", label: "First" },
  { value: "2", label: "Second" },
  { value: "3", label: "Third" },
  { value: "4", label: "Fourth" },
  { value: "-1", label: "Last" },
];

export function RecurrenceField({
  value,
  scheduled,
  anchor,
  onChange,
  onAnchorChange,
}: {
  value?: string;
  scheduled?: string;
  anchor?: "scheduled" | "completion";
  onChange(value?: string): void;
  onAnchorChange(value: "scheduled" | "completion"): void;
}) {
  const rule = useMemo(() => parseRecurrenceRule(value), [value]);
  const visualRule = useMemo(
    () => ({
      ...rule,
      dtstart:
        rule.dtstart ??
        recurrenceDtstartValue(scheduled) ??
        recurrenceDtstartValue(today()),
    }),
    [rule, scheduled],
  );
  const [expanded, setExpanded] = useState(() =>
    Boolean(rule.unsupported.length || rule.invalid.length),
  );
  const [advanced, setAdvanced] = useState(() =>
    Boolean(rule.unsupported.length || rule.invalid.length),
  );
  const preset = recurrencePreset(value);
  const preview = useMemo(
    () =>
      recurrencePreview(buildRecurrenceRule(visualRule), scheduled, visualRule),
    [scheduled, visualRule],
  );

  function update(patch: Partial<RecurrenceRuleDraft>) {
    onChange(buildRecurrenceRule({ ...visualRule, ...patch }));
  }

  function changeFrequency(frequency: RecurrenceFrequency) {
    const clean = parseRecurrenceRule(
      recurrenceRuleForPreset(frequency.toLocaleLowerCase(), { scheduled }),
    );
    const keepsWeekdays =
      (rule.frequency === "DAILY" || rule.frequency === "WEEKLY") &&
      (frequency === "DAILY" || frequency === "WEEKLY");
    const keepsCalendarPattern =
      (rule.frequency === "MONTHLY" || rule.frequency === "YEARLY") &&
      (frequency === "MONTHLY" || frequency === "YEARLY");
    update({
      frequency,
      weekdays:
        keepsWeekdays || keepsCalendarPattern ? rule.weekdays : clean.weekdays,
      pattern: keepsCalendarPattern ? rule.pattern : clean.pattern,
      monthDay: keepsCalendarPattern ? rule.monthDay : clean.monthDay,
      position: keepsCalendarPattern ? rule.position : clean.position,
      month: keepsCalendarPattern ? rule.month : clean.month,
    });
  }

  return (
    <div className="repeat-fields recurrence-field">
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
            ...(preset === "advanced"
              ? [{ value: "advanced", label: "Advanced rule" }]
              : []),
          ]}
          value={preset}
          onChange={(next) => {
            if (next === "advanced") {
              setExpanded(true);
              setAdvanced(true);
              return;
            }
            const recurrence = recurrenceRuleForPreset(next, { scheduled });
            onChange(recurrence);
            setAdvanced(false);
            setExpanded(Boolean(recurrence));
          }}
        />
        {value ? (
          <button
            aria-expanded={expanded}
            className="text-action"
            type="button"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Done" : "Edit pattern"}
          </button>
        ) : null}
      </div>

      {value ? (
        <div className="recurrence-overview" aria-live="polite">
          <strong>{recurrenceRuleSummary(rule)}</strong>
          {preview.length ? (
            <span>Next: {preview.join(" · ")}</span>
          ) : rule.invalid.length ? (
            <span>Correct the rule before it can be scheduled.</span>
          ) : (
            <span>No upcoming dates in this pattern.</span>
          )}
        </div>
      ) : null}

      {expanded && value ? (
        advanced || rule.unsupported.length || rule.invalid.length ? (
          <AdvancedRuleEditor
            value={value}
            onApply={onChange}
            onVisualEditor={() => setAdvanced(false)}
          />
        ) : (
          <div className="recurrence-builder">
            <div className="recurrence-start">
              <TaskNotesDateTimeField
                label="Pattern starts"
                value={recurrenceStartStorageValue(visualRule.dtstart)}
                onChange={(start) =>
                  update({ dtstart: recurrenceDtstartValue(start) })
                }
              />
              <p>
                This anchors the pattern. Scheduled remains the next date you
                plan to do the task.
              </p>
            </div>

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
                  { value: "DAILY", label: unitLabel("DAILY", rule.interval) },
                  {
                    value: "WEEKLY",
                    label: unitLabel("WEEKLY", rule.interval),
                  },
                  {
                    value: "MONTHLY",
                    label: unitLabel("MONTHLY", rule.interval),
                  },
                  {
                    value: "YEARLY",
                    label: unitLabel("YEARLY", rule.interval),
                  },
                ]}
                value={rule.frequency}
                onChange={(frequency) =>
                  changeFrequency(frequency as RecurrenceFrequency)
                }
              />
            </div>

            {rule.frequency === "DAILY" || rule.frequency === "WEEKLY" ? (
              <WeekdayField
                values={rule.weekdays}
                onChange={(weekdays) => update({ weekdays })}
              />
            ) : null}

            {rule.frequency === "MONTHLY" || rule.frequency === "YEARLY" ? (
              <CalendarPatternField
                frequency={rule.frequency}
                month={rule.month}
                monthDay={rule.monthDay}
                pattern={rule.pattern}
                position={rule.position}
                weekday={rule.weekdays[0] ?? "MO"}
                onChange={update}
              />
            ) : null}

            <div className="recurrence-end">
              <TaskNotesSelectField
                label="Ends"
                options={[
                  { value: "never", label: "Never" },
                  { value: "until", label: "On a date" },
                  { value: "count", label: "After a number of times" },
                ]}
                value={rule.end}
                onChange={(end) =>
                  update({
                    end: end as RecurrenceRuleDraft["end"],
                    until: rule.until ?? today(),
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
                <label className="form-field recurrence-count">
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

            <TaskNotesSelectField
              className="recurrence-anchor"
              label="Repeat from"
              options={[
                {
                  value: "scheduled",
                  label: "Fixed schedule",
                  description: "Keep dates anchored to the pattern.",
                },
                {
                  value: "completion",
                  label: "Completion date",
                  description: "Start the next interval when this is finished.",
                },
              ]}
              value={anchor ?? "scheduled"}
              onChange={(next) =>
                onAnchorChange(next as "scheduled" | "completion")
              }
            />

            <button
              className="recurrence-advanced-action text-action"
              type="button"
              onClick={() => setAdvanced(true)}
            >
              Edit RRULE
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}

function WeekdayField({
  values,
  onChange,
}: {
  values: RecurrenceWeekday[];
  onChange(value: RecurrenceWeekday[]): void;
}) {
  return (
    <fieldset className="recurrence-weekdays">
      <legend>On</legend>
      <div>
        {WEEKDAYS.map(({ value, short }) => (
          <button
            aria-label={weekdayName(value)}
            aria-pressed={values.includes(value)}
            className={values.includes(value) ? "is-selected" : undefined}
            key={value}
            type="button"
            onClick={() =>
              onChange(
                values.includes(value)
                  ? values.filter((entry) => entry !== value)
                  : [...values, value],
              )
            }
          >
            {short}
          </button>
        ))}
      </div>
      {!values.length ? <small>The pattern start day is used.</small> : null}
    </fieldset>
  );
}

function CalendarPatternField({
  frequency,
  pattern,
  monthDay,
  position,
  weekday,
  month,
  onChange,
}: {
  frequency: "MONTHLY" | "YEARLY";
  pattern: RecurrencePattern;
  monthDay: number;
  position: number;
  weekday: RecurrenceWeekday;
  month: number;
  onChange(patch: Partial<RecurrenceRuleDraft>): void;
}) {
  return (
    <div className="recurrence-calendar-pattern">
      {frequency === "YEARLY" ? (
        <TaskNotesSelectField
          label="Month"
          options={MONTHS}
          value={String(month)}
          onChange={(next) => onChange({ month: Number(next) })}
        />
      ) : null}
      <TaskNotesSelectField
        label={frequency === "MONTHLY" ? "Each month" : "On"}
        options={[
          { value: "date", label: "A calendar date" },
          { value: "weekday", label: "A weekday position" },
        ]}
        value={pattern}
        onChange={(next) => onChange({ pattern: next as RecurrencePattern })}
      />
      {pattern === "date" ? (
        <TaskNotesSelectField
          label="Date"
          options={MONTH_DAYS}
          value={String(monthDay)}
          onChange={(next) => onChange({ monthDay: Number(next) })}
        />
      ) : (
        <>
          <TaskNotesSelectField
            label="Which"
            options={POSITIONS}
            value={String(position)}
            onChange={(next) => onChange({ position: Number(next) })}
          />
          <TaskNotesSelectField
            label="Weekday"
            options={WEEKDAYS.map(({ value }) => ({
              value,
              label: weekdayName(value),
            }))}
            value={weekday}
            onChange={(next) =>
              onChange({ weekdays: [next as RecurrenceWeekday] })
            }
          />
        </>
      )}
    </div>
  );
}

function AdvancedRuleEditor({
  value,
  onApply,
  onVisualEditor,
}: {
  value: string;
  onApply(value: string): void;
  onVisualEditor(): void;
}) {
  const [raw, setRaw] = useState(value);
  const parsed = useMemo(() => parseRecurrenceRule(raw), [raw]);
  const changed = raw.trim() !== value.trim();

  return (
    <div className="custom-rule-warning">
      <div>
        <strong>Advanced recurrence</strong>
        <p>
          The rule is kept exactly as written. Apply only after it is valid.
        </p>
      </div>
      <label className="form-field custom-rule-field">
        <span>Recurrence rule</span>
        <textarea
          aria-invalid={Boolean(parsed.invalid.length)}
          rows={3}
          spellCheck={false}
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
        />
      </label>
      {parsed.invalid.length ? (
        <p className="recurrence-rule-error" role="alert">
          {parsed.invalid[0]}
        </p>
      ) : parsed.unsupported.length ? (
        <p>
          Visual editing is unavailable because this rule uses{" "}
          {parsed.unsupported.join(", ")}.
        </p>
      ) : (
        <p>This rule can also be edited with the visual controls.</p>
      )}
      <div className="recurrence-rule-actions">
        {!parsed.invalid.length && !parsed.unsupported.length ? (
          <button
            className="text-action"
            type="button"
            onClick={onVisualEditor}
          >
            Use visual editor
          </button>
        ) : null}
        <button
          disabled={!changed || Boolean(parsed.invalid.length)}
          type="button"
          onClick={() => onApply(raw.trim())}
        >
          Apply rule
        </button>
      </div>
    </div>
  );
}

function recurrencePreview(
  value: string | undefined,
  scheduled: string | undefined,
  rule: RecurrenceRuleDraft,
): string[] {
  if (!value || rule.invalid.length || rule.unsupported.length || !rule.dtstart)
    return [];
  const start = startOfUtcDay(new Date());
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + 5);
  return generateRecurringInstances(
    {
      title: "Task",
      recurrence: value,
      scheduled,
      dateCreated: recurrenceStartStorageValue(rule.dtstart),
    },
    start,
    end,
  )
    .slice(0, 3)
    .map(formatPreviewDate);
}

function formatPreviewDate(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(value);
}

function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function unitLabel(frequency: RecurrenceFrequency, interval: number): string {
  const unit = {
    DAILY: "day",
    WEEKLY: "week",
    MONTHLY: "month",
    YEARLY: "year",
  }[frequency];
  return Math.max(1, Math.round(interval)) === 1 ? unit : `${unit}s`;
}

function ordinal(value: number): string {
  const remainder = value % 100;
  const suffix =
    remainder >= 11 && remainder <= 13
      ? "th"
      : ({ 1: "st", 2: "nd", 3: "rd" }[value % 10] ?? "th");
  return `${value}${suffix}`;
}

function today(): string {
  const value = new Date();
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}
