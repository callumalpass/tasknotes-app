import { resolveModelConfig } from "@tasknotes/model/config";
import { resolveTaskNotesModelConfigFromMdbaseType } from "@tasknotes/model/mdbase";
import {
  applyTaskNotesAppSettingsToModelConfig,
  resolveTaskNotesAppSettings,
  type TaskNotesAppSettingsChanges,
  type TaskNotesAppSettingsValues,
  type TaskNotesStatusBehavior,
} from "@tasknotes/model/settings";

import type {
  PriorityConfig,
  StatusConfig,
  TaskNotesModelConfig,
  UserMappedField,
  UserMappedFieldType,
} from "@tasknotes/model/types";
import type { TaskNotesMdbaseTypeSettingsPatch } from "@tasknotes/model/mdbase";

import { editableFieldSchema } from "./editable-field-schema";
import { taskNotesImplementationOf } from "./tasknotes-contract";

/**
 * A settings save as the settings screen describes it. Fields the
 * tasknotes.task binding keeps go to the task type; app behaviour
 * (templating, archive moves, time tracking, checkbox resets, link format and
 * per-status automation) goes to the TaskNotes settings record. See
 * splitTaskModelSettingsPatch.
 */
export interface TaskModelSettingsPatch extends Omit<
  TaskNotesMdbaseTypeSettingsPatch,
  "recurrence"
> {
  recurrence?: {
    maintainDueDateOffset?: boolean;
    resetCheckboxesOnRecurrence?: boolean;
  };
  timeTracking?: { autoStopOnComplete?: boolean };
  links?: { writeFormat?: "wikilink" | "markdown" };
  archive?: { moveOnArchive?: boolean; folder?: string };
  templating?: { enabled?: boolean; templatePath?: string };
  statusAutomation?: Record<
    string,
    { autoArchive?: boolean; autoArchiveDelay?: number }
  >;
}

export interface TaskModelSettingsAccess {
  writable: boolean;
  source: string;
  reason?: string;
  /**
   * Whether app behaviour, kept in the TaskNotes settings record, can be
   * saved. Absent means it follows `writable`.
   */
  appSettings?: { writable: boolean; reason?: string };
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
  options: {
    /**
     * Frontmatter of the TaskNotes settings record, when there is one. Each
     * of its fields wins over an earlier binding's, which wins over the
     * default, so a missing or late record never loses a value.
     */
    settings?: Readonly<Record<string, unknown>>;
  } = {},
): TaskCollectionConfiguration {
  const base = resolveTaskNotesModelConfigFromMdbaseType(
    value,
    {},
    options.settings ? { settings: options.settings } : {},
  );
  const implementation = taskNotesImplementationOf(value) ?? {};
  const extension = record(implementation.binding);
  const appSettings = resolveTaskNotesAppSettings(options.settings, {
    legacyBinding: extension,
    fallback: legacyAliases(extension),
  }).values;
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
    applyTaskNotesAppSettingsToModelConfig(
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
      appSettings,
    ),
    appSettings,
    properties,
    collectionLinks,
  );
}

/** The default app folder for archived tasks when the collection names none. */
export const DEFAULT_ARCHIVE_FOLDER = "TaskNotes/Archive";

function withCollectionDefaults(
  model: TaskNotesModelConfig,
  settings?: TaskNotesAppSettingsValues,
  properties: Record<string, unknown> = {},
  collectionLinks: Record<string, unknown> = {},
): TaskCollectionConfiguration {
  return {
    ...model,
    templating: {
      enabled: settings?.template_enabled ?? false,
      templatePath: settings?.template_path || undefined,
      failureMode: settings?.template_failure_mode ?? "warning_fallback",
      unknownVariablePolicy:
        settings?.template_unknown_variable_policy ?? "preserve",
    },
    archive: {
      moveOnArchive: settings?.move_on_archive ?? false,
      folder: settings?.archive_folder || DEFAULT_ARCHIVE_FOLDER,
    },
    fieldCompletions: completionConfiguration(
      model,
      properties,
      collectionLinks,
    ),
    linkWriteFormat: settings?.link_write_format ?? "wikilink",
  };
}

/**
 * Camel-case spellings early TaskNotes bindings used. They are read after the
 * settings record and the binding's own fields.
 */
function legacyAliases(
  extension: Record<string, unknown>,
): Partial<TaskNotesAppSettingsValues> {
  const templating = record(extension.templating);
  const archive = record(extension.archive);
  const links = record(extension.links);
  const templatePath = string(templating.templatePath);
  const moveOnArchive = boolean(archive.moveOnArchive);
  return {
    ...(templatePath ? { template_path: templatePath } : {}),
    ...(templating.failureMode === "error" ||
    templating.failureMode === "warning_fallback"
      ? { template_failure_mode: templating.failureMode }
      : {}),
    ...(templating.unknownVariablePolicy === "empty" ||
    templating.unknownVariablePolicy === "preserve"
      ? { template_unknown_variable_policy: templating.unknownVariablePolicy }
      : {}),
    ...(moveOnArchive !== undefined ? { move_on_archive: moveOnArchive } : {}),
    ...(links.writeFormat === "markdown" ||
    links.use_markdown_format === true ||
    links.useMarkdownFormat === true
      ? { link_write_format: "markdown" as const }
      : {}),
  };
}

/**
 * Split a settings save between the task type and the TaskNotes settings
 * record. Only app settings whose value differs from `current` become record
 * changes. `status_behavior` holds only the statuses that changed; expand it
 * with taskNotesSettingsChanges before saving.
 */
