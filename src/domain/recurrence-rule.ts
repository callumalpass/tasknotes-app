export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type RecurrenceEnd = "never" | "until" | "count";
export type RecurrencePattern = "date" | "weekday";
export type RecurrenceWeekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export interface RecurrenceRuleDraft {
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays: RecurrenceWeekday[];
  pattern: RecurrencePattern;
  monthDay: number;
  position: number;
  month: number;
  end: RecurrenceEnd;
  until?: string;
  count?: number;
  dtstart?: string;
  weekStart?: RecurrenceWeekday;
  unsupported: string[];
  invalid: string[];
}

export interface RecurrencePresetOptions {
  scheduled?: string;
  now?: Date;
}

const WEEKDAYS: RecurrenceWeekday[] = [
  "MO",
  "TU",
  "WE",
  "TH",
  "FR",
  "SA",
  "SU",
];
const SUPPORTED_FIELDS = new Set([
  "FREQ",
  "INTERVAL",
  "BYDAY",
  "BYMONTHDAY",
  "BYMONTH",
  "BYSETPOS",
  "COUNT",
  "UNTIL",
  "WKST",
]);

export function parseRecurrenceRule(value?: string): RecurrenceRuleDraft {
  const normalized = normalizeRule(value);
  const segments = normalized ? normalized.split(";").filter(Boolean) : [];
  let dtstart: string | undefined;
  const fields = new Map<string, string>();
  const unsupported = new Set<string>();
  const invalid: string[] = [];

  for (const segment of segments) {
    if (segment.startsWith("DTSTART:")) {
      if (dtstart !== undefined)
        invalid.push("DTSTART appears more than once.");
      dtstart = segment.slice("DTSTART:".length).trim().toUpperCase();
      continue;
    }
    const separator = segment.indexOf("=");
    if (separator <= 0 || separator === segment.length - 1) {
      invalid.push(`“${segment}” is not a valid RRULE part.`);
      continue;
    }
    const key = segment.slice(0, separator).trim().toUpperCase();
    const fieldValue = segment
      .slice(separator + 1)
      .trim()
      .toUpperCase();
    if (fields.has(key)) invalid.push(`${key} appears more than once.`);
    fields.set(key, fieldValue);
    if (!SUPPORTED_FIELDS.has(key)) unsupported.add(key);
  }

  if (dtstart && !isDtstart(dtstart))
    invalid.push("DTSTART must be a date or UTC date and time.");

  const frequencyValue = fields.get("FREQ");
  const frequency: RecurrenceFrequency = isFrequency(frequencyValue)
    ? frequencyValue
    : "WEEKLY";
  if (!fields.has("FREQ")) invalid.push("A frequency is required.");
  else if (!isFrequency(fields.get("FREQ")))
    invalid.push("The recurrence frequency is not supported.");

  const interval = positiveInteger(fields.get("INTERVAL")) ?? 1;
  if (fields.has("INTERVAL") && !positiveInteger(fields.get("INTERVAL")))
    invalid.push("The interval must be a positive whole number.");

  const byDay = parseByDay(fields.get("BYDAY"));
  const monthDays = integerList(fields.get("BYMONTHDAY"));
  const months = integerList(fields.get("BYMONTH"));
  const bySetPos = integerList(fields.get("BYSETPOS"));
  const weekStart = weekday(fields.get("WKST"));

  if (fields.has("BYDAY") && !byDay.valid) unsupported.add("BYDAY");
  if (
    fields.has("BYMONTHDAY") &&
    (!monthDays.valid ||
      monthDays.values.length !== 1 ||
      !validMonthDay(monthDays.values[0]))
  )
    unsupported.add("BYMONTHDAY");
  if (
    fields.has("BYMONTH") &&
    (!months.valid ||
      months.values.length !== 1 ||
      !within(months.values[0], 1, 12))
  )
    unsupported.add("BYMONTH");
  if (
    fields.has("BYSETPOS") &&
    (!bySetPos.valid ||
      bySetPos.values.length !== 1 ||
      !validPosition(bySetPos.values[0]))
  )
    unsupported.add("BYSETPOS");
  if (fields.has("WKST") && !weekStart) unsupported.add("WKST");

  let weekdays: RecurrenceWeekday[] = [];
  let position = 1;
  let pattern: RecurrencePattern = monthDays.values.length ? "date" : "weekday";

  if (frequency === "DAILY" || frequency === "WEEKLY") {
    if (byDay.positioned.length) unsupported.add("BYDAY");
    weekdays = orderedWeekdays(byDay.plain);
    if (fields.has("BYMONTHDAY")) unsupported.add("BYMONTHDAY");
    if (fields.has("BYMONTH")) unsupported.add("BYMONTH");
    if (fields.has("BYSETPOS")) unsupported.add("BYSETPOS");
  } else {
    if (byDay.plain.length > 1 || byDay.positioned.length > 1)
      unsupported.add("BYDAY");
    if (byDay.plain.length && byDay.positioned.length) unsupported.add("BYDAY");
    if (
      monthDays.values.length &&
      (byDay.plain.length || byDay.positioned.length)
    )
      unsupported.add("BYDAY");

    if (byDay.positioned.length === 1) {
      weekdays = [byDay.positioned[0].weekday];
      position = byDay.positioned[0].position;
      pattern = "weekday";
      if (fields.has("BYSETPOS")) unsupported.add("BYSETPOS");
    } else if (byDay.plain.length === 1 && bySetPos.values.length === 1) {
      weekdays = [byDay.plain[0]];
      position = bySetPos.values[0];
      pattern = "weekday";
    } else if (byDay.plain.length) {
      unsupported.add("BYDAY");
    }

    if (frequency === "MONTHLY" && fields.has("BYMONTH"))
      unsupported.add("BYMONTH");
    if (
      frequency === "YEARLY" &&
      (fields.has("BYMONTHDAY") || fields.has("BYDAY")) &&
      !fields.has("BYMONTH")
    )
      unsupported.add("BYMONTH");
  }

  const count = positiveInteger(fields.get("COUNT"));
  const until = storageUntil(fields.get("UNTIL"));
  if (fields.has("COUNT") && !count)
    invalid.push("The occurrence count must be a positive whole number.");
  if (fields.has("UNTIL") && !until) invalid.push("The end date is not valid.");
  if (count && until)
    invalid.push("Use either an occurrence count or an end date, not both.");

  return {
    frequency,
    interval,
    weekdays,
    pattern,
    monthDay: monthDays.values[0] ?? startDateParts(dtstart).day,
    position,
    month: months.values[0] ?? startDateParts(dtstart).month,
    end: count ? "count" : until ? "until" : "never",
    ...(until ? { until } : {}),
    ...(count ? { count } : {}),
    ...(dtstart ? { dtstart } : {}),
    ...(weekStart ? { weekStart } : {}),
    unsupported: [...unsupported],
    invalid,
  };
}

