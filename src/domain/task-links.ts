import { recordCompletion } from "./completion";

import type { TaskSummary } from "./task";

/** A portable link to a task's Markdown record in the collection's write
 * format, or "" when the task has no record yet (a virtual occurrence). */
export function taskRecordLink(
  task: Pick<TaskSummary, "path" | "title" | "frontmatter">,
  format: "wikilink" | "markdown",
): string {
  if (!task.path) return "";
  return recordCompletion(
    {
      path: task.path,
      label: task.title,
      frontmatter: task.frontmatter,
      types: ["task"],
    },
    format,
  ).value;
}
