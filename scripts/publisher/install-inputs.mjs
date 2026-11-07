// Data-only ephemeral staging install; originals are never rewritten or repacked.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { publicBytes } from "./authentication.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function prepareInstall(
  plan,
  root = process.cwd(),
  fetchImpl = fetch,
) {
  if (plan.target === "production") return;
  if (plan.target !== "staging") throw Error("Unknown install target");
  const original = plan.sdkTrust.archives.sdk,
    bytes = await publicBytes(original.path, fetchImpl);
  if (hash(bytes) !== original.sha256) throw Error("Staging original changed");
  const path = join(root, "package.json"),
    pkg = JSON.parse(await readFile(path, "utf8"));
  const lockPath = join(root, "pnpm-lock.yaml"),
    lock = await readFile(lockPath, "utf8");
  if (hash(lock) !== plan.sdkTrust.lockSha256)
    throw Error("Source lock changed");
  const before = "file:" + plan.sdkTrust.production.path,
    after = "file:vendor/sdk-staging.tgz";
  if (pkg.dependencies["@mdbase-dev/sdk"] !== before)
    throw Error("Production source pin changed");
  const entry = `'@mdbase-dev/sdk':\n        specifier: ${before}\n        version: ${before}`;
  if (
    !lock.includes(entry) ||
    !lock.includes(
      `integrity: ${plan.sdkTrust.production.sri}, tarball: ${before}`,
    )
  )
    throw Error("Source frozen SDK changed");
  const alias = "@mdbase-dev/sdk-staging@" + after;
  const staged = lock
    .replaceAll("@mdbase-dev/sdk@" + before, alias)
    .replace("specifier: " + before, "specifier: " + after)
    .replaceAll("version: " + before, "version: '" + alias + "'")
    .replaceAll(
      "'@mdbase-dev/sdk': " + before,
      "'@mdbase-dev/sdk': '" + alias + "'",
    )
    .replace(
      `resolution: {integrity: ${plan.sdkTrust.production.sri}, tarball: ${before}}`,
      `resolution: {integrity: ${original.sri}, tarball: ${after}}\n    name: '@mdbase-dev/sdk-staging'`,
    );
  await writeFile(join(root, "vendor/sdk-staging.tgz"), bytes, { flag: "wx" });
  pkg.dependencies["@mdbase-dev/sdk"] = after;
  await writeFile(path, JSON.stringify(pkg, null, 2) + "\n");
  await writeFile(lockPath, staged);
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  await prepareInstall(JSON.parse(await readFile(process.argv[2], "utf8")));
