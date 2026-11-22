import test from "node:test";
import assert from "node:assert/strict";
import {
  APPLE_HELD_LOCALES,
  APPLE_KEYWORD_BYTES,
  APPLE_REFUSED_LOCALES,
  LIMITS,
  expandListing,
  loadStoreListing,
} from "./store-listing.mjs";

const file = () => ({
  apple: {
    locales: ["en-AU", "en-CA"],
    name: "TaskNotes",
    subtitle: "Tasks",
    keywords: "todo,gtd",
    promotionalText: "Promo",
  },
  play: { languages: ["en-US"], title: "TaskNotes", shortDescription: "Short" },
  description: ["Line one", "• Line two"],
  whatsNew: "Recent improvements.",
});

test("the committed store listing is valid for both stores", async () => {
  const listing = await loadStoreListing();
  assert.ok(listing.apple["en-AU"], "the primary App Store locale is listed");
  assert.ok(listing.play["en-US"], "the default Play language is listed");
  assert.ok(!listing.apple["en-GB"], "en-GB is not an App Store locale");
  assert.ok(!listing.apple["en-US"], "en-US is not an App Store locale");
  assert.ok(listing.play["en-GB"], "Google Play keeps en-GB");
  assert.ok(listing.play["en-US"], "Google Play keeps en-US");
  // Only the locales already on the 1.0.31 draft; the rest are held.
  assert.deepEqual(Object.keys(listing.apple), [
    "de-DE",
    "en-AU",
    "en-CA",
    "es-ES",
    "es-MX",
    "fr-FR",
    "fr-CA",
  ]);
  for (const entry of Object.values(listing.apple)) {
    for (const [field, max] of Object.entries(LIMITS.apple))
      if (entry[field]) assert.ok([...entry[field]].length <= max, field);
    assert.ok(
      Buffer.byteLength(entry.keywords, "utf8") <= APPLE_KEYWORD_BYTES,
      `${entry.name}: keywords exceed ${APPLE_KEYWORD_BYTES} bytes`,
    );
    // Apple indexes the name and subtitle already; repeating their words wastes keyword space.
    const titled = new Set(
      `${entry.name} ${entry.subtitle}`
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}]+/u),
    );
    for (const word of entry.keywords.split(","))
      assert.ok(
        !titled.has(word.toLocaleLowerCase()),
        `${entry.name}: ${word}`,
      );
  }
  for (const entry of Object.values(listing.play))
    for (const [field, max] of Object.entries(LIMITS.play))
      if (entry[field]) assert.ok([...entry[field]].length <= max, field);
});

test("held App Store locales keep their text and Google Play languages", async () => {
  const listing = await loadStoreListing();
  assert.deepEqual(
    [...APPLE_HELD_LOCALES.keys()],
    ["it", "ja", "ko", "pt-BR", "ru", "zh-Hans"],
  );
  for (const locale of APPLE_HELD_LOCALES.keys()) {
    assert.ok(!listing.apple[locale], `${locale} is not an App Store locale`);
    // Held is not refused: re-adding one is a decision, not a known conflict.
    assert.ok(!APPLE_REFUSED_LOCALES.has(locale), `${locale} is not refused`);
  }
  for (const language of ["it-IT", "ja-JP", "ko-KR", "pt-BR", "ru-RU", "zh-CN"])
    assert.ok(listing.play[language], `Google Play keeps ${language}`);
});

test("a language with no App Store locale is still validated", () => {
  const data = file();
  data.apple.locales = [];
  const { apple, play } = expandListing({
    "en.json": file(),
    "it.json": { ...data, play: { ...data.play, languages: ["it-IT"] } },
  });
  assert.deepEqual(Object.keys(apple), ["en-AU", "en-CA"]);
  assert.ok(play["it-IT"]);
  data.apple.name = "x".repeat(31);
  assert.throws(
    () => expandListing({ "en.json": file(), "it.json": data }),
    /it.json apple.name is 31 characters/,
  );
});

test("expands one language file to each store locale", () => {
  const { apple, play } = expandListing({ "en.json": file() });
  assert.deepEqual(Object.keys(apple), ["en-AU", "en-CA"]);
  assert.equal(apple["en-CA"].description, "Line one\n• Line two");
  assert.equal(play["en-US"].fullDescription, "Line one\n• Line two");
  assert.equal(play["en-US"].whatsNew, "Recent improvements.");
});

test("release notes are optional", () => {
  const data = file();
  delete data.whatsNew;
  assert.equal(
    expandListing({ "en.json": data }).apple["en-AU"].whatsNew,
    undefined,
  );
});

for (const [label, change, pattern] of [
  ["an over-long name", (d) => (d.apple.name = "x".repeat(31)), /limit is 30/],
  [
    "an over-long short description",
    (d) => (d.play.shortDescription = "x".repeat(81)),
    /limit is 80/,
  ],
  [
    "release notes over Play's limit",
    (d) => (d.whatsNew = "x".repeat(501)),
    /limit is 500/,
  ],
  [
    "padded keywords",
    (d) => (d.apple.keywords = "todo, gtd"),
    /comma-separated/,
  ],
  [
    // 38 characters but 104 bytes: within the character count, over the byte cap.
    "keywords over Apple's byte limit",
    (d) => (d.apple.keywords = `todo,${"タ".repeat(33)}`),
    /104 bytes of UTF-8; the App Store limit is 100/,
  ],
  ["repeated keywords", (d) => (d.apple.keywords = "todo,Todo"), /repeats/],
  ["an unknown field", (d) => (d.apple.icon = "x"), /unknown field/],
  [
    "an invalid locale",
    (d) => (d.play.languages = ["English"]),
    /invalid locale/,
  ],
  ["empty text", (d) => (d.apple.subtitle = " "), /non-empty/],
  [
    // Apple spells Simplified Chinese zh-Hans; zh-CN is a Play code.
    "a locale App Store Connect does not use",
    (d) => (d.apple.locales = ["zh-CN"]),
    /zh-CN, which is not an App Store locale/,
  ],
  [
    // Apple refused the en-GB localization: its name is taken there by an
    // app on another developer account.
    "en-GB, whose app name another developer account holds",
    (d) => (d.apple.locales = ["en-AU", "en-GB"]),
    /en-GB, which the App Store refuses: .*DUPLICATE_NAME\.DIFFERENT_ACCOUNT/,
  ],
  [
    // Apple refused the en-US localization for the same reason.
    "en-US, whose app name another developer account holds",
    (d) => (d.apple.locales = ["en-AU", "en-US"]),
    /en-US, which the App Store refuses: .*DUPLICATE_NAME\.DIFFERENT_ACCOUNT/,
  ],
  [
    // Held until new locales are created with their own name first.
    "a held App Store locale",
    (d) => (d.apple.locales = ["en-AU", "it"]),
    /it, which is on hold: .*own name/,
  ],
  [
    "an App Store locale in the wrong case",
    (d) => (d.apple.locales = ["zh-hans"]),
    /not an App Store locale/,
  ],
]) {
  test(`refuses ${label}`, () => {
    const data = file();
    change(data);
    assert.throws(
      () => expandListing({ "en.json": data }),
      (error) => {
        assert.match(error.message, pattern);
        assert.equal(error.refusal, "store-listing-invalid");
        return true;
      },
    );
  });
}

test("refuses a locale claimed by two files", () => {
  assert.throws(
    () => expandListing({ "a.json": file(), "b.json": file() }),
    /listed twice/,
  );
});
