import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gh, REPO, requirePolicy } from "./mobile-release-policy.mjs";

export function verifyArchive(bytes, digest) {
  requirePolicy(
    /^sha256:[a-f0-9]{64}$/.test(digest ?? "") &&
      `sha256:${createHash("sha256").update(bytes).digest("hex")}` === digest,
    "signed-artifact-digest-mismatch",
  );
}
async function main() {
  const qualified = JSON.parse(
    await readFile("mobile-release-qualified.json", "utf8"),
  );
  const artifacts = gh(
    `repos/${REPO}/actions/runs/${qualified.sourceRunId}/artifacts?per_page=100`,
  ).artifacts;
  const matches = artifacts.filter(
    (artifact) =>
      !artifact.expired &&
      artifact.name === qualified.artifactName &&
      artifact.digest === qualified.artifactDigest,
  );
  requirePolicy(
    matches.length === 1 && Number.isSafeInteger(matches[0].id),
    "signed-artifact-custody-required",
  );
  const bytes = execFileSync(
    "gh",
    ["api", `repos/${REPO}/actions/artifacts/${matches[0].id}/zip`],
    { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 512 * 1024 * 1024 },
  );
  verifyArchive(bytes, qualified.artifactDigest);
  const archive = join(process.env.RUNNER_TEMP, "tasknotes-signed-android.zip");
  await writeFile(archive, bytes);
  const members = [
    "bundle/release/app-release.aab",
    "apk/release/app-release.apk",
  ];
  const entries = execFileSync("unzip", ["-Z", "-1", archive], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .trim()
    .split("\n");
  requirePolicy(
    members.every(
      (member) => entries.filter((entry) => entry === member).length === 1,
    ) &&
      entries.every(
        (entry) =>
          members.includes(entry) ||
          ["apk/", "apk/release/", "bundle/", "bundle/release/"].includes(
            entry,
          ),
      ),
    "signed-artifact-inventory-mismatch",
  );
  for (const member of members) {
    const destination = join("android-release", member);
    await mkdir(resolve(destination, ".."), { recursive: true });
    const content = execFileSync("unzip", ["-p", archive, member], {
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 512 * 1024 * 1024,
    });
    requirePolicy(content.length > 0, "empty-signed-artifact");
    await writeFile(destination, content);
  }
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
)
  main().catch(() => {
    console.error("Signed artifact custody refused.");
    process.exitCode = 1;
  });
