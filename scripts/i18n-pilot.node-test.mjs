import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatter } from "@lingui/format-po";
import { generateMessageId } from "@lingui/message-utils/generateMessageId";
import { messageContract, validateCatalogues } from "./lib/pilot-catalogue.mjs";
import { assertCompleteCatalogue } from "./lib/catalogue-completeness.mjs";

const en = JSON.parse(
  await readFile(
    new URL("../src/i18n/locales/en/messages.json", import.meta.url),
    "utf8",
  ),
).messages;
const fr = JSON.parse(
  await readFile(
    new URL("../src/i18n/locales/fr/messages.json", import.meta.url),
    "utf8",
  ),
).messages;

test("real committed PO source/context pairs compile to generated JSON IDs", async () => {
  const po = formatter({}).parse(
    await readFile(
      new URL("../src/i18n/locales/en/messages.po", import.meta.url),
      "utf8",
    ),
    { locale: "en" },
  );
  for (const [id, entry] of Object.entries(po))
    assert.ok(
      en[generateMessageId(entry.message, entry.context)] &&
        id === generateMessageId(entry.message, entry.context),
    );
  validateCatalogues(en, fr);
});

test("French policy requires complete authored PO before compiler fallback", async () => {
  const policy = JSON.parse(
    await readFile(
      new URL("../src/i18n/locale-policy.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(policy.productionLocales, ["en"]);
  assert.deepEqual(policy.completeCatalogLocales, ["en", "fr"]);
  const po = formatter({}).parse(
    await readFile(
      new URL("../src/i18n/locales/fr/messages.po", import.meta.url),
      "utf8",
    ),
    { locale: "fr" },
  );
  assert.equal(assertCompleteCatalogue(po, "fr"), Object.keys(en).length);
  const required = policy.requiredTranslations.fr[0];
  assert.ok(po[required].translation);
  po[required].translation = "";
  // The already compiled fallback-capable JSON is still structurally valid.
  validateCatalogues(en, fr);
  assert.throws(
    () => assertCompleteCatalogue(po, "fr"),
    /missing before fallback/,
  );
  assert.equal(
    assertCompleteCatalogue(
      {
        retired: { obsolete: true, translation: "" },
        active: { translation: "Bonjour" },
      },
      "fr",
    ),
    1,
  );
});

test("selector cases, explicit zero and pound markers cannot disappear", () => {
  const source = {
    id: [
      [
        "count",
        "plural",
        { 0: ["No tasks"], one: ["# task"], other: ["# tasks"] },
      ],
    ],
  };
  assert.throws(
    () =>
      validateCatalogues(source, {
        id: [["count", "plural", { one: ["# tâche"], other: ["# tâches"] }]],
      }),
    /contract changed/,
  );
  assert.throws(
    () =>
      validateCatalogues(source, {
        id: [
          [
            "count",
            "plural",
            { 0: ["Aucune tâche"], one: ["une tâche"], other: ["# tâches"] },
          ],
        ],
      }),
    /contract changed/,
  );
});

test("source/context changes produce new IDs; translator guidance is not part of identity", () => {
  const original = generateMessageId("Collection", "settings section title");
  assert.notEqual(
    generateMessageId("Collections", "settings section title"),
    original,
  );
  assert.notEqual(
    generateMessageId("Collection", "a set of interface controls"),
    original,
  );
  assert.equal(
    generateMessageId("Collection", "settings section title"),
    original,
  );
});

test("validator rejects missing/renamed parameters and translator HTML", () => {
  assert.throws(
    () => validateCatalogues({ id: [["name"]] }, { id: [["nom"]] }),
    /contract changed/,
  );
  assert.throws(
    () => validateCatalogues({ id: [["name"]] }, { id: ["Bonjour"] }),
    /contract changed/,
  );
  assert.throws(
    () => messageContract(['<a href="javascript:bad">link</a>']),
    /numeric React/,
  );
  assert.throws(() => messageContract(["<0>link</1>"]), /Unbalanced/);
  assert.throws(
    () => validateCatalogues({ id: ["<0>link</0>"] }, { id: ["<1>lien</1>"] }),
    /contract changed/,
  );
});

test("plural needs other; arguments and rich-text tags survive reordering", () => {
  assert.throws(
    () => messageContract([["count", "plural", { one: ["one"] }]]),
    /requires other/,
  );
  validateCatalogues(
    { id: [["count", "plural", { one: ["# record"], other: ["# records"] }]] },
    {
      id: [
        ["count", "plural", { one: ["# document"], other: ["# documents"] }],
      ],
    },
  );
  validateCatalogues(
    { id: ["<0>", ["name"], "</0> hello"] },
    { id: ["Bonjour <0>", ["name"], "</0>"] },
  );
});
