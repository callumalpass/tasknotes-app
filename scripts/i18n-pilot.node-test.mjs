import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatter } from "@lingui/format-po";
import { generateMessageId } from "@lingui/message-utils/generateMessageId";
import { messageContract, validateCatalogues } from "./lib/pilot-catalogue.mjs";

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
