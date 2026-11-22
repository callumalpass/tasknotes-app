import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadStoreMedia, STORE_MEDIA_DIR } from "./store-media.mjs";

test("the committed screenshots load in file-name order with checksums", async () => {
  const { apple, play } = await loadStoreMedia();
  assert.deepEqual(Object.keys(apple), [
    "APP_IPHONE_67",
    "APP_IPAD_PRO_3GEN_129",
  ]);
  assert.deepEqual(Object.keys(play), [
    "phoneScreenshots",
    "tenInchScreenshots",
    "featureGraphic",
  ]);
  for (const files of [...Object.values(apple), ...Object.values(play)]) {
    const names = files.map((file) => file.fileName);
    assert.deepEqual(names, [...names].sort());
    for (const file of files) {
      assert.match(file.md5, /^[0-9a-f]{32}$/);
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
    }
  }
  assert.equal(play.featureGraphic.length, 1);
  assert.ok(play.phoneScreenshots.length >= 2);
});

async function withCopy(change) {
  // Keep scratch files in the worktree: /tmp is a shared, inode-limited tmpfs.
  const root = await mkdtemp(join("scripts", ".store-media-test-"));
  try {
    await cp(STORE_MEDIA_DIR, root, { recursive: true });
    await change(root);
    return await loadStoreMedia(root).then(
      () => null,
      (error) => error,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("wrong sizes, alpha channels and non-PNG files refuse before any upload", async () => {
  const first = join("ios-iphone-69", "en", "01-today.png");
  const cases = {
    "not a PNG": (root) => writeFile(join(root, first), "not an image"),
    "expected 1320x2868": async (root) => {
      const bytes = await readFile(join(root, first));
      bytes.writeUInt32BE(1290, 16);
      await writeFile(join(root, first), bytes);
    },
    "opaque RGB": async (root) => {
      const bytes = await readFile(join(root, first));
      bytes[25] = 6;
      await writeFile(join(root, first), bytes);
    },
    "needs 1 to 8": async (root) => {
      const dir = join(root, "play-phone", "en");
      const bytes = await readFile(join(dir, "01-today.png"));
      for (let index = 0; index < 3; index++)
        await writeFile(join(dir, `09-extra-${index}.png`), bytes);
    },
  };
  for (const [message, change] of Object.entries(cases)) {
    const error = await withCopy(change);
    assert.ok(error, message);
    assert.match(error.message, new RegExp(message));
    assert.equal(error.refusal, "store-media-invalid");
  }
});
