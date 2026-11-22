// Store screenshots kept in the repository (store/screenshots, rendered by
// scripts/store-screenshots.mjs) and uploaded by the store publishers.
// Dependency-free: the publish workflows run without installing packages.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const STORE_MEDIA_DIR = "store/screenshots";
// Screenshots in the app's primary language. The App Store submitter puts
// them on every listed locale, which API-created localizations need.
const LOCALE = "en";

// App Store Connect has no separate 6.9" or 13" type: the largest iPhone and
// iPad types take those sizes, and Apple scales them for smaller devices.
const APPLE_SETS = {
  APP_IPHONE_67: { dir: "ios-iphone-69", width: 1320, height: 2868 },
  APP_IPAD_PRO_3GEN_129: { dir: "ios-ipad-13", width: 2064, height: 2752 },
};
// Play recommends 16:9 or 9:16 tablet screenshots, so the 3:4 iPad set is
// not reused there; tablets show the phone screenshots until a tablet set
// exists.
const PLAY_SETS = {
  phoneScreenshots: { dir: "play-phone", width: 1080, height: 1920, max: 8 },
};
const FEATURE_GRAPHIC = {
  file: "play-feature-graphic.png",
  width: 1024,
  height: 500,
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function invalid(message) {
  return Object.assign(new Error(`Store screenshots: ${message}`), {
    refusal: "store-media-invalid",
  });
}

function describe(fileName, bytes, { width, height }) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG))
    throw invalid(`${fileName} is not a PNG`);
  const actual = {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
  if (actual.width !== width || actual.height !== height)
    throw invalid(
      `${fileName} is ${actual.width}x${actual.height}, expected ${width}x${height}`,
    );
  // Colour type 2 is opaque RGB; Apple rejects screenshots with alpha.
  if (bytes[25] !== 2) throw invalid(`${fileName} must be an opaque RGB PNG`);
  return {
    fileName,
    bytes,
    md5: createHash("md5").update(bytes).digest("hex"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function readSet(root, { dir, ...size }, max = 10) {
  const path = join(root, dir, LOCALE);
  const names = (await readdir(path))
    .filter((name) => name.endsWith(".png"))
    .sort();
  if (!names.length || names.length > max)
    throw invalid(`${dir}/${LOCALE} needs 1 to ${max} PNG files`);
  return Promise.all(
    names.map(async (name) =>
      describe(name, await readFile(join(path, name)), size),
    ),
  );
}

export async function loadStoreMedia(root = STORE_MEDIA_DIR) {
  const apple = {};
  for (const [type, set] of Object.entries(APPLE_SETS))
    apple[type] = await readSet(root, set);
  const play = {};
  for (const [type, set] of Object.entries(PLAY_SETS))
    play[type] = await readSet(root, set, set.max);
  play.featureGraphic = [
    describe(
      FEATURE_GRAPHIC.file,
      await readFile(join(root, FEATURE_GRAPHIC.file)),
      FEATURE_GRAPHIC,
    ),
  ];
  return { apple, play };
}
