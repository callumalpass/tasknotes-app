import { resolveModelConfig } from "@tasknotes/model/config";
import { resolveTaskNotesModelConfigFromMdbaseType } from "@tasknotes/model/mdbase";

import type {
  PriorityConfig,
  StatusConfig,
  TaskNotesModelConfig,
  UserMappedField,
  UserMappedFieldType,
} from "@tasknotes/model/types";
import type { TaskNotesMdbaseTypeSettingsPatch } from "@tasknotes/model/mdbase";

export type TaskModelSettingsPatch = TaskNotesMdbaseTypeSettingsPatch;

export interface TaskModelSettingsAccess {
  writable: boolean;
  source: string;
  reason?: string;
}

export interface TaskTemplatingConfiguration {
  enabled: boolean;
  templatePath?: string;
  failureMode: "error" | "warning_fallback";
  unknownVariablePolicy: "preserve" | "empty";
}

export interface TaskArchiveConfiguration {
  moveOnArchive: boolean;
  folder: string;
}

export interface TaskFieldCompletionConfiguration {
  kind: "values" | "records";
  values?: Array<{ value: string; label?: string }>;
  targetTypes?: string[];
}

export interface TaskUserMappedField extends UserMappedField {
  required?: true;
  readOnly?: true;
  inputKind?: "enum" | "datetime";
  options?: Array<{ value: string; label?: string }>;
}

export type TaskCollectionConfiguration = Omit<
  TaskNotesModelConfig,
  "userFields"
> & {
  userFields: TaskUserMappedField[];
  templating: TaskTemplatingConfiguration;
  archive: TaskArchiveConfiguration;
  fieldCompletions: Record<string, TaskFieldCompletionConfiguration>;
  linkWriteFormat: "wikilink" | "markdown";
};

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
  const implementation = taskNotesImplementation(value);
  const extension = record(implementation.binding);
  const schema = record(record(value.schema).value);
  const properties = record(schema.properties);
  const required = new Set(stringList(schema.required));
  const collectionLinks = record(record(value.collection).links);
  const statuses = resolveStatuses(base.statuses, record(extension.status));
  const priorities = resolvePriorities(
    base.priorities,
    record(extension.priority),
  );
  const inferredFields = inferUserFields(
    properties,
    base.fieldMapping,
    required,
  );
  const configuredFields = base.userFields.filter(
    (field) => field.id !== field.key,
  );
  const explicitKeys = new Set(configuredFields.map((field) => field.key));
  const explicitFields = configuredFields.map((field) =>
    enrichUserField(field, record(properties[field.key]), required),
  );

  return withCollectionDefaults(
    resolveModelConfig({
      ...base,
      statuses,
      priorities,
      occurrences: resolveOccurrences(
        base.occurrences,
        record(extension.occurrences),
      ),
      userFields: [
        ...explicitFields,
        ...inferredFields.filter((field) => !explicitKeys.has(field.key)),
      ],
    }),
    extension,
    properties,
    collectionLinks,
  );
}

function taskNotesImplementation(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const implementations = Array.isArray(value.implements)
    ? value.implements
    : [];
  return (
    implementations
      .map(record)
      .find(
        (implementation) =>
          implementation.contract === "tasknotes.task" &&
          implementation.version === "0.3.0-rc.1",
      ) ?? {}
  );
}

function withCollectionDefaults(
  model: TaskNotesModelConfig,
  extension: Record<string, unknown> = {},
  properties: Record<string, unknown> = {},
  collectionLinks: Record<string, unknown> = {},
): TaskCollectionConfiguration {
  const templating = record(extension.templating);
  const archive = record(extension.archive);
  const links = record(extension.links);
  return {
    ...model,
    templating: {
      enabled: boolean(templating.enabled) ?? false,
      templatePath:
        string(templating.template_path) ?? string(templating.templatePath),
      failureMode:
        templating.failure_mode === "error" ||
        templating.failureMode === "error"
          ? "error"
          : "warning_fallback",
      unknownVariablePolicy:
        templating.unknown_variable_policy === "empty" ||
        templating.unknownVariablePolicy === "empty"
          ? "empty"
          : "preserve",
    },
    archive: {
      moveOnArchive:
        boolean(archive.move_on_archive) ??
        boolean(archive.moveOnArchive) ??
        false,
      folder: string(archive.folder) ?? "TaskNotes/Archive",
    },
    fieldCompletions: completionConfiguration(
      model,
      properties,
      collectionLinks,
    ),
    linkWriteFormat:
      links.write_format === "markdown" ||
      links.writeFormat === "markdown" ||
      links.use_markdown_format === true ||
      links.useMarkdownFormat === true
        ? "markdown"
        : "wikilink",
  };
}

