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

**Integration state:** the nine-locale runtime is implemented, but complete authored
catalogues and their final mechanical/browser gates are still pending. Compiled
fallback output is not evidence of a complete translation or permission to release.
Shared library catalogues must be composed from their own `/i18n` exports when the
coordinated library packages are available, not copied into application PO files.

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
The current French allowlist preserves genuinely shared vocabulary (for example
Collection, Date, Notes), prelocalized formatting skeletons, literal paths and
identifiers. It does not permit arbitrary English fallback.

The guard covers application, component and i18n UI directories; test fixtures,
tests and locale data are excluded. Extraction also includes `src/main.tsx`.
This is a structural guard, not proof that every dependency's copy is translated.
The app retains contract/source regression tests against the kit's real validators.
CI runs the check and rejects generated catalogue drift before its normal gates.

Browser acceptance uses isolated Playwright contexts, blocked external traffic,
and app-lane ports. `e2e/i18n.spec.ts` covers local collection controls, data and
language persistence. `e2e/i18n-production.acceptance.ts`, run with
`playwright.production-i18n.config.ts`, checks a normal production artifact:
all nine saved locales, browser negotiation, explicit preference precedence and
same-deployment lazy chunks. The retired `i18n-pilot` query has no authority.

## Shared-kit handoff

The app vendors kit `0.1.0-beta.141` from commit `096d80bf` as
`vendor/mdbase-dev-i18n-0.1.0-beta.141-096d80bf.tgz` (SHA256
`ba0d9ca37ab265482c8716672995523db9a5f56d15554507bf408b7dcf50e95b`).
Swap this file dependency for the published package at merge time, after the
coordinated Connect release. This branch does not publish or deploy anything.
Agent-authored translations have not received native-speaker certification.
