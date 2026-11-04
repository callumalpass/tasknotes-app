import type { NlpTriggerConfig } from "@tasknotes/model/types";
import {
  combineTaskDateTime,
  formatTaskDate,
  recurrenceLabel,
  todayString,
  type CreateTaskInput,
} from "./task";
import { captureTriggers } from "./capture-autosuggest";
import { linkDisplayLabel } from "./completion";
import {
  captureHighlightsFromSpans,
  type CaptureHighlight,
} from "./capture-highlights";

import type { TaskCollectionConfiguration } from "./task-configuration";
import type {
  NaturalLanguageParserCore,
  ParsedTaskData,
} from "tasknotes-nlp-core";

export interface TaskCapturePreview {
  key: string;
  label: string;
}

export interface TaskCaptureResult {
  input: CreateTaskInput;
  preview: TaskCapturePreview[];
  /** Where the parser found each value, as offsets in the parsed text. */
  highlights?: CaptureHighlight[];
}

let parserModule: Promise<typeof import("tasknotes-nlp-core")> | undefined;
const parserCache = new WeakMap<
  TaskCollectionConfiguration,
  Map<string, Promise<NaturalLanguageParserCore>>
>();

export async function parseTaskCapture(
  text: string,
  configuration: TaskCollectionConfiguration,
  locale = browserLocale(),
  knownProjects: readonly string[] = [],
): Promise<TaskCaptureResult> {
  const parser = await captureParser(configuration, locale);
  const titleWords = dayPartsInTitle(text);
  const projectWords = knownProjectSpaces(
    text,
    knownProjects,
    captureTriggers(configuration),
  );
  const readable = (value: string) =>
    projectWords.reduce(
      (current, space) =>
        current.slice(0, space) + PROJECT_SPACE + current.slice(space + 1),
      titleWords.reduce(
        (current, { start, end }) =>
          current.slice(0, start) +
          titleWordMask(end - start) +
          current.slice(end),
        value,
      ),
    );
  // The portable parser has no phrase for a day of the month.
  const monthly = monthlyPhrase(text, locale);
  const source = monthly
    ? text.slice(0, monthly.start) +
      " ".repeat(monthly.end - monthly.start) +
      text.slice(monthly.end)
    : text;
  let parsed = parser.parseInputWithSpans(readable(source));
  // Rank shorthand belongs to the app: the portable parser only knows the
  // collection's names. Mask with equal-length spaces to preserve all offsets.
  const ranked = configuration.priorities
    .map((priority, index) => ({
      ...priority,
      weight: priority.weight ?? index,
    }))
    .sort((left, right) => right.weight - left.weight);
  const links = [...text.matchAll(/\[\[[\s\S]*?\]\]|\[[^\]]*\]\([^)]+\)/gu)];
  const shorthand = ranked.length
    ? [...text.matchAll(/(?:^|\s)(p(\d{1,2})[.,;:!?]?)(?=\s|$)/giu)].flatMap(
        (match) => {
          const rank = Number(match[2]);
          // A rank in this collection's own list, however long. The familiar
          // first four always work, and settle on the lowest in a short list.
          if (rank < 1 || rank > Math.max(4, ranked.length)) return [];
          const start = match.index + match[0].length - match[1].length;
          const end = start + match[1].length;
          if (
            parsed.spans.some(
              (span) =>
                span.kind !== "priority" &&
                span.start < end &&
                span.end > start,
            ) ||
            links.some(
              (link) => link.index < end && link.index + link[0].length > start,
            )
          )
            return [];
          return [
            {
              start,
              end,
              priority: ranked[Math.min(rank, ranked.length) - 1].value,
            },
          ];
        },
      )
    : [];
  if (shorthand.length) {
    let masked = source;
    for (const { start, end } of shorthand)
      masked =
        masked.slice(0, start) + " ".repeat(end - start) + masked.slice(end);
    parsed = parser.parseInputWithSpans(readable(masked));
    // A named priority is explicit; otherwise the last shorthand wins.
    parsed.data.priority ??= shorthand.at(-1)!.priority;
  }
  const { data } = parsed;
  if (monthly || shorthand.length)
    data.title = data.title.replace(/[ \t]+/gu, " ").trim();
  if (monthly) {
    data.recurrence = `FREQ=MONTHLY;BYMONTHDAY=${monthly.day}`;
    if (!data.scheduledDate && !data.dueDate)
      data.scheduledDate = nextMonthDay(monthly.day);
  }
  let { spans } = parsed;
  data.projects = data.projects?.map((project) =>
    project.replaceAll(PROJECT_SPACE, " "),
  );
  data.title = restoreTitleWords(data.title, titleWords, text);
  // A frequency that stays in the title names the task ("weekly review");
  // only a command such as "every week" makes it repeat.
  if (spans.some((span) => span.kind === "recurrence" && span.inTitle)) {
    delete data.recurrence;
    spans = spans.filter((span) => span.kind !== "recurrence");
  }
  const highlights = captureHighlightsFromSpans(
    spans,
    captureTriggers(configuration),
  ).flatMap((highlight) => {
    if (!shorthand.length) return [highlight];
    // A date span can bridge the masked shorthand ("tomorrow p1 3pm").
    // Keep its pieces separate so each chip still owns exactly its own tint.
    let pieces = [highlight];
    for (const token of shorthand) {
      pieces = pieces.flatMap((piece) => {
        if (piece.end <= token.start || piece.start >= token.end)
          return [piece];
        return [
          { ...piece, end: Math.min(piece.end, token.start) },
          { ...piece, start: Math.max(piece.start, token.end) },
        ].filter((part) => part.start < part.end);
      });
    }
    return pieces
      .map((piece) => {
        let { start, end } = piece;
        while (start < end && /\s/u.test(text[start])) start++;
        while (end > start && /\s/u.test(text[end - 1])) end--;
        return { ...piece, start, end };
      })
      .filter((piece) => piece.start < piece.end);
  });
  highlights.push(
    ...shorthand.map(({ start, end }) => ({
      start,
      end,
      kind: "priority" as const,
    })),
  );
  if (monthly)
    highlights.push({
      start: monthly.start,
      end: monthly.end,
      kind: "recurrence" as const,
    });
  highlights.sort((left, right) => left.start - right.start);
  return {
    ...mapParsedCapture(data, configuration),
    ...(highlights.length ? { highlights } : {}),
  };
}

