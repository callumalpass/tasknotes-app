# Store listing text

These files are the source of the App Store and Google Play listing text. The
store publishers apply them with every release, so edit them here rather than
in App Store Connect or Play Console; console edits are overwritten by the next
release.

One file per app language. Each file holds:

- `apple`: the App Store locales it covers (may be empty), the app `name` (30), `subtitle`
  (30), `keywords` (100 _bytes_ of UTF-8, comma-separated with no spaces around commas, no
  words already in the name or subtitle) and `promotionalText` (170).
- `play`: the Google Play languages it covers, the `title` (30) and
  `shortDescription` (80).
- `description`: the full description for both stores, one entry per line
  (4000).
- `whatsNew`: optional release notes for both stores (500, Play's limit).
  They go out with the first release after they change; later releases say
  "TaskNotes x.y.z." until they are rewritten, so update them alongside a
  user-visible change. An explicit `docs/releases/ios/<version>.json` still
  wins on iOS, for every locale of its language.

Apple locales must be App Store Connect locale codes spelled exactly as Apple
does (`zh-Hans`, not `zh-CN`; `it`, not `it-IT`); the loader refuses others.
The loader also refuses en-GB and en-US: App Store Connect rejected both with
`STATE_ERROR.DUPLICATE_NAME.DIFFERENT_ACCOUNT` because another developer
account holds the app's name there. UK and US users see the primary English
listing. Google Play keeps en-GB and en-US. See "Name conflicts" in
`docs/mobile-store-automation.md`.

it, ja, ko, pt-BR, ru and zh-Hans are held, not refused. Their files list
`apple.locales: []` and keep all their text, and `APPLE_HELD_LOCALES` in
`scripts/store-listing.mjs` refuses them on the App Store until new locales are
created with their own name first. Google Play keeps these languages. See
"Held App Store locales" in `docs/mobile-store-automation.md`.

Numbers are the store limits in characters, except Apple keywords, which App
Store Connect counts in UTF-8 bytes: a Japanese, Korean or Chinese character
takes three and a Cyrillic letter two, so those lists hold far fewer than 100
characters. `scripts/store-listing.mjs` refuses a listing over any limit. Apple rejects metadata that names other mobile platforms, so keep
"Android" out of the `apple` fields and the shared description.

How each release applies them:

- **App Store** (`scripts/submit-app-store.mjs`): updates each listed locale's
  description, keywords, promotional text and release notes on the new
  version, creates listed locales the store does not have yet (copying the
  support and marketing URLs; a locale the live version does not have yet goes
  out without release notes, because App Store Connect has no "What's New" for
  a language's first release), and sets the name and subtitle on the editable
  app info (copying the privacy policy URL). Locales that only exist in App
  Store Connect keep their text and get the plain release line. Screenshots
  come from `store/screenshots` (see its README).
- **Google Play** (`scripts/publish-google-play.mjs`): in the same edit as the
  release, replaces the title and descriptions of every listed language whose
  text differs, keeping any promo video, and adds release notes for every
  listed language. Languages that only exist in Play Console are left alone.
  Graphics come from `store/screenshots` (see its README).

Listing changes go through store review together with the release.
