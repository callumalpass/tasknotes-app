import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { prepareLocalSdk, readLocalSdkReceipt } from "./local-sdk.mjs";

const [appOrigin, editorOrigin] = process.argv.slice(2);
function exactOrigin(value) {
  try {
    const u = new URL(value);
    return (
      u.origin === value &&
      u.protocol === "http:" &&
      u.hostname === "127.0.0.1" &&
      u.port !== "" &&
      Number(u.port) > 0
    );
  } catch {
    return false;
  }
}
if (
  process.argv.length !== 4 ||
  !exactOrigin(appOrigin) ||
  !exactOrigin(editorOrigin)
)
  throw Error(
    "Local build requires exact HTTP 127.0.0.1 app and Editor origins with positive ports.",
  );
prepareLocalSdk();
const env = {
  ...process.env,
  TASKNOTES_APP_URL: appOrigin,
  TASKNOTES_WEB_ONLY: "1",
  VITE_TASKNOTES_ENVIRONMENT: "local",
  VITE_TASKNOTES_LOCAL_ORIGIN: appOrigin,
  VITE_TASKNOTES_LAB_ORIGIN: "",
  VITE_TASKNOTES_EDITOR_ORIGIN: editorOrigin,
};
for (const args of [
  ["manifest"],
  ["manifest:validate:local"],
  ["exec", "tsc", "-b"],
  ["exec", "vite", "build", "--mode", "local-rehearsal"],
  ["exec", "node", "scripts/write-static-routes.mjs"],
]) {
  const result = spawnSync("pnpm", args, {
    env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error || result.status !== 0 || result.signal)
    process.exit(result.status || 1);
}
writeFileSync(
  resolve("dist/local-build-receipt.json"),
  JSON.stringify(
    {
      schema: "tasknotes/local-build/1",
      environment: "local",
      mode: "local-rehearsal",
      appOrigin,
      editorOrigin,
      sdk: readLocalSdkReceipt(),
    },
    null,
    2,
  ) + "\n",
);