/** "every 1st", "every month on the 15th": a repeating day of the month. */
function monthlyPhrase(text: string, locale: string) {
  if (!locale.toLowerCase().startsWith("en")) return null;
  const match =
    /(?:^|\s)(every\s+(?:month\s+on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th))(?=[\s.,;:!?]|$)/iu.exec(
      text,
    );
  const day = Number(match?.[2]);
  if (!match || day < 1 || day > 31) return null;
  const start = match.index + match[0].length - match[1].length;
  return { day, start, end: start + match[1].length };
}

/** The next date with this day, skipping months too short to have it. */
function nextMonthDay(day: number): string {
  const today = todayString();
  const [year, month] = today.split("-").map(Number);
  for (let offset = 0; ; offset++) {
    const date = new Date(Date.UTC(year, month - 1 + offset, day));
    const value = date.toISOString().slice(0, 10);
    if (date.getUTCDate() === day && value >= today) return value;
  }
}

/** Stands in for a space inside a project name, keeping every offset. */
const PROJECT_SPACE = "\u01C2";

/**
 * Finds the spaces inside a known project typed after its trigger, so
 * `+Product refresh` reads as that project, not `Product` and a stray word.
 * The longest name wins, and only whole words match.
 */
function knownProjectSpaces(
  text: string,
  projects: readonly string[],
  triggers: readonly NlpTriggerConfig[],
): number[] {
  const trigger = triggers.find(
    ({ propertyId }) => propertyId === "projects",
  )?.trigger;
  if (!trigger) return [];
  const names = projects
    .filter((name) => /\s/u.test(name))
    .sort((left, right) => right.length - left.length);
  const lowered = text.toLocaleLowerCase();
  const spaces: number[] = [];
  let index = lowered.indexOf(trigger);
  while (index >= 0) {
    const start = index + trigger.length;
    if (index === 0 || /\s/u.test(text[index - 1])) {
      const name = names.find((candidate) => {
        const end = start + candidate.length;
        return (
          lowered.startsWith(candidate.toLocaleLowerCase(), start) &&
          (end === text.length || /[\s.,;:!?]/u.test(text[end]))
        );
      });
      for (let offset = 0; name && offset < name.length; offset++)
        if (/\s/u.test(name[offset])) spaces.push(start + offset);
    }
    index = lowered.indexOf(trigger, start);
  }
  return spaces;
}

