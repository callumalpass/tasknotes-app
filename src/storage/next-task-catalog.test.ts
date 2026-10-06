import { connect, type MdbaseClient, type wire } from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTaskProviders } from "./next-task-catalog";

const clients: MdbaseClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  vi.restoreAllMocks();
});

async function fixture() {
  const replica = new MemoryReplica();
  replica.seedResource(
    "_types/todo.md",
    "---\nname: todo\ncollection:\n  path:\n    folder: work\n---\nTask type source\n",
  );
  const client = await connect({
    connector: replica.connector(),
    app: { name: "tasknotes-test", version: "test" },
    reconnect: false,
  });
  clients.push(client);
  const catalog: wire.DescribeResult = {
    specVersion: "0.3.0",
    inclusion: { include: [] },
    issues: [],
    settings: new Map(),
    types: [
      {
        name: "todo",
        path: "_types/todo.md",
        implements: [
          {
            contract: "tasknotes.task",
            version: TASKNOTES_SPEC_VERSION,
            fields: new Map([["title", "headline"]]),
            binding: new Map(),
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
        implementedBy: ["todo"],
      },
    ],
  };
  // The protocol stand-in has no contract parser. Catalog metadata is synthetic;
  // resource reads below still run through its real SDK frames and codecs.
  vi.spyOn(client, "describe").mockResolvedValue(catalog);
  const resources = vi.spyOn(client.resources, "get");
  return { client, catalog, resources, signal: new AbortController().signal };
}

describe("native task catalog adapter (not LAB)", () => {
  it("uses replica contract bindings and actual type resource paths", async () => {
    const f = await fixture();
    const providers = await nextTaskProviders(f.client, f.signal);
    expect(providers).toHaveLength(1);
    expect(providers[0]!.typeName).toBe("todo");
    expect(providers[0]!.model.config.fieldMapping.title).toBe("headline");
    expect(
      providers[0]!.model.create(
        { title: "Native catalog" },
        { id: crypto.randomUUID() },
      ).path,
    ).toMatch(/^work\//);
    expect(f.resources).toHaveBeenCalledWith("_types/todo.md", f.signal);
  });

  it.each(["digest", "version"] as const)(
    "refuses a different contract %s without inferring a task type",
    async (field) => {
      const f = await fixture();
      f.catalog.contracts[0]![field] = "unsupported";
      await expect(nextTaskProviders(f.client, f.signal)).rejects.toThrow(
        "does not provide tasknotes.task",
      );
      expect(f.resources).not.toHaveBeenCalled();
    },
  );

  it("refuses a catalog with no task implementation", async () => {
    const f = await fixture();
    f.catalog.types[0]!.implements = [];
    await expect(nextTaskProviders(f.client, f.signal)).rejects.toThrow(
      "no implementing types",
    );
    expect(f.resources).not.toHaveBeenCalled();
  });

  it("refuses a missing type source rather than using default configuration", async () => {
    const f = await fixture();
    f.catalog.types[0]!.path = "_types/missing.md";
    await expect(nextTaskProviders(f.client, f.signal)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("quarantines a catalog reply after collection lifetime cancellation", async () => {
    const f = await fixture();
    const controller = new AbortController();
    vi.mocked(f.client.describe).mockImplementation(async () => {
      controller.abort();
      return f.catalog;
    });
    await expect(
      nextTaskProviders(f.client, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(f.resources).not.toHaveBeenCalled();
  });
});
