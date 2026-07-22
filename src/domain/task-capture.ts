import {
  combineTaskDateTime,
  formatTaskDate,
  recurrenceLabel,
  type CreateTaskInput,
} from "./task";

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
): Promise<TaskCaptureResult> {
  const parser = await captureParser(configuration, locale);
  return mapParsedCapture(
    parser.parseInput(disambiguateCaptureText(text, supportedLanguage(locale))),
    configuration,
  );
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
  const created = loadParserModule().then(
    ({ DEFAULT_NLP_TRIGGERS, NaturalLanguageParserCore }) => {
      const triggers = {
        triggers: DEFAULT_NLP_TRIGGERS.triggers.map((trigger) =>
          trigger.propertyId === "priority"
            ? { ...trigger, enabled: true }
            : trigger,
        ),
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
    },
  );
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
    preview.push({ key: `project:${project}`, label: `+${project}` });
  for (const context of input.contexts ?? [])
    preview.push({ key: `context:${context}`, label: `@${context}` });
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

function disambiguateCaptureText(text: string, language: string): string {
  if (language !== "en") return text;
  // Preserve adjective uses such as "weekly review". Explicit phrases such as
  // "every week" remain recurrence commands, as do trailing "weekly" tokens.
  return text.replace(
    /\b(daily|weekly|monthly|yearly|annually)\b(?=\s+[\p{L}\p{N}])/giu,
    "\\$1",
  );
}
