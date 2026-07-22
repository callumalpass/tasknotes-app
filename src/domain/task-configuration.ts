import { resolveModelConfig } from "@tasknotes/model/config";
import { resolveTaskNotesModelConfigFromMdbaseType } from "@tasknotes/model/mdbase";

import type {
  PriorityConfig,
  StatusConfig,
  TaskNotesModelConfig,
  UserMappedField,
  UserMappedFieldType,
} from "@tasknotes/model/types";

export interface TaskTemplatingConfiguration {
  enabled: boolean;
  templatePath?: string;
  failureMode: "error_abort" | "warning_fallback";
  unknownVariablePolicy: "preserve" | "error" | "empty";
}

export interface TaskArchiveConfiguration {
  moveOnArchive: boolean;
  folder: string;
}

export interface TaskCollectionConfiguration extends TaskNotesModelConfig {
  templating: TaskTemplatingConfiguration;
  archive: TaskArchiveConfiguration;
}

export function defaultTaskCollectionConfiguration(): TaskCollectionConfiguration {
  return withCollectionDefaults(resolveModelConfig());
}

/**
 * Resolve the portable TaskNotes contract and enrich it with generic JSON
 * Schema properties that are safe to edit as custom fields. The shared model
 * owns TaskNotes semantics; this adapter owns the app's form vocabulary.
 */
export function resolveTaskCollectionConfiguration(
  value: Record<string, unknown>,
): TaskCollectionConfiguration {
  const base = resolveTaskNotesModelConfigFromMdbaseType(value);
  const extension = record(value["x-tasknotes"]);
  const schema = record(record(value.schema).value);
  const properties = record(schema.properties);
  const statuses = resolveStatuses(base.statuses, record(extension.status));
  const priorities = resolvePriorities(
    base.priorities,
    record(extension.priority),
  );
  const inferredFields = inferUserFields(properties, base.fieldMapping);
  const explicitKeys = new Set(base.userFields.map((field) => field.key));

  return withCollectionDefaults(
    resolveModelConfig({
      ...base,
      statuses,
      priorities,
      userFields: [
        ...base.userFields,
        ...inferredFields.filter((field) => !explicitKeys.has(field.key)),
      ],
    }),
    extension,
  );
}

function withCollectionDefaults(
  model: TaskNotesModelConfig,
  extension: Record<string, unknown> = {},
): TaskCollectionConfiguration {
  const templating = record(extension.templating);
  const archive = record(extension.archive);
  return {
    ...model,
    templating: {
      enabled: boolean(templating.enabled) ?? false,
      templatePath:
        string(templating.template_path) ?? string(templating.templatePath),
      failureMode:
        templating.failure_mode === "error_abort" ||
        templating.failureMode === "error_abort"
          ? "error_abort"
          : "warning_fallback",
      unknownVariablePolicy:
        templating.unknown_variable_policy === "empty" ||
        templating.unknownVariablePolicy === "empty"
          ? "empty"
          : templating.unknown_variable_policy === "error" ||
              templating.unknownVariablePolicy === "error"
            ? "error"
            : "preserve",
    },
    archive: {
      moveOnArchive:
        boolean(archive.move_on_archive) ??
        boolean(archive.moveOnArchive) ??
        false,
      folder: string(archive.folder) ?? "TaskNotes/Archive",
    },
  };
}

function resolveStatuses(
  base: StatusConfig[],
  status: Record<string, unknown>,
): StatusConfig[] {
  const definitions = objectList(status.definitions);
  if (!definitions.length) return base;
  const byValue = new Map(
    definitions.flatMap((definition) => {
      const value = string(definition.value);
      return value ? [[value, definition] as const] : [];
    }),
  );
  return base.map((entry, index) => {
    const definition = byValue.get(entry.value);
    if (!definition) return entry;
    return {
      ...entry,
      label: string(definition.label) ?? entry.label,
      color: string(definition.color) ?? entry.color,
      icon: string(definition.icon) ?? entry.icon,
      order: integer(definition.order) ?? entry.order ?? index,
      isCompleted:
        boolean(definition.is_completed) ??
        boolean(definition.isCompleted) ??
        entry.isCompleted,
      isSkipped:
        boolean(definition.is_skipped) ??
        boolean(definition.isSkipped) ??
        entry.isSkipped,
      excludeFromCycle:
        boolean(definition.exclude_from_cycle) ??
        boolean(definition.excludeFromCycle) ??
        entry.excludeFromCycle,
      nextStatus:
        string(definition.next_status) ??
        string(definition.nextStatus) ??
        entry.nextStatus,
      autoArchive:
        boolean(definition.auto_archive) ??
        boolean(definition.autoArchive) ??
        entry.autoArchive,
      autoArchiveDelay:
        integer(definition.auto_archive_delay_minutes) ??
        integer(definition.autoArchiveDelay) ??
        entry.autoArchiveDelay,
    };
  });
}

function resolvePriorities(
  base: PriorityConfig[],
  priority: Record<string, unknown>,
): PriorityConfig[] {
  const definitions = objectList(priority.definitions);
  if (!definitions.length) return base;
  const byValue = new Map(
    definitions.flatMap((definition) => {
      const value = string(definition.value);
      return value ? [[value, definition] as const] : [];
    }),
  );
  return base.map((entry, index) => {
    const definition = byValue.get(entry.value);
    if (!definition) return entry;
    return {
      ...entry,
      label: string(definition.label) ?? entry.label,
      color: string(definition.color) ?? entry.color,
      icon: string(definition.icon) ?? entry.icon,
      weight: number(definition.weight) ?? entry.weight ?? index,
    };
  });
}

function inferUserFields(
  properties: Record<string, unknown>,
  fieldMapping: TaskNotesModelConfig["fieldMapping"],
): UserMappedField[] {
  const reserved = new Set([
    ...Object.values(fieldMapping),
    "type",
    "types",
    "id",
    "tags",
    "mobileRevision",
  ]);
  return Object.entries(properties).flatMap(([key, rawSchema]) => {
    if (reserved.has(key)) return [];
    const property = record(rawSchema);
    const type = editableFieldType(property);
    if (!type) return [];
    const defaultValue = editableDefault(property.default, type);
    return [
      {
        id: `schema:${key}`,
        key,
        displayName: string(property.title) ?? humanize(key),
        type,
        ...(defaultValue === undefined ? {} : { defaultValue }),
      },
    ];
  });
}

function editableFieldType(
  property: Record<string, unknown>,
): UserMappedFieldType | null {
  if (property.type === "boolean") return "boolean";
  if (property.type === "number" || property.type === "integer")
    return "number";
  if (property.type === "array") {
    const items = record(property.items);
    return items.type === "string" ? "list" : null;
  }
  if (property.type === "string")
    return property.format === "date" ? "date" : "text";
  if (Array.isArray(property.anyOf)) {
    const variants = property.anyOf.map(record);
    if (
      variants.some(
        (variant) => variant.type === "string" && variant.format === "date",
      )
    )
      return "date";
  }
  return null;
}

function editableDefault(
  value: unknown,
  type: UserMappedFieldType,
): UserMappedField["defaultValue"] | undefined {
  if (type === "boolean" && typeof value === "boolean") return value;
  if (type === "number" && typeof value === "number") return value;
  if ((type === "text" || type === "date") && typeof value === "string")
    return value;
  if (
    type === "list" &&
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
  )
    return value;
  return undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function objectList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function humanize(value: string): string {
  const words = value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : value;
}
