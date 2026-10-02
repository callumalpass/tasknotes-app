import type { CollectionDescription } from "@mdbase-dev/connect";
import { MdbaseCollectionClient } from "@mdbase-dev/connect/advanced";
import type { CollectionDescription as WireDescription } from "@mdbase-dev/connect-protocol";
import type { mdbaseFixture } from "./mdbase-fixture";

/** Public-to-wire adapter for the synthetic authority, not an app cache. */
export function wireTestDescription(
  value: CollectionDescription,
): WireDescription {
  return {
    protocol_version: value.protocolVersion,
    collection_id: value.collectionId,
    display_name: value.displayName,
    spec_version: value.specVersion,
    operations: value.operations,
    change_cursor: value.changeCursor,
    types: value.types,
    contracts: value.contracts.map((contract) => ({
      contract_type: contract.contractType,
      id: contract.id,
      version: contract.version,
      digest: contract.digest,
      schema: contract.schema,
      binding_schema: contract.bindingSchema,
      implementations: contract.implementations.map((implementation) => ({
        type_name: implementation.typeName,
        type_version: implementation.typeVersion,
        type_path: implementation.typePath,
        digest: implementation.digest,
        fields: implementation.fields,
        binding: implementation.binding,
      })),
    })),
    configuration: value.configuration,
  };
}

/** Opt into actual SDK description caching while retaining authority spies. */
export function cacheFixtureDescription(
  fixture: ReturnType<typeof mdbaseFixture>,
) {
  const client = new MdbaseCollectionClient({
    operation: async <Result>(operation: string): Promise<Result> => {
      if (operation !== "describe")
        throw new Error("Unexpected fixture operation");
      return wireTestDescription(await fixture.describe()) as Result;
    },
  });
  fixture.connect.describe = client.describe.bind(client);
  Object.defineProperty(fixture.connect, "schemaGeneration", {
    get: () => client.schemaGeneration,
  });
}
