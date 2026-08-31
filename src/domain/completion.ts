export interface FieldCompletionRequest {
  field: string;
  kind: "values" | "records";
  query?: string;
  limit?: number;
  targetTypes?: string[];
  configuredValues?: Array<{ value: string; label?: string }>;
}

export interface FieldCompletion {
  value: string;
  label: string;
  detail?: string;
  path?: string;
  /** Present when this record completion is a TaskNote in the current repository. */
  taskId?: string;
  kind: "value" | "record";
}

export interface CollectionRecord {
  path: string;
  label: string;
  frontmatter: Record<string, unknown>;
  body?: string;
  types: string[];
}

export function recordCompletion(
  record: Omit<CollectionRecord, "label"> & { label?: string },
  writeFormat: "wikilink" | "markdown",
): FieldCompletion {
  const path = record.path.replace(/\.md$/i, "");
  const label = record.label?.trim() || recordLabel(record);
  const basename = path.split("/").at(-1) ?? path;
  const alias = wikiAlias(label, basename);
  return {
    kind: "record",
    value:
      writeFormat === "markdown"
        ? `[${label}](/${encodeMarkdownPath(record.path)})`
        : `[[${path}${alias ? `|${alias}` : ""}]]`,
    label,
    detail: record.path,
    path: record.path,
  };
}

/** Returns the human-facing label embedded in a portable record link. */
export function linkLabel(value: string): string | undefined {
  const source = value.trim();
  const wikilink = source.match(/^!?\[\[([\s\S]+?)\]\]$/);
  if (wikilink) {
    const separator = wikilink[1].indexOf("|");
    if (separator >= 0) {
      const label = wikilink[1].slice(separator + 1).trim();
      return label || undefined;
    }
    return;
  }
  const markdown = source.match(/^!?\[([^\]]+)\]\([^)]+\)$/);
  return markdown?.[1].trim() || undefined;
}

export function recordLabel(record: {
  path: string;
  frontmatter?: Record<string, unknown>;
}): string {
  const title = record.frontmatter?.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  const name = record.path.split("/").at(-1) ?? record.path;
  return name.replace(/\.md$/i, "");
}

export function completionMatches(
  completion: Pick<FieldCompletion, "label" | "detail" | "value">,
  query: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [completion.label, completion.detail, completion.value].some((value) =>
    value?.toLocaleLowerCase().includes(needle),
  );
}

export function linkTarget(value: string): string {
  const source = value.trim();
  const wikilink = source.match(/^!?\[\[([\s\S]+?)\]\]$/);
  if (wikilink) return cleanTarget(wikilink[1].split("|", 1)[0]);
  const markdown = source.match(/^!?\[[^\]]*\]\(([^)]+)\)$/);
  if (markdown) return cleanTarget(markdown[1]);
  return cleanTarget(source);
}

export function recordMatchesLink(path: string, link: string): boolean {
  const target = linkTarget(link).toLocaleLowerCase();
  const normalizedPath = cleanTarget(path).toLocaleLowerCase();
  if (!target) return false;
  if (target.includes("/")) return target === normalizedPath;
  const basename = normalizedPath.split("/").at(-1) ?? normalizedPath;
  return target === basename;
}

function cleanTarget(value: string): string {
  let target = value.split("#", 1)[0].trim().replaceAll("\\", "/");
  try {
    target = decodeURIComponent(target);
  } catch {
    // Preserve malformed percent sequences as literal link text.
  }
  return target.replace(/^\/+/, "").replace(/\.md$/i, "").replace(/\/+/g, "/");
}

function encodeMarkdownPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function wikiAlias(label: string, basename: string): string | undefined {
  if (label === basename || /[\]|\r\n]/.test(label)) return;
  return label;
}