function completionConfiguration(
  model: TaskNotesModelConfig,
  properties: Record<string, unknown>,
  collectionLinks: Record<string, unknown>,
): Record<string, TaskFieldCompletionConfiguration> {
  const result: Record<string, TaskFieldCompletionConfiguration> = {
    [model.fieldMapping.projects]: { kind: "records" },
    [model.fieldMapping.contexts]: { kind: "values" },
    tags: { kind: "values" },
  };

  for (const [key, raw] of Object.entries(properties)) {
    const property = record(raw);
    const values = enumValues(property);
    if (values.length) result[key] = { kind: "values", values };
  }

  for (const [key, raw] of Object.entries(collectionLinks)) {
    const link = record(raw);
    const target = string(link.target_type);
    result[key] = {
      kind: "records",
      ...(target && target !== "any" ? { targetTypes: [target] } : {}),
    };
  }
  return result;
}

function enumValues(
  property: Record<string, unknown>,
): Array<{ value: string }> {
  const direct = stringList(property.enum);
  const items = stringList(record(property.items).enum);
  return [...new Set([...direct, ...items])].map((value) => ({ value }));
}

function resolveStatuses(
  base: StatusConfig[],
  status: Record<string, unknown>,
): StatusConfig[] {
  const completedValues = new Set(stringList(status.completed_values));
  const skippedValues = new Set(stringList(status.skipped_values));
  const definitions = objectList(status.definitions);
  if (!definitions.length && !completedValues.size && !skippedValues.size)
    return base;
  const byValue = new Map(
    definitions.flatMap((definition) => {
      const value = string(definition.value);
      return value ? [[value, definition] as const] : [];
    }),
  );
  return base.map((entry, index) => {
    const definition = byValue.get(entry.value) ?? {};
    return {
      ...entry,
      label: string(definition.label) ?? entry.label,
      color: string(definition.color) ?? entry.color,
      icon: string(definition.icon) ?? entry.icon,
      order: integer(definition.order) ?? entry.order ?? index,
      isCompleted:
        boolean(definition.is_completed) ??
        boolean(definition.isCompleted) ??
        (completedValues.size ? completedValues.has(entry.value) : undefined) ??
        entry.isCompleted,
      isSkipped:
        boolean(definition.is_skipped) ??
        boolean(definition.isSkipped) ??
        (skippedValues.size ? skippedValues.has(entry.value) : undefined) ??
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

function resolveOccurrences(
  base: TaskNotesModelConfig["occurrences"],
  occurrences: Record<string, unknown>,
): TaskNotesModelConfig["occurrences"] {
  const mode =
    occurrences.default_materialization ?? occurrences.defaultMaterialization;
  const trigger =
    occurrences.default_next_trigger ?? occurrences.defaultNextTrigger;
  return {
    ...base,
    defaultMaterialization:
      mode === "manual" || mode === "on_completion" || mode === "rolling"
        ? mode
        : base.defaultMaterialization,
    defaultNextTrigger:
      trigger === "completion" || trigger === "completion_or_skip"
        ? trigger
        : base.defaultNextTrigger,
    pastHorizon:
      string(occurrences.past_horizon) ??
      string(occurrences.pastHorizon) ??
      base.pastHorizon,
    futureHorizon:
      string(occurrences.future_horizon) ??
      string(occurrences.futureHorizon) ??
      base.futureHorizon,
  };
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
  required: ReadonlySet<string>,
): TaskUserMappedField[] {
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
      enrichUserField(
        {
          id: `schema:${key}`,
          key,
          displayName: string(property.title) ?? humanize(key),
          type,
          ...(defaultValue === undefined ? {} : { defaultValue }),
        },
        property,
        required,
      ),
    ];
  });
}

function enrichUserField(
  field: UserMappedField,
  property: Record<string, unknown>,
  required: ReadonlySet<string>,
): TaskUserMappedField {
  const options = enumValues(property);
  const format =
    string(property.format) ??
    (Array.isArray(property.anyOf)
      ? property.anyOf
          .map(record)
          .map((value) => string(value.format))
          .find(Boolean)
      : undefined);
  return {
    ...field,
    ...(required.has(field.key) ? { required: true as const } : {}),
    ...(property.readOnly === true ? { readOnly: true as const } : {}),
    ...(options.length
      ? { inputKind: "enum" as const, options }
      : format === "date-time"
        ? { inputKind: "datetime" as const }
        : {}),
  };
}

function editableFieldType(
  property: Record<string, unknown>,
): UserMappedFieldType | null {
  if (enumValues(property).length) return "text";
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

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
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
