import { TASKNOTES_LEGACY_CONTRACT_DIGESTS } from "@tasknotes/model/mdbase";
import { describe, expect, it } from "vitest";
import { nextTaskFixture } from "../test/next-task-fixture";

/** Persisted rc.5 task definitions still carry settings in their binding. */
describe("TaskNotes collection resolution", () => {
  it("resolves an rc.5 collection through the SDK catalog, reading moved settings from its binding", async () => {
    const fixture = await nextTaskFixture({}, true);
    try {
      const contract = fixture.catalog.contracts[0]!;
      contract.version = "0.3.0-rc.5";
      contract.digest = TASKNOTES_LEGACY_CONTRACT_DIGESTS["0.3.0-rc.5"]!;
      fixture.catalog.types[0]!.implements[0]!.version = contract.version;
      expect(await fixture.repository.taskConfiguration()).toMatchObject({
        archive: { moveOnArchive: true, folder: "TaskNotes/Archive" },
      });
    } finally {
      fixture.close();
    }
  });
});