/** The parser drops symbols, so a stand-in has to read as a word of equal length. */
function titleWordMask(length: number): string {
  return "zqxj".repeat(length).slice(0, length);
}

const DATE_WORD_BEFORE =
  /(?:^|[\s,])(?:at|by|in the|last|next|on|this|today|tomorrow|tonight|yesterday|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s+$/iu;

/**
 * Finds "morning" and the like where they name the task ("Morning appointment
 * tomorrow 9am") instead of the time ("tomorrow morning"). Left in, the date
 * parser reads them as a date and ignores the one the person typed.
 */
function dayPartsInTitle(text: string): { start: number; end: number }[] {
  return [
    ...text.matchAll(
      /(?<![\p{L}\p{N}])(?:morning|afternoon|evening|night)(?![\p{L}\p{N}])/giu,
    ),
  ]
    .filter((match) => !DATE_WORD_BEFORE.test(text.slice(0, match.index)))
    .map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }));
}

function restoreTitleWords(
  title: string,
  words: readonly { start: number; end: number }[],
  text: string,
): string {
  return words.reduce((current, { start, end }) => {
    return current.replace(titleWordMask(end - start), text.slice(start, end));
  }, title);
}

export function preloadTaskCapture(): void {
  void loadParserModule();
}

function captureParser(
  configuration: TaskCollectionConfiguration,
  locale: string,
): Promise<NaturalLanguageParserCore> {
  const language = supportedLanguage(locale);
  const key = `${language}:${locale}`;
  const cached = parserCache.get(configuration) ?? new Map();
  parserCache.set(configuration, cached);
  const existing = cached.get(key);
  if (existing) return existing;
  const created = loadParserModule().then(({ NaturalLanguageParserCore }) => {
    const triggers = {
      triggers: captureTriggers(configuration),
    };
    return new NaturalLanguageParserCore(
      configuration.statuses.map((status, order) => ({
        id: status.id,
        value: status.value,
        label: status.label,
        color: status.color,
        icon: status.icon,
        isCompleted: status.isCompleted,
        order: status.order ?? order,
        autoArchive: status.autoArchive ?? false,
        autoArchiveDelay: status.autoArchiveDelay ?? 0,
      })),
      configuration.priorities.map((priority, weight) => ({
        id: priority.id,
        value: priority.value,
        label: priority.label,
        color: priority.color,
        weight: priority.weight ?? weight,
      })),
      true,
      language,
      triggers,
      configuration.userFields.map((field) => ({
        id: field.id,
        displayName: field.displayName,
        key: field.key,
        type: field.type,
        defaultValue: field.defaultValue,
      })),
      { dateLocale: locale },
    );
  });
  cached.set(key, created);
  return created;
}

function loadParserModule(): Promise<typeof import("tasknotes-nlp-core")> {
  parserModule ??= import("tasknotes-nlp-core");
  return parserModule;
}

