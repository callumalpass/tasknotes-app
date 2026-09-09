import type { Task } from "../domain/task";

/** Explain observed non-title matches without fetching or changing search semantics. */
export function searchMatchContext(
  task: Pick<
    Task,
    "title" | "body" | "projects" | "contexts" | "tags" | "attachments"
  >,
  query: string,
): string | undefined {
  const title = task.title.toLocaleLowerCase();
  const outsideTitle = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter((token) => token && !title.includes(token));
  if (!outsideTitle.length) return undefined;
  const fields: [string, string[]][] = [
    ["notes", [task.body]],
    ["projects", task.projects],
    ["contexts", task.contexts],
    ["tags", task.tags],
    ["attachments", task.attachments],
  ];
  const matches = fields
    .filter(([, values]) =>
      values.some((value) =>
        outsideTitle.some((token) => value.toLocaleLowerCase().includes(token)),
      ),
    )
    .map(([label]) => label);
  return matches.length ? `Matched in ${matches.join(", ")}` : undefined;
}
