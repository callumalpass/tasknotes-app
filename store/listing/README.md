# Store listing text

These files are the source of the App Store and Google Play listing text. The
store publishers apply them with every release, so edit them here rather than
in App Store Connect or Play Console; console edits are overwritten by the next
release.

One file per app language. Each file holds:

- `apple`: the App Store locales it covers, the app `name` (30), `subtitle`
  (30), `keywords` (100, comma-separated, no spaces, no words already in the
  name or subtitle) and `promotionalText` (170).
- `play`: the Google Play languages it covers, the `title` (30) and
  `shortDescription` (80).
- `description`: the full description for both stores, one entry per line
  (4000).
- `whatsNew`: optional rolling release notes for both stores (500, Play's
  limit). It is reused for every release until it changes, so describe recent
  improvements rather than a single version. Without it, releases say
  "TaskNotes x.y.z.".

Numbers are the store limits in characters; `scripts/store-listing.node-test.mjs`
checks them. Apple rejects metadata that names other mobile platforms, so keep
"Android" out of the `apple` fields and the shared description.

How each release applies them:

- **App Store** (`scripts/submit-app-store.mjs`): updates each listed locale's
  description, keywords, promotional text and release notes on the new
  version, creates listed locales the store does not have yet (copying the
  support and marketing URLs), and sets the name and subtitle on the editable
  app info (copying the privacy policy URL). Locales that only exist in App
  Store Connect keep their text and get the plain release line. Screenshots of
  new locales fall back to the primary locale's.
- **Google Play** (`scripts/publish-google-play.mjs`): in the same edit as the
  release, replaces the title and descriptions of every listed language whose
  text differs, keeping any promo video, and adds release notes for every
  listed language. Languages that only exist in Play Console are left alone.
  Graphics of new languages fall back to the default language's.

Listing changes go through store review together with the release.
