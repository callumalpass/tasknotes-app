// Public failure-only evidence. Never a prepared build, qualified artifact,
// SDK/authentication claim, upload capability or environment/context dump.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const phases = [
  ["originals", "NATIVE_ORIGINALS_OUTCOME"],
  ["install", "NATIVE_INSTALL_OUTCOME"],
  ["installed-members", "NATIVE_INSTALLED_OUTCOME"],
  ["source-contracts", "NATIVE_CONTRACTS_OUTCOME"],
  ["build-and-inventory", "NATIVE_PREPARE_OUTCOME"],
];
export async function recordBuildFailure(environment = process.env) {
  const temp = resolve(environment.RUNNER_TEMP);
  const directory = resolve(environment.NATIVE_FAILURE_PATH);
  if (!directory.startsWith(temp + "/"))
    throw new Error("Failure evidence requires runner temp.");
  const checked = (key, pattern) =>
    pattern.test(environment[key] ?? "") ? environment[key] : null;
  const receipt = {
    kind: "tasknotes-native-build-failure-only",
    status: "failed",
    phase:
      phases.find(([, key]) => environment[key] === "failure")?.[0] ??
      "runner-or-setup",
    source: {
      requestedSha: checked("NATIVE_SOURCE_SHA", /^[a-f0-9]{40}$/),
      tree: null,
    },
    requestedTarget: ["staging", "production"].includes(
      environment.NATIVE_TARGET,
    )
      ? environment.NATIVE_TARGET
      : null,
    run: {
      repository: checked(
        "GITHUB_REPOSITORY",
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
      ),
      id: checked("GITHUB_RUN_ID", /^[1-9][0-9]*$/),
      attempt: checked("GITHUB_RUN_ATTEMPT", /^[1-9][0-9]*$/),
    },
    deployment: null,
  };
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  return receipt;
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    await recordBuildFailure();
  } catch {
    console.error("Public build failure evidence could not be retained.");
    process.exitCode = 1;
  }
}