function mapParsedCapture(
  parsed: ParsedTaskData,
  configuration: TaskCollectionConfiguration,
): TaskCaptureResult {
  const scheduled = combineTaskDateTime(
    parsed.scheduledDate,
    parsed.scheduledTime,
  );
  const due = combineTaskDateTime(parsed.dueDate, parsed.dueTime);
  const customProperties = Object.fromEntries(
    Object.entries(parsed.userFields ?? {}).flatMap(([fieldId, value]) => {
      const field = configuration.userFields.find(
        (entry) => entry.id === fieldId,
      );
      return field
        ? [[field.key, normalizeUserFieldValue(value, field.type)]]
        : [];
    }),
  );
  const input: CreateTaskInput = {
    title: parsed.title.trim(),
    ...(parsed.status ? { status: parsed.status } : {}),
    ...(parsed.priority ? { priority: parsed.priority } : {}),
    ...(scheduled ? { scheduled } : {}),
    ...(due ? { due } : {}),
    ...(parsed.details ? { body: parsed.details } : {}),
    ...(parsed.tags.length ? { tags: parsed.tags } : {}),
    ...(parsed.contexts.length ? { contexts: parsed.contexts } : {}),
    ...(parsed.projects.length ? { projects: parsed.projects } : {}),
    ...(parsed.recurrence ? { recurrence: parsed.recurrence } : {}),
    ...(parsed.estimate ? { timeEstimate: parsed.estimate } : {}),
    ...(Object.keys(customProperties).length ? { customProperties } : {}),
  };
  return { input, preview: taskCapturePreview(input, configuration) };
}

export function taskCapturePreview(
  input: CreateTaskInput,
  configuration: TaskCollectionConfiguration,
): TaskCapturePreview[] {
  const preview: TaskCapturePreview[] = [];
  if (input.scheduled)
    preview.push({ key: "scheduled", label: formatTaskDate(input.scheduled) });
  if (input.due)
    preview.push({ key: "due", label: `Due ${formatTaskDate(input.due)}` });
  if (input.status) {
    const status = configuration.statuses.find(
      (entry) => entry.value === input.status,
    );
    preview.push({ key: "status", label: status?.label ?? input.status });
  }
  if (input.priority) {
    const priority = configuration.priorities.find(
      (entry) => entry.value === input.priority,
    );
    preview.push({ key: "priority", label: priority?.label ?? input.priority });
  }
  if (input.recurrence)
    preview.push({
      key: "recurrence",
      label: recurrenceLabel(input.recurrence),
    });
  if (input.timeEstimate)
    preview.push({ key: "estimate", label: formatMinutes(input.timeEstimate) });
  for (const project of input.projects ?? [])
    preview.push({
      key: `project:${project}`,
      label: `+${linkDisplayLabel(project)}`,
    });
  for (const context of input.contexts ?? [])
    preview.push({
      key: `context:${context}`,
      label: `@${linkDisplayLabel(context)}`,
    });
  for (const tag of input.tags ?? [])
    preview.push({ key: `tag:${tag}`, label: `#${tag}` });
  return preview;
}

function normalizeUserFieldValue(
  value: string | string[],
  type: TaskCollectionConfiguration["userFields"][number]["type"],
): unknown {
  if (type === "number" && typeof value === "string") {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (type === "boolean" && typeof value === "string")
    return value.toLocaleLowerCase() === "true";
  return value;
}

function formatMinutes(value: number): string {
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function browserLocale(): string {
  return typeof navigator !== "undefined" && navigator.language
    ? navigator.language
    : "en";
}

function supportedLanguage(locale: string): string {
  const language = locale.toLocaleLowerCase().split("-")[0];
  return [
    "en",
    "es",
    "fr",
    "de",
    "ru",
    "zh",
    "ja",
    "it",
    "nl",
    "pt",
    "sv",
    "uk",
  ].includes(language)
    ? language
    : "en";
}
