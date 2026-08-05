import type {
  CollectionContractDescriptor,
  CollectionTypeDescriptor,
  JsonObject,
} from "@mdbase-dev/connect";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { resolveTaskCollectionConfiguration } from "../domain/task-configuration";

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

export function resolveTaskCollection(
  resources: TaskCollectionResources,
): ResolvedTaskCollection {
  const contract = resources.contracts.find(
    (candidate) =>
      candidate.id === "tasknotes.task" &&
      candidate.version === TASKNOTES_SPEC_VERSION &&
      candidate.digest === TASKNOTES_CONTRACT_DIGEST,
  );
  if (!contract)
    throw new Error(
      `This collection does not provide tasknotes.task ${TASKNOTES_SPEC_VERSION}.`,
    );
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
  } = {},
): ResolvedTaskProvider {
  const configuration =
    overrides.configuration ?? taskNotesImplementation(definition)?.binding;
  const fields =
    overrides.fields ?? taskNotesImplementation(definition)?.fields;
  const implementation = {
    contract: "tasknotes.task",
    version: TASKNOTES_SPEC_VERSION,
    fields: fields ?? {},
    binding: configuration ?? {},
  };
  if (
    overrides.configuration === undefined &&
    !taskNotesImplementation(definition)
  )
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
      resolveTaskCollectionConfiguration({
        ...definition,
        schema: { value: schema },
        collection,
        implements: [implementation],
      }),
      {
        typeName,
        recordsFolder: taskRecordsFolder,
        pathPattern:
          pathPattern(collection) ??
          taskNotesPathPattern(configuration, taskRecordsFolder),
      },
    ),
  };
}

function taskNotesImplementation(
  definition: Record<string, unknown>,
): { fields?: JsonObject; binding?: JsonObject } | undefined {
  const implementations = Array.isArray(definition.implements)
    ? definition.implements
    : [];
  return implementations.find(
    (
      candidate,
    ): candidate is {
      contract: string;
      version: string;
      fields?: JsonObject;
      binding?: JsonObject;
    } =>
      candidate !== null &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).contract === "tasknotes.task" &&
      (candidate as Record<string, unknown>).version === TASKNOTES_SPEC_VERSION,
  );
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