export function buildRecurrenceRule(draft: RecurrenceRuleDraft): string {
  const fields = [
    draft.dtstart ? `DTSTART:${draft.dtstart}` : "",
    `FREQ=${draft.frequency}`,
    `INTERVAL=${positiveInteger(String(draft.interval)) ?? 1}`,
  ];

  if (
    (draft.frequency === "DAILY" || draft.frequency === "WEEKLY") &&
    draft.weekdays.length
  )
    fields.push(`BYDAY=${orderedWeekdays(draft.weekdays).join(",")}`);

  if (
    (draft.frequency === "MONTHLY" || draft.frequency === "YEARLY") &&
    draft.pattern === "date"
  )
    fields.push(
      `BYMONTHDAY=${validMonthDay(draft.monthDay) ? draft.monthDay : 1}`,
    );

  if (draft.frequency === "YEARLY")
    fields.push(`BYMONTH=${within(draft.month, 1, 12) ? draft.month : 1}`);

  if (
    (draft.frequency === "MONTHLY" || draft.frequency === "YEARLY") &&
    draft.pattern === "weekday"
  ) {
    const day = draft.weekdays[0] ?? "MO";
    const position = validPosition(draft.position) ? draft.position : 1;
    fields.push(`BYDAY=${position}${day}`);
  }

  if (draft.weekStart) fields.push(`WKST=${draft.weekStart}`);
  if (draft.end === "until" && draft.until)
    fields.push(`UNTIL=${draft.until.replaceAll("-", "")}T235959Z`);
  if (draft.end === "count" && draft.count)
    fields.push(`COUNT=${positiveInteger(String(draft.count)) ?? 1}`);
  return fields.filter(Boolean).join(";");
}

