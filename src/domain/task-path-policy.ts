import { makeTaskPath } from "./task";

export function taskPath(
  recordsFolder: string,
  pathPattern: string | undefined,
  frontmatter: Record<string, unknown>,
  title: string,
  id: string,
  now = new Date(),
): string {
  if (!pathPattern) return makeTaskPath(title, id, recordsFolder);
  const values = canonicalPathValues(frontmatter, title, id, now);
  const expanded = pathPattern.replace(
    /\{\{\s*(\w+)\s*\}\}|\{(\w+)\}/g,
    (
      _placeholder,
      doubleKey: string | undefined,
      singleKey: string | undefined,
    ) => {
      const key = (doubleKey ?? singleKey)!;
      const value = values[key];
      if (
        value === undefined ||
        value === null ||
        (typeof value === "string" && !value.trim())
      )
        throw new Error(`path_required: The canonical path requires "${key}".`);
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      )
        throw new Error(
          `path_required: The canonical path field "${key}" must be scalar.`,
        );
      return sanitizePathTemplateValue(String(value));
    },
  );
  return normalizeCanonicalPath(expanded);
}

/** TaskNotes filename collision convention. Occupancy and atomic creation stay
 * with the owning repository/replica; this helper has no filesystem semantics.
 */
export function* taskPathCandidates(path: string): Generator<string> {
  yield path;
  const extension = /\.md$/i.test(path) ? ".md" : "";
  const stem = extension ? path.slice(0, -extension.length) : path;
  for (let index = 2; index < 10_000; index++)
    yield `${stem}-${index}${extension}`;
}

export function normalizeCollectionFolder(value: string): string {
  const normalized = value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "");
  if (
    !normalized ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("archive_path_invalid: The archive folder is unsafe.");
  return normalized;
}

function normalizeCanonicalPath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = normalized.split("/");
  if (
    !normalized ||
    value.trim().startsWith("/") ||
    normalized.includes("\0") ||
    parts.some((part) => !part || part === "." || part === "..")
  )
    throw new Error("path_invalid: The canonical task path is unsafe.");
  return /\.md$/i.test(normalized) ? normalized : `${normalized}.md`;
}

function canonicalPathValues(
  frontmatter: Record<string, unknown>,
  title: string,
  id: string,
  now: Date,
): Record<string, unknown> {
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = String(now.getFullYear());
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const words = title.match(/[\p{L}\p{N}]+/gu) ?? [];
  const capitalize = (word: string) =>
    `${word[0]?.toLocaleUpperCase() ?? ""}${word.slice(1).toLocaleLowerCase()}`;
  const scalar = (value: unknown) =>
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
      ? String(value)
      : "";
  const priority = scalar(frontmatter.priority);
  const status = scalar(frontmatter.status);
  return {
    ...frontmatter,
    id,
    uuid: id,
    title,
    titleKebab: words.map((word) => word.toLocaleLowerCase()).join("-"),
    titleSnake: words.map((word) => word.toLocaleLowerCase()).join("_"),
    titleCamel: words.length
      ? `${words[0]!.toLocaleLowerCase()}${words.slice(1).map(capitalize).join("")}`
      : "",
    titlePascal: words.map(capitalize).join(""),
    titleUpper: title.toLocaleUpperCase(),
    titleLower: title.toLocaleLowerCase(),
    priority,
    priorityShort: priority.slice(0, 3).toLocaleLowerCase(),
    status,
    statusShort: status.slice(0, 3).toLocaleLowerCase(),
    dueDate: scalar(frontmatter.due),
    scheduledDate: scalar(frontmatter.scheduled),
    year,
    month,
    day,
    date: `${year}-${month}-${day}`,
    shortDate: `${year}${month}${day}`,
    time,
    timestamp: `${year}${month}${day}${time}`,
    zettel: `${year}${month}${day}${time}`,
  };
}

function sanitizePathTemplateValue(value: string): string {
  return value
    .replace(/[\p{Cc}<>:"|?*]/gu, "")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
