import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildTaskNotesManifest } from "./tasknotes-manifest.mjs";
import { buildAppTaskNotesResources } from "./tasknotes-resources.mjs";

const development = process.argv.includes("--development");
const webOnly = process.env.TASKNOTES_WEB_ONLY === "1";
const appUrl = (
  process.env.TASKNOTES_APP_URL ??
  (development ? "http://127.0.0.1:4173" : "https://tasknotes.dev/app")
).replace(/\/$/, "");
const resources = buildAppTaskNotesResources();
const firebaseProjectId =
  process.env.TASKNOTES_FIREBASE_PROJECT_ID?.trim() || undefined;
const target = resolve(
  import.meta.dirname,
  "..",
  "public",
  ".well-known",
  "mdbase-app.json",
);

const manifest = buildTaskNotesManifest({
  appUrl,
  webOnly,
  firebaseProjectId,
  resources,
});

await mkdir(resolve(target, ".."), { recursive: true });
await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`);
