import { occurrenceTask } from "./task-occurrence";
import { dateFromStorage } from "./task";

import type { Task } from "./task";
import type { TaskOccurrence } from "./task-occurrence";
import type { TaskViewProperty, TaskViewRow } from "./view";

export interface ViewPropertyDetail {
  key: string;
  label: string;
  value: string;
  description?: string;
}

export function viewPropertyDetails(
  row: TaskViewRow,
  properties: readonly TaskViewProperty[],
  {
    identityProperty,
    omittedProperties = [],
    occurrence,
    suppressRoutineDefaults = false,
  }: {
    identityProperty?: string;
    omittedProperties?: readonly string[];
    occurrence?: TaskOccurrence;
    suppressRoutineDefaults?: boolean;
  } = {},
): ViewPropertyDetail[] | undefined {
  if (!properties.length) return undefined;
  return properties.flatMap((property) => {
    if (
      property.hidden ||
      omittedProperties.includes(property.key) ||
      (identityProperty && isIdentityProperty(property.key, identityProperty))
    )
      return [];
    const value = viewPropertyValue(row, property.key, occurrence);
    const formatted = formatPropertyValue(value, property.format);
    if (suppressRoutineDefaults && isRoutineTaskDefault(property.key, value))
      return [];
    return formatted === null
      ? []
      : [
          {
            key: property.key,
            label: property.label ?? propertyLabel(property.key),
            value: formatted,
            ...(property.description
              ? { description: property.description }
              : {}),
          },
        ];
  });
}

function isRoutineTaskDefault(key: string, value: unknown): boolean {
  const field = notePropertyName(key) ?? key;
  if (field === "status") return value === "open" || value === "none";
  if (field === "priority") return value === "normal" || value === "none";
  if (field === "completed" || field === "archived") return value === false;
  return false;
}

export function viewPropertyValue(
  row: TaskViewRow,
  key: string,
  occurrence?: TaskOccurrence,
): unknown {
  const displayed = occurrence ? occurrenceTask(occurrence) : row.task;
  const field = notePropertyName(key) ?? key;
  if (occurrence && Object.prototype.hasOwnProperty.call(displayed, field))
    return displayed[field as keyof Task];
  if (Object.prototype.hasOwnProperty.call(row.values, key))
    return row.values[key];
  return displayed.frontmatter[field];
}

export function propertyLabel(key: string): string {
  const name = (notePropertyName(key) ?? key).split(".").at(-1) ?? key;
  const words = name
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : key;
}

export function formatPropertyValue(
  value: unknown,
  format?: string,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) {
    const values = value
      .map((item) => formatPropertyValue(item))
      .filter((item): item is string => item !== null);
    return values.length ? values.join(", ") : null;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return new Intl.NumberFormat().format(value);
  if (typeof value === "string") {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
    if (format === "date" || dateOnly || dateTime) {
      const date = dateFromStorage(value);
      if (date)
        return new Intl.DateTimeFormat(undefined, {
          day: "numeric",
          month: "short",
          ...(dateTime
            ? {
                hour: "numeric",
                minute: "2-digit",
              }
            : {}),
          year:
            date.getFullYear() === new Date().getFullYear()
              ? undefined
              : "numeric",
        }).format(date);
    }
    if (
      value.includes("<") &&
      value.includes(">") &&
      typeof DOMParser !== "undefined"
    ) {
      const text = new DOMParser()
        .parseFromString(value, "text/html")
        .body.textContent?.trim();
      if (text) return text;
    }
    return value;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (typeof object.path === "string") return object.path;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function isIdentityProperty(key: string, identityProperty: string): boolean {
  if (key === "file.name" || key === "file.basename") return true;
  return (notePropertyName(key) ?? key) === identityProperty;
}

function notePropertyName(key: string): string | undefined {
  if (key.startsWith("note.")) return key.slice("note.".length);
  const match = /^note\[(["'])(.+)\1\]$/.exec(key);
  return match?.[2];
}
