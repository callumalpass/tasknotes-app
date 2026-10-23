import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatter } from "@lingui/format-po";
import { setupI18n } from "@lingui/core";
import { compileMessageOrThrow } from "@lingui/message-utils/compileMessage";
import { generateMessageId } from "@lingui/message-utils/generateMessageId";
import {
  assertCompleteCatalogue,
  assertMessageContract,
} from "@mdbase-dev/i18n/checks";

const locales = ["en", "fr", "de", "es", "ja", "ko", "pt", "ru", "zh"];
const parse = async (locale) =>
  formatter({}).parse(
    await readFile(
      new URL(`../src/i18n/locales/${locale}/messages.po`, import.meta.url),
      "utf8",
    ),
    { locale },
  );
const english = await parse("en");
const policy = JSON.parse(
  await readFile(new URL("../i18n-policy.json", import.meta.url), "utf8"),
);

test("the shared-kit bin executes commands instead of silently skipping them", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("./bin.mjs", import.meta.resolve("@mdbase-dev/i18n/config")),
      ),
      "not-a-command",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: mdbase-i18n/);
});

test("committed PO source/context pairs use generated compiler JSON IDs", async () => {
  const compiled = JSON.parse(
    await readFile(
      new URL("../src/i18n/locales/en/messages.json", import.meta.url),
      "utf8",
    ),
  ).messages;
  for (const [id, entry] of Object.entries(english)) {
    if (entry.obsolete) continue;
    assert.equal(id, generateMessageId(entry.message, entry.context));
    assert.ok(compiled[id]);
  }
});

for (const locale of locales) {
  test(`${locale} requires complete authored PO before compiler fallback`, async () => {
    const target = await parse(locale);
    const allowed = policy.allowIdentical?.[locale] ?? [];
    // Report every broken ICU/rich-text contract in this locale in one round,
    // rather than bouncing translators through the remote queue one ID at a time.
    const contractErrors = [];
    for (const [id, entry] of Object.entries(english)) {
      if (entry.obsolete || !target[id]?.translation) continue;
      try {
        assertMessageContract(entry.message, target[id].translation, locale);
      } catch (error) {
        contractErrors.push(`${id}: ${error.message}`);
      }
    }
    assert.deepEqual(contractErrors, [], `${locale} translation contracts`);
    assert.equal(
      assertCompleteCatalogue(english, target, locale, allowed),
      Object.values(english).filter((entry) => !entry.obsolete).length,
    );
    const id = Object.keys(target).find((key) => !target[key].obsolete);
    target[id].translation = "";
    assert.throws(
      () => assertCompleteCatalogue(english, target, locale, allowed),
      /missing authored translation before fallback/,
    );
  });
}

test("select cases, exact zero and pound markers cannot disappear", () => {
  assert.throws(
    () =>
      assertMessageContract(
        "{count, plural, =0 {No tasks} one {# task} other {# tasks}}",
        "{count, plural, one {# tâche} other {# tâches}}",
        "fr",
      ),
    /exact numeric cases/,
  );
  assert.throws(
    () =>
      assertMessageContract(
        "{count, plural, one {# task} other {# tasks}}",
        "{count, plural, one {une tâche} other {# tâches}}",
        "fr",
      ),
    /pound markers/,
  );
  assert.throws(
    () =>
      assertMessageContract(
        "{state, select, open {Open} other {Closed}}",
        "{state, select, closed {Fermé} other {Ouvert}}",
        "fr",
      ),
    /select cases/,
  );
  assert.doesNotThrow(() =>
    assertMessageContract(
      "{count, plural, one {# task} other {# tasks}}",
      "{count, plural, other {# 件のタスク}}",
      "ja",
    ),
  );
});