export function recurrenceRuleForPreset(
  preset: string,
  options: RecurrencePresetOptions = {},
): string | undefined {
  if (preset === "never") return undefined;
  const start = recurrenceStart(options.scheduled, options.now);
  const date = dateFromDtstart(start);
  const weekdayCode = weekdayForDate(date);
  const base: RecurrenceRuleDraft = {
    frequency: "DAILY",
    interval: 1,
    weekdays: [],
    pattern: "date",
    monthDay: date.getUTCDate(),
    position: 1,
    month: date.getUTCMonth() + 1,
    end: "never",
    dtstart: start,
    unsupported: [],
    invalid: [],
  };
  if (preset === "weekdays")
    return buildRecurrenceRule({
      ...base,
      frequency: "DAILY",
      weekdays: ["MO", "TU", "WE", "TH", "FR"],
    });
  if (preset === "weekly")
    return buildRecurrenceRule({
      ...base,
      frequency: "WEEKLY",
      weekdays: [weekdayCode],
    });
  if (preset === "monthly")
    return buildRecurrenceRule({ ...base, frequency: "MONTHLY" });
  if (preset === "yearly")
    return buildRecurrenceRule({ ...base, frequency: "YEARLY" });
  return buildRecurrenceRule(base);
}

export function recurrencePreset(value?: string): string {
  if (!value) return "never";
  const draft = parseRecurrenceRule(value);
  if (draft.invalid.length || draft.unsupported.length) return "advanced";
  if (
    draft.frequency === "DAILY" &&
    orderedWeekdays(draft.weekdays).join(",") === "MO,TU,WE,TH,FR"
  )
    return "weekdays";
  return draft.frequency.toLocaleLowerCase();
}

export function recurrenceRuleSummary(draft: RecurrenceRuleDraft): string {
  if (draft.invalid.length) return "Invalid recurrence rule";
  if (draft.unsupported.length) return "Advanced recurrence rule";

  const interval = Math.max(1, Math.round(draft.interval));
  const unit = {
    DAILY: "day",
    WEEKLY: "week",
    MONTHLY: "month",
    YEARLY: "year",
  }[draft.frequency];
  let summary = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;

  if (
    (draft.frequency === "DAILY" || draft.frequency === "WEEKLY") &&
    draft.weekdays.length
  )
    summary += ` on ${listWords(orderedWeekdays(draft.weekdays).map(weekdayName))}`;
  if (
    (draft.frequency === "MONTHLY" || draft.frequency === "YEARLY") &&
    draft.pattern === "date"
  )
    summary += ` on the ${ordinalMonthDay(draft.monthDay)}`;
  if (
    (draft.frequency === "MONTHLY" || draft.frequency === "YEARLY") &&
    draft.pattern === "weekday"
  )
    summary += ` on the ${positionName(draft.position)} ${weekdayName(
      draft.weekdays[0] ?? "MO",
    )}`;
  if (draft.frequency === "YEARLY") summary += ` of ${monthName(draft.month)}`;

  if (draft.end === "count" && draft.count) summary += `, ${draft.count} times`;
  else if (draft.end === "until" && draft.until)
    summary += `, until ${formatSummaryDate(draft.until)}`;
  return summary;
}

export function recurrenceStartStorageValue(
  dtstart?: string,
): string | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(?:\d{2})?Z?)?$/.exec(
    dtstart ?? "",
  );
  if (!match) return undefined;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return match[4] ? `${date}T${match[4]}:${match[5]}` : date;
}

export function recurrenceDtstartValue(value?: string): string | undefined {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?/.exec(
      value ?? "",
    );
  if (!match) return undefined;
  const date = `${match[1]}${match[2]}${match[3]}`;
  return match[4] ? `${date}T${match[4]}${match[5]}00Z` : date;
}

export function weekdayName(value: RecurrenceWeekday): string {
  return {
    MO: "Monday",
    TU: "Tuesday",
    WE: "Wednesday",
    TH: "Thursday",
    FR: "Friday",
    SA: "Saturday",
    SU: "Sunday",
  }[value];
}

