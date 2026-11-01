import {
  connect,
  toValue,
  type Connector,
  type MdbaseClient,
  type PlainValue,
  type wire,
} from "@mdbase-dev/sdk";
import {
  MemoryReplica,
  type MemoryRecord,
  type MemoryReplicaOptions,
} from "@mdbase-dev/sdk/testing";
import {
  buildTaskNotesMdbaseResources,
  TASKNOTES_CONTRACT_DIGEST,
  type TaskNotesMdbaseOptions,
} from "@tasknotes/model/mdbase";
import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";
import { vi } from "vitest";
import type { CreateTaskInput } from "../domain/task";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { NextTaskRepository } from "../storage/next-repository";

/** SDK protocol stand-in. Catalog is synthetic: this is not native Core, Noise,
 * real account/grant or LAB qualification. Resource/CRUD frames are real SDK code.
 */
export async function nextTaskFixture(
  options: MemoryReplicaOptions = {},
  archive = false,
  modelConfig?: TaskNotesMdbaseOptions["modelConfig"],
  connectorFactory?: (
    replica: MemoryReplica,
    catalog: wire.DescribeResult,
  ) => Connector,
) {
  const replica = new MemoryReplica(options);
  return attachTaskNotes(replica, undefined, {
    archive,
    modelConfig,
    connectorFactory,
  });
}

/** TaskNotes' type and catalog on `replica`, and a repository over `client`
 * (or a new client). Connecting again to the same replica is what a reload
 * does: the device keeps its replica, the page gets a new client. */
export async function attachTaskNotes(
  replica: MemoryReplica,
  existing?: MdbaseClient,
  {
    archive = false,
    modelConfig,
    connectorFactory,
    wrapConnector = (connector) => connector,
    accountId = crypto.randomUUID(),
  }: {
    archive?: boolean;
    modelConfig?: TaskNotesMdbaseOptions["modelConfig"];
    connectorFactory?: (
      replica: MemoryReplica,
      catalog: wire.DescribeResult,
    ) => Connector;
    /** Observe the link (benchmarks meter it) without replacing the stand-in. */
    wrapConnector?: (connector: Connector) => Connector;
    accountId?: string;
  } = {},
) {
  const generated = buildTaskNotesMdbaseResources({
    profiles: ["core-lite"],
    modelConfig,
  });
  const type = structuredClone(generated.type) as unknown as {
    implements: Array<{
      contract: string;
      version: string;
      fields: Record<string, string>;
      binding: Record<string, PlainValue>;
    }>;
  };
  const implementation = type.implements.find(
    (i) => i.contract === "tasknotes.task",
  )!;
  if (archive)
    implementation.binding.archive = {
      move_on_archive: true,
      folder: "TaskNotes/Archive",
    };
  replica.seedResource(
    "_types/task.md",
    serializeMarkdownDocument(type, "Task type"),
  );
  const catalog: wire.DescribeResult = {
    specVersion: "0.3.0",
    inclusion: { include: [] },
    issues: [],
    settings: new Map(),
    types: [
      {
        name: "task",
        path: "_types/task.md",
        implements: [
          {
            contract: "tasknotes.task",
            version: TASKNOTES_SPEC_VERSION,
            fields: new Map(Object.entries(implementation.fields)),
            binding: toValue(implementation.binding),
          },
        ],
      },
    ],
    contracts: [
      {
        id: "tasknotes.task",
        version: TASKNOTES_SPEC_VERSION,
        path: "_contracts/tasknotes.task.md",
        digest: TASKNOTES_CONTRACT_DIGEST,
        contractType: "record",
        implementedBy: ["task"],
      },
    ],
  };
  const client =
    existing ??
    (await connect({
      connector: wrapConnector(
        connectorFactory?.(replica, catalog) ?? replica.connector(),
      ),
      app: { name: "tasknotes-test", version: "test" },
      reconnect: false,
    }));
  if (!connectorFactory)
    vi.spyOn(client, "describe").mockImplementation(async (input) => {
      const signal = input && "aborted" in input ? input : input?.signal;
      const resource = await client.resources.get("_types/task.md", signal);
      const definition = parseFrontmatter(resource.text!)
        .frontmatter as unknown as typeof type;
      const current = definition.implements.find(
        (item) => item.contract === "tasknotes.task",
      )!;
      catalog.types[0]!.implements[0]!.fields = new Map(
        Object.entries(current.fields),
      );
      catalog.types[0]!.implements[0]!.binding = toValue(current.binding);
      return catalog;
    });
  const repository = new NextTaskRepository(
    client,
    "Native test tasks",
    accountId,
  );
  return {
    replica,
    client,
    catalog,
    accountId,
    repository,
    close: () => repository.dispose(),
  };
}

/** Seed a confirmed record from plain frontmatter, as another app wrote it. */
export function seedRecord(
  replica: MemoryReplica,
  record: {
    path: string;
    types: string[];
    frontmatter: Record<string, unknown>;
    body?: string;
  },
) {
  return replica.seed({
    ...record,
    frontmatter: Object.fromEntries(
      Object.entries(record.frontmatter).map(([field, value]) => [
        field,
        toValue(value as PlainValue),
      ]),
    ),
  });
}

/** Seed a confirmed TaskNotes task record, as another app would have written it. */
export function seedTask(
  replica: MemoryReplica,
  input: CreateTaskInput,
  options: { id?: string; now?: string; path?: string } = {},
) {
  const task = new TaskNotesTaskModel().create(input, {
    id: options.id ?? crypto.randomUUID(),
    now: options.now ?? "2026-07-22T00:00:00.000Z",
  });
  return seedRecord(replica, {
    path: options.path ?? task.path,
    types: ["task"],
    frontmatter: task.frontmatter,
    body: task.body,
  });
}

/** A saved task view the replica serves to app Bases reads. */
export function seedTaskView(
  replica: MemoryReplica,
  {
    path = "views/tasks.base",
    name = "Tasks",
    columns = ["file.path"],
  }: { path?: string; name?: string; columns?: string[] } = {},
) {
  const view = replica.seedBaseView({ path, types: ["task"], columns, name });
  // The replica stores its own view list as the body; the app reads the
  // source as a Bases document.
  replica.editElsewhere(view.record, {
    body: `views:\n  - type: table\n    name: ${JSON.stringify(name)}\n`,
  });
  return view;
}

const literal = String.raw`("(?:[^"\\]|\\.)*")`;
const bodyContains = new RegExp(
  String.raw`^file\.body\.lower\(\)\.contains\(${literal}\)$`,
);
const pathOrTitleContains = new RegExp(
  String.raw`^file\.path\.lower\(\)\.contains\(${literal}\) \|\| \("title" in record && record\.title\.lower\(\)\.contains\(${literal}\)\)$`,
);

/** `MemoryReplicaOptions.where` for the expressions TaskNotes sends: Notes
 * search and link completion. Not Core's CEL; anything else is refused. */
export function taskQueryWhere(expression: string, record: MemoryRecord) {
  const body = bodyContains.exec(expression);
  if (body)
    return record.body.toLowerCase().includes(JSON.parse(body[1]!) as string);
  const link = pathOrTitleContains.exec(expression);
  if (link) {
    const title = record.frontmatter.get("title");
    return (
      record.path.toLowerCase().includes(JSON.parse(link[1]!) as string) ||
      (typeof title === "string" &&
        title.toLowerCase().includes(JSON.parse(link[2]!) as string))
    );
  }
  throw new Error(`Unsupported synthetic where: ${expression}`);
}
