import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prefetchJava } from "./prefetch-java.mjs";

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), "java-prefetch-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from("jdk archive");
  const tag = "jdk-21.0.9+10";
  const name = "OpenJDK21U-jdk_x64_linux_hotspot_21.0.9_10.tar.gz";
  const metadata = [
    {
      release_name: tag,
      version: { major: 21 },
      binary: {
        os: "linux",
        architecture: "x64",
        image_type: "jdk",
        package: {
          name,
          checksum: createHash("sha256").update(bytes).digest("hex"),
          link: `https://github.com/adoptium/temurin21-binaries/releases/download/${encodeURIComponent(tag)}/${name}`,
        },
      },
    },
  ];
  const release = {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: [{ name, id: 100 }],
  };
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push(url);
    if (url.startsWith("https://api.adoptium.net/")) {
      assert.equal(options.headers.authorization, undefined);
      return Response.json(metadata);
    }
    assert.equal(options.headers.authorization, "Bearer test-token");
    if (url.includes("/releases/tags/")) return Response.json(release);
    assert.equal(
      url,
      "https://api.github.com/repos/adoptium/temurin21-binaries/releases/assets/100",
    );
    assert.equal(options.headers.accept, "application/octet-stream");
    return new Response(bytes);
  };
  return {
    root,
    bytes,
    metadata,
    release,
    seen,
    options: {
      token: "test-token",
      fetchImpl,
      delays: [0, 0],
      platform: "linux",
      arch: "x64",
    },
  };
}

test("cold and poisoned Java caches use authenticated assets; warm caches recheck the upstream checksum", async (context) => {
  const data = await fixture(context);
  const path = await prefetchJava(data.root, data.options);
  assert.deepEqual(await readFile(path), data.bytes);
  assert.equal(data.seen.length, 3);
  data.seen.length = 0;
  assert.equal(await prefetchJava(data.root, data.options), path);
  assert.equal(data.seen.length, 1);
  await writeFile(path, "poisoned cache");
  data.seen.length = 0;
  await prefetchJava(data.root, data.options);
  assert.deepEqual(await readFile(path), data.bytes);
  assert.equal(data.seen.length, 3);
});

test("missing token, wrong metadata and tampered bytes fail closed", async (context) => {
  const data = await fixture(context);
  await assert.rejects(
    prefetchJava(data.root, { ...data.options, token: "" }),
    /token required/,
  );
  assert.equal(data.seen.length, 0);
  data.release.tag_name = "other";
  await assert.rejects(
    prefetchJava(data.root, data.options),
    /Exact published/,
  );
  data.release.tag_name = data.metadata[0].release_name;
  await assert.rejects(
    prefetchJava(data.root, {
      ...data.options,
      fetchImpl: (url, options) =>
        url.includes("/releases/assets/")
          ? new Response("tampered")
          : data.options.fetchImpl(url, options),
    }),
    /checksum mismatch/,
  );
});

test("Android uses only the verified local archive without changing its Gradle cache or enabling/disabling signature checks", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/android.yml", import.meta.url),
    "utf8",
  );
  assert.equal((workflow.match(/distribution: jdkfile/g) ?? []).length, 2);
  assert.equal(
    (workflow.match(/jdk-file: \$\{\{ env.VERIFIED_JAVA_ARCHIVE \}\}/g) ?? [])
      .length,
    2,
  );
  assert.equal((workflow.match(/cache: gradle/g) ?? []).length, 2);
  assert.equal(
    (workflow.match(/GITHUB_TOKEN: \$\{\{ github.token \}\}/g) ?? []).length,
    2,
  );
  assert.equal(workflow.includes("verify-signature:"), false);
});
