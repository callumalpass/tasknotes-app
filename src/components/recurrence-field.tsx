import { t as translate } from "@lingui/core/macro";
import {
  monthName,
  recurrenceRuleSummary,
  weekdayName,
} from "../i18n/presentation";
import { t, plural } from "@lingui/core/macro";
import { appLocale } from "../i18n/app";
import { ordinal as localizedOrdinal } from "../i18n/presentation";
import { useLingui, Trans } from "@lingui/react/macro";
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
  parseRecurrenceRule,
  recurrenceDtstartValue,
  recurrencePreset,
  recurrenceRuleForPreset,
  recurrenceStartStorageValue,
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
  get label() {
    return monthName(index + 1);
  },
}));

const MONTH_DAYS = [
  ...Array.from({ length: 31 }, (_, index) => ({
    value: String(index + 1),
    get label() {
      return ordinal(index + 1);
    },
  })),
  {
    value: "-1",
    get label() {
      return t({ message: "Last day" });
    },
  },
];

const POSITIONS = [
  {
    value: "1",
    get label() {
      return t({ message: "First" });
    },
  },
  {
    value: "2",
    get label() {
      return t({ message: "Second" });
    },
  },
  {
    value: "3",
    get label() {
      return t({ message: "Third" });
    },
  },
  {
    value: "4",
    get label() {
      return t({ message: "Fourth" });
    },
  },
  {
    value: "-1",
    get label() {
      return t({ message: "Last" });
    },
  },
];

