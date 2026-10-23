import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { checkProductionSdk } from "./production-sdk.mjs";

export function productionBuildEnvironment(environment = process.env) {
  if (
    environment.VITE_TASKNOTES_ENVIRONMENT &&
    environment.VITE_TASKNOTES_ENVIRONMENT !== "production"
  )
    throw new Error("Production build cannot select LAB.");
  if (environment.VITE_TASKNOTES_LAB_ORIGIN)
    throw new Error("Production build cannot include a LAB origin.");
  return {
    ...environment,
    VITE_TASKNOTES_ENVIRONMENT: "production",
    VITE_TASKNOTES_EDITOR_ORIGIN: "https://editor.mdbase.dev",
  };
}

export function buildProductionAssets(env) {
  const result = spawnSync("pnpm", ["run", "build:assets"], {
    stdio: "inherit",
    env,
  });
  return result.status ?? 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await checkProductionSdk();
    process.exit(buildProductionAssets(productionBuildEnvironment()));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
