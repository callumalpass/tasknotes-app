export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type RecurrenceEnd = "never" | "until" | "count";

export interface RecurrenceRuleDraft {
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays: string[];
  end: RecurrenceEnd;
  until?: string;
  count?: number;
  dtstart?: string;
  unsupported: string[];
}

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export function parseRecurrenceRule(value?: string): RecurrenceRuleDraft {
  const dtstart = value?.match(/(?:^|;)DTSTART:([^;]+)/)?.[1];
  const fields = Object.fromEntries(
    (value ?? "")
      .split(";")
      .filter((entry) => !entry.startsWith("DTSTART:"))
      .map((entry) => entry.split("=", 2))
      .filter((entry) => entry.length === 2),
  ) as Record<string, string>;
  const frequency = isFrequency(fields.FREQ) ? fields.FREQ : "WEEKLY";
  const interval = positiveInteger(fields.INTERVAL) ?? 1;
  const weekdays = (fields.BYDAY ?? "")
    .split(",")
    .filter((day) => WEEKDAYS.includes(day));
  const count = positiveInteger(fields.COUNT);
  const until = storageUntil(fields.UNTIL);
  const supported = new Set([
    "FREQ",
    "INTERVAL",
    "BYDAY",
    "COUNT",
    "UNTIL",
    "DTSTART",
  ]);
  return {
    frequency,
    interval,
    weekdays,
    end: count ? "count" : until ? "until" : "never",
    ...(until ? { until } : {}),
    ...(count ? { count } : {}),
    ...(dtstart ? { dtstart } : {}),
    unsupported: Object.keys(fields).filter((key) => !supported.has(key)),
  };
}

export function buildRecurrenceRule(draft: RecurrenceRuleDraft): string {
  const fields = [
    draft.dtstart ? `DTSTART:${draft.dtstart}` : "",
    `FREQ=${draft.frequency}`,
    `INTERVAL=${Math.max(1, Math.round(draft.interval || 1))}`,
    draft.frequency === "WEEKLY" && draft.weekdays.length
      ? `BYDAY=${WEEKDAYS.filter((day) => draft.weekdays.includes(day)).join(",")}`
      : "",
    draft.end === "until" && draft.until
      ? `UNTIL=${draft.until.replaceAll("-", "")}T235959Z`
      : "",
    draft.end === "count" && draft.count
      ? `COUNT=${Math.max(1, Math.round(draft.count))}`
      : "",
  ];
  return fields.filter(Boolean).join(";");
}

function isFrequency(value?: string): value is RecurrenceFrequency {
  return ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(value ?? "");
}

function positiveInteger(value?: string): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function storageUntil(value?: string): string | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value ?? "");
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}
