import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const specRoot = fileURLToPath(
  new URL("../node_modules/tasknotes-spec/", import.meta.url),
);
const adapter = fileURLToPath(
  new URL(
    "../node_modules/@tasknotes/model/dist/esm/conformance.js",
    import.meta.url,
  ),
);
const result = spawnSync(
  process.execPath,
  ["--test", "conformance/tests/runner.test.mjs"],
  {
    cwd: specRoot,
    env: { ...process.env, TASKNOTES_ADAPTER: adapter },
    encoding: "utf8",
  },
);

if (result.error) throw result.error;
if (result.status === 0) {
  const summary = String(result.stdout)
    .split("\n")
    .filter((line) => /^# (tests|pass|fail|skipped) /.test(line));
  console.log(
    ["TaskNotes core-lite conformance: passed", ...summary].join("\n"),
  );
} else {
  process.stdout.write(String(result.stdout));
  process.stderr.write(String(result.stderr));
}
process.exitCode = result.status ?? 1;
