export type CalendarHourFormat = "locale" | "12" | "24";
export type CalendarTimeFormat = Intl.DateTimeFormatOptions & {
  meridiem?: "short" | false;
};

export interface CalendarPreferences {
  firstDay: number;
  weekends: boolean;
  allDaySlot: boolean;
  nowIndicator: boolean;
  hourFormat: CalendarHourFormat;
  slotMinTime: string;
  slotMaxTime: string;
  slotDuration: string;
}

const STORAGE_KEY = "tasknotes:calendar-preferences:v1";

export function defaultCalendarPreferences(
  locale = browserLocale(),
): CalendarPreferences {
  return {
    firstDay: localeFirstDay(locale),
    weekends: true,
    allDaySlot: true,
    nowIndicator: true,
    hourFormat: "locale",
    slotMinTime: "06:00:00",
    slotMaxTime: "22:00:00",
    slotDuration: "00:30:00",
  };
}

export function loadCalendarPreferences(
  storage: Pick<Storage, "getItem"> = window.localStorage,
  locale = browserLocale(),
): CalendarPreferences {
  const fallback = defaultCalendarPreferences(locale);
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value))
      return fallback;
    const stored = value as Record<string, unknown>;
    return {
      firstDay: validFirstDay(stored.firstDay) ?? fallback.firstDay,
      weekends: boolean(stored.weekends) ?? fallback.weekends,
      allDaySlot: boolean(stored.allDaySlot) ?? fallback.allDaySlot,
      nowIndicator: boolean(stored.nowIndicator) ?? fallback.nowIndicator,
      hourFormat:
        stored.hourFormat === "12" ||
        stored.hourFormat === "24" ||
        stored.hourFormat === "locale"
          ? stored.hourFormat
          : fallback.hourFormat,
      slotMinTime: validClock(stored.slotMinTime) ?? fallback.slotMinTime,
      slotMaxTime: validClock(stored.slotMaxTime) ?? fallback.slotMaxTime,
      slotDuration: validDuration(stored.slotDuration) ?? fallback.slotDuration,
    };
  } catch {
    return fallback;
  }
}

export function saveCalendarPreferences(
  preferences: CalendarPreferences,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

export function calendarEventTimeFormat(
  preference: CalendarHourFormat,
): CalendarTimeFormat {
  return {
    hour: "numeric",
    minute: "2-digit",
    meridiem: "short",
    ...(preference === "12"
      ? { hour12: true }
      : preference === "24"
        ? { hour12: false }
        : {}),
  };
}

export function orderedWeekdays(
  firstDay: number,
  locale = browserLocale(),
  width: "narrow" | "short" = "narrow",
): string[] {
  const sunday = new Date(2024, 0, 7, 12);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(sunday);
    day.setDate(sunday.getDate() + ((firstDay + index) % 7));
    return new Intl.DateTimeFormat(locale, { weekday: width }).format(day);
  });
}

export function startOfCalendarWeek(day: Date, firstDay: number): Date {
  const result = new Date(day);
  const offset = (result.getDay() - (validFirstDay(firstDay) ?? 0) + 7) % 7;
  result.setDate(result.getDate() - offset);
  return result;
}

export function calendarMonthGrid(month: Date, firstDay: number): Date[] {
  const start = startOfCalendarWeek(
    new Date(month.getFullYear(), month.getMonth(), 1),
    firstDay,
  );
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function localeFirstDay(locale: string): number {
  try {
    const weekInfo = (
      new Intl.Locale(locale) as Intl.Locale & {
        weekInfo?: { firstDay?: number };
        getWeekInfo?: () => { firstDay?: number };
      }
    ).weekInfo;
    const methodInfo = (
      new Intl.Locale(locale) as Intl.Locale & {
        getWeekInfo?: () => { firstDay?: number };
      }
    ).getWeekInfo?.();
    const firstDay = weekInfo?.firstDay ?? methodInfo?.firstDay;
    if (typeof firstDay === "number") return firstDay % 7;
  } catch {
    // Fall through to the conservative locale-region defaults below.
  }
  const region = /-([A-Z]{2}|\d{3})(?:-|$)/i.exec(locale)?.[1]?.toUpperCase();
  return region && ["US", "CA", "JP", "PH"].includes(region) ? 0 : 1;
}

function validFirstDay(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 6
    ? value
    : undefined;
}

function validClock(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^(?:[01]\d|2[0-4]):[0-5]\d:00$/.test(value)
    ? value
    : undefined;
}

function validDuration(value: unknown): string | undefined {
  return typeof value === "string" &&
    ["00:15:00", "00:30:00", "01:00:00"].includes(value)
    ? value
    : undefined;
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function browserLocale(): string {
  return typeof navigator !== "undefined" && navigator.language
    ? navigator.language
    : "en";
}
