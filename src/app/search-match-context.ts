import type { TaskSummary } from "../domain/task";

/** Explain observed non-title matches without fetching or changing search semantics. */
export function searchMatchContext(
  task: Pick<
    TaskSummary,
    "title" | "projects" | "contexts" | "tags" | "attachments"
  >,
  query: string,
  bodyMatches: readonly string[],
): string | undefined {
  const title = task.title.toLowerCase();
  const outsideTitle = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token && !title.includes(token));
  if (!outsideTitle.length) return undefined;
  const fields: [string, string[]][] = [
    ["notes", [...bodyMatches]],
    ["projects", task.projects],
    ["contexts", task.contexts],
    ["tags", task.tags],
    ["attachments", task.attachments],
  ];
  const matches = fields
    .filter(([, values]) =>
      values.some((value) =>
        outsideTitle.some((token) => value.toLowerCase().includes(token)),
      ),
    )
    .map(([label]) => label);
  return matches.length ? `Matched in ${matches.join(", ")}` : undefined;
}
