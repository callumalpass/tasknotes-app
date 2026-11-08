// Unprivileged build; publisher checkout must remain dependency-free (#1562).
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compareInstalled } from "./originals.mjs";
import { publicationInventory, serializeInventory } from "./publisher.mjs";
const root = process.cwd(),
  output = process.argv[2];
const plan = JSON.parse(await readFile(join(output, "plan.json"), "utf8"));
await compareInstalled(root, plan.sdkTrust.archives);
delete process.env.GITHUB_TOKEN;
const { buildCandidate } = await import(
  pathToFileURL(join(root, "scripts/publisher/candidate-build.mjs")).href
);
const env = {
  ...process.env,
  TASKNOTES_APP_URL: plan.origin,
  TASKNOTES_WEB_ONLY: "1",
  VITE_BASE_PATH: "/",
  VITE_TASKNOTES_ENVIRONMENT: plan.target,
  TASKNOTES_BUILD_COMMIT: plan.sha,
  VITE_TASKNOTES_EDITOR_ORIGIN:
    plan.target === "production"
      ? "https://editor.mdbase.dev"
      : "https://editor-staging.mdbase.dev",
  VITE_TASKNOTES_CALENDAR_ORIGIN:
    plan.target === "production"
      ? "https://calendar.tasknotes.dev"
      : "https://calendar-staging.tasknotes.dev",
};
delete env.GITHUB_TOKEN;
delete env.GH_TOKEN;
delete env.APP_EVIDENCE_GH_TOKEN;
await buildCandidate(env);
await cp(join(root, "dist"), join(output, "publish"), {
  recursive: true,
  errorOnExist: true,
  force: false,
});
await writeFile(
  join(output, "inventory.json"),
  serializeInventory(await publicationInventory(join(output, "publish"), plan)),
);