export function RecurrenceField({
  value,
  scheduled,
  due,
  anchor,
  onChange,
  onAnchorChange,
}: {
  value?: string;
  scheduled?: string;
  due?: string;
  anchor?: "scheduled" | "completion";
  onChange(value?: string): void;
  onAnchorChange(value: "scheduled" | "completion"): void;
}) {
  const referenceDate = scheduled ?? due;
  const rule = useMemo(
    () => parseRecurrenceRule(value, referenceDate ?? today()),
    [value, referenceDate],
  );
  const visualRule = useMemo(
    () => ({
      ...rule,
      dtstart:
        rule.dtstart ??
        recurrenceDtstartValue(referenceDate) ??
        recurrenceDtstartValue(today()),
    }),
    [rule, referenceDate],
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
      recurrenceRuleForPreset(frequency.toLocaleLowerCase(), {
        scheduled: referenceDate,
      }),
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
          label={t({ message: "Repeat" })}
          options={[
            { value: "never", label: t({ message: "Never" }) },
            { value: "daily", label: t({ message: "Daily" }) },
            { value: "weekdays", label: t({ message: "Weekdays" }) },
            { value: "weekly", label: t({ message: "Weekly" }) },
            { value: "monthly", label: t({ message: "Monthly" }) },
            { value: "yearly", label: t({ message: "Yearly" }) },
            ...(preset === "advanced"
              ? [{ value: "advanced", label: t({ message: "Advanced rule" }) }]
              : []),
          ]}
          value={preset}
          onChange={(next) => {
            if (next === "advanced") {
              setExpanded(true);
              setAdvanced(true);
              return;
            }
            const recurrence = recurrenceRuleForPreset(next, {
              scheduled: referenceDate,
            });
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
            {expanded ? t({ message: "Done" }) : t({ message: "Edit pattern" })}
          </button>
        ) : null}
      </div>

      {value ? (
        <div className="recurrence-overview" aria-live="polite">
          <strong>{recurrenceRuleSummary(rule)}</strong>
          {preview.length ? (
            <span>
              <Trans>Next: {preview.join(" · ")}</Trans>
            </span>
          ) : rule.invalid.length ? (
            <span>
              <Trans>Correct the rule before it can be scheduled.</Trans>
            </span>
          ) : (
            <span>
              <Trans>No upcoming dates in this pattern.</Trans>
            </span>
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
                label={t({ message: "Pattern starts" })}
                value={recurrenceStartStorageValue(visualRule.dtstart)}
                onChange={(start) =>
                  update({ dtstart: recurrenceDtstartValue(start) })
                }
              />
              <p>
                <Trans>
                  This anchors the pattern. Scheduled remains the next date you
                  plan to do the task.
                </Trans>
              </p>
            </div>

            <div className="recurrence-interval">
              <span>
                <Trans>Every</Trans>
              </span>
              <input
                aria-label={t({ message: "Repeat interval" })}
                inputMode="numeric"
                min="1"
                type="number"
                value={rule.interval}
                onChange={(event) =>
                  update({ interval: Number(event.target.value) || 1 })
                }
              />
              <TaskNotesSelect
                ariaLabel={t({ message: "Repeat frequency" })}
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
                label={t({ message: "Ends" })}
                options={[
                  { value: "never", label: t({ message: "Never" }) },
                  { value: "until", label: t({ message: "On a date" }) },
                  {
                    value: "count",
                    label: t({ message: "After a number of times" }),
                  },
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
                  label={t({ message: "Last date" })}
                  value={rule.until}
                  onChange={(until) => update({ until })}
                />
              ) : rule.end === "count" ? (
                <label className="form-field recurrence-count">
                  <span>
                    <Trans>Occurrences</Trans>
                  </span>
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
              label={t({ message: "Repeat from" })}
              options={[
                {
                  value: "scheduled",
                  label: translate({ message: "Planned dates" }),
                  description: translate({
                    message: "Keep the planned dates, even if you finish late.",
                  }),
                },
                {
                  value: "completion",
                  label: translate({ message: "Completion date" }),
                  description: translate({
                    message:
                      "Count the interval from when you finish the task.",
                  }),
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
              <Trans>Advanced rule</Trans>
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
      <legend>
        <Trans>On</Trans>
      </legend>
      <div>
        {WEEKDAYS.map(({ value }) => (
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
            {weekdayName(value, "narrow")}
          </button>
        ))}
      </div>
      {!values.length ? (
        <small>
          <Trans>The pattern start day is used.</Trans>
        </small>
      ) : null}
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
  const { t } = useLingui();
  return (
    <div className="recurrence-calendar-pattern">
      {frequency === "YEARLY" ? (
        <TaskNotesSelectField
          label={t({ message: "Month" })}
          options={MONTHS}
          value={String(month)}
          onChange={(next) => onChange({ month: Number(next) })}
        />
      ) : null}
      <TaskNotesSelectField
        label={
          frequency === "MONTHLY"
            ? t({ message: "Each month" })
            : t({ message: "On" })
        }
        options={[
          { value: "date", label: t({ message: "A calendar date" }) },
          { value: "weekday", label: t({ message: "A weekday position" }) },
        ]}
        value={pattern}
        onChange={(next) => onChange({ pattern: next as RecurrencePattern })}
      />
      {pattern === "date" ? (
        <TaskNotesSelectField
          label={t({ message: "Date" })}
          options={MONTH_DAYS}
          value={String(monthDay)}
          onChange={(next) => onChange({ monthDay: Number(next) })}
        />
      ) : (
        <>
          <TaskNotesSelectField
            label={t({ message: "Which" })}
            options={POSITIONS}
            value={String(position)}
            onChange={(next) => onChange({ position: Number(next) })}
          />
          <TaskNotesSelectField
            label={t({ message: "Weekday" })}
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
        <strong>
          <Trans>Advanced recurrence</Trans>
        </strong>
        <p>
          <Trans>
            The rule is kept exactly as written. Apply only after it is valid.
          </Trans>
        </p>
      </div>
      <label className="form-field custom-rule-field">
        <span>
          <Trans>Recurrence rule</Trans>
        </span>
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
          <Trans>
            Visual editing is unavailable because this rule uses{" "}
            {parsed.unsupported.join(", ")}.
          </Trans>
        </p>
      ) : (
        <p>
          <Trans>This rule can also be edited with the visual controls.</Trans>
        </p>
      )}
      <div className="recurrence-rule-actions">
        {!parsed.invalid.length && !parsed.unsupported.length ? (
          <button
            className="text-action"
            type="button"
            onClick={onVisualEditor}
          >
            <Trans>Use visual editor</Trans>
          </button>
        ) : null}
        <button
          disabled={!changed || Boolean(parsed.invalid.length)}
          type="button"
          onClick={() => onApply(raw.trim())}
        >
          <Trans>Apply rule</Trans>
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
  return new Intl.DateTimeFormat(appLocale(), {
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
  const count = Math.max(1, Math.round(interval));
  switch (frequency) {
    case "DAILY":
      return plural(count, { one: "day", other: "days" });
    case "WEEKLY":
      return plural(count, { one: "week", other: "weeks" });
    case "MONTHLY":
      return plural(count, { one: "month", other: "months" });
    case "YEARLY":
      return plural(count, { one: "year", other: "years" });
  }
}

function ordinal(value: number): string {
  return localizedOrdinal(value);
}

function today(): string {
  const value = new Date();
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}
