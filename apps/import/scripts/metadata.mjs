import { mkdir, writeFile } from "node:fs/promises";
import { createMdbase } from "@mdbase-dev/sdk";
import { loadCanonicalTaskNotesTypePack } from "../../../scripts/canonical-task-pack.mjs";

const origin = new URL(
  process.env.VITE_APP_URL || "https://tasknotes-import.pages.dev",
).origin;
if (!origin.startsWith("https://"))
  throw new Error(
    "VITE_APP_URL must be HTTPS for the production SDK original.",
  );
// This original contains production trust. Never silently retarget it to LAB/local.
if (
  process.env.VITE_MDBASE_CONNECT_URL &&
  process.env.VITE_MDBASE_CONNECT_URL !== "https://connect.mdbase.dev"
)
  throw new Error(
    "The vendored SDK original is production-only; a different Connect environment needs its own qualified original.",
  );
if (process.env.VITE_MDBASE_LOOPBACK_URL)
  throw new Error(
    "The native SDK owns transport selection; loopback overrides are no longer supported.",
  );
const pack = await loadCanonicalTaskNotesTypePack();
const manifest = {
  manifest_version: 1,
  id: "dev.tasknotes.import",
  name: "TaskNotes Import",
  homepage: `${origin}/`,
  redirect_uris: [`${origin}/auth/mdbase/callback`],
  installation_origins: { production: { "app-runtime": [origin] } },
  requirements: {
    access: "full_collection",
    contracts: pack.provides,
    capabilities: {
      contract_version: 2,
      required: ["collection.read", "records.create", "definitions.manage"],
      optional: [],
    },
  },
  provisions: { type_packs: [pack] },
};
// The SDK constructor is IO-free and compiles with its bundled canonical parser.
// This replaces connect-dev's legacy CLI validation without another protocol pin.
createMdbase({
  id: manifest.id,
  name: manifest.name,
  origin,
  environment: "production",
  manifest,
});
console.log("Connect declaration validated by the pinned SDK.");
const metadata = {
  client_id: `${origin}/oauth/todoist-client.json`,
  client_name: "TaskNotes Import",
  client_uri: `${origin}/`,
  redirect_uris: [`${origin}/auth/todoist/callback`],
  grant_types: ["authorization_code"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  scope: "data:read",
};
for (const [path, value] of [
  ["public/.well-known/mdbase-app.json", manifest],
  ["public/oauth/todoist-client.json", metadata],
  ["src/generated/site.json", { origin }],
  ["src/generated/mdbase-app.json", manifest],
]) {
  await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
console.log(`Authorization origin: ${origin}`);
