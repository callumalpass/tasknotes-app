import test from "node:test";
import assert from "node:assert/strict";
import {
  APPLE_KEYWORD_BYTES,
  LIMITS,
  expandListing,
  loadStoreListing,
} from "./store-listing.mjs";

const file = () => ({
  apple: {
    locales: ["en-AU", "en-US"],
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

test("expands one language file to each store locale", () => {
  const { apple, play } = expandListing({ "en.json": file() });
  assert.deepEqual(Object.keys(apple), ["en-AU", "en-US"]);
  assert.equal(apple["en-US"].description, "Line one\n• Line two");
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
