import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertSameRunArtifact,
  assertArchiveDigest,
  signedAndroidProof,
  sha256,
} from "./android-signed-artifact.mjs";
import { requirePolicy, REPO } from "./mobile-release-policy.mjs";
import { runNativeJourney } from "./run-android-wasm-journey.mjs";

const command = (program, args) =>
  execFileSync(program, args, {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
    maxBuffer: 256 * 1024 * 1024,
  });
const api = (path) =>
  JSON.parse(command("gh", ["api", `repos/${REPO}/${path}`]));
let phase = "source-binding";
let scratch;
try {
  // No externally supplied success JSON. This entrypoint itself must download,
  // hash, install and exercise this source run's retained signed application.
  await rm("qualification.json", { force: true });
  const context = {
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA,
    runId: Number(process.env.GITHUB_RUN_ID),
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
  };
  const version = JSON.parse(await readFile("package.json", "utf8")).version;
  const run = api(`actions/runs/${context.runId}`);
  scratch = await mkdtemp(join(tmpdir(), "tasknotes-signed-android-"));
  const retained = {};
  for (const [kind, id, digest] of [
    [
      "build",
      process.env.SIGNED_ARTIFACT_ID,
      process.env.SIGNED_ARTIFACT_DIGEST,
    ],
    [
      "host",
      process.env.TEST_HOST_ARTIFACT_ID,
      process.env.TEST_HOST_ARTIFACT_DIGEST,
    ],
  ]) {
    phase = `${kind}-artifact-binding`;
    requirePolicy(/^[1-9]\d*$/.test(id ?? ""), "artifact-id-required");
    const artifact = api(`actions/artifacts/${id}`);
    requirePolicy(artifact.id === Number(id), "artifact-id-mismatch");
    assertSameRunArtifact({ run, artifact, context, version, kind });
    const bytes = command("gh", [
      "api",
      `repos/${REPO}/actions/artifacts/${id}/zip`,
      "--allow-escape-sequences",
    ]);
    assertArchiveDigest(bytes, artifact, digest);
    const archive = join(scratch, `${kind}.zip`);
    await writeFile(archive, bytes);
    command("python3", [
      "scripts/android-artifact-extract.py",
      archive,
      scratch,
      kind,
    ]);
    retained[kind] = artifact;
  }
  phase = "signed-apk-verification";
  const tools = join(process.env.ANDROID_HOME, "build-tools");
  const versions = (await readdir(tools))
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  requirePolicy(versions.length > 0, "android-build-tools-required");
  const apksigner = join(tools, versions.at(-1), "apksigner");
  const certificate = (path) => {
    const certificates = [
      ...command(apksigner, ["verify", "--print-certs", path])
        .toString()
        .matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})$/gm),
    ].map((m) => m[1]);
    requirePolicy(
      certificates.length === 1,
      "one-apk-signing-certificate-required",
    );
    return certificates[0];
  };
  const apk = join(scratch, "application.apk");
  const host = join(scratch, "test-host.apk");
  requirePolicy(
    certificate(apk) === certificate(host),
    "instrumentation-signature-mismatch",
  );
  const analyzer = join(
    process.env.ANDROID_HOME,
    "cmdline-tools/latest/bin/apkanalyzer",
  );
  requirePolicy(
    command(analyzer, ["manifest", "debuggable", apk]).toString().trim() ===
      "false",
    "non-debuggable-release-required",
  );
  requirePolicy(
    command(analyzer, ["manifest", "application-id", apk]).toString().trim() ===
      "dev.tasknotes.app",
    "release-package-required",
  );
  requirePolicy(
    command(analyzer, ["manifest", "version-name", apk]).toString().trim() ===
      version,
    "release-version-mismatch",
  );
  phase = "exact-apk-installation";
  const apkSha256 = sha256(await readFile(apk));
  command("adb", ["install", apk]);
  command("adb", ["install", "-t", host]);
  const paths = command("adb", ["shell", "pm", "path", "dev.tasknotes.app"])
    .toString()
    .trim()
    .split(/\r?\n/);
  requirePolicy(
    paths.length === 1 &&
      /^package:\/data\/app\/[A-Za-z0-9_+~/=.-]+\/base\.apk$/.test(paths[0]),
    "one-installed-apk-required",
  );
  const installed = join(scratch, "installed.apk");
  command("adb", ["pull", paths[0].slice("package:".length), installed]);
  requirePolicy(
    sha256(await readFile(installed)) === apkSha256,
    "installed-apk-bytes-mismatch",
  );
  phase = "native-journey";
  const result = await runNativeJourney({
    account: process.env.TASKNOTES_NATIVE_ACCOUNT,
    save: (report) => {
      // Only fixed phases/checks, never exception bodies or account inputs.
      phase = report.phase;
    },
  });
  requirePolicy(result.status === "passed", "native-journey-failed");
  phase = "proof-emission";
  const proof = signedAndroidProof({
    context,
    run,
    artifact: retained.build,
    result,
    apkSha256,
    aabSha256: sha256(await readFile(join(scratch, "application.aab"))),
    host: retained.host,
  });
  await writeFile("qualification.json", JSON.stringify(proof, null, 2));
  console.log("signed-android-qualification: passed");
} catch {
  await rm("qualification.json", { force: true });
  await writeFile(
    "native-qualification-failure.json",
    JSON.stringify(
      {
        status: "failed",
        phase,
        category: "signed-native-qualification-failed",
      },
      null,
      2,
    ),
  );
  console.error(`signed-android-qualification: failed (${phase})`);
  process.exitCode = 1;
} finally {
  if (scratch) await rm(scratch, { recursive: true, force: true });
}
