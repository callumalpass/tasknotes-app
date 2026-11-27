import type { DescribeResult } from "@mdbase-dev/sdk";
import { readableTaskNotesContract } from "../../../src/domain/tasknotes-contract";
import { collectionTimezone } from "../../../src/domain/runtime-timezone";
import type { DestinationType, JsonObject } from "./plan";

export function discoverTypes(description: DescribeResult): DestinationType[] {
  const contract = readableTaskNotesContract(description.contracts);
  const timezone = collectionTimezone(description.settings);
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
      timezone,
      definition: definition as JsonObject,
      schema: schema as JsonObject,
      fields: implementation.fields,
      binding: implementation.binding,
      revision: type.revision,
      digest: implementation.digest,
    };
  });
}
