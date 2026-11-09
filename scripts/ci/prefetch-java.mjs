import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  githubReleaseAsset,
  publicBytes,
} from "../lib/github-release-download.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const repository = "adoptium/temurin21-binaries";
const metadata =
  "https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=linux&vendor=eclipse&heap_size=normal";

export async function prefetchJava(
  directory,
  {
    token,
    fetchImpl = fetch,
    delays,
    platform = process.platform,
    arch = process.arch,
  } = {},
) {
  assert(token, "GitHub token required for Java release download");
  assert(
    platform === "linux" && arch === "x64",
    "Java release prefetch supports Linux x64 Android runners",
  );
  const versions = JSON.parse(await publicBytes(metadata, fetchImpl, delays));
  assert(
    Array.isArray(versions) && versions.length === 1,
    "Exact Temurin 21 release required",
  );
  const version = versions[0];
  const archive = version.binary?.package;
  assert(
    version.version?.major === 21 &&
      version.binary?.os === "linux" &&
      version.binary?.architecture === "x64" &&
      version.binary?.image_type === "jdk",
    "Exact Temurin 21 Linux x64 JDK required",
  );
  assert(
    /^jdk-21[\w.+-]*$/.test(version.release_name) &&
      /^[a-f0-9]{64}$/.test(archive?.checksum ?? ""),
    "Temurin archive checksum required",
  );
  assert(
    typeof archive.name === "string" &&
      /^[\w.+-]+\.tar\.gz$/.test(archive.name),
    "Exact Temurin archive name required",
  );
  const link = new URL(archive.link);
  assert(
    link.origin === "https://github.com" &&
      decodeURIComponent(link.pathname) ===
        `/${repository}/releases/download/${version.release_name}/${archive.name}` &&
      !link.search &&
      !link.hash,
    "Exact Temurin release asset URL required",
  );
  const path = join(directory, archive.name);
  try {
    if (sha256(await readFile(path)) === archive.checksum) return path;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const release = JSON.parse(
    await publicBytes(
      `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(version.release_name)}`,
      fetchImpl,
      delays,
      { authorization: `Bearer ${token}` },
    ),
  );
  assert(
    release.tag_name === version.release_name &&
      release.draft === false &&
      release.prerelease === false,
    "Exact published Temurin release required",
  );
  const assets =
    release.assets?.filter((asset) => asset.name === archive.name) ?? [];
  assert(assets.length === 1, "Exact Temurin release asset required");
  const bytes = await githubReleaseAsset(repository, assets[0], {
    token,
    fetchImpl,
    delays,
  });
  assert.equal(
    sha256(bytes),
    archive.checksum,
    "Temurin archive checksum mismatch",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(`${path}.partial`, bytes);
  await rename(`${path}.partial`, path);
  return path;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const path = await prefetchJava(
    join(process.env.RUNNER_TEMP, "verified-java"),
    { token: process.env.GITHUB_TOKEN },
  );
  await appendFile(process.env.GITHUB_ENV, `VERIFIED_JAVA_ARCHIVE=${path}\n`);
}
