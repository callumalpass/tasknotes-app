import { connect, toValue, type PlainValue, type wire } from "@mdbase-dev/sdk";
import {
  MemoryReplica,
  type MemoryReplicaOptions,
} from "@mdbase-dev/sdk/testing";
import {
  buildTaskNotesMdbaseResources,
  TASKNOTES_CONTRACT_DIGEST,
} from "@tasknotes/model/mdbase";
import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";
import { vi } from "vitest";
import { NextTaskRepository } from "../storage/next-repository";

/** SDK protocol stand-in. Catalog is synthetic: this is not native Core, Noise,
 * real account/grant or LAB qualification. Resource/CRUD frames are real SDK code.
 */
export async function nextTaskFixture(
  options: MemoryReplicaOptions = {},
  archive = false,
) {
  const replica = new MemoryReplica(options);
  const generated = buildTaskNotesMdbaseResources({ profiles: ["core-lite"] });
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
  const client = await connect({
    connector: replica.connector(),
    app: { name: "tasknotes-test", version: "test" },
    reconnect: false,
  });
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
  vi.spyOn(client, "describe").mockImplementation(async (signal) => {
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
  const accountId = crypto.randomUUID();
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
