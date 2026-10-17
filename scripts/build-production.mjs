import { spawnSync } from "node:child_process";
import { checkProductionSdk } from "./production-sdk.mjs";

await checkProductionSdk();
if (
  process.env.VITE_TASKNOTES_ENVIRONMENT &&
  process.env.VITE_TASKNOTES_ENVIRONMENT !== "production"
)
  throw new Error("Production build cannot select LAB.");
if (process.env.VITE_TASKNOTES_LAB_ORIGIN)
  throw new Error("Production build cannot include a LAB origin.");
const result = spawnSync("pnpm", ["run", "build:assets"], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_TASKNOTES_ENVIRONMENT: "production",
    VITE_TASKNOTES_EDITOR_ORIGIN: "https://editor.mdbase.dev",
  },
});
process.exit(result.status ?? 1);
