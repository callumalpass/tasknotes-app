import { it, expect } from "vitest";
import {
  MdbaseClient,
  type DescribeResult,
  type JsonObject,
} from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";
import { session } from "./connect";
import { discoverTypes } from "./destination";
import { exampleTarget } from "./example";
import manifest from "./generated/mdbase-app.json";

function description(): DescribeResult {
  return {
    specVersion: "0.3",
    settings: {},
    inclusion: { include: [] },
    issues: [],
    types: [
      {
        name: exampleTarget.name,
        path: "_types/task.md",
        revision: "sha256:type-source",
        definition: exampleTarget.definition,
        schema: exampleTarget.schema,
        implements: [
          {
            contract: "tasknotes.task",
            version: TASKNOTES_SPEC_VERSION,
            fields: exampleTarget.fields,
            binding: exampleTarget.binding,
            digest: "sha256:implementation",
          },
        ],
      },
    ],
    contracts: [
      {
        id: "tasknotes.task",
        version: TASKNOTES_SPEC_VERSION,
        digest: TASKNOTES_CONTRACT_DIGEST,
        path: "_contracts/tasknotes.task.md",
        contractType: "record",
        implementedBy: [exampleTarget.name],
      },
    ],
  };
}
it("constructs an IO-free native SDK session from the canonical v2 declaration", () => {
  // Node has no browser Worker/storage; declaration compilation still runs.
  expect(session.getSnapshot().phase.kind).toBe("unavailable");
  expect(manifest.requirements.capabilities).toEqual({
    contract_version: 2,
    required: ["collection.read", "records.create", "definitions.manage"],
    optional: [],
  });
  expect(manifest.installation_origins.production["app-runtime"]).toEqual([
    new URL(manifest.homepage).origin,
  ]);
  expect(manifest.requirements).not.toHaveProperty("files");
});
it("discovers the exact TaskNotes contract using native definition/schema maps", () => {
  const [target] = discoverTypes(description());
  expect(target).toMatchObject(exampleTarget);
  expect(target.revision).toBe("sha256:type-source");
  expect(target.digest).toBe("sha256:implementation");
});
it("decodes current SDK field maps as JSON and refuses summary-only discovery", async () => {
  const replica = new MemoryReplica({
    contracts: [
      {
        id: "tasknotes.task",
        version: TASKNOTES_SPEC_VERSION,
        type: exampleTarget.name,
        fields: exampleTarget.fields,
        binding: exampleTarget.binding as JsonObject,
        contractDigest: TASKNOTES_CONTRACT_DIGEST,
      },
    ],
  });
  replica.seedType(exampleTarget.name, exampleTarget.definition);
  const client = await MdbaseClient.connect({
    app: { name: "[test] TaskNotes Import", version: "test" },
    connector: replica.connector(),
  });
  try {
    const result = await client.describe();
    expect(result.types[0].implements[0].fields).toEqual(exampleTarget.fields);
    expect(result.types[0].implements[0].fields).not.toBeInstanceOf(Map);
    expect(() => discoverTypes(result)).toThrow(
      "Missing resolved definition or schema",
    );
  } finally {
    await client.close();
  }
});
it("refuses a different contract digest and missing implementations", () => {
  const d = description();
  d.contracts[0].digest = "sha256:wrong";
  expect(() => discoverTypes(d)).toThrow("supported TaskNotes contract");
  d.contracts[0].digest = TASKNOTES_CONTRACT_DIGEST;
  d.types[0].implements = [];
  expect(() => discoverTypes(d)).toThrow("Missing implementing type");
});
it("requires resolved native definitions and schemas, not summary-only discovery", () => {
  const d = description();
  delete d.types[0].schema;
  expect(() => discoverTypes(d)).toThrow(
    "Missing resolved definition or schema",
  );
  d.types[0].schema = exampleTarget.schema;
  delete d.types[0].definition;
  expect(() => discoverTypes(d)).toThrow(
    "Missing resolved definition or schema",
  );
});
