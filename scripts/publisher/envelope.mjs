import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const root = process.argv[2];
const plan = JSON.parse(await readFile(join(root, "plan.json"), "utf8"));
const hash = async (path) =>
  createHash("sha256")
    .update(await readFile(join(root, path)))
    .digest("hex");
await writeFile(
  join(root, "envelope.json"),
  JSON.stringify(
    {
      repository: process.env.GITHUB_REPOSITORY,
      run: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
      event: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
      workflowSha: process.env.GITHUB_SHA,
      source: plan.sha,
      tree: plan.tree,
      target: plan.target,
      inventorySha256: await hash("inventory.json"),
      planSha256: await hash("plan.json"),
    },
    null,
    2,
  ),
);
