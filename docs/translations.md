# Interface translations

TaskNotes uses Lingui 6.9 with generated IDs from English source and semantic
context. The shared `@mdbase-dev/i18n` kit owns the config preset, runtime,
negotiation, picker primitive, CodeMirror dictionaries and mechanical checks.

## Supported languages

The runtime enables `en fr de es ja ko pt ru zh` in production. Portuguese is
Brazilian Portuguese (`pt-BR` for display formatting); Chinese is Simplified
Chinese (`zh-CN`). Catalogue and persisted keys remain two-letter language codes.
English is imported synchronously. Each other application catalogue and CodeMirror
phrase dictionary is a lazy chunk served by this application's own deployment.
No translation service, remote language-pack endpoint or AI credentials are used.

On startup, a supported explicit choice in `localStorage["tasknotes:locale"]`
wins; otherwise the first supported browser/OS language wins, then English.
Settings → Language changes the interface and saves a successful explicit choice.
`<html lang>` follows activation. A failed load keeps the working catalogue and
stored choice; Settings displays an error. Unavailable browser storage is
best-effort. This does not change repository, authorization or offline behaviour.

**Catalogue scope:** 1,294 active application messages. All eight QA-fixed v2
branches, their 13-ID v3 deltas and final two-ID v4 deltas are merged, with no
missing authored targets. `Collection access is unavailable.` (`8fU7nk`) is the
generic non-Error fallback; real authority diagnostics remain unchanged.
`Collection settings` (`1WKqDd`, context `settings access source label`) is
visible provenance after settings-access failure, not a navigation title. Both
resolve at render time without restarting repository effects. This is not
native-speaker certification or permission to release.

The shared `@mdbase-dev/ui` `/i18n` source is composed through the kit's `libraries`
option, using its exported singleton for presentation helpers. Library UI is never
copied into application PO files. Final UI/kit `a36fa009` prune obsolete entries
before compiling: the library has exactly 197 active compiled messages per locale,
without obsolete `nzHlj8`. Conflicts still fail closed and retain the current
language rather than overriding translations; successful composition remains a
product release gate.

## Authoring

- Mark English copy with `Trans`, `t` or message descriptors. Do not invent IDs.
- Give ambiguous short labels semantic context and translator comments.
- Use `useLingui()` in components so runtime switching updates labels and portals.
  Presentation helpers share the injected global Lingui instance; never translate
  eagerly at module scope or use translated text as keys, selectors or CSS.
- Author `src/i18n/locales/<locale>/messages.po`. JSON is compiler-owned.
- Preserve ICU argument names/types, select and exact-number cases, offsets,
  pound markers, and numeric React tags. Plural categories follow the target
  language, not English: Japanese/Chinese need not retain English `one`, while
  Russian needs its own categories.
- Never translate user-entered titles, saved view names, note paths, tags, status
  values, property mappings, recurrence rules, Markdown/NLP examples or protocol
  identifiers. Formatting and built-in display labels belong at presentation boundaries.
- CodeMirror lookup keys and `$` substitution tokens are fixed. The shared kit
  owns those messages; reconfigure its phrases through the existing compartment
  without replacing the document or undo history.

## Commands and checks

```sh
pnpm i18n:extract
pnpm i18n:compile
rpnpm i18n:check
rpnpm i18n:source
rpnpm test:release
```

`i18n:check` checks extraction sync; complete authored PO in **all nine locales
before fallback**; generated IDs; ICU/rich-text contracts; strict compilation;
and the source guard. Missing, fuzzy or untranslated English-placeholder entries
fail. Legitimate identical vocabulary, format skeletons, product names and paths
need a reviewed generated-ID entry in `i18n-policy.json` for each target locale.
The per-language allowlists preserve genuinely shared vocabulary (for example
French Collection/Date/Notes, German Status/Tags, Spanish Agenda/No), product names,
formatting skeletons, literal paths and identifiers. They do not permit arbitrary
English fallback.

