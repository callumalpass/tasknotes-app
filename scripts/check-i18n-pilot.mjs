import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatter } from "@lingui/format-po";
import { generateMessageId } from "@lingui/message-utils/generateMessageId";
import { validateCatalogues } from "./lib/pilot-catalogue.mjs";

const load = async (locale) =>
  JSON.parse(await readFile(`src/i18n/locales/${locale}/messages.json`, "utf8"))
    .messages;
validateCatalogues(await load("en"), await load("fr"));
for (const locale of ["en", "fr"]) {
  const entries = formatter({}).parse(
    await readFile(`src/i18n/locales/${locale}/messages.po`, "utf8"),
    { locale },
  );
  for (const [id, entry] of Object.entries(entries)) {
    if (entry.obsolete) continue;
    assert.equal(
      id,
      generateMessageId(entry.message, entry.context),
      "Pilot requires IDs generated from source + semantic context",
    );
  }
}
console.log(
  "Pilot JSON, generated IDs and ICU interpolation/markup contracts validated (en/fr).",
);
