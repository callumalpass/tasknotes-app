import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatter } from "@lingui/format-po";
import { generateMessageId } from "@lingui/message-utils/generateMessageId";
import { validateCatalogues } from "./lib/pilot-catalogue.mjs";
import { assertCompleteCatalogue } from "./lib/catalogue-completeness.mjs";

const load = async (locale) =>
  JSON.parse(await readFile(`src/i18n/locales/${locale}/messages.json`, "utf8"))
    .messages;
const english = await load("en");
validateCatalogues(english, await load("fr"));
const policy = JSON.parse(
  await readFile("src/i18n/locale-policy.json", "utf8"),
);
assert.deepEqual(
  policy.productionLocales,
  ["en"],
  "Production locale enablement is a separate decision",
);
const parsed = {};
for (const locale of ["en", "fr"]) {
  const entries = formatter({}).parse(
    await readFile(`src/i18n/locales/${locale}/messages.po`, "utf8"),
    { locale },
  );
  parsed[locale] = entries;
  for (const [id, entry] of Object.entries(entries)) {
    if (entry.obsolete) continue;
    assert.equal(
      id,
      generateMessageId(entry.message, entry.context),
      "Messages require IDs generated from source + semantic context",
    );
  }
}
assert.deepEqual(policy.completeCatalogLocales, ["en", "fr"]);
for (const locale of policy.completeCatalogLocales) {
  assertCompleteCatalogue(parsed[locale], locale);
}
for (const [locale, required] of Object.entries(policy.requiredTranslations)) {
  for (const id of required) {
    assert.ok(english[id], `Required source message disappeared: ${id}`);
    const entry = parsed[locale][id];
    assert.ok(
      entry && !entry.obsolete && entry.translation?.trim(),
      `Required ${locale} translation missing before fallback: ${id}`,
    );
  }
}
const active = Object.entries(parsed.fr).filter(([, entry]) => !entry.obsolete);
const translated = active.filter(([, entry]) =>
  entry.translation?.trim(),
).length;
console.log(
  `Application ICU/IDs validated; French PREVIEW: ${translated}/${active.length} authored, ${active.length - translated} missing before fallback. Complete catalogue and original French contracts checked; linguistic quality requires separate review.`,
);
