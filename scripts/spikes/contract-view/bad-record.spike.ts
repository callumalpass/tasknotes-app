/**
 * Side finding: one task without dateCreated, read through the app's real
 * NextTaskRepository on the real runtime. Not part of the contract question.
 *
 *   pnpm exec vitest run --config scripts/spikes/contract-view/vitest.config.ts bad-record
 */
import { test } from "vitest";
import { NextTaskRepository } from "../../../src/storage/next-repository";
import { openReplica, plainTask, seed } from "./harness";

test("one task without dateCreated", async () => {
  const r = await openReplica();
  const ids = await seed(
    r.client,
    Array.from({ length: 20 }, (_, i) => ({
      path: `tasks/t${i}.md`,
      frontmatter: plainTask(i),
    })),
  );
  const repo = new NextTaskRepository(r.client, "spike", crypto.randomUUID(), {
    clientOwnership: "borrowed",
  });
  const before = await repo.listSummaries({});
  console.log(
    "before:",
    Array.isArray(before) ? before.length : Object.keys(before),
  );
  repo.dispose();
  await r.client.update(ids[3]!, { unset: ["dateCreated"] });
  const repo2 = new NextTaskRepository(r.client, "spike", crypto.randomUUID(), {
    clientOwnership: "borrowed",
  });
  try {
    const after = await repo2.listSummaries({});
    console.log(
      "after:",
      Array.isArray(after) ? after.length : Object.keys(after),
    );
  } catch (e) {
    console.log("after: listSummaries threw:", (e as Error).message);
  }
  repo2.dispose();
  await r.close();
});
