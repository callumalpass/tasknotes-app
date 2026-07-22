import { parseFrontmatter } from "@tasknotes/model/frontmatter";

import { taskDatePart } from "./task";

import type { Task, CreateTaskInput } from "./task";
import type { TaskTemplatingConfiguration } from "./task-configuration";

export interface ExpandedTaskTemplate {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function expandTaskTemplate(
  source: string,
  task: Task,
  input: CreateTaskInput,
  configuration: TaskTemplatingConfiguration,
  now = new Date(),
): ExpandedTaskTemplate {
  const values = templateValues(task, input, now);
  const split = splitTemplate(source);
  const frontmatterSource = expandVariables(
    split.frontmatter,
    values,
    configuration.unknownVariablePolicy,
    true,
  );
  const body = expandVariables(
    split.body,
    values,
    configuration.unknownVariablePolicy,
    false,
  );
  if (!split.hasFrontmatter) return { frontmatter: {}, body };
  const parsed = parseFrontmatter(`---\n${frontmatterSource}\n---\n${body}`);
  return { frontmatter: parsed.frontmatter, body: parsed.body };
}

function splitTemplate(source: string): {
  hasFrontmatter: boolean;
  frontmatter: string;
  body: string;
} {
  const normalized = source.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n"))
    return { hasFrontmatter: false, frontmatter: "", body: normalized };
  const end = normalized.indexOf("\n---", 4);
  if (end < 0)
    throw new Error(
      "template_parse_failed: The template frontmatter is not closed.",
    );
  const delimiterEnd = end + 4;
  const suffix = normalized.slice(delimiterEnd);
  if (suffix && !suffix.startsWith("\n"))
    throw new Error(
      "template_parse_failed: The template delimiter must be on its own line.",
    );
  return {
    hasFrontmatter: true,
    frontmatter: normalized.slice(4, end),
    body: suffix.replace(/^\n/, ""),
  };
}

function expandVariables(
  source: string,
  values: Record<string, string>,
  unknownPolicy: TaskTemplatingConfiguration["unknownVariablePolicy"],
  yaml: boolean,
): string {
  return source.replace(
    /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g,
    (match, key: string, offset: number) => {
      const value = values[key];
      const replacement =
        value === undefined ? (unknownPolicy === "empty" ? "" : match) : value;
      return yaml && isWholeYamlScalar(source, offset, match.length)
        ? JSON.stringify(replacement)
        : replacement;
    },
  );
}

function isWholeYamlScalar(
  source: string,
  offset: number,
  length: number,
): boolean {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const lineEndValue = source.indexOf("\n", offset + length);
  const lineEnd = lineEndValue < 0 ? source.length : lineEndValue;
  const before = source.slice(lineStart, offset);
  const after = source.slice(offset + length, lineEnd);
  return (
    /^\s*(?:-\s*)?(?:[^:#\n]+:\s*)?$/.test(before) &&
    /^\s*(?:#.*)?$/.test(after)
  );
}

function templateValues(
  task: Task,
  input: CreateTaskInput,
  now: Date,
): Record<string, string> {
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = String(now.getFullYear());
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hour = pad(now.getHours());
  const minute = pad(now.getMinutes());
  const second = pad(now.getSeconds());
  const words = task.title.match(/[\p{L}\p{N}]+/gu) ?? [];
  const camel = words
    .map((word, index) =>
      index === 0
        ? word.toLocaleLowerCase()
        : `${word[0]?.toLocaleUpperCase() ?? ""}${word.slice(1).toLocaleLowerCase()}`,
    )
    .join("");
  const pascal = words
    .map(
      (word) =>
        `${word[0]?.toLocaleUpperCase() ?? ""}${word.slice(1).toLocaleLowerCase()}`,
    )
    .join("");
  const offset = timezoneOffset(now);
  const tags = task.tags;
  const secondsSinceMidnight =
    now.getHours() * 3_600 + now.getMinutes() * 60 + now.getSeconds();
  return {
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueDate: taskDatePart(task.due),
    scheduledDate: taskDatePart(task.scheduled),
    details: input.body ?? "",
    contexts: task.contexts.join(", "),
    tags: tags.join(", "),
    hashtags: tags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" "),
    timeEstimate:
      task.timeEstimate === undefined ? "" : String(task.timeEstimate),
    parentNote: input.parentNote ?? "",
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
    year,
    month,
    day,
    dateTime: `${year}-${month}-${day}-${hour}${minute}`,
    timestamp: `${year}-${month}-${day}-${hour}${minute}${second}`,
    shortDate: `${year.slice(-2)}${month}${day}`,
    shortYear: year.slice(-2),
    monthName: englishPart(now, { month: "long" }),
    monthNameShort: englishPart(now, { month: "short" }),
    dayName: englishPart(now, { weekday: "long" }),
    dayNameShort: englishPart(now, { weekday: "short" }),
    week: pad(isoWeek(now)),
    quarter: String(Math.floor(now.getMonth() / 3) + 1),
    hour,
    minute,
    second,
    time12: englishPart(now, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }),
    time24: `${hour}:${minute}`,
    timezone: offset,
    utcOffset: offset,
    unix: String(Math.floor(now.getTime() / 1_000)),
    unixMs: String(now.getTime()),
    zettel: `${year}${month}${day}${secondsSinceMidnight.toString(36).padStart(3, "0")}`,
    titleLower: task.title.toLocaleLowerCase(),
    titleUpper: task.title.toLocaleUpperCase(),
    titleSnake: words.map((word) => word.toLocaleLowerCase()).join("_"),
    titleKebab: words.map((word) => word.toLocaleLowerCase()).join("-"),
    titleCamel: camel,
    titlePascal: pascal,
    priorityShort: task.priority.slice(0, 1).toLocaleUpperCase(),
    statusShort: task.status.slice(0, 1).toLocaleUpperCase(),
  };
}

function englishPart(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

function timezoneOffset(date: Date): string {
  const total = -date.getTimezoneOffset();
  const sign = total < 0 ? "-" : "+";
  const absolute = Math.abs(total);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function isoWeek(date: Date): number {
  const day = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const start = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return Math.ceil(((day.getTime() - start.getTime()) / 86_400_000 + 1) / 7);
}