export function splitTaskModelSettingsPatch(
  patch: TaskModelSettingsPatch,
  current: TaskCollectionConfiguration,
): {
  type: TaskNotesMdbaseTypeSettingsPatch;
  app: TaskNotesAppSettingsChanges;
} {
  const type: TaskNotesMdbaseTypeSettingsPatch = {
    ...(patch.defaultStatus !== undefined
      ? { defaultStatus: patch.defaultStatus }
      : {}),
    ...(patch.defaultPriority !== undefined
      ? { defaultPriority: patch.defaultPriority }
      : {}),
    ...(patch.recurrence?.maintainDueDateOffset !== undefined
      ? {
          recurrence: {
            maintainDueDateOffset: patch.recurrence.maintainDueDateOffset,
          },
        }
      : {}),
    ...(patch.occurrences ? { occurrences: patch.occurrences } : {}),
  };
  const app: TaskNotesAppSettingsChanges = {};
  const reset = patch.recurrence?.resetCheckboxesOnRecurrence;
  if (
    reset !== undefined &&
    reset !== current.recurrence.resetCheckboxesOnRecurrence
  )
    app.reset_body_checkboxes_on_recurrence = reset;
  const autoStop = patch.timeTracking?.autoStopOnComplete;
  if (
    autoStop !== undefined &&
    autoStop !== current.timeTracking.autoStopOnComplete
  )
    app.auto_stop_time_tracking_on_complete = autoStop;
  const writeFormat = patch.links?.writeFormat;
  if (writeFormat !== undefined && writeFormat !== current.linkWriteFormat)
    app.link_write_format = writeFormat;
  const moveOnArchive = patch.archive?.moveOnArchive;
  if (
    moveOnArchive !== undefined &&
    moveOnArchive !== current.archive.moveOnArchive
  )
    app.move_on_archive = moveOnArchive;
  if (patch.archive?.folder !== undefined) {
    const folder = cleanFolder(patch.archive.folder, "archive folder");
    if ((folder || DEFAULT_ARCHIVE_FOLDER) !== current.archive.folder)
      app.archive_folder = folder;
  }
  const templatePath =
    patch.templating?.templatePath !== undefined
      ? cleanFolder(patch.templating.templatePath, "template path")
      : undefined;
  if (
    templatePath !== undefined &&
    templatePath !== (current.templating.templatePath ?? "")
  )
    app.template_path = templatePath;
  const templateEnabled = patch.templating?.enabled;
  if (
    templateEnabled !== undefined &&
    templateEnabled !== current.templating.enabled
  )
    app.template_enabled = templateEnabled;
  if (
    (templateEnabled ?? current.templating.enabled) &&
    !(templatePath ?? current.templating.templatePath ?? "")
  )
    throw new Error(
      "template path must be set before task templating is enabled.",
    );
  const behaviors: Record<string, TaskNotesStatusBehavior> = {};
  for (const [value, automation] of Object.entries(
    patch.statusAutomation ?? {},
  )) {
    const status = current.statuses.find(
      (candidate) => candidate.value === value,
    );
    if (!status) throw new Error(`Unknown task status "${value}".`);
    const delay = automation.autoArchiveDelay;
    if (delay !== undefined && (!Number.isInteger(delay) || delay < 0))
      throw new Error(
        `Auto-archive delay for "${value}" must be a non-negative integer.`,
      );
    const behavior: TaskNotesStatusBehavior = {};
    if (
      automation.autoArchive !== undefined &&
      automation.autoArchive !== status.autoArchive
    )
      behavior.auto_archive = automation.autoArchive;
    if (delay !== undefined && delay !== status.autoArchiveDelay)
      behavior.auto_archive_delay_minutes = delay;
    if (Object.keys(behavior).length) behaviors[value] = behavior;
  }
  if (Object.keys(behaviors).length) app.status_behavior = behaviors;
  return { type, app };
}

/**
 * The record changes for `app`, with `status_behavior` merged into the map
 * the record already holds, so a save never drops another status's entry.
 */
export function taskNotesSettingsChanges(
  app: TaskNotesAppSettingsChanges,
  frontmatter: Readonly<Record<string, unknown>> | undefined,
): TaskNotesAppSettingsChanges {
  if (!app.status_behavior) return app;
  const stored =
    resolveTaskNotesAppSettings(frontmatter).stored.status_behavior ?? {};
  const merged: Record<string, TaskNotesStatusBehavior> = {
    ...structuredClone(stored),
  };
  for (const [status, behavior] of Object.entries(app.status_behavior))
    merged[status] = { ...merged[status], ...behavior };
  return { ...app, status_behavior: merged };
}

function cleanFolder(value: string, label: string): string {
  const path = value.trim().replace(/^\/+|\/+$/g, "");
  if (path.split("/").some((part) => part === ".." || part === "."))
    throw new Error(`The ${label} must stay inside the collection.`);
  return path;
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
      // Cycling and auto-archive are app settings: the settings record, then
      // an earlier binding's definitions (see resolveTaskNotesAppSettings).
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
    const editable = editableFieldSchema(property);
    if (!editable) return [];
    const { type } = editable;
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
  const editable = editableFieldSchema(property);
  return {
    ...field,
    ...(required.has(field.key) ? { required: true as const } : {}),
    ...(property.readOnly === true ? { readOnly: true as const } : {}),
    ...(options.length
      ? { inputKind: "enum" as const, options }
      : editable?.inputKind === "datetime"
        ? { inputKind: "datetime" as const }
        : {}),
  };
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
