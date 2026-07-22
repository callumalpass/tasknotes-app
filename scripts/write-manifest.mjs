import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildAppTaskNotesResources } from "./tasknotes-resources.mjs";

const development = process.argv.includes("--development");
const webOnly = process.env.TASKNOTES_WEB_ONLY === "1";
const appUrl = (
  process.env.TASKNOTES_APP_URL ??
  (development ? "http://127.0.0.1:4173" : "https://tasknotes.dev/app")
).replace(/\/$/, "");
const resources = buildAppTaskNotesResources();
const target = resolve(
  import.meta.dirname,
  "..",
  "public",
  ".well-known",
  "mdbase-app.json",
);

const manifest = {
  manifest_version: 1,
  name: "TaskNotes",
  homepage: `${appUrl}/`,
  icon: `${appUrl}/icon.png`,
  redirect_uris: [
    `${appUrl}/auth/mdbase/callback`,
    ...(!webOnly ? ["dev.tasknotes.app://auth/mdbase/callback"] : []),
  ],
  requirements: {
    contracts: [{ id: "tasknotes.task", version: 1 }],
    access: "full_collection",
  },
  provisions: {
    types: [
      {
        name: "task",
        path: resources.paths.type,
        document: resources.typeDocument,
        provides: [{ id: "tasknotes.task", version: 1 }],
      },
    ],
  },
};

await mkdir(resolve(target, ".."), { recursive: true });
await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`);
