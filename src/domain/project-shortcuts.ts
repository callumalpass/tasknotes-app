import { linkLabel, linkTarget } from "./completion";
import type { TaskSummary } from "./task";

export interface ProjectShortcut {
  label: string;
  count: number;
}

/** A project's name as lists and the Projects view show it. */
export function projectLabel(value: string): string {
  return linkLabel(value) ?? linkTarget(value).split("/").at(-1) ?? value;
}

function taskLinkKeys(path: string) {
  const target = path.replace(/\.md$/i, "").toLocaleLowerCase();
  return [target, target.split("/").at(-1) ?? target];
}

function isProjectTag(tag: string): boolean {
  const normalized = tag.trim().replace(/^#+/, "").toLocaleLowerCase();
  return /(?:^|\/)projects?$/u.test(normalized);
}

function isProjectMarkerValue(value: unknown): boolean {
  if (typeof value === "string") {
    const normalized = value.trim().toLocaleLowerCase();
    return normalized === "project" || normalized === "projects";
  }
  if (Array.isArray(value)) return value.some(isProjectMarkerValue);
  return false;
}

/**
 * A note explicitly marked as a project (for example with `#action/project` or
 * `category: project`) can still match the collection's task type via a nested
 * tag. Keep it eligible as a sidebar project instead of treating it as a
 * subtask parent.
 */
function isMarkedProjectNote(
  task: Partial<Pick<TaskSummary, "tags" | "frontmatter">>,
): boolean {
  if (task.tags?.some(isProjectTag)) return true;
  const frontmatter = task.frontmatter;
  if (!frontmatter) return false;
  return (
    isProjectMarkerValue(frontmatter.category) ||
    isProjectMarkerValue(frontmatter.kind) ||
    isProjectMarkerValue(frontmatter.type)
  );
}

/**
 * The busiest projects in name order, so a capture never reshuffles them. A
 * link to another task makes a subtask, so ordinary parent tasks stay out of
 * the list while notes explicitly marked as projects remain listed.
 */
export function projectShortcuts(
  tasks: Iterable<
    Pick<TaskSummary, "completed" | "archived" | "path" | "projects"> &
      Partial<Pick<TaskSummary, "tags" | "frontmatter">>
  >,
  limit = 6,
): ProjectShortcut[] {
  const all = [...tasks];
  const taskLinks = new Set(
    all
      .filter((task) => !isMarkedProjectNote(task))
      .flatMap((task) => taskLinkKeys(task.path)),
  );
  const counts = new Map<string, number>();
  for (const task of all) {
    if (task.completed || task.archived) continue;
    for (const value of task.projects) {
      if (taskLinks.has(linkTarget(value).toLocaleLowerCase())) continue;
      const label = projectLabel(value);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label),
    )
    .slice(0, limit)
    .sort((left, right) => left.label.localeCompare(right.label));
}
