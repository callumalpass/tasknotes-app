import { TASKNOTES_LEGACY_CONTRACT_DIGESTS } from "@tasknotes/model/mdbase";
import { describe, expect, it } from "vitest";

import { description } from "../test/mdbase-fixture";
import { resolveTaskCollection } from "./tasknotes-collection";

/** A collection still on tasknotes.task rc.5, its moved settings in the binding. */
function rc5Collection() {
  const described = description(false, true);
  const contract = described.contracts[0]!;
  contract.version = "0.3.0-rc.5";
  contract.digest = TASKNOTES_LEGACY_CONTRACT_DIGESTS["0.3.0-rc.5"]!;
  const definition = described.types[0]!.definition as {
    implements: { contract: string; version: string }[];
  };
  for (const implementation of definition.implements)
    if (implementation.contract === "tasknotes.task")
      implementation.version = "0.3.0-rc.5";
  return described;
}

describe("TaskNotes collection resolution", () => {
  it("still resolves an rc.5 collection, reading moved settings from its binding", () => {
    const resolved = resolveTaskCollection(rc5Collection());
    expect(resolved.typeName).toBe("task");
    expect(resolved.model.configuration().archive).toEqual({
      moveOnArchive: true,
      folder: "TaskNotes/Archive",
    });
  });
});
