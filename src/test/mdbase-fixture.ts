import {
  MdbaseConnectError,
  type CollectionDescription,
  type ConnectOutcome,
  type JsonObject,
  type MdbaseConnection,
  type MdbaseOperationEnvelope,
  type PendingMutation,
  type QueryRecord,
  type QueryResult,
} from "@mdbase-dev/connect";
import { connectError } from "@mdbase-dev/connect-testing";
import {
  buildTaskNotesMdbaseResources,
  TASKNOTES_CONTRACT_DIGEST,
} from "@tasknotes/model/mdbase";
import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import { vi } from "vitest";

import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { MdbaseTaskRepository } from "../storage/mdbase-repository";
import { MemoryCollectionFileStore } from "./memory-collection-files";

export function createTestMdbaseRepository(
  initial: TestRecord[] = [],
): MdbaseTaskRepository {
  const repository = new MdbaseTaskRepository(mdbaseFixture(initial).connect);
  Object.defineProperty(repository, "files", {
    value: new MemoryCollectionFileStore(),
  });
  return repository;
}

export function mdbaseFixture(
  initial: TestRecord[],
  templating = false,
  archive = false,
  collectionId = crypto.randomUUID(),
) {
  const records = new Map(initial.map((record) => [record.path, record]));
  const pendingMutations = new Map<string, PendingMutation<unknown>>();
  let revision = initial.length + 1;
  const described = description(templating, archive, collectionId);
  const initialDefinition = structuredClone(
    described.types[0]?.definition ?? {},
  );
  let typeRevision = 1;
  let typeDocument = {
    name: "task",
    path: "_types/task.md",
    revision: `type-r${typeRevision}`,
    document: serializeMarkdownDocument(
      initialDefinition as Record<string, unknown>,
      "# Task\n\nTask records live under `tasks/`.",
    ),
  };
  const describeCollection = vi.fn(
    async (options?: { signal?: AbortSignal }) => {
      void options;
      return structuredClone(described);
    },
  );
  const query = vi.fn(async (input?: Record<string, unknown>) => {
    const requestedTypes = Array.isArray(input?.types)
      ? new Set(input.types.map(String))
      : null;
    const matching = [...records.values()].filter(
      (record) =>
        !requestedTypes ||
        record.types.some((type) => requestedTypes.has(type)),
    );
    return valid<QueryResult<JsonObject>>({
      results: matching.map((record) => ({
        path: record.path,
        effectiveFrontmatter: record.effectiveFrontmatter ?? record.frontmatter,
        body: record.body,
        types: record.types,
        file: record.file ?? testQueryFile(record.path),
      })),
      meta: {
        totalCount: matching.length,
        hasMore: false,
        snapshot: "tasks-1",
      },
    });
  });
  const read = vi.fn(async ({ path }: { path: string }) => {
    const record = records.get(path);
    if (!record) throw new Error("Task not found.");
    return valid(record);
  });
  const create = vi.fn(
    async (input: {
      path?: string;
      type?: string;
      frontmatter: JsonObject;
      body?: string;
    }) => {
      const path = input.path ?? `tasks/${crypto.randomUUID()}.md`;
      if (records.has(path)) throw new Error(`Path already exists: ${path}`);
      const record: TestRecord = {
        path,
        frontmatter: structuredClone(input.frontmatter),
        body: input.body ?? "",
        types: [input.type ?? "task"],
        revision: `r${revision++}`,
      };
      records.set(path, record);
      return valid(record);
    },
  );
  const update = vi.fn(
    async (input: {
      path: string;
      patch: JsonObject;
      body?: string;
      ifRevision?: string;
    }) => {
      const current = records.get(input.path);
      if (!current) throw new Error("Task not found.");
      if (input.ifRevision !== current.revision)
        throw new Error("Revision conflict.");
      const frontmatter = structuredClone(current.frontmatter);
      for (const [key, value] of Object.entries(input.patch)) {
        if (value === null) delete frontmatter[key];
        else frontmatter[key] = structuredClone(value);
      }
      const record: TestRecord = {
        ...current,
        frontmatter,
        body: input.body ?? current.body,
        revision: `r${revision++}`,
      };
      records.set(input.path, record);
      return valid(record);
    },
  );
  const remove = vi.fn(async (input: { path: string; ifRevision?: string }) => {
    const current = records.get(input.path);
    if (!current) throw new Error("Task not found.");
    if (input.ifRevision !== current.revision)
      throw new Error("Revision conflict.");
    records.delete(input.path);
    return valid({ path: input.path, deleted: true });
  });
  const rename = vi.fn(
    async (input: {
      from: string;
      to: string;
      ifRevision?: string;
      updateRefs?: boolean;
    }) => {
      const current = records.get(input.from);
      if (!current) throw new Error("Task not found.");
      if (records.has(input.to)) throw new Error("Destination already exists.");
      if (input.ifRevision !== current.revision)
        throw new Error("Revision conflict.");
      const record: TestRecord = {
        ...current,
        path: input.to,
        revision: `r${revision++}`,
      };
      records.delete(input.from);
      records.set(input.to, record);
      return valid({ ...record, from: input.from, to: input.to });
    },
  );
  const listViews = vi.fn(async () =>
    valid({
      views: [
        {
          id: "tasks",
          name: "Tasks",
          source: {
            path: "views/tasks.base",
            format: "obsidian.base",
            revision: "sha256:view",
            writable: false,
          },
          views: [
            {
              id: "kanban",
              name: "Kanban",
              presentation: {
                type: "tasknotesKanban",
                options: {},
              },
            },
          ],
        },
      ],
      meta: { totalCount: 1 },
    }),
  );
  const executeView = vi.fn(async () =>
    valid({
      results: [...records.values()].map((record) => ({
        path: record.path,
        effectiveFrontmatter: record.effectiveFrontmatter ?? record.frontmatter,
        body: record.body,
        types: record.types,
        values: { status: record.frontmatter.status ?? "open" },
      })),
      meta: {
        totalCount: records.size,
        hasMore: false,
        view: { path: "views/tasks.base", id: "kanban" },
        groups: [],
      },
    }),
  );
  const viewSources = new Map<
    string,
    {
      path: string;
      format: "obsidian.base" | "mdbase.view";
      revision: string;
      document: string;
    }
  >([
    [
      "views/tasks.base",
      {
        path: "views/tasks.base",
        format: "obsidian.base" as const,
        revision: "view-r1",
        document: "views:\n  - name: Kanban\n    type: tasknotesKanban\n",
      },
    ],
  ]);
  let viewRevision = 2;
  const readViewSource = vi.fn(async ({ path }: { path: string }) => {
    const source = viewSources.get(path);
    if (!source) throw new Error("View source not found.");
    return valid(structuredClone(source));
  });
  const createViewSource = vi.fn(
    async (input: {
      path?: string;
      format: "obsidian.base" | "mdbase.view";
      name: string;
      document: string;
    }) => {
      const extension = input.format === "obsidian.base" ? "base" : "md";
      const path =
        input.path ??
        `views/${input.name.toLowerCase().replaceAll(" ", "-")}.${extension}`;
      const source = {
        path,
        format: input.format,
        revision: `view-r${viewRevision++}`,
        document: input.document,
      };
      viewSources.set(path, source);
      return valid(structuredClone(source));
    },
  );
  const updateViewSource = vi.fn(
    async (input: { path: string; document: string; ifRevision?: string }) => {
      const current = viewSources.get(input.path);
      if (!current) throw new Error("View source not found.");
      if (input.ifRevision !== current.revision)
        throw new Error("Revision conflict.");
      const source = {
        ...current,
        revision: `view-r${viewRevision++}`,
        document: input.document,
      };
      viewSources.set(input.path, source);
      return valid(structuredClone(source));
    },
  );
  const deleteViewSource = vi.fn(
    async (input: { path: string; ifRevision?: string }) => {
      const current = viewSources.get(input.path);
      if (!current) throw new Error("View source not found.");
      if (input.ifRevision !== current.revision)
        throw new Error("Revision conflict.");
      viewSources.delete(input.path);
      return valid({ path: input.path, deleted: true });
    },
  );
  const readType = vi.fn(
    async ({ name, path }: { name?: string; path?: string }) => {
      if (name !== typeDocument.name && path !== typeDocument.path)
        throw new Error("Type not found.");
      return valid(structuredClone(typeDocument));
    },
  );
  const updateType = vi.fn(
    async (input: { path?: string; document: string; ifRevision: string }) => {
      if (input.path !== typeDocument.path) throw new Error("Type not found.");
      if (input.ifRevision !== typeDocument.revision)
        throw new Error("Revision conflict.");
      const definition = parseFrontmatter(input.document).frontmatter;
      typeRevision += 1;
      typeDocument = {
        ...typeDocument,
        revision: `type-r${typeRevision}`,
        document: input.document,
      };
      const descriptor = described.types[0];
      if (descriptor) {
        descriptor.definition = structuredClone(definition) as JsonObject;
        descriptor.schema = structuredClone(
          (definition.schema as { value?: JsonObject } | undefined)?.value ??
            descriptor.schema,
        );
        descriptor.collection = structuredClone(
          (definition.collection as JsonObject | undefined) ??
            descriptor.collection,
        );
      }
      const implementation = Array.isArray(definition.implements)
        ? definition.implements.find(
            (candidate) =>
              candidate &&
              typeof candidate === "object" &&
              (candidate as Record<string, unknown>).contract ===
                "tasknotes.task",
          )
        : undefined;
      const binding =
        implementation && typeof implementation === "object"
          ? (implementation as Record<string, unknown>).binding
          : undefined;
      if (binding && typeof binding === "object" && !Array.isArray(binding))
        described.contracts[0]!.implementations[0]!.binding = structuredClone(
          binding,
        ) as JsonObject;
      return valid(structuredClone(typeDocument));
    },
  );
  const connect = {
    sync: () => null,
    connection: () => ({ route: "relay" }),
    pendingMutation: (requestId: string) =>
      pendingMutations.get(requestId) ?? null,
    pendingMutations: () => [...pendingMutations.values()],
    describe: describeCollection,
    query,
    read,
    create,
    update,
    delete: remove,
    rename,
    listViews,
    executeView,
    readViewSource,
    createViewSource,
    updateViewSource,
    deleteViewSource,
    readType,
    updateType,
  } as unknown as MdbaseConnection<JsonObject>;
  const stagePendingMutation = <Result>(
    requestId: string,
    recover: () => Promise<ConnectOutcome<Result>>,
  ) => {
    const handle: PendingMutation<Result> = {
      requestId,
      operation: "update",
      fingerprint: `fixture:${requestId}`,
      status: "outcome_unknown",
      createdAt: "2026-08-05T00:00:00.000Z",
      recover: vi.fn(async () => {
        const outcome = await recover();
        if (outcome.ok || outcome.problem.operation_outcome !== "unknown")
          pendingMutations.delete(requestId);
        return outcome;
      }),
    };
    pendingMutations.set(requestId, handle as PendingMutation<unknown>);
    return handle;
  };
  return {
    connect,
    records,
    describe: describeCollection,
    query,
    read,
    create,
    update,
    remove,
    rename,
    listViews,
    executeView,
    readViewSource,
    createViewSource,
    updateViewSource,
    deleteViewSource,
    readType,
    updateType,
    stagePendingMutation,
  };
}