The guard covers application, component and i18n UI directories; test fixtures,
tests and locale data are excluded. Extraction also includes `src/main.tsx`.
This is a structural guard, not proof that every dependency's copy is translated.
The app retains contract/source regression tests against the kit's real validators,
including cardinal/ordinal CLDR categories in all nine locales at 0/1/2/5/11/21/22/101.
Exact numeric cases, argument names/types, offsets and rich-text tags remain
contracts; no pound-marker exceptions are allowed. Singular phrases that omit a
number use `=1` rather than the language-dependent grammatical category `one`.

Kit `b4134d71` fixed the old symlink-sensitive bin guard; the temporary app CLI
adapter remains removed. Its successor `8785bd19` also follows local React state
rendered as copy to its initializers/setters, fixing the account-notice blind spot
(the old guard stopped at every call, including `setNotice`). Regression tests
reject both direct and conditional unmarked state notices, but accept whole-plural
messages and opaque state. Kit `5be277b8` adds field-level tracking to avoid
opaque-state false positives while detecting the two genuine fields above.
`i18n:check` now includes the kit's runtime-equivalent
`--compose` check against public UI, reporting all conflicting IDs and values.
CI rejects generated catalogue drift before its normal gates.

Browser acceptance uses isolated Playwright contexts, blocked external traffic,
and app-lane ports. `e2e/i18n.spec.ts` covers local collection controls, data and
language persistence. `e2e/i18n-production.acceptance.ts`, run with
`playwright.production-i18n.config.ts`, checks a normal production artifact:
all nine saved locales, browser negotiation, explicit preference precedence and
same-deployment lazy chunks. `e2e/i18n-final.spec.ts` checks real ja/de/ru rendering
at 0/1/2/5/11/21/22/101, inclusive month-end summaries and all three account notices
using isolated mock account ports (not real authority or native acceptance).
The retired `i18n-pilot` query has no authority.

**Vite compatibility:** the packed UI uses Node JSON import attributes. Vite's
optimizer relocates those dynamic imports without their files, and its production
bundler also leaves attributed imports unresolved. `uiCatalogueImports()`
normalizes only literal JSON imports with the exact `with: { type: "json" }`
option in the packed UI's `dist/i18n.js` before Vite analyzes them. The UI stays
outside dependency prebundling so both dev and builds resolve the real JSON
modules into same-deployment lazy chunks. Unknown attributes/options are untouched;
regressions cover all eight imports, module scoping and Vite version queries.
Authenticated archive bytes, catalogue values and fail-closed composition are
unchanged. Requalify this bundler integration when replacing the npm pins.

## Shared-kit handoff

The app adopted and hash-verified kit `b4134d71` (SHA256
`3cc9e231dd0ea2ef3cbb34112689e7ed227111f30d976ce0f94d6cd991520806`),
then advanced to its source-guard/composition successor `8785bd19`, same version
`0.1.0-beta.141`, as `vendor/mdbase-dev-i18n-0.1.0-beta.141-8785bd19.tgz`
(SHA256 `4eae06666795c7d7e8c24d5eb35ead06686e6f351b3d76d39f2b95f402c91af6`).
The field-aware successor `5be277b8` was subsequently superseded by final
**`a36fa00914af2aacef03b8e23cb566bee5531e4a`**, also `0.1.0-beta.141`:

- Kit: `vendor/mdbase-dev-i18n-0.1.0-beta.141-a36fa009.tgz`, 21,683 bytes,
  SHA256 `da2ae8145e5744733c29726a5b56f999c19f82bdd9d48c57d67da29cc18dd9b5`.
- UI: `vendor/mdbase-dev-ui-0.1.0-beta.141-a36fa009.tgz`, 129,246 bytes,
  SHA256 `e7199463d7f4d282cfd6f5f16e71dc1aa1029330a634f43112ae5b2f63dea7a0`.

Exact byte/hash/sha512 lockfile integrity regressions protect both final pins;
all original predecessor and earlier UI integration checks remain intact.
**Swap both vendored kit/UI file dependencies for published npm versions at merge
time**, after the coordinated Connect release, and rerun gates. This branch does
not publish or deploy anything. Agent-authored translations have not received
native-speaker certification. iOS acceptance remains explicitly waived/unverified,
not passed.