export function monthName(value: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "long" }).format(
    new Date(2024, Math.max(0, Math.min(11, value - 1)), 1),
  );
}

function normalizeRule(value?: string): string {
  return (value ?? "")
    .trim()
    .replace(/\r?\n/g, ";")
    .replace(/(?:^|;)RRULE:/gi, (match) => (match.startsWith(";") ? ";" : ""))
    .replace(/;+/g, ";")
    .replace(/^;|;$/g, "")
    .toUpperCase();
}

function parseByDay(value?: string): {
  plain: RecurrenceWeekday[];
  positioned: Array<{ weekday: RecurrenceWeekday; position: number }>;
  valid: boolean;
} {
  if (!value) return { plain: [], positioned: [], valid: true };
  const plain: RecurrenceWeekday[] = [];
  const positioned: Array<{
    weekday: RecurrenceWeekday;
    position: number;
  }> = [];
  let valid = true;
  for (const entry of value.split(",")) {
    const match = /^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(entry);
    if (!match) {
      valid = false;
      continue;
    }
    const day = match[2] as RecurrenceWeekday;
    if (match[1]) {
      const position = Number(match[1]);
      if (!validPosition(position)) valid = false;
      else positioned.push({ weekday: day, position });
    } else plain.push(day);
  }
  return { plain, positioned, valid };
}

function integerList(value?: string): { values: number[]; valid: boolean } {
  if (!value) return { values: [], valid: true };
  const entries = value.split(",");
  const values = entries.map(Number);
  return {
    values: values.filter(Number.isInteger),
    valid: values.length === entries.length && values.every(Number.isInteger),
  };
}

function isFrequency(value?: string): value is RecurrenceFrequency {
  return ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(value ?? "");
}

function weekday(value?: string): RecurrenceWeekday | undefined {
  return WEEKDAYS.find((candidate) => candidate === value);
}

function orderedWeekdays(
  values: readonly RecurrenceWeekday[],
): RecurrenceWeekday[] {
  return WEEKDAYS.filter((day) => values.includes(day));
}

function positiveInteger(value?: string): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function storageUntil(value?: string): string | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T\d{6}Z?)?$/.exec(value ?? "");
  if (!match) return undefined;
  const result = `${match[1]}-${match[2]}-${match[3]}`;
  return validDate(result) ? result : undefined;
}

function startDateParts(dtstart?: string): { month: number; day: number } {
  const date = dateFromDtstart(dtstart);
  return { month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function recurrenceStart(scheduled?: string, now = new Date()): string {
  return (
    recurrenceDtstartValue(scheduled) ??
    [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("")
  );
}

function dateFromDtstart(value?: string): Date {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value ?? "");
  return match && validDate(`${match[1]}-${match[2]}-${match[3]}`)
    ? new Date(
        Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
      )
    : new Date(Date.UTC(2024, 0, 1));
}

function weekdayForDate(date: Date): RecurrenceWeekday {
  return ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][
    date.getUTCDay()
  ] as RecurrenceWeekday;
}

function isDtstart(value: string): boolean {
  const storage = recurrenceStartStorageValue(value);
  return Boolean(storage && validDate(storage.slice(0, 10)));
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function within(value: number, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function validMonthDay(value: number): boolean {
  return within(value, 1, 31) || within(value, -31, -1);
}

function validPosition(value: number): boolean {
  return within(value, 1, 4) || value === -1;
}

function listWords(values: string[]): string {
  return new Intl.ListFormat(undefined, {
    style: "long",
    type: "conjunction",
  }).format(values);
}

function ordinalMonthDay(value: number): string {
  if (value === -1) return "last day";
  if (value < 0) return `${Math.abs(value)} days from the end`;
  const remainder = value % 100;
  const suffix =
    remainder >= 11 && remainder <= 13
      ? "th"
      : ({ 1: "st", 2: "nd", 3: "rd" }[value % 10] ?? "th");
  return `${value}${suffix}`;
}

function positionName(value: number): string {
  return (
    { 1: "first", 2: "second", 3: "third", 4: "fourth", "-1": "last" }[value] ??
    "first"
  );
}

function formatSummaryDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}
