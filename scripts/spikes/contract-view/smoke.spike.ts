import { test } from "vitest";
import { openReplica, show } from "./harness";

test("smoke", async () => {
  const r = await openReplica();
  const d = await r.client.describe();
  console.log(
    show({ types: d.types, contracts: d.contracts, issues: d.issues }).slice(
      0,
      2500,
    ),
  );
  const w = await r.client.create({
    type: "task",
    path: "tasks/a.md",
    frontmatter: {
      title: "A",
      status: "open",
      dateCreated: "2026-01-01T00:00:00Z",
      tags: ["task"],
    },
  });
  console.log(show(w));
  const q = await r.client.queryContract(r.contract, { pageSize: 10 });
  console.log(show(q, 1).slice(0, 5000));
  await r.close();
});
