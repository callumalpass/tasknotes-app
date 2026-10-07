# Application translations

TaskNotes uses Lingui 6.9 across the application interface: collection access and recovery, navigation, views, search, task capture/editing/actions, settings, Scratchpad, dialogs, accessible announcements, and reusable controls. Presentation helpers localize built-in field/day labels, dates, recurrence summaries, counts and editor phrases. The provider-neutral `TaskRepository`, domain parsing and serialized record values remain unchanged.

**The French catalogue is complete; French is not enabled in production.** All 1130 active English messages have locally authored French translations, with zero missing before fallback. The original 16 French contracts are retained. One local writer completed three authoring batches and a second linguistic/context consistency pass over the full catalogue and corresponding source UI. This is not independent native-speaker certification. English remains the only production locale; French is a development/e2e preview.

## Preview and runtime

In development or an `e2e` build, open `more?demo=12&i18n-pilot=fr`, then navigate to other screens. The historical query parameter now selects the **application-wide** preview. The disposable demo requires no account or real collection. Normal production builds ignore this parameter and do not retain the preview catalogue in the bundle.

`src/i18n/app.ts` loads bundled English JSON synchronously before the application opens. `src/main.tsx` wraps the error boundary, collection gate and workspace in one `AppI18nProvider`; React portals retain that context. Document language and display-only Intl formatting use the selected locale. There are no language downloads, translation network requests or network-dependent startup steps. This does not make authoritative collection access work offline.

PO is authored data; compiled JSON contains ICU arrays/strings, never executable translation functions. Compiler-owned JSON is committed and validated. App remote delivery would need its own versioned ICU-data schema/loader; it must not reuse the plugin's legacy flat-string pack schema without a separate compatibility design.

## Mark copy, not data

Use conventional React and Lingui macros:

```tsx
const { t } = useLingui();
<button aria-label={t`Delete ${task.title}`}><Trans>Delete task</Trans></button>
<Plural value={count} _0="No tasks" one="# task" other="# tasks" />
```

- Translate source-owned visible copy, placeholders, accessible names, notices and announcements. Use whole ICU messages for counts rather than appending English `s` or interpolating English `task/tasks` choices.
- Add semantic context for ambiguous messages, and comments for interpretation or protected example syntax. Source text **and context** determine generated IDs; comments and glossary edits do not change IDs and still require linguistic review.
- Do not translate CSS classes, URLs, keys, enum/comparison values, protocol identifiers, record contents, user/authority-provided labels, collection names/paths or authority diagnostics. Explicit saved-view property labels and raw values remain untouched.
- Default record/view names and reminder descriptions stored as data remain data, even if originally seeded in English. Localize display fallbacks separately. NLP grammar and CEL/recurrence syntax are not translated by catalogue extraction; preserve executable tokens in examples.
- Do not nest translation macros inside a `t` template interpolation: the native transform leaves the inner call uncompiled. Resolve source-owned fallback fragments through the lazy `src/i18n/ui-copy.ts` helper, or translate them separately before composing the outer message. Never pass user data to that helper. Weekday display uses `appLocale()`/Intl without changing persisted weekday keys.
- Keep i18n in React/presentation code, not repository or domain logic. Module-level option labels must be lazy getters or created during rendering, not eager translations captured before locale activation.
- Use the shared `TRANSLATIONS.md` and `GLOSSARY.md` conventions; products retain separate catalogues and runtime schemas.

## Local authoring and deterministic checks

`lingui.config.ts` extracts marked messages from `src/app`, `src/components` and `src/i18n`, excluding tests. Extraction does not translate and does not indiscriminately collect every string literal.

```bash
pnpm i18n:extract
# Locally author/review target messages in src/i18n/locales/<locale>/messages.po.
pnpm i18n:check
pnpm test:release
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm build:e2e
```

`i18n:check` enforces extraction sync and complete **English and French authored PO before fallback** (`lingui check missing --mode catalog --locale fr`), then strict compilation, generated source/context IDs, and source/target ICU argument, selector/case, explicit-zero, pound-marker and numeric React-tag contracts. `src/i18n/locale-policy.json` records complete catalogues independently of English-only production and French preview eligibility. The raw-PO validator additionally rejects any missing active translation and retains the original pilot/ordinal requirements. Tests prove that structurally valid compiled output cannot hide a missing authored entry. These are mechanical checks, not linguistic certification.

The structural source guard rejects unmarked JSX/visible attributes, translations in identifier comparisons/lookups or CSS, eager module translations, and uncompiled nested macros. This is a regression guard, not proof that arbitrary English in every dependency/domain layer is interface copy; source review remains necessary. CI also rejects changes to committed generated catalogues and runs the guard's Node tests. CI never translates or calls an AI provider. A complete future production locale must get a pre-fallback completeness gate before being enabled.

Use `pnpm exec lingui extract --clean` only when deliberately retiring obsolete messages; keep useful obsolete translations during ordinary authoring/review. Never hand-edit generated JSON.

## Acceptance

Unit checks cover root/portal context, immediate network-free English, production/unsupported-locale fallback, document language, zero/one/many counts, French ordinals, record/label preservation, mapped date keys, composed French fallback fragments and CodeMirror substitution tokens. Existing UI tests render with real Lingui context rather than mocking translation calls.

```bash
# Fresh browser contexts and disposable demos; external traffic is blocked.
PLAYWRIGHT_SKIP_BROWSER_GC=1 pnpm exec playwright install chromium
TASKNOTES_DEV_PORT=18573 \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:18573 \
PLAYWRIGHT_WEB_SERVER_COMMAND='pnpm dev:e2e' \
pnpm exec playwright test e2e/i18n-pilot.spec.ts
```

Desktop and Pixel 7 browser-mode checks assert actual French settings, capture, accepted-write confirmation, task actions, editing/search, view editor and Scratchpad writing controls, with Axe. Stored demo titles, view names, collection labels and enum values intentionally remain data, including English seeded names. English demo regression acceptance is retained. Production-mode acceptance separately checks that a French query cannot activate the preview:

```bash
pnpm build
PLAYWRIGHT_BASE_URL=http://127.0.0.1:18574 \
PLAYWRIGHT_WEB_SERVER_COMMAND='pnpm preview --host 127.0.0.1 --port 18574' \
pnpm exec playwright test --config playwright.production-i18n.config.ts
```

These are web/browser checks, not physical-device or native-packaging acceptance.

## Linguistic review and next decisions

Reviewed neutral/France French uses tâche, document, collection, connexion, échéance, date planifiée, étiquette, Bloc-notes and plan consistently. Ambiguous action/state and hour/duration labels have separate source contexts. Retry/recovery copy keeps unconfirmed outcomes uncertain, never promises a successful write or an offline replica. English NLP examples, CEL/RRULE tokens, paths, links and ICU contracts remain intact. Two accidentally extracted non-copy strings (CSS transform and serialized calendar timestamp) were retired; five contextual entries were added. The concatenated Add + formula/projection identifier label became two whole messages instead of one fragment. These presentation-only changes take 1126 source messages to 1130 active messages.

Independent native-speaker review and physical-device/native packaging acceptance have **not** been run. Production enablement, a language picker, other locales, remote ICU delivery, publishing and releasing remain separate follow-up decisions.
