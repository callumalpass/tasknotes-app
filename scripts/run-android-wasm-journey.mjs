import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exerciseAndroidWasm } from "./android-wasm-journey.mjs";

const CHECKS = [
  "runtime-initialized",
  "sqlite-open-query-write-reopen",
  "task-create-edit-reload",
];
const CLEANUP = "owned-task-deleted-and-installation-access-revoked";

export function nativeFixture(value) {
  const fixture = JSON.parse(value ?? "null");
  if (
    !fixture?.email ||
    !fixture.password ||
    !/^agent-[a-zA-Z0-9-]+$/.test(fixture.runId ?? "") ||
    fixture.collectionName !== `[test] ${fixture.runId}`
  )
    throw new Error("run-scoped-native-fixture-required");
  return fixture;
}

export async function runNativeJourney({
  account,
  journey = exerciseAndroidWasm,
  health = () => fetch("https://connect.mdbase.dev/health"),
  save = () => {},
}) {
  let report = { status: "failed", phase: "fixture-preflight" };
  const phase = (phase) => {
    report = { ...report, phase };
    save(report);
    console.log(`android-native-journey: ${phase}`);
  };
  try {
    const fixture = nativeFixture(account);
    phase("environment-preflight");
    const response = await health();
    const environment = await response.json();
    if (
      !response.ok ||
      environment.environment !== "production" ||
      environment.public_origin !== "https://connect.mdbase.dev"
    )
      throw new Error("environment-mismatch");
    const result = await journey({ ...fixture, phase });
    if (
      !CHECKS.every((c) => result?.checks?.[c] === true) ||
      result.cleanup !== CLEANUP
    )
      throw new Error("native-journey-incomplete");
    report = {
      status: "passed",
      phase: "complete",
      checks: result.checks,
      cleanup: result.cleanup,
      environment: "production",
      serverRevision: environment.revision,
    };
  } catch {
    // Playwright errors can include credentials, private URLs and DOM contents.
    // Never serialize the exception or accept a caller-supplied success report.
    report = { ...report, status: "failed", category: "native-journey-failed" };
  }
  save(report);
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report = await runNativeJourney({
    account: process.env.TASKNOTES_NATIVE_ACCOUNT,
    save: (report) =>
      writeFileSync("journey.json", JSON.stringify(report, null, 2)),
  });
  console.log(`android-native-journey: ${report.status}`);
  if (report.status !== "passed") process.exitCode = 1;
}
