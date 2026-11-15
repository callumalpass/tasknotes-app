import type { DescribeResult } from "@mdbase-dev/sdk";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";
import type { DestinationType, JsonObject } from "./plan";

export function discoverTypes(description: DescribeResult): DestinationType[] {
  const contract = description.contracts.find(
    (c) =>
      c.id === "tasknotes.task" &&
      c.version === TASKNOTES_SPEC_VERSION &&
      c.digest === TASKNOTES_CONTRACT_DIGEST,
  );
  if (!contract)
    throw new Error(
      "This collection does not yet have the supported TaskNotes contract. Review collection setup first.",
    );
  return contract.implementedBy.map((name) => {
    const type = description.types.find((t) => t.name === name);
    const implementation = type?.implements.find(
      (i) => i.contract === contract.id && i.version === contract.version,
    );
    if (!type || !implementation)
      throw new Error(`Missing implementing type: ${name}`);
    const definition = type.definition;
    const schema = type.schema;
    if (
      !definition ||
      Array.isArray(definition) ||
      typeof definition !== "object" ||
      !schema ||
      Array.isArray(schema) ||
      typeof schema !== "object"
    )
      throw new Error(
        `Missing resolved definition or schema for ${name}. Import cannot proceed safely.`,
      );
    return {
      name,
      definition: definition as JsonObject,
      schema: schema as JsonObject,
      fields: implementation.fields,
      binding: implementation.binding,
      revision: type.revision,
      digest: implementation.digest,
    };
  });
}
