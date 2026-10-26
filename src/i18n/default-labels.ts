import { plural, t } from "@lingui/core/macro";

export type CountKind =
  | "task"
  | "project"
  | "context"
  | "dependency"
  | "tag"
  | "property"
  | "session"
  | "reminder"
  | "view"
  | "sort"
  | "field"
  | "default"
  | "formula"
  | "projection";

/** Whole ICU messages, not English singulars with an appended 's'. */
export function countLabel(count: number, kind: CountKind): string {
  switch (kind) {
    case "task":
      return plural(count, { 0: "# tasks", one: "# task", other: "# tasks" });
    case "project":
      return plural(count, {
        0: "# projects",
        one: "# project",
        other: "# projects",
      });
    case "context":
      return plural(count, {
        0: "# contexts",
        one: "# context",
        other: "# contexts",
      });
    case "dependency":
      return plural(count, {
        0: "# dependencies",
        one: "# dependency",
        other: "# dependencies",
      });
    case "tag":
      return plural(count, { 0: "# tags", one: "# tag", other: "# tags" });
    case "property":
      return plural(count, {
        0: "# properties",
        one: "# property",
        other: "# properties",
      });
    case "session":
      return plural(count, {
        0: "# sessions",
        one: "# session",
        other: "# sessions",
      });
    case "reminder":
      return plural(count, {
        0: "# reminders",
        one: "# reminder",
        other: "# reminders",
      });
    case "view":
      return plural(count, { 0: "# views", one: "# view", other: "# views" });
    case "sort":
      return plural(count, { 0: "# sorts", one: "# sort", other: "# sorts" });
    case "field":
      return plural(count, {
        0: "# fields",
        one: "# field",
        other: "# fields",
      });
    case "default":
      return plural(count, {
        0: "# defaults",
        one: "# default",
        other: "# defaults",
      });
    case "formula":
      return plural(count, {
        0: "# formulas",
        one: "# formula",
        other: "# formulas",
      });
    case "projection":
      return plural(count, {
        0: "# projections",
        one: "# projection",
        other: "# projections",
      });
  }
}

export function nestedItemCount(count: number): string {
  return plural(count, {
    0: "# nested items",
    one: "# nested item",
    other: "# nested items",
  });
}

export function daySectionLabel(key: string, fallback: string): string {
  switch (key) {
    case "today":
      return t`Today`;
    case "overdue":
      return t`Overdue`;
    case "anytime":
      return t`Anytime`;
    case "later":
      return t`Later`;
    default:
      return fallback;
  }
}

/** Only source-owned field names; never use this on a user's displayName or value. */
export function builtInFieldLabel(key: string): string | undefined {
  switch (key) {
    case "title":
      return t`Title`;
    case "status":
      return t`Status`;
    case "priority":
      return t`Priority`;
    case "due":
      return t`Due`;
    case "scheduled":
      return t`Scheduled`;
    case "tags":
      return t`Tags`;
    case "projects":
      return t`Projects`;
    case "contexts":
      return t`Contexts`;
    case "archived":
      return t`Archived`;
    case "completed":
      return t`Completed`;
    case "file.name":
      return t`File name`;
    case "file.path":
      return t`File path`;
    default:
      return undefined;
  }
}
