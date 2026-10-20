import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseVersionedAppManifest } from "@mdbase-dev/connect-protocol/manifest";

export function stagingIosEnvironment(environment = process.env) {
  if (!environment.VITE_TASKNOTES_EDITOR_ORIGIN)
    throw new Error(
      "An explicit staging Editor presentation origin is required.",
    );
  return {
    ...environment,
    TASKNOTES_STAGING_IOS: "1",
    TASKNOTES_APP_URL: "https://staging.tasknotes-app.pages.dev",
    VITE_TASKNOTES_ENVIRONMENT: "staging",
    VITE_TASKNOTES_LAB_ORIGIN: "",
    VITE_TASKNOTES_EDITOR_ORIGIN: environment.VITE_TASKNOTES_EDITOR_ORIGIN,
    VITE_MDBASE_CONNECT_URL: "https://connect-staging.mdbase.dev",
    VITE_MDBASE_CONNECT_LOOPBACK_URL: "",
  };
}

export function assertStagingSdk() {
  const pkg = JSON.parse(readFileSync(resolve("package.json")));
  if (
    pkg.dependencies["@mdbase-dev/sdk"] !==
    "file:vendor/sdk-dev-eaa4e697-staging.tgz"
  )
    throw new Error(
      "The iOS smoke requires the original staging SDK944 archive.",
    );
  const bytes = readFileSync(resolve("vendor/sdk-dev-eaa4e697-staging.tgz"));
  if (
    createHash("sha256").update(bytes).digest("hex") !==
    "15eb64b50fc7c2809ff3dba9cce5104fe48d8592208b3af8acb529862a1af18c"
  )
    throw new Error(
      "The staging SDK944 archive differs from the accepted original.",
    );
}

// The legacy connect-dev beta125 CLI rejects installation_origins entirely.
// Use the pinned beta129 public compiler, exactly as SDK registration does.
export function buildStagingIosAssets(env) {
  const run = (command, args) =>
    spawnSync(command, args, { env, stdio: "inherit" }).status ?? 1;
  const manifestStatus = run("pnpm", ["manifest"]);
  if (manifestStatus) return manifestStatus;
  parseVersionedAppManifest(
    JSON.parse(
      readFileSync(resolve("public/.well-known/mdbase-app.json"), "utf8"),
    ),
  );
  for (const [command, args] of [
    ["pnpm", ["exec", "tsc", "-b"]],
    ["pnpm", ["exec", "vite", "build"]],
    ["node", ["scripts/write-static-routes.mjs"]],
    ["node", ["scripts/assert-no-production-fixtures.mjs"]],
  ]) {
    const status = run(command, args);
    if (status) return status;
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assertStagingSdk();
  const status = buildStagingIosAssets(
    stagingIosEnvironment({
      ...process.env,
      VITE_TASKNOTES_EDITOR_ORIGIN:
        process.argv[2] ?? process.env.VITE_TASKNOTES_EDITOR_ORIGIN,
    }),
  );
  if (status === 0)
    writeFileSync(
      new URL("../dist/tasknotes-candidate.json", import.meta.url),
      JSON.stringify({
        releasable: false,
        environment: "staging",
        sdkTarget: "0.1.0-beta.134",
      }) + "\n",
    );
  process.exit(status);
}
