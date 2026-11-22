// Store listing text kept in the repository (store/listing/<language>.json)
// and applied by the App Store and Google Play publishers with each release.
// Dependency-free: the publish workflows run without installing packages.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const STORE_LISTING_DIR = "store/listing";

// Store limits, counted in Unicode code points, except Apple keywords: App
// Store Connect caps them at 100 bytes of UTF-8, so Japanese, Korean,
// Chinese and Cyrillic keywords reach the limit well before 100 characters.
export const APPLE_KEYWORD_BYTES = 100;
export const LIMITS = {
  apple: {
    name: 30,
    subtitle: 30,
    keywords: 100,
    promotionalText: 170,
    description: 4000,
    whatsNew: 4000,
  },
  play: {
    title: 30,
    shortDescription: 80,
    fullDescription: 4000,
    whatsNew: 500,
  },
};

const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/;
const FILE_KEYS = new Set(["apple", "play", "description", "whatsNew"]);
const APPLE_KEYS = new Set([
  "locales",
  "name",
  "subtitle",
  "keywords",
  "promotionalText",
]);
const PLAY_KEYS = new Set(["languages", "title", "shortDescription"]);

const length = (text) => [...text].length;

function invalid(message) {
  return Object.assign(new Error(`Store listing: ${message}`), {
    refusal: "store-listing-invalid",
  });
}

function text(value, label, max, { optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || !value.trim())
    throw invalid(`${label} must be non-empty text`);
  if (value !== value.trim())
    throw invalid(`${label} has leading or trailing whitespace`);
  if (length(value) > max)
    throw invalid(
      `${label} is ${length(value)} characters; the limit is ${max}`,
    );
  return value;
}

function locales(value, label) {
  if (!Array.isArray(value) || !value.length)
    throw invalid(`${label} must list at least one locale`);
  for (const locale of value)
    if (typeof locale !== "string" || !LOCALE.test(locale))
      throw invalid(`${label} has an invalid locale`);
  return value;
}

function onlyKeys(object, allowed, label) {
  if (!object || typeof object !== "object" || Array.isArray(object))
    throw invalid(`${label} must be an object`);
  for (const key of Object.keys(object))
    if (!allowed.has(key)) throw invalid(`${label} has unknown field ${key}`);
}

function keywords(value, label) {
  const list = text(value, label, LIMITS.apple.keywords);
  const bytes = Buffer.byteLength(list, "utf8");
  if (bytes > APPLE_KEYWORD_BYTES)
    throw invalid(
      `${label} is ${bytes} bytes of UTF-8; the App Store limit is ${APPLE_KEYWORD_BYTES}`,
    );
  const words = list.split(",");
  if (words.some((word) => !word.trim() || word !== word.trim()))
    throw invalid(
      `${label} must be comma-separated without empty entries or padding`,
    );
  if (
    new Set(words.map((word) => word.toLocaleLowerCase())).size !== words.length
  )
    throw invalid(`${label} repeats a keyword`);
  return list;
}

/**
 * Validates parsed listing files and expands them to per-store locales.
 * `files` maps a file name (for messages) to its parsed JSON.
 */
export function expandListing(files) {
  const apple = {};
  const play = {};
  for (const [file, data] of Object.entries(files)) {
    onlyKeys(data, FILE_KEYS, file);
    if (!Array.isArray(data.description) || !data.description.length)
      throw invalid(`${file} description must be a list of lines`);
    if (data.description.some((line) => typeof line !== "string"))
      throw invalid(`${file} description lines must be text`);
    const description = data.description.join("\n");
    const whatsNew = text(
      data.whatsNew,
      `${file} whatsNew`,
      LIMITS.play.whatsNew,
      {
        optional: true,
      },
    );

    onlyKeys(data.apple, APPLE_KEYS, `${file} apple`);
    const appleEntry = {
      name: text(data.apple.name, `${file} apple.name`, LIMITS.apple.name),
      subtitle: text(
        data.apple.subtitle,
        `${file} apple.subtitle`,
        LIMITS.apple.subtitle,
      ),
      keywords: keywords(data.apple.keywords, `${file} apple.keywords`),
      promotionalText: text(
        data.apple.promotionalText,
        `${file} apple.promotionalText`,
        LIMITS.apple.promotionalText,
      ),
      description: text(
        description,
        `${file} description`,
        LIMITS.apple.description,
      ),
      ...(whatsNew ? { whatsNew } : {}),
    };
    for (const locale of locales(data.apple.locales, `${file} apple.locales`)) {
      if (apple[locale])
        throw invalid(`Apple locale ${locale} is listed twice`);
      apple[locale] = appleEntry;
    }

    onlyKeys(data.play, PLAY_KEYS, `${file} play`);
    const playEntry = {
      title: text(data.play.title, `${file} play.title`, LIMITS.play.title),
      shortDescription: text(
        data.play.shortDescription,
        `${file} play.shortDescription`,
        LIMITS.play.shortDescription,
      ),
      fullDescription: text(
        description,
        `${file} description`,
        LIMITS.play.fullDescription,
      ),
      ...(whatsNew ? { whatsNew } : {}),
    };
    for (const language of locales(
      data.play.languages,
      `${file} play.languages`,
    )) {
      if (play[language])
        throw invalid(`Play language ${language} is listed twice`);
      play[language] = playEntry;
    }
  }
  if (!Object.keys(apple).length) throw invalid("no listing files");
  return { apple, play };
}

export async function loadStoreListing(dir = STORE_LISTING_DIR) {
  const names = (await readdir(dir))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const files = {};
  for (const name of names) {
    try {
      files[name] = JSON.parse(await readFile(join(dir, name), "utf8"));
    } catch (error) {
      throw Object.assign(invalid(`${name} is not valid JSON`), {
        cause: error,
      });
    }
  }
  return expandListing(files);
}