for (const locale of locales) {
  for (const type of ["cardinal", "ordinal"]) {
    test(`${locale} ${type} contracts follow CLDR, not English case sets`, () => {
      const formattingLocale = locale === "pt" ? "pt-BR" : locale;
      const categories = new Intl.PluralRules(formattingLocale, {
        type,
      }).resolvedOptions().pluralCategories;
      const selector = type === "ordinal" ? "selectordinal" : "plural";
      const source =
        type === "ordinal"
          ? "{count, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}"
          : "{count, plural, =0 {none} one {# item} other {# items}}";
      // These are structural numeric fixtures, not authored catalogue copy.
      const target = `{count, ${selector}, ${type === "cardinal" ? "=0 {none} " : ""}${categories.map((key) => `${key} {# ${key}}`).join(" ")}}`;
      assert.doesNotThrow(() => assertMessageContract(source, target, locale));
      const runtime = setupI18n({
        locale,
        messages: { [locale]: { fixture: compileMessageOrThrow(target) } },
      });
      const rules = new Intl.PluralRules(formattingLocale, { type });
      for (const count of [0, 1, 2, 5, 11, 21, 22, 101]) {
        assert.equal(
          runtime._("fixture", { count }),
          type === "cardinal" && count === 0
            ? "none"
            : `${new Intl.NumberFormat(locale).format(count)} ${rules.select(count)}`,
        );
      }
      const unsupported = ["zero", "one", "two", "few", "many"].find(
        (key) => !categories.includes(key),
      );
      assert.ok(unsupported);
      const invalid = `{count, ${selector}, ${unsupported} {#} other {#}}`;
      assert.throws(
        () =>
          assertMessageContract(
            "{count, " + selector + ", other {#}}",
            invalid,
            locale,
          ),
        /Invalid plural category/,
      );
    });
  }
}

test("exact singular is distinct from grammatical one at 21 and 101", () => {
  const source = "{interval, plural, =1 {Every day} other {Every # days}}";
  const target =
    "{interval, plural, =1 {Каждый день} one {Раз в # день} few {Раз в # дня} many {Раз в # дней} other {Раз в # дня}}";
  assert.doesNotThrow(() => assertMessageContract(source, target, "ru"));
  assert.throws(
    () =>
      assertMessageContract(
        source,
        target.replace("=1 {Каждый день} ", ""),
        "ru",
      ),
    /exact numeric cases/,
  );
  assert.throws(
    () => assertMessageContract(source, target.replace("=1", "=2"), "ru"),
    /exact numeric cases/,
  );
  assert.throws(
    () =>
      assertMessageContract(
        source,
        target.replace("one {Раз в # день}", "one {Каждый день}"),
        "ru",
      ),
    /pound markers/,
  );
  assert.throws(
    () =>
      assertMessageContract(
        "{count, plural, =0 {# items} other {# items}}",
        "{count, plural, =0 {none} other {#}}",
        "en",
      ),
    /pound markers/,
  );
  assert.throws(
    () =>
      assertMessageContract(
        "{count, plural, offset:1 other {#}}",
        "{count, plural, other {#}}",
        "en",
      ),
    /offset/,
  );
  assert.throws(
    () =>
      assertMessageContract(
        "{count, plural, other {#}}",
        "{count, selectordinal, other {#}}",
        "en",
      ),
    /argument names\/types/,
  );
});

test("source/context changes produce new IDs; translator guidance is not identity", () => {
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

test("contracts reject missing/renamed parameters and translator HTML", () => {
  assert.throws(
    () => assertMessageContract("Hello {name}", "Bonjour {nom}", "fr"),
    /argument names/,
  );
  assert.throws(
    () => assertMessageContract("Hello {name}", "Bonjour", "fr"),
    /argument names/,
  );
  assert.throws(
    () =>
      assertMessageContract(
        "<0>link</0>",
        '<a href="javascript:bad">lien</a>',
        "fr",
      ),
    /numeric React/,
  );
  assert.throws(
    () => assertMessageContract("<0>link</0>", "<0>lien</1>", "fr"),
    /Unbalanced/,
  );
  assert.throws(
    () => assertMessageContract("<0>link</0>", "<1>lien</1>", "fr"),
    /placeholder tags/,
  );
  assert.doesNotThrow(() =>
    assertMessageContract("<0>{name}</0> hello", "Bonjour <0>{name}</0>", "fr"),
  );
});