export function taskRecord(
  id: string,
  title: string,
  revision: string,
): TestRecord {
  const task = new TaskNotesTaskModel().create(
    { title },
    { id, now: "2026-07-22T00:00:00.000Z" },
  );
  return {
    path: task.path,
    frontmatter: structuredClone(task.frontmatter) as JsonObject,
    body: task.body,
    types: ["task"],
    revision,
  };
}

export interface TestRecord {
  path: string;
  frontmatter: JsonObject;
  effectiveFrontmatter?: JsonObject;
  body: string;
  types: string[];
  revision: string;
  file?: QueryRecord<JsonObject>["file"];
}

function testQueryFile(path: string): QueryRecord<JsonObject>["file"] {
  const segments = path.split("/");
  return {
    path,
    name: segments.at(-1) ?? path,
    folder: segments.slice(0, -1).join("/"),
    size: 0,
    mtime: "2026-07-22T00:00:00.000Z",
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

export function unknownOutcome(): MdbaseConnectError {
  return connectError(
    "operation_outcome_unknown",
    "The direct write may have completed.",
    {
      operationOutcome: "unknown",
      details: { request_id: "fixture-request" },
    },
  );
}

export function description(
  templating = false,
  archive = false,
  collectionId = crypto.randomUUID(),
): CollectionDescription {
  const generated = buildTaskNotesMdbaseResources({ profiles: ["core-lite"] });
  const type = generated.type as unknown as {
    schema: { value: JsonObject };
    collection?: JsonObject;
    implements: Array<{
      contract: string;
      version: string;
      fields: Record<string, string>;
      binding: JsonObject;
    }>;
  };
  const implementation = type.implements.find(
    (candidate) =>
      candidate.contract === "tasknotes.task" &&
      candidate.version === "0.3.0-rc.3",
  )!;
  const configuration = structuredClone(implementation.binding);
  if (templating)
    configuration.templating = {
      enabled: true,
      template_path: "Templates/Task.md",
      failure_mode: "error",
      unknown_variable_policy: "preserve",
    };
  if (archive)
    configuration.archive = {
      move_on_archive: true,
      folder: "TaskNotes/Archive",
    };
  return {
    protocolVersion: 1,
    collectionId,
    displayName: "Local tasks",
    specVersion: "0.3.0",
    operations: [
      "describe",
      "query",
      "list_views",
      "execute_view",
      "read_view_source",
      "create_view_source",
      "update_view_source",
      "delete_view_source",
      "read",
      "create",
      "update",
      "delete",
      "rename",
    ],
    changeCursor: 0,
    types: [
      {
        name: "task",
        version: 1,
        schema: type.schema.value,
        collection: type.collection,
        definition: generated.type,
        extensions: {},
      },
    ],
    contracts: [
      {
        id: "tasknotes.task",
        contractType: "record",
        version: "0.3.0-rc.3",
        digest: TASKNOTES_CONTRACT_DIGEST,
        schema: generated.taskSchema,
        bindingSchema: generated.bindingSchema,
        implementations: [
          {
            typeName: "task",
            typeVersion: 1,
            digest: `sha256:${"1".repeat(64)}`,
            fields: implementation.fields,
            binding: configuration,
          },
        ],
      },
    ],
  };
}

export function multipleProviderDescription(): CollectionDescription {
  const result = description(false, false, crypto.randomUUID());
  const taskType = result.types[0]!;
  const taskImplementation = result.contracts[0]!.implementations[0]!;
  const schema = structuredClone(taskType.schema) as Record<string, unknown>;
  const properties = schema.properties as Record<string, unknown>;
  properties.summary = properties.title;
  delete properties.title;
  if (Array.isArray(schema.required)) {
    schema.required = schema.required.map((field) =>
      field === "title" ? "summary" : field,
    );
  }
  const definition = structuredClone(taskType.definition ?? {}) as Record<
    string,
    unknown
  >;
  definition.name = "work_task";
  definition.schema = {
    dialect: "json-schema-2020-12",
    value: schema,
  };
  result.types.push({
    ...taskType,
    name: "work_task",
    schema: schema as JsonObject,
    collection: {
      ...(taskType.collection ?? {}),
      path: { pattern: "work-tasks/{id}.md" },
    },
    definition,
  });
  result.contracts[0]!.implementations.push({
    ...taskImplementation,
    typeName: "work_task",
    digest: `sha256:${"2".repeat(64)}`,
    fields: {
      ...taskImplementation.fields,
      title: "summary",
    },
  });
  return result;
}

function valid<Result>(result: Result): MdbaseOperationEnvelope<Result> {
  return { valid: true, result, diagnostics: [] };
}
