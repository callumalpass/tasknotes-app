import type {
  CollectionContractDescriptor,
  CollectionTypeDescriptor,
  JsonObject,
} from "@mdbase-dev/connect";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { resolveTaskCollectionConfiguration } from "../domain/task-configuration";
import {
  readableTaskNotesContract,
  taskNotesImplementationOf,
  TASKNOTES_MISSING_CONTRACT_MESSAGE,
} from "../domain/tasknotes-contract";

export interface TaskCollectionResources {
  contracts: CollectionContractDescriptor[];
  types: CollectionTypeDescriptor[];
}

export interface ResolvedTaskCollection {
  model: TaskNotesTaskModel;
  typeName: string;
  providers: ResolvedTaskProvider[];
}

export interface ResolvedTaskProvider {
  model: TaskNotesTaskModel;
  typeName: string;
}

/**
 * The collection's TaskNotes providers. The current tasknotes.task contract
 * is preferred; a collection still on an earlier readable contract (rc.5)
 * resolves too, reading moved settings from its binding after the record.
 */
export function resolveTaskCollection(
  resources: TaskCollectionResources,
  options: { settings?: Readonly<Record<string, unknown>> } = {},
): ResolvedTaskCollection {
  const contract = readableTaskNotesContract(resources.contracts);
  if (!contract) throw new Error(TASKNOTES_MISSING_CONTRACT_MESSAGE);
  const providers = contract.implementations.map((implementation) => {
    const type = resources.types.find(
      (candidate) => candidate.name === implementation.typeName,
    );
    if (!type)
      throw new Error(
        `The TaskNotes implementation type "${implementation.typeName}" is missing.`,
      );
    return resolveTaskTypeDefinition(type.definition ?? {}, {
      typeName: implementation.typeName,
      schema: type.schema,
      fields: implementation.fields,
      collection: type.collection,
      configuration: implementation.binding,
      version: contract.version,
      settings: options.settings,
    });
  });
  if (!providers.length)
    throw new Error("The TaskNotes contract has no implementing types.");
  return { ...providers[0], providers };
}

export function resolveTaskTypeDefinition(
  definition: Record<string, unknown>,
  overrides: {
    typeName?: string;
    schema?: JsonObject;
    fields?: JsonObject;
    collection?: JsonObject;
    configuration?: JsonObject;
    /** The tasknotes.task version the catalog says the type implements. */
    version?: string;
    /** Frontmatter of the TaskNotes settings record, when there is one. */
    settings?: Readonly<Record<string, unknown>>;
  } = {},
): ResolvedTaskProvider {
  const declared = taskNotesImplementationOf(definition) as
    { version?: string; fields?: JsonObject; binding?: JsonObject } | undefined;
  const configuration = overrides.configuration ?? declared?.binding;
  const fields = overrides.fields ?? declared?.fields;
  const implementation = {
    contract: "tasknotes.task",
    version:
      overrides.version ??
      (typeof declared?.version === "string"
        ? declared.version
        : TASKNOTES_SPEC_VERSION),
    fields: fields ?? {},
    binding: configuration ?? {},
  };
  if (overrides.configuration === undefined && !declared)
    throw new Error("This type does not provide the TaskNotes task contract.");
  const schema =
    overrides.schema ??
    ((definition.schema as Record<string, unknown> | undefined)?.value as
      JsonObject | undefined);
  const collection =
    overrides.collection ?? (definition.collection as JsonObject | undefined);
  const typeName =
    overrides.typeName ??
    (typeof definition.name === "string" ? definition.name : undefined);
  if (!typeName)
    throw new Error("The TaskNotes task type does not have a name.");
  const taskRecordsFolder = recordsFolder(collection);
  return {
    typeName,
    model: new TaskNotesTaskModel(
      resolveTaskCollectionConfiguration(
        {
          ...definition,
          schema: { value: schema },
          collection,
          implements: [implementation],
        },
        overrides.settings ? { settings: overrides.settings } : {},
      ),
      {
        recordsFolder: taskRecordsFolder,
        pathPattern:
          pathPattern(collection) ??
          taskNotesPathPattern(configuration, taskRecordsFolder),
      },
    ),
  };
}

function pathPattern(collection: JsonObject | undefined): string | undefined {
  const path = collection?.path;
  if (!path || typeof path !== "object" || Array.isArray(path))
    return undefined;
  const descriptor = path as Record<string, unknown>;
  const pattern = descriptor.pattern ?? descriptor.template;
  if (typeof pattern !== "string" || !pattern.trim()) return undefined;
  const template = pattern.trim().replace(/^\/+/, "");
  const folder =
    typeof descriptor.folder === "string"
      ? descriptor.folder.trim().replace(/^\/+|\/+$/g, "")
      : "";
  if (!folder || template === folder || template.startsWith(`${folder}/`))
    return template;
  return `${folder}/${template}`;
}

function recordsFolder(collection: JsonObject | undefined): string {
  const path = collection?.path;
  if (!path || typeof path !== "object" || Array.isArray(path)) return "tasks";
  const descriptor = path as Record<string, unknown>;
  const folder = descriptor.folder;
  if (typeof folder === "string" && folder.trim()) return folder;
  const pattern = descriptor.pattern ?? descriptor.template;
  if (typeof pattern !== "string") return "tasks";
  const marker = pattern.search(/\{[^}]+\}/);
  const prefix = (marker < 0 ? pattern : pattern.slice(0, marker))
    .replace(/\/+$/g, "")
    .trim();
  return prefix || "tasks";
}

function taskNotesPathPattern(
  configuration: JsonObject | undefined,
  folder: string,
): string {
  const rawTitle = configuration?.title;
  const title =
    rawTitle && typeof rawTitle === "object" && !Array.isArray(rawTitle)
      ? (rawTitle as Record<string, unknown>)
      : {};
  const format = title.storage === "filename" ? "title" : title.filename_format;
  const template =
    format === "title"
      ? "{{title}}"
      : format === "timestamp"
        ? "{{timestamp}}"
        : format === "uuid"
          ? "{{uuid}}"
          : format === "custom" &&
              typeof title.custom_filename_template === "string" &&
              title.custom_filename_template.trim()
            ? title.custom_filename_template.trim()
            : "{{zettel}}";
  return `${folder.replace(/^\/+|\/+$/g, "") || "tasks"}/${template}`;
}
